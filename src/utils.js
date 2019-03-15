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

module.exports = {
    emptyWebpackProps,
    pathHelper,
    pathHelper_legacy,
    appendCurPath,
};