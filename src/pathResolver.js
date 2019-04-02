const ospath = require('path');
const utils = require('./utils');

/** @typedef {import('./index').LoaderContext} LoaderContext */
/** @typedef {import('./index').Debug} Debug */

/**
 * A class containing information about a resolved path.
 */
class ResolvedPath {

    /**
     * Creates an instance of {@link ResolvedPath}.
     * 
     * @param {string} originalPath
     * The original path to this resource, as it was provided.
     * @param {string} resolvedPath
     * The resolved, absolute path to this resource.
     * @param {string} loaders
     * The loader portion of the path extracted from the original path string.
     * @param {string} query
     * The query portion of the path extracted from the original path string.
     */
    constructor(originalPath, resolvedPath, loaders, query) {
        /** The original path to this resource, as it was provided. */
        this.originalPath = originalPath;

        /** The resolved, absolute path to this resource. */
        this.resolvedPath = resolvedPath;

        /** The context directory of this resource. */
        this.context = ospath.dirname(resolvedPath);

        /** The loader portion of the path extracted from the original path string. */
        this.loaders = loaders;

        /** The query portion of the path extracted from the original path string. */
        this.query = query;

        /** The original Webpack path, including loaders and query. */
        this.original = [loaders, originalPath, query].filter(Boolean).join('');

        /** The resolved Webpack path, including loaders and query. */
        this.resolved = [loaders, resolvedPath, query].filter(Boolean).join('');
    }

    /**
     * Creates a full Webpack path from this instance.
     *
     * @param {string} [context]
     * A context directory to which to make the path relative to.
     * @returns {string}
     * The full Webpack path.
     */
    toString(context) {
        if (!context) return this.resolved;

        const { resolvedPath, loaders, query } = this;
        const path = utils.appendCurPath(ospath.relative(context, resolvedPath));
        return [loaders, path, query].filter(Boolean).join('');
    }
}

/**
 * Resolves the absolute path to a file using Webpack's resolver.
 */
class PathResolver {

    /**
     * Initializes a new instance of {@link PathResolver}.
     * 
     * @param {LoaderContext} loader
     * The loader context.
     */
    constructor(loader) {
        /** @type {Map.<string, Promise.<string>} */
        this.cache = new Map();

        /**
         * @function
         * @param {string} request
         * @param {string} issuer
         * @returns {Promise.<string>}
         */
        this.resolvePathFn = (request, issuer) => {
            return new Promise((ok, fail) => {
                const context = ospath.dirname(issuer);
                loader.resolve(context, request,
                    (err, path) => err ? fail(err) : ok(path)
                );
            });
        };
    }

    /**
     * Resolves a Webpack request and returns an object containing information
     * about the path.
     * 
     * @async
     * @param {string} request
     * The relative path of the requested module.
     * @param {string} issuer
     * The absolute path to the issuer of the request.
     * @param {Debug} [debug]
     * The debug instance to log to in the case of an error.
     * @returns {ResolvedPath}
     * An object that has information about the resolved path.
     * @throws {Error}
     * When the path could not be resolved.
     */
    async resolve(request, issuer, debug) {
        try {
            // the issuer cannot have loaders attached to it
            const [issuerPath] = utils.decomposePath(issuer);

            const [requestPath, loaders, query] = utils.decomposePath(request);
            const resolvedPath = await this.resolveImpl(requestPath, issuerPath);
            return new ResolvedPath(requestPath, resolvedPath, loaders, query);
        }
        catch (error) {
            if (debug) debug('PATH RESOLVE ERROR', error);
            throw error;
        }
    }

    /**
     * Resolves a request path to an absolute path.
     * 
     * @private
     * @async
     * @param {string} request
     * The request path, without loaders or query parameters.
     * @param {string} issuer
     * The issuer of the request, without loaders or query parameters.
     * @returns {string}
     * The absolute path of the request.
     * @throws {Error}
     * When the path could not be resolved.
     */
    async resolveImpl(request, issuer) {
        const cacheKey = `${issuer} => ${request}`;
        let resolvingPath = this.cache.get(cacheKey);

        if (typeof resolvingPath === 'undefined') {
            resolvingPath = this.resolvePathFn(request, issuer);
            this.cache.set(cacheKey, resolvingPath);
        }

        return await resolvingPath;
    }
}

module.exports = PathResolver;
module.exports.ResolvedPath = ResolvedPath;