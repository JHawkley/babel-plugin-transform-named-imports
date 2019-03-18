const fs = require('fs');
const ospath = require('path');
const isPath = require('is-valid-path');
const isPromise = require('is-promise');
const deasync = require('deasync-promise');
const { pathExists, deasyncFn } = require('./utils');

/** @typedef {import('./pathResolver').ResolvePathFn} ResolvePathFn */
/** @typedef {import('./specResolver').ResolveAstFn} ResolveAstFn */

/**
 * @typedef SideEffectOptions
 * @prop {boolean} [enabled] Whether side-effect checking is enabled.
 * @prop {boolean} [default] The default assumption to make when a package has no
 * information on whether it has side-effects.
 * @prop {string} [projectPath] The absolute path of the project's root.
 * @prop {string[]} [ignore] A list of Node modules, globs, or paths to ignore
 * during a side-effect test.
 */

/**
 * @typedef AdvancedOptions
 * @prop {ResolvePathFn} [pathResolver] A function that takes the
 * relative path of a `request` and the absolute path of the `issuer` and
 * resolves the absolute path to the requested module.  If not provided, a
 * default resolver will be created using the project's Webpack config or
 * the config provided through `webpackConfig`.
 * @prop {ResolveAstFn} [astResolver] A function that takes a path to
 * a module and attempts to parse it into a Babel AST.  If not provided,
 * a default resolver will be created using the installed Babel package.
 * @prop {string|Object} [babelConfig] The Babel configuration to use when
 * parsing a file to an AST, either a path to a config file or an object that
 * will be programmatically supplied to Babel.
 * @prop {boolean} [async] If set to `true`, the `pathResolver` and `astResolver`
 * can return promises.  If they do, the plugin will stop its processing and
 * await the promise until it has completed.
 */

/**
 * The options recognized by the plugin.
 * @typedef InputPluginOptions
 * @prop {string} [webpackConfig] Path to the webpack configuration file to use
 * when no `pathResolver` was provided.
 * @prop {number} [webpackConfigIndex] The index of the configuration to use in
 * case the specified Webpack configuration file is a multi-config file.
 * @prop {boolean} [transformDefaultImports] Whether to try and transform default
 * imports and exports.
 * @prop {(boolean|SideEffectOptions)} [sideEffects]
 * The options for side-effects.  When a `boolean` value, indicates whether
 * side-effect checking is enabled.  When an object, allows customizing the
 * behavior of side-effect checking.
 * @prop {AdvancedOptions} [advanced] The advanced options.  Options defined
 * here can alter the plugin's output in ways that are not predictable.
 */

/**
 * @typedef FinalizedOptions
 * @prop {ResolvePathFn} pathResolver
 * @prop {ResolveAstFn} astResolver
 * @prop {boolean} transformDefaultImports
 * @prop {SideEffectOptions} sideEffects
 */

/** @type {SideEffectOptions} */
const defaultSideEffectsOptions = Object.freeze({
    enabled: true,
    default: true,
    projectPath: require('app-root-path').toString(),
    ignore: [],
});

/** @type {AdvancedOptions} */
const defaultAdvancedOptions = Object.freeze({
    pathResolver: null,
    astResolver: null,
    babelConfig: null,
    async: false,
});

/** @type {InputPluginOptions} */
const defaultPluginOptions = Object.freeze({
    webpackConfig: './webpack.config.js',
    webpackConfigIndex: 0,
    transformDefaultImports: false,
    sideEffects: defaultSideEffectsOptions,
    advanced: defaultAdvancedOptions,
});

const doError = messages => {
    if (!Array.isArray(messages)) {
        messages = [messages];
    }

    messages.push('please check the options provided to the `transform-named-imports` Babel plugin');
    return new Error(messages.join('; '));
};

