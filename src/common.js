const debugModule = require('debug');
const nodeUtil = require('util');

const debugBase = debugModule(require('./constants').loaderName);
const debugPending = debugBase.extend('pending');

const utils = require('./utils');
const AstParser = require('./astParser');
const PathResolver = require('./pathResolver');
const SpecResolver = require('./specResolver');

/** @typedef {import('./options').LoaderOptions} LoaderOptions */

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
 * @typedef ResolvedLoader
 * @prop {string} ident
 * @prop {string} path
 * @prop {string} request
 */

/**
 * @typedef LoaderContext
 * @prop {string} request
 * @prop {string} resource
 * @prop {string} resourcePath
 * @prop {string} context
 * @prop {string} rootContext
 * @prop {number} loaderIndex
 * @prop {ResolvedLoader[]} loaders
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
 * @prop {AstParser} astParser
 * The shared AST parser instance.
 * @prop {PathResolver} pathResolver
 * The shared path resolver instance.
 * @prop {SpecResolver} specResolver
 * The shared specifier resolver instance.
 * @prop {Debug} debugRoot
 * The debug handle for the current loader instance.
 * @prop {boolean} unsafeAstCache
 * Whether to perform unsafe AST caching.
 */

/**
 * A custom debug formatter for arrays.
 * 
 * @param {*} v Any value, but best as an array.
 * @returns {string} The inspection output of `v`.
 */
debugModule.formatters.A = function arrayDebugFormatter(v) {
    if (!Array.isArray(v)) return debugModule.formatters.O(v);
    if (v.length === 0) return '[]';

    this.inspectOpts.colors = this.useColors;
    v = v.map(el => `    ${nodeUtil.inspect(el, this.inspectOpts).replace(/\n/g, '\n     ')},`);
    return [].concat('[', ...v, ']').join('\n');
};

/**
 * The shared contexts cache.
 * 
 * @type {WeakMap.<*, Map.<string, SharedContext>}
 */
const contexts = new WeakMap();

/**
 * Gets the shared context based on the given information.
 * 
 * @param {LoaderContext} loaderContext
 * The context of the loader.
 * @param {LoaderOptions} options
 * The options of the loader.
 * @param {boolean} [create=true]
 * Whether to create a context if one is not already available.
 * @returns {SharedContext}
 * The shared-context associated with this loader.
 */
const getSharedContext = (loaderContext, options, create = true) => {
    const loaderIdent = options.ident;
    const compilation = loaderContext._compilation;

    let compContexts = contexts.get(compilation);
    if (!compContexts) {
        compContexts = new Map();
        contexts.set(compilation, compContexts);
    }

    let sharedContext = compContexts.get(loaderIdent);
    if (!sharedContext && create) {
        debugBase('BUILDING SHARED CONTEXT', loaderIdent);
        const debugRoot = debugBase.extend(loaderIdent);

        const astParser = new AstParser(options);
        const pathResolver = new PathResolver(loaderContext);
        const specResolver = new SpecResolver();

        sharedContext = {
            debugRoot, astParser, pathResolver, specResolver,
            unsafeAstCache: options.unsafeAstCache,
            ident: loaderIdent
        };

        compContexts.set(loaderIdent, sharedContext);
    }

    return sharedContext || null;
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

/** Provides debug infrastructure for debugging deadlocks. */
const report = {
    timeoutHandle: null,
    pendingResources: [],
    registerLoader(request) {
        if (!debugPending.enabled) return;
        report.pendingResources.push(request);
    },
    unregisterLoader(request) {
        if (!debugPending.enabled) return;
        for (let i = report.pendingResources.length - 1; i >= 0; i -= 1)
            if (report.pendingResources[i] === request)
                return report.pendingResources[i] = null;
    },
    reportPendingLoaders() {
        report.timeoutHandle = null;
        report.pendingResources = report.pendingResources.filter(Boolean);
    
        if (contexts.size === 0 || report.pendingResources.length === 0)
            debugPending('NOTHING PENDING');
        else
            debugPending('AWAITING %A', report.pendingResources);
    },
    startReportPendingLoaders() {
        if (!debugPending.enabled) return;
        if (report.timeoutHandle) clearTimeout(report.timeoutHandle);
        report.timeoutHandle = setTimeout(report.reportPendingLoaders, 10000);
    }
};

module.exports = {
    debugBase,
    getSharedContext,
    restoreRequest,
    report
};