const ospath = require('path');

/**
 * The options recognized by the plugin.
 * @typedef LoaderOptions
 * @prop {string} [ident]
 * A string identifying the current loader.  This is used for creating multiple
 * caches, in case of concurrent compilations.
 * @prop {boolean} [syncMode]
 * When `true`, the loader will perform its loading synchronously, transforming
 * only one file at a time instead of executing all possible transformations all
 * at once.  If you have issues compiling your bundle, enabling this may allow
 * your bundle to compile.
 * @prop {boolean} [transformDefaultImports]
 * Whether to try and transform default imports and exports.
 * @prop {(boolean|string[])} [ignoreSideEffects]
 * When `true`, disables side-effect checking.  When an array-of-strings,
 * specifies a list of files and/or node-modules to skip side-effects checking.
 * Supports globs for files, but not node-modules.
 * @prop {(string|Object)} [babelConfig]
 * When provided, this config will be provided to Babel when parsing modules
 * into an AST.  Can be either an absolute path to a config file or a config
 * object which will be mixed into the loader's required options.  Babel
 * is usually smart enough to obtain configuration itself, so this option
 * is mostly intended for testing purposes.
 */

/** @type {LoaderOptions} */
const defaultLoaderOptions = Object.freeze({
    ident: 'unnamed',
    syncMode: false,
    transformDefaultImports: false,
    ignoreSideEffects: false,
    babelConfig: null
});

const doError = (messages) => {
    if (!Array.isArray(messages))
        messages = [messages];

    messages.push('please check the options provided to the `transform-imports` Webpack loader');
    return new Error(messages.join('; '));
};

/**
 * Validates the plugin's options object and finalizes the options.
 * 
 * @param {LoaderOptions} options The options object to validate.
 * @returns {LoaderOptions} The finalized options.
 * @throws When the provided options object fails validation.
 */
const validate = (options) => {
    options = Object.assign({}, defaultLoaderOptions, options);

    if (typeof options.syncMode !== 'boolean')
        throw doError('the `syncMode` option must be a boolean value');

    if (typeof options.transformDefaultImports !== 'boolean')
        throw doError('the `transformDefaultImports` option must be a boolean value');

    if (typeof options.ignoreSideEffects !== 'boolean') {
        if (!Array.isArray(options.ignoreSideEffects)) {
            throw doError([
                'the `ignoreSideEffects` option must be either',
                'a boolean value or an array of strings'
            ].join(' '));
        }

        if (options.ignoreSideEffects.some(path => typeof path !== 'string')) {
            throw doError([
                'when set to an array, the `ignoreSideEffects` option',
                'can only contain strings'
            ].join(' '));
        }
    }

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