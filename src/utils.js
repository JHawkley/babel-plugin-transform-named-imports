const fs = require('fs');

/** @typedef {import('./pathResolver').DecomposedRequest} DecomposedRequest */

/**
 * @typedef WebpackProps
 * @prop {?string} loaders The loader portion of a request.
 * @prop {?string} query The query portion of a request.
 */

/** @type {WebpackProps} */
const emptyWebpackProps = Object.freeze({ loaders: null, query: null });

/**
 * @typedef SpecifierProps
 * @prop {?string} importPath The absolute path to the file imported.
 * @prop {WebpackProps} webpack The Webpack-specific parts of the path.
 */

/**
 * A helper for the specifier extractors, to assist in working with decomposed paths.
 * @param {string} request The original request path provided by the
 * import/export declaration.
 * @param {string} issuer The path to the module that issued the request.
 * @param {import('./pathResolver')} pathResolver A path-resolver instance.
 * @returns {SpecifierProps}
 */
const pathHelper = (request, issuer, pathResolver) => {
    if (request) {
        const decomposed = pathResolver.resolve(request, issuer);

        if (decomposed) {
            const { loaders, path, query } = decomposed;

            return {
                importPath: path,
                webpack: { loaders, query },
            };
        }
    }

    return {
        importPath: null,
        webpack: emptyWebpackProps,
    };
};

/**
 * A helper for {@link import('./ast') AST} to continue working.
 * @param {string} request The original request path provided by the
 * import/export declaration.
 * @param {string} issuer The path to the module that issued the request.
 * @param {import('./resolver')} resolver A resolver instance.
 * @returns {SpecifierProps}
 */
const pathHelper_legacy = (request, issuer, resolver) => {
    if (request) {
        const path = resolver.resolveFile(request, issuer);

        return {
            importPath: path,
            webpack: emptyWebpackProps,
        };
    }

    return {
        importPath: null,
        webpack: emptyWebpackProps,
    };
};

/**
 * Prefixes a path with './', the current path, if necessary.
 * @param {string} path The path.
 * @returns {string}
 */
const appendCurPath = path => path.startsWith('.') ? path : './' + path;

/**
 * Checks if a path exists; basically the same as `fs.exists` but
 * uses the non-deprecated method of checking for a path's existence.
 * @param {string} path The path whose existence is in question.
 * @returns {boolean}
 */
const pathExists = path => {
    try {
        // check if the path exists
        // yes, this is the currently recommended way to do it;
        // `fs.exists` is deprecated
        fs.accessSync(path);
        return true;
    }
    catch (error) {
        return false;
    }
};

/**
 * Wraps a potentially asynchronous function, awaiting any promises
 * returned by cycling Node's event-loop until it completes.
 * If the function did not return a promise, the return value
 * is returned immediately.
 * @template TArgs,TResult
 * @param {function(...TArgs): (TResult|Promise<TResult>)} fn
 * The potentially asynchronous function to wrap.
 * @returns {function(...TArgs): TResult} A function that always
 * invokes `fn` synchronously.
 */
const deasyncFn = (fn) => {
    const isPromise = require('is-promise');
    const deasync = require('deasync-promise');

    return function synchedFn() {
        const result = fn.apply(this, arguments);
        return isPromise(result) ? deasync(result) : result;
    };
};

module.exports = {
    emptyWebpackProps,
    pathHelper,
    pathHelper_legacy,
    appendCurPath,
    pathExists,
    deasyncFn,
};