const fs = require('fs');
const ospath = require('path');
const pathExists = require('./utils').pathExists;

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
 * The options recognized by the plugin.
 * @typedef PluginOptions
 * @prop {string} [webpackConfig] Path to the webpack configuration file to use.
 * @prop {number} [webpackConfigIndex] The index of the configuration to use in
 * case the specified configuration file is a multi-config file.
 * @prop {string|Object} [babelConfig] The Babel configuration to use when
 * parsing a file to an AST, either a path to a config file or an object that
 * will be programmatically supplied to Babel.
 * @prop {boolean} [transformDefaultImports] Whether to try and transform default
 * imports and exports.
 * @prop {(boolean|SideEffectOptions)} [sideEffects]
 * The options for side-effects.  When a `boolean` value, indicates whether
 * side-effect checking is enabled.  When an object, allows customizing the
 * behavior of side-effect checking.
 */

/** @type {SideEffectOptions} */
const defaultSideEffectsOptions = Object.freeze({
    enabled: true,
    default: true,
    projectPath: require('app-root-path').toString(),
    ignore: [],
});

/** @type {PluginOptions} */
const defaultPluginOptions = Object.freeze({
    webpackConfig: './webpack.config.js',
    webpackConfigIndex: 0,
    babelConfig: null,
    transformDefaultImports: false,
    sideEffects: defaultSideEffectsOptions,
});

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
            throw new Error('the `sideEffects.projectPath` option must be a string when provided');
        }

        if (!ospath.isAbsolute(value)) {
            throw new Error('the `sideEffects.projectPath` option must be an absolute path');
        }

        return;

    case 'ignore':
        // wrap in an array, if needed
        value = Array.isArray(value) ? value : [value];

        if (value.every(path => typeof path === 'string')) {
            options[key] = value;
            return;
        }

        throw new Error('the `sideEffects.ignore` option can only contain strings');
    }
};

/** @type {function(string, PluginOptions): void} */
const validate_PluginOptions = (key, options) => {
    let value = options[key];

    if (value == null) {
        delete options[key];
        return;
    }

    switch (key) {

    case 'webpackConfig':
        if (typeof value === 'string') return;
        throw new Error('the `webpackConfig` option can only be a string');

    case 'webpackConfigIndex':
        if (typeof value !== 'number') {
            throw new Error('the `webpackConfigIndex` option can only be a number');
        }
        
        value = value | 0;

        if (value >= 0) {
            options[key] = value;
            return;
        }
        
        throw new Error('the `webpackConfigIndex` option must be a number greater than `0`');
    
    case 'babelConfig':
        switch (typeof value) {
        case 'string':
            value = ospath.resolve(value);

            if (!pathExists(value)) {
                throw new Error([
                    'the `babelConfig` option was supplied a string that does not',
                    'resolve to an existing file'
                ].join(' '));
            }

            if (require('./babel-helper').checkVersion('7.0.0')) {
                // Babel 7 allows a configuration file to be specified
                options[key] = { configFile: value };
                return;
            }
            else {
                // Babel 6 will need to have the options parsed first
                try {
                    const parsed = ospath.parse(value);
                    if (parsed.base === '.babelrc' || parsed.ext.search(/^\.json$/i)) {
                        value = JSON.parse(fs.readFileSync(value, 'utf-8'));
                    }
                    else if (parsed.ext.search(/^\.js$/i)) {
                        value = require(value);
                    }

                    if (typeof value === 'object' && !Array.isArray(value)) {
                        options[key] = value;
                        return;
                    }
                }
                catch (error) { void 0; }

                throw new Error([
                    'the `babelConfig` option was supplied a string that did not',
                    'resolve to a file that could be treated as a Babel',
                    'configuration file'
                ].join(' '));
            }
        
        case 'object':
            if (!Array.isArray(value)) return;
            throw new Error('the `babelConfig` option cannot be an array');
        
        default:
            throw new Error([
                'the `babelConfig` option must be a string or an object',
                'use a string to specify the path to a configuration file',
                'use an object to provide options directly to Babel'
            ].join('; '));
        }

    case 'transformDefaultImports':
        options[key] = Boolean(value);
        return;

    case 'sideEffects':
        if (typeof value === 'boolean') {
            options[key] = Object.assign({}, defaultSideEffectsOptions, { enabled: value });
            return;
        }
        if (typeof value === 'object' && !Array.isArray(value)) {
            for (const k of Object.keys(value)) {
                validate_SideEffects(k, value);
            }
            options[key] = Object.assign({}, defaultSideEffectsOptions, value);
            return;
        }
        throw new Error('the `sideEffects` option can only be an object or a boolean value');

    }
};

/**
 * Validates and sets defaults for the plugin's options object.
 * @param {PluginOptions} options The options object to validate.
 * @returns {PluginOptions}
 * @throws When the provided options object fails validation.
 */
const validate = options => {
    if (!options) {
        return Object.assign({}, defaultPluginOptions);
    }

    for (const k of Object.keys(options)) {
        validate_PluginOptions(k, options);
    }

    return Object.assign({}, defaultPluginOptions, options);
};

module.exports = {
    defaultPluginOptions,
    defaultSideEffectsOptions,
    validate,
};