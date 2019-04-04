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
 * The complete context for a single loader.
 * 
 * @typedef {SharedContext & OwnContext} Context
 */

module.exports = require('./transformLoader');