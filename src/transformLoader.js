const loaderUtils = require('loader-utils');
const babel = require('@babel/core');

const { debugBase, report, contexts } = require('./common');
const { setupState, addImportTransforms, abortSignal } = require('./core');
const { createBabelPlugin } = require('./babel');
const { validate: validateOptions } = require('./options');
const utils = require('./utils');

const PathResolver = require('./pathResolver');
const SpecResolver = require('./specResolver');

/** @typedef {import('./index').Context} Context */
/** @typedef {import('./index').SourceMap} SourceMap */
/** @typedef {import('./index').WebpackModule} WebpackModule */
/** @typedef {import('./index').LoaderContext} LoaderContext */

/**
 * Restores the request string of a loaded resource.
 * Webpack adds a lot of non-relevant information to the `resource` property
 * of the loader context when it is created through `loadModule`.  This
 * information needs to be discarded and the original request path
 * reintegrated.
 * 
 * @param {string} resourcePath
 * The resource path, from the loader.
 * @param {WebpackModule} instance
 * The Webpack module instance.
 * @returns {string}
 * The regenerated request path.
 */
const restoreRequest = (resourcePath, instance) => {
    if (!resourcePath || !instance.rawRequest) return null;

    const [, loaders, query] = utils.decomposePath(instance.rawRequest);
    return [loaders, resourcePath, query].filter(Boolean).join('');
};

/**
 * Performs the work necessary to generate the transformed source code.
 * 
 * @async
 * @param {string} source
 * The source code of the module.
 * @param {?SourceMap} sourceMap
 * The source-map of the module.
 * @param {Context} context
 * The working context.
 * @returns {[string, SourceMap]}
 * A tuple of the output source code and source-map.
 */
const transform = async (source, sourceMap, context) => {
    const { request, loader, specResolver } = context;
    const { resourcePath, _module: instance } = loader;
    const state = setupState(context);

    const loadedModule = { request, resourcePath, source, instance };

    const registered = await specResolver.registerModule(state, loadedModule);
    if (!registered) return [source, sourceMap];

    const { ast, specifiers: { importSpecifiers } } = registered;
    if (importSpecifiers.length === 0) return [source, sourceMap];

    try {
        const allTransformsMap = await addImportTransforms(state, importSpecifiers, new Map());
        const babelPlugin = createBabelPlugin(allTransformsMap);

        const { code, map } = await babel.transformFromAstAsync(ast, source, {
            inputSourceMap: sourceMap || void 0,
            configFile: false,
            babelrc: false,
            plugins: [babelPlugin]
        });

        return [code, map];
    }
    catch (error) {
        if (Object.is(error, abortSignal)) {
            // abort signal was thrown; just stop without
            // performing any transformations
            return [source, sourceMap];
        }

        throw error;
    }
};

/**
 * @this {LoaderContext}
 * @param {string} source
 * The source code of the module.
 * @param {SourceMap} sourceMap
 * The source-map of the module.
 * @param {*} meta
 * The current loader meta-data.
 */
function transformImportsLoader(source, sourceMap, meta) {
    const { resourcePath, rootContext, _module: instance } = this;
    const request = restoreRequest(resourcePath, instance);

    if (this.cacheable) this.cacheable();

    if (!request || !rootContext) {
        const inspection = require('util').inspect(this, { depth: 2, getters: true });
        debugBase('NO PATH AVAILABLE', inspection);
        return this.callback(null, source, sourceMap, meta);
    }

    const options = validateOptions(loaderUtils.getOptions(this));
    const loaderIdent = options.ident;

    let sharedContext = contexts.get(this._compilation);
    if (!sharedContext) {
        const debugRoot = debugBase.extend(loaderIdent);
        debugRoot('BUILDING SHARED CONTEXT');

        const pathResolver = new PathResolver(this);
        const specResolver = new SpecResolver(this, options, pathResolver, debugRoot);

        sharedContext = {
            debugRoot, pathResolver, specResolver,
            ident: loaderIdent
        };

        contexts.set(this._compilation, sharedContext);
    }

    const callback = this.async();
    const moduleIdent = utils.contextRelative(rootContext, request);
    const debugLoader = sharedContext.debugRoot.extend(moduleIdent);

    /** @type {Context} */
    const context = Object.assign({}, sharedContext, {
        request, options, debugLoader,
        loader: this
    });

    report.startReportPendingLoaders();
    report.registerLoader(request);
    debugLoader('START');

    transform(source, sourceMap, context).then(
        ([code, map]) => {
            debugLoader('DONE');
            report.unregisterLoader(request);
            callback(null, code, map, meta);
        },
        (err) => {
            debugLoader('FAILED', err);
            report.unregisterLoader(request);
            callback(err);
        }
    );
    
    return void 0;
}

module.exports = transformImportsLoader;