const resolveWebpackConfig = (config, configIndex, allowString = false) => {
    switch (typeof config) {

    case 'string':
        if (!allowString) {
            break;
        }

        if (!isPath(config)) {
            throw doError('the `webpackConfig` option was supplied a string that did not look like a valid path');
        }

        try {
            config = require(ospath.resolve(config));
        }
        catch (error) {
            throw doError([
                'a Webpack configuration could not be located',
                `the following path was used when trying to load it: "${ospath.resolve(config)}"`
            ]);
        }
        // run it through again to pull out the object
        return resolveWebpackConfig(config, configIndex);

    case 'function':
        try {
            config = config(process.env, {});
        }
        catch (error) {
            throw doError([
                'the Webpack configuration function threw an error',
                error.message
            ].join(': '));
        }
        // run it through again to pull out the object
        return resolveWebpackConfig(config, configIndex);

    case 'object':
        if (config == null) {
            throw doError('the `webpackConfig` resolved to a null value');
        }

        // is this a promise?
        if (isPromise(config)) {
            try {
                config = deasync(config);
            }
            catch (error) {
                throw doError([
                    'the promise returned by the Webpack configuration was rejected',
                    error.message
                ].join(': '));
            }
            return resolveWebpackConfig(config, configIndex);
        }
        // is this an ES module?
        if (config.default) {
            return resolveWebpackConfig(config.default, configIndex);
        }
        // is this a multi-configuration?
        if (Array.isArray(configIndex)) {
            return resolveWebpackConfig(config[configIndex], 0);
        }

        return config;
    }

    throw doError('the `webpackConfig` option could not be resolved to an object');
};

const resolveBabelConfig = (config, allowStringOrNull = false) => {
    switch (typeof config) {

    case 'string':
        if (!allowStringOrNull) {
            break;
        }

        config = ospath.resolve(config);

        if (!pathExists(config)) {
            throw doError([
                'the `advanced.babelConfig` option was supplied a string that',
                'does not resolve to an existing file'
            ].join(' '));
        }

        if (require('./babelHelper').checkVersion('7.0.0')) {
            // Babel 7 allows a configuration file to be specified
            return { configFile: config };
        }
        else {
            // Babel 6 will need to have the options parsed first
            try {
                const parsed = ospath.parse(config);
                if (parsed.base === '.babelrc' || parsed.ext.search(/^\.json$/i)) {
                    config = JSON.parse(fs.readFileSync(config, 'utf-8'));
                }
                else if (parsed.ext.search(/^\.js$/i)) {
                    config = require(config);
                }
            }
            catch (error) {
                throw doError([
                    'the `advanced.babelConfig` option was supplied a string',
                    'that did not resolve to a file that could be treated as',
                    'a Babel configuration file'
                ].join(' '));
            }

            return resolveBabelConfig(config);
        }

    case 'object':
        if (!config && allowStringOrNull) return config; 
        if (config && !Array.isArray(config)) return config;
        break;

    }

    throw doError('the `advanced.babelConfig` option could not be resolved to an object');
};

/** @type {function(string, SideEffectOptions): void} */
const validate_SideEffects = (key, options) => {
    let value = options[key];

    if (value == null) {
        delete options[key];
        return;
    }

    switch (key) {
    
    case 'enabled':
    case 'default':
        options[key] = Boolean(value);
        return;

    case 'projectPath':
        if (typeof value !== 'string') {
            throw doError('the `sideEffects.projectPath` option must be a string');
        }

        if (!ospath.isAbsolute(value)) {
            throw doError('the `sideEffects.projectPath` option must be an absolute path');
        }

        return;

    case 'ignore':
        // wrap in an array, if needed
        value = Array.isArray(value) ? value : [value];

        if (value.every(path => typeof path === 'string')) {
            options[key] = value;
            return;
        }

        throw doError('the `sideEffects.ignore` option can only contain strings');
    }
};

/** @type {function(string, AdvancedOptions): void} */
const validate_Advanced = (key, options) => {
    let value = options[key];

    if (value == null) {
        delete options[key];
        return;
    }

    switch (key) {

        case 'pathResolver':
            if (typeof value === 'function') return;
            throw doError('the `advanced.pathResolver` option must be a function');
        
        case 'astResolver':
            if (typeof value === 'function') return;
            throw doError('the `advanced.astResolver` option must be a function');
        
        case 'babelConfig':
            switch (typeof value) {
                case 'string':
                case 'object':
                    return;
            }

            throw doError('the `advanced.babelConfig` option must be either a string or object');

        case 'async':
            options[key] = Boolean(value);
            return;
    }
};

/** @type {function(string, InputPluginOptions): void} */
const validate_PluginOptions = (key, options) => {
    let value = options[key];

    if (value == null) {
        delete options[key];
        return;
    }

    switch (key) {

    case 'webpackConfig':
        switch (typeof value) {
        case 'string':
        case 'object':
        case 'function':
            return;
        }

        throw doError('the `webpackConfig` option must be either a string, object, or function');

    case 'webpackConfigIndex':
        if (typeof value !== 'number') {
            throw doError('the `webpackConfigIndex` option can only be a number');
        }
        
        value = value | 0;

        if (value >= 0) {
            options[key] = value;
            return;
        }
        
        throw doError('the `webpackConfigIndex` option must be a number greater than `0`');

    case 'transformDefaultImports':
        options[key] = Boolean(value);
        return;

    case 'sideEffects':
        if (typeof value === 'boolean') {
            options[key] = Object.assign({}, defaultSideEffectsOptions, { enabled: value });
            return;
        }
        if (typeof value === 'object' && !Array.isArray(value)) {
            // clone the options before validating
            value = Object.assign({}, value);

            for (const k of Object.keys(value)) {
                validate_SideEffects(k, value);
            }

            options[key] = Object.assign({}, defaultSideEffectsOptions, value);
            return;
        }
        throw doError('the `sideEffects` option can only be an object or a boolean value');
    
    case 'advanced':
        if (typeof value === 'object' && !Array.isArray(value)) {
            // clone the options before validating
            value = Object.assign({}, value);

            for (const k of Object.keys(value)) {
                validate_Advanced(k, value);
            }

            options[key] = Object.assign({}, defaultAdvancedOptions, value);
            return;
        }
        throw doError('the `advanced` option can only be an object');

    }
};

/** @type{function(InputPluginOptions): FinalizedOptions} */
const finalize_PluginOptions = options => {
    let {
        transformDefaultImports,
        sideEffects,
        advanced: { pathResolver, astResolver, async }
    } = options;

    if (!pathResolver) {
        const webpackConfig = resolveWebpackConfig(
            options.webpackConfig,
            options.webpackConfigIndex,
            true
        );
        pathResolver = require('./pathResolver').defaultResolver(webpackConfig);
    }
    else if (async) {
        pathResolver = deasyncFn(pathResolver);
    }

    if (!astResolver) {
        const babelConfig = resolveBabelConfig(
            options.advanced.babelConfig,
            true
        );
        astResolver = require('./specResolver').defaultResolver(babelConfig);
    }
    else if (async) {
        astResolver = deasyncFn(astResolver);
    }

    return {
        pathResolver,
        astResolver,
        transformDefaultImports,
        sideEffects,
    };
};

/**
 * Validates the plugin's options object and finalizes the options.
 * @param {InputPluginOptions} options The options object to validate.
 * @returns {FinalizedOptions} The finalized options.
 * @throws When the provided options object fails validation.
 */
const validate = options => {
    if (options) {
        // clone options before validating
        options = Object.assign({}, options);

        for (const k of Object.keys(options)) {
            validate_PluginOptions(k, options);
        }
    }

    options = Object.assign({}, defaultPluginOptions, options);
    return finalize_PluginOptions(options);
};

module.exports = {
    defaultPluginOptions,
    defaultSideEffectsOptions,
    defaultAdvancedOptions,
    validate,
};