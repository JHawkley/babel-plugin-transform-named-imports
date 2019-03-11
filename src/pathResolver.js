const path = require('path');

const resolver = require('eslint-import-resolver-webpack');

/**
 * Resolves the absolute path to a file using Webpack's resolver.
 */
class PathResolver {
    /**
     * Initializes a new instance of {@link PathResolver}.
     * @param {Object} opts The options that were provided to the plugin.
     * @param {string} [opts.webpackConfig] Path to the webpack configuration file to use.
     * @param {number} [opts.webpackConfigIndex] The index of the configuration to use in
     * case the specified configuration file is a multi-config file.
     */
    constructor({webpackConfig, webpackConfigIndex}) {
        this.cache = {};
        this.settings = {
            config: path.resolve(webpackConfig || './webpack.config.js'),
            'config-index': webpackConfigIndex || 0,
        };
    }

    /**
     * Gets the absolute path of a requested module.
     * @param {string} request The relative path of the requested module.
     * @param {string} issuer The absolute path to the issuer of the request.
     * @returns {string}
     */
    resolve(request, issuer) {
        const cacheKey = request + issuer;
        const cachedResult = this.cache[cacheKey];

        if (cachedResult !== undefined) {
            return cachedResult;
        }

        const result = resolver.resolve(request, issuer, this.settings);
        const resolvedPath = result.found ? result.path : null;

        this.cache[cacheKey] = resolvedPath;
        return resolvedPath;
    }
}

module.exports = PathResolver;
