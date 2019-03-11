const PathResolver = require('./pathResolver');

/**
 * Resolves the absolute path to a file using Webpack's resolver.
 * @deprecated This is now just a shim around {@link PathResolver} that
 * implements the {@link Resolver#resolveFile} method.  It is advised
 * to switch using PathResolver directly.
 */
class Resolver extends PathResolver {

    /**
     * Initializes a new instance of {@link Resolver}.
     * @param {string} webpackConfig Path to the webpack configuration file to use.
     * @param {number} webpackConfigIndex The index of the configuration to use in
     * case the specified configuration file is a multi-config file.
     */
    constructor(webpackConfig, webpackConfigIndex) {
        super({ webpackConfig, webpackConfigIndex });
    }

    /**
     * Resolves the absolute path to the specified path.
     * @param importPath The path to resolve.
     * @param source The path to make the import relative to.
     * @returns The absolute path to the specified `importPath` or null if the
     * file could not be resolved.
     */
    resolveFile(importPath, source) {
        return this.resolve(importPath, source);
    }

}

module.exports = Resolver;