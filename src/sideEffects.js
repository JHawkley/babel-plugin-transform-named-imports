const debug = require('debug')('transform-named-imports');
const fs = require('fs');
const ospath = require('path');

const isPath = require('is-valid-path');
const findPackage = require('find-package-json');
const mm = require('micromatch');

/** @typedef {import('./index').PluginOptions} PluginOptions */
/** @typedef {(boolean|string|string[])} FlagValue */

/**
 * @typedef PackageData
 * @prop {string} dir The directory containing the `package.json` file.
 * @prop {FlagValue} flagValue The value of the `sideEffects` property.
 */

/**
 * @typedef SideEffectOptions
 * @prop {boolean} [enabled] Whether side-effect checking is enabled.
 * @prop {boolean} [default] The default assumption to make when a package has no
 * information on whether it has side-effects.
 * @prop {string} [projectPath] The absolute path of the project's root.
 * @prop {string[]} [ignore] A list of Node modules, globs, or paths to ignore
 * during a side-effect test.
 */

/** @type {SideEffectOptions} */
const baseOptions = {
    enabled: true,
    default: true,
    projectPath: require('app-root-path').toString(),
    ignore: [],
};

/** @type {function(string): string} */
const fixPath = path => path.startsWith('.') ? path : './' + path;

/** @type {function(string, (string|string[])): boolean} */
const isMatch = (str, patterns) =>
    mm.isMatch(str, patterns, { matchBase: true });

/** @type {function(string, FlagValue, boolean): boolean} */
const hasSideEffectsImpl = (modulePath, flagValue, defaultValue) => {
    try {
        // adapted from code in Webpack version 4.29.1, released under the following license:
        // https://github.com/webpack/webpack/blob/569bbcca0cba6aea616ed68829a244a0c4065eeb/LICENSE
        switch (typeof flagValue) {
        case 'undefined':
            return defaultValue;
        case 'boolean':
            return flagValue;
        case 'string':
            if (process.platform === 'win32') {
                flagValue = flagValue.replace(/\\/g, '/');
            }
            return isMatch(modulePath, flagValue);
        case 'object':
            return flagValue.some(glob => hasSideEffectsImpl(modulePath, glob, defaultValue));
        }
    }
    catch (error) {
        debug('SIDE EFFECT ERROR', error);
        return defaultValue;
    }
};

/** @type {function(SideEffectOptions): SideEffectOptions} */
const validateOptions = config => {
    if (!config) {
        return baseOptions;
    }

    if (typeof config !== 'object' || Array.isArray(config)) {
        throw new Error('the `sideEffects` option can only be an object or a boolean value');
    }

    if (config.projectPath != null) {
        if (typeof config.projectPath !== 'string') {
            throw new Error('the `sideEffects.projectPath` option must be a string when provided');
        }

        if (!ospath.isAbsolute(config.projectPath)) {
            throw new Error('the `sideEffects.projectPath` option must be an absolute path');
        }
    }

    if (config.ignore != null) {
        if (!Array.isArray(config.ignore)) {
            config.ignore = [config.ignore];
        }

        if (!config.ignore.every(path => typeof path === 'string')) {
            throw new Error('the `sideEffects.ignore` option can only contain strings');
        }
    }

    return Object.assign({}, baseOptions, config);
};

/**
 * Determines whether a module has side-effects.
 */
class SideEffects {

    /**
     * Creates an instance of {@link SideEffects}.
     * @param {PluginOptions} pluginOptions The options that were provided to the plugin.
     * @param {import('./pathResolver')} pathResolver The path-resolver.
     * @memberof SideEffects
     */
    constructor({sideEffects: options}, pathResolver) {
        options = validateOptions(typeof options === 'boolean' ? { enabled: options } : options);

        this.cache = {};
        this.enabled = Boolean(options.enabled);
        this.default = Boolean(options.default);
        this.projectPath = options.projectPath;

        // split the ignore list into two
        this.ignoredModules = [];
        this.ignoredPatterns = [];

        options.ignore.forEach(str => {
            if (isPath(str)) {
                let path;

                // check for ignored node_modules
                path = this.resolveNodePackage(str);
                if (path) {
                    return this.ignoredPatterns.push(path + '/**/*');
                }

                // check for specifically ignored modules
                path = pathResolver.resolve(str, this.projectPath);
                if (path) {
                    return this.ignoredModules.push(path);
                }
            }
            
            // otherwise, treat as a pattern
            this.ignoredPatterns.push(str);
        });
    }

    /**
     * Determines whether the given module has side-effects.
     * @param {string} filePath The absolute path to the file to test.
     * @returns {boolean}
     */
    test(filePath) {
        if (!this.enabled || !filePath || this.isIgnored(filePath)) {
            return false;
        }

        const cacheKey = ospath.dirname(filePath);
        const cachedResult = this.cache[cacheKey];
        if (cachedResult !== undefined) {
            return this.hasSideEffects(filePath, cachedResult);
        }

        const packageData = this.getPackageData(filePath);
        this.cache[cacheKey] = packageData;
        return this.hasSideEffects(filePath, packageData);
    }

    /**
     * Gets the `package.json` file nearest to the given module.
     * @param {string} filePath The absolute path to the file to test.
     * @returns {?PackageData} The package's data or `null` if no `package.json`
     * file could be located.
     */
    getPackageData(filePath) {
        for (const pkg of findPackage(filePath)) {
            // use the first one found
            const dir = ospath.dirname(pkg.__path);
            const flagValue = pkg.sideEffects;
            return flagValue != null ? { dir, flagValue } : null;
        }

        return null;
    }

    /**
     * Determines if the given module is in an ignore list.
     * @param {string} filePath
     * @returns {boolean}
     */
    isIgnored(filePath) {
        // check if it is an ignored module
        if (this.ignoredModules.includes(filePath)) {
            return true;
        }

        // check if in the ignored patterns list
        const projectRelative = fixPath(ospath.relative(this.projectPath, filePath));
        return isMatch(projectRelative, this.ignoredPatterns);
    }

    /**
     * Determines whether the given module has side-effects.
     * @param {string} filePath
     * @param {?PackageData} packageData
     * @returns {boolean}
     */
    hasSideEffects(filePath, packageData) {
        if (!packageData) {
            return this.default;
        }

        const flagValue = packageData.flagValue;
        const modulePath = fixPath(ospath.relative(packageData.dir, filePath));

        debug('SIDE EFFECT DATA', { modulePath, flagValue });

        return hasSideEffectsImpl(modulePath, flagValue, this.default);
    }

    /**
     * Tries to resolve the path to a named node-module.
     * @param {string} moduleName The name of the node-module.
     * @returns {?string} The project-root-relative path to the module or `null` if
     * no such module could be located.
     */
    resolveNodePackage(moduleName) {
        if (ospath.isAbsolute(moduleName) || moduleName.startsWith('.')) {
            return null;
        }

        const packagePath = ospath.resolve('./node_modules', moduleName);
        const path = ospath.resolve(this.projectPath, packagePath);
        try {
            // check if the path exists
            // yes, this is the currently recommended way to do it
            // `fs.exists` is deprecated
            fs.accessSync(path);
            return packagePath;
        }
        catch (error) {
            return null;
        }
    }

}

module.exports = SideEffects;