const debugFn = require('debug');
const debugBase = debugFn(require('./constants').loaderName);
const loaderUtils = require('loader-utils');
const babel = require('@babel/core');

const core = require('./core');
const utils = require('./utils');
const validateOptions = require('./options').validate;
const { createBabelPlugin } = require('./babel');
const PathResolver = require('./pathResolver');
const SpecResolver = require('./specResolver');

const setupState = core.setupState;
const addImportTransforms = core.addImportTransforms;

/** @typedef {import('./options').LoaderOptions} LoaderOptions */
/** @typedef {import('./specResolver').SpecifierResult} SpecifierResult */
/** @typedef {import('./specResolver').LoadedModule} LoadedModule */
/** @typedef {import('./babel').BabelAST} BabelAST */
/** @typedef {import('./babel').ImportNode} ImportNode */
/** @typedef {import('./babel').AllTransformsMap} AllTransformsMap */
/** @typedef SourceMap */

/**
 * @callback DebugFunction
 * @param {...*} args
 * The arguments to log.  When the first argument is a string, any
 * other arguments can be integrated into the string through
 * `printf` style formatters.
 */

/**
 * @typedef DebugProps
 * @prop {boolean} enabled
 * Whether the debug instance is enabled.
 * @prop {function(string): Debug} extend
 * Extends the debug function with a new namespace.
 */

/** @typedef {DebugFunction & DebugProps} Debug */

/**
 * @typedef WebpackModule
 * @prop {Object} [factoryMeta]
 * @prop {boolean} factoryMeta.sideEffectFree
 */

/**
 * @typedef LoaderContext
 * @prop {string} request
 * @prop {string} resource
 * @prop {string} resourcePath
 * @prop {string} rootContext
 * @prop {WebpackModule} _module
 * @prop {function(): void} [cacheable]
 * @prop {function(): function(Error, string, SourceMap, *): void} async
 * @prop {function(string, function(Error, string, SourceMap, WebpackModule): void): void} loadModule
 * @prop {function(string, string, function(Error, string): void): void} resolve
 * @prop {function(Error): void} emitWarning
 * @prop {function(Error): void} emitError
 */

/** 
 * @typedef SharedContext
 * @prop {string} ident
 * The `ident` the context was created for.
 * @prop {PathResolver} pathResolver
 * The shared path resolver instance.
 * @prop {SpecResolver} specResolver
 * The shared specifier resolver instance.
 * @prop {Debug} debugRoot
 * The debug handle for the current loader instance.
 */

/**
 * @typedef OwnContext
 * @prop {string} request
 * The restored request path.
 * @prop {LoaderOptions} options
 * The options for the current loader instance.
 * @prop {LoaderContext} loader
 * The context object of the current loader instance.
 * @prop {Debug} debugLoader
 * The debug handle for the current loader instance.
 */

/**
 * @typedef {SharedContext & OwnContext} Context
 */

/** A custom debug formatter for arrays. */
debugFn.formatters.A = (() => {
    const util = require('util');
    return function(v) {
        if (!Array.isArray(v)) return debugFn.formatters.O(v);
        if (v.length === 0) return '[]';

        this.inspectOpts.colors = this.useColors;
        v = v.map(el => `    ${util.inspect(el, this.inspectOpts).replace(/\n/g, '\n     ')},`);
        return [].concat('[', ...v, ']').join('\n');
    };
})();

/** @type {WeakMap.<*, SharedContext} */
const contexts = new WeakMap();

// some debug infrastructure for determining progress

const debugPending = debugBase.extend('pending');
let timeoutHandle = null;
let pendingResources = [];

const registerLoader = (request) => {
    if (!debugPending.enabled) return;
    pendingResources.push(request);
};

const unregisterLoader = (request) => {
    if (!debugPending.enabled) return;
    for (let i = pendingResources.length - 1; i >= 0; i -= 1)
        if (pendingResources[i] === request)
            return pendingResources[i] = null;
};

const reportPendingLoaders = () => {
    timeoutHandle = null;
    pendingResources = pendingResources.filter(Boolean);

    if (contexts.size === 0 || pendingResources.length === 0)
        debugPending('NOTHING PENDING');
    else
        debugPending('AWAITING %A', pendingResources);
};

const startReportPendingLoaders = () => {
    if (!debugPending.enabled) return;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    timeoutHandle = setTimeout(reportPendingLoaders, 10000);
};

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
        if (Object.is(error, core.abortSignal)) {
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

    startReportPendingLoaders();
    registerLoader(request);
    debugLoader('START');

    transform(source, sourceMap, context).then(
        ([code, map]) => {
            debugLoader('DONE');
            unregisterLoader(request);
            callback(null, code, map, meta);
        },
        (err) => {
            debugLoader('FAILED', err);
            unregisterLoader(request);
            callback(err);
        }
    );
    
    return void 0;
}

module.exports = transformImportsLoader;