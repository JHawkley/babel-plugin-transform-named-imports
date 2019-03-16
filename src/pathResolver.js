const path = require('path');

const resolver = require('eslint-import-resolver-webpack');

const rePath = /^(.*!)?(.*?)(\?.*)?$/;

/** @typedef {import('./options').PluginOptions} PluginOptions */

/**
 * @typedef DecomposedRequest
 * @prop {?string} loaders The loader portion of a request.
 * @prop {string} path The module path portion of a request.
 * @prop {?string} query The query portion of a request.
 */

/**
 * Resolves the absolute path to a file using Webpack's resolver.
 */
class PathResolver {

    /**
     * Initializes a new instance of {@link PathResolver}.
     * @param {PluginOptions} options The options that were provided to the plugin.
     */
    constructor(options) {
        this.cache = {};
        this.settings = {
            config: path.resolve(options.webpackConfig),
            'config-index': options.webpackConfigIndex,
        };
    }

    /**
     * Decomposes a Webpack request path and resolves the `path` component
     * to an absolute path, returning the decomposed result.  Use
     * {@link PathResolver#recompose} to restore the full path.
     * @param {string} request The relative path of the requested module.
     * @param {string} issuer The absolute path to the issuer of the request.
     * @returns {?DecomposedRequest} An object representing the decomposed
     * Webpack request or `null` if the path could not be resolved.
     */
    resolve(request, issuer) {
        const decomposed = this.decompose(request);
        const requestPath = decomposed.path;
        const cacheKey = requestPath + issuer;
        const cachedResult = this.cache[cacheKey];

        if (cachedResult !== undefined) {
            return this.integrate(cachedResult, decomposed);
        }

        const result = resolver.resolve(requestPath, issuer, this.settings);
        const resolvedPath = result.found ? result.path : null;

        this.cache[cacheKey] = resolvedPath;
        return this.integrate(resolvedPath, decomposed);
    }

    /**
     * Integrates the resolved path back into a {@link DecomposedRequest}.
     * This is just a helper for cleaner code.
     * @param {string} resolvedPath The absolute path to the requested module.
     * @param {DecomposedRequest} decomposed The decomposed Webpack path.
     * @returns {?DecomposedRequest}
     */
    integrate(resolvedPath, decomposed) {
        if (!resolvedPath) {
            return null;
        }

        decomposed.path = resolvedPath;
        return decomposed;
    }

    /**
     * Decomposes a request path into its Webpack loaders, module path, and query.
     * @param {string} request The request to decompose.
     * @returns {DecomposedRequest}
     */
    decompose(request) {
        const decomposedPath = rePath.exec(request);

        if (!decomposedPath) {
            return { loaders: null, path: request, query: null };
        }

        const [, loaders, path, query] = decomposedPath;
        return { loaders, path, query };
    }

    /**
     * Recomposes a {@link DecomposedRequest} back into a proper Webpack path.
     * @param {DecomposedRequest} decomposed The decomposed Webpack path object.
     * @returns {string}
     */
    recompose(decomposed) {
        if (!decomposed) {
            return null;
        }

        const { loaders, path, query } = decomposed;
        return [loaders, path, query].filter(Boolean).join('');
    }
}

module.exports = PathResolver;
