const ospath = require('path');

const rePath = /^(.*!)?(.*?)(\?.*)?$/;

/** @typedef {import('./index').Context} Context */

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
     * 
     * @param {Context} context The path resolver function to use.
     */
    constructor(context) {
        this.cache = context.cache.path;
        this.resolvePathFn = (request, issuer) => {
            return new Promise(ok => {
                const dir = ospath.dirname(issuer);
                context.loader.resolve(dir, request, (err, path) => {
                    err ? ok(null) : ok(path);
                });
            });
        };
    }

    /**
     * Resolves a Webpack request to an absolute path.  Any Webpack-specific
     * information attachments, loaders and queries, will be preserved.
     * 
     * @async
     * @param {string} request The relative path of the requested module.
     * @param {string} issuer The absolute path to the issuer of the request.
     * @returns {?string} The absolute path of the request or `null` if the
     * path could not be resolved correctly.
     */
    async resolve(request, issuer) {
        // the issuer cannot have loaders attached to it
        issuer = this.decompose(issuer).path;

        const decomposed = this.decompose(request);
        const resolvedPath = await this.resolveImpl(decomposed.path, issuer);
        return this.integrate(resolvedPath, decomposed);
    }

    /**
     * Resolves a Webpack request to an absolute path.  Any Webpack-specific
     * information attachments, loaders and queries, will be discarded.
     * 
     * @async
     * @param {string} request The relative path of the requested module.
     * @param {string} issuer The absolute path to the issuer of the request.
     * @returns {?string} The absolute path of the request or `null` if the
     * path could not be resolved correctly.
     */
    async resolvePath(request, issuer) {
        // the issuer cannot have loaders attached to it
        issuer = this.decompose(issuer).path;

        const decomposed = this.decompose(request);
        return await this.resolveImpl(decomposed.path, issuer);
    }

    /**
     * Decomposes a request path into its Webpack loaders, module path, and query.
     * 
     * @param {string} request The request to decompose.
     * @returns {DecomposedRequest} The decomposed request.
     */
    decompose(request) {
        const decomposedPath = rePath.exec(request);

        if (!decomposedPath)
            return { loaders: null, path: request, query: null };

        const [, loaders, path, query] = decomposedPath;
        return { loaders, path, query };
    }

    /**
     * Recomposes a {@link DecomposedRequest} back into a proper Webpack path.
     * 
     * @param {DecomposedRequest} decomposed The decomposed Webpack path object.
     * @returns {string} The recomposed request path.
     */
    recompose(decomposed) {
        if (!decomposed) return null;
        const { loaders, path, query } = decomposed;
        return [loaders, path, query].filter(Boolean).join('');
    }

    /**
     * Resolves a request path to an absolute path.
     * 
     * @private
     * @async
     * @param {string} request The request path, without loaders or query parameters.
     * @param {string} issuer The issuer of the request, without loaders or query parameters.
     * @returns {?string} The absolute path of the request or `null` if the
     * path could not be resolved correctly.
     */
    async resolveImpl(request, issuer) {
        const cacheKey = request + issuer;
        let resolvedPath = this.cache.get(cacheKey);

        if (typeof resolvedPath === 'undefined') {
            resolvedPath = await this.resolvePathFn(request, issuer);
            this.cache.set(cacheKey, resolvedPath);
        }

        return resolvedPath;
    }

    /**
     * Integrates the resolved path and a {@link DecomposedRequest} back into
     * a string.  This is just a helper for cleaner code.
     * 
     * @private
     * @param {string} resolvedPath The absolute path to the requested module.
     * @param {DecomposedRequest} decomposed The decomposed Webpack path.
     * @returns {?string} The reintegrated request path.
     */
    integrate(resolvedPath, decomposed) {
        if (!resolvedPath) return null;
        decomposed.path = resolvedPath;
        return this.recompose(decomposed);
    }
}

module.exports = PathResolver;
