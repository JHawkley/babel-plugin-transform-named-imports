const loaderUtils = require('loader-utils');
const babel = require('@babel/core');

const $ = require('./constants');
const common = require('./common');
const utils = require('./utils');
const errors = require('./errors');
const createBabelPlugin = require('./babel');
const validateOptions = require('./options').validate;
const { debugBase, report } = require('./debugging');
const { setupState, addTransforms, abortSignal } = require('./core');

/** @typedef {import('./debugging').Debug} Debug */
/** @typedef {import('./common').SourceMap} SourceMap */
/** @typedef {import('./common').LoaderContext} LoaderContext */
/** @typedef {import('./common').SharedContext} SharedContext */
/** @typedef {import('./options').LoaderOptions} LoaderOptions */
/** @typedef {import('./core').State} State */
/** @typedef {import('./astParser')} AstParser */
/** @typedef {import('./astParser').BabelAST} BabelAST */
/** @typedef {import('./specResolver').SpecifierResult} SpecifierResult */

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
 * The complete context for a single transform-loader.
 * 
 * @typedef {SharedContext & OwnContext} TransformContext
 */

/**
 * @param {State} state
 * @param {AstParser} astParser
 * @param {string} source
 * @returns {[SpecifierResult, BabelAST]}
 */
const resolveCachedAst = async (state, astParser, source) => {
    const { request, sourcePath, specResolver } = state;
    const [specifiers, specModule] = await specResolver.resolveModule(state, request);
    const ast = specModule.buildMeta[$.cachedAst] || await astParser.parse(sourcePath, source);

    return [specifiers, ast];
};

/**
 * @param {State} state
 * @param {AstParser} astParser
 * @param {string} source
 * @returns {[SpecifierResult, BabelAST]}
 */
const resolveNewAst = async (state, astParser, source) => {
    const { request, sourcePath, specResolver } = state;
    const specifiers = await specResolver.resolve(state, request);
    const ast = await astParser.parse(sourcePath, source);

    return [specifiers, ast];
};

/**
 * Performs the work necessary to generate the transformed source code.
 * 
 * @async
 * @param {string} source
 * The source code of the module.
 * @param {?SourceMap} sourceMap
 * The source-map of the module.
 * @param {TransformContext} context
 * The working context.
 * @returns {[string, SourceMap]}
 * A tuple of the output source code and source-map.
 */
const transform = async (source, sourceMap, context) => {
    const { astParser, unsafeAstCache } = context;
    const state = setupState(context);
    const resolverFn = unsafeAstCache ? resolveCachedAst : resolveNewAst;

    try {
        const [{ pathedSpecifiers }, ast] = await resolverFn(state, astParser, source);

        if (pathedSpecifiers.length === 0)
            return [source, sourceMap];

        const allTransformsMap = await addTransforms(state, pathedSpecifiers, new Map());
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
        switch (true) {
            case Object.is(error, abortSignal):
                // abort signal was thrown; just stop without
                // performing any transformations
                return [source, sourceMap];
            case error instanceof errors.SpecifierResolutionError:
            case error instanceof errors.AstParsingError:
                // consider these errors non-critical
                context.loader.emitWarning(error);
                context.loader.emitWarning(error.innerError);
                return [source, sourceMap];
            default:
                throw error;
        }
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
    const request = common.restoreRequest(resourcePath, instance);

    if (this.cacheable) this.cacheable();

    if (!request || !rootContext) {
        const inspection = require('util').inspect(this, { depth: 2, getters: true });
        debugBase('NO PATH AVAILABLE', inspection);
        this.callback(null, source, sourceMap, meta);
        return void 0;
    }

    const options = validateOptions(loaderUtils.getOptions(this));
    const sharedContext = common.getSharedContext(this, options);

    const callback = this.async();
    const moduleIdent = utils.contextRelative(rootContext, request);
    const debugLoader = sharedContext.debugRoot.extend(`${moduleIdent}:transform`);

    /** @type {TransformContext} */
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