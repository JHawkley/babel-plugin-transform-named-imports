const ospath = require('path');
const loaderUtils = require('loader-utils');

/**
 * The options recognized by the plugin.
 * @typedef LoaderOptions
 * @prop {string} [ident]
 * A string identifying the current loader.  This is used for creating multiple
 * caches, in case of concurrent compilations.  If not provided, an identifier
 * will be created by hashing the contents of the options object.
 * @prop {boolean} [syncMode]
 * When `true`, the loader will perform its loading synchronously, transforming
 * only one file at a time instead of executing all possible transformations all
 * at once.  If you have issues compiling your bundle, enabling this may allow
 * your bundle to compile.
 * @prop {boolean} [transformDefaultImports]
 * Whether to try and transform default imports and exports.
 * @prop {boolean} [transformSideEffects]
 * When `true`, side-effecting modules that are encountered will still be
 * transformed, however this will add a side-effecting import to the result
 * to ensure the side-effects still execute.
 * @prop {(string|Object)} [babelConfig]
 * When provided, this config will be provided to Babel when parsing modules
 * into an AST.  Can be either an absolute path to a config file or a config
 * object which will be mixed into the loader's required options.  Babel
 * is usually smart enough to obtain configuration itself, so this option
 * is mostly intended for testing purposes.
 * @prop {boolean} [unsafeAstCaching]
 * When `true`, the loader will try to save some work by caching the Babel
 * AST on the Webpack module object after resolving the specifiers of
 * a module.  This generally should work, however it makes the assumption that
 * the `spec-loader` is getting the same source that the `transform-loader`
 * is working with.  If another loader changes the loaders during the `pitch`
 * phase, this could break that assumption.
 */

/** @type {LoaderOptions} */
const defaultLoaderOptions = Object.freeze({
    syncMode: false,
    transformDefaultImports: false,
    transformSideEffects: false,
    babelConfig: null,
    unsafeAstCaching: false
});

const doError = (messages) => {
    if (!Array.isArray(messages))
        messages = [messages];

    messages.push('please check the options provided to the `transform-imports` Webpack loader');
    return new Error(messages.join('; '));
};

const getIdent = (options) => {
    if (typeof options.ident === 'string') return options.ident;

    const json = JSON.stringify(options, (k, v) => {
        if (typeof v !== 'function') return v;
        if (v.name) return `${v.name}::${v.toString()}`;
        return v.toString();
    });

    return loaderUtils.getHashDigest(json, 'md5', 'hex', 32);
};

/**
 * Validates the plugin's options object and finalizes the options.
 * 
 * @param {LoaderOptions} options The options object to validate.
 * @returns {LoaderOptions} The finalized options.
 * @throws When the provided options object fails validation.
 */
const validate = (options) => {
    options = Object.assign({}, defaultLoaderOptions, options, { ident: getIdent(options) });

    if (typeof options.syncMode !== 'boolean')
        throw doError('the `syncMode` option must be a boolean value');

    if (typeof options.transformDefaultImports !== 'boolean')
        throw doError('the `transformDefaultImports` option must be a boolean value');
    
    if (typeof options.transformSideEffects !== 'boolean')
        throw doError('the `transformSideEffects` option must be a boolean value');
    
    if (typeof options.unsafeAstCaching !== 'boolean')
        throw doError('the `unsafeAstCaching` option must be a boolean value');

    if (options.babelConfig != null) {
        const { babelConfig } = options;

        switch (typeof babelConfig) {
            case 'string':
                if (ospath.isAbsolute(babelConfig)) break;
                throw doError('the `babelConfig` option must be an absolute path');
            case 'object':
                if (!Array.isArray(babelConfig)) break;
                throw doError('the `babelConfig` option cannot be an array');
            default:
                throw doError('the `babelConfig` option must be an object');
        }
    }

    return options;
};

module.exports = {
    defaultLoaderOptions,
    validate
};