const debug = require('debug')('transform-named-imports');
const fs = require('fs');
const ospath = require('path');

const isPath = require('is-valid-path');
const findNodeModules = require('find-node-modules');
const findPackage = require('find-package-json');
const mm = require('micromatch');

const { appendCurPath } = require('./utils');

/** @typedef {import('./options').PluginOptions} PluginOptions */
/** @typedef {(boolean|string|string[])} FlagValue */

/**
 * @typedef PackageData
 * @prop {string} dir The directory containing the `package.json` file.
 * @prop {FlagValue} flagValue The value of the `sideEffects` property.
 */

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

/**
 * Determines whether a module has side-effects.
 */
class SideEffects {

    /**
     * Creates an instance of {@link SideEffects}.
     * @param {PluginOptions} options The options that were provided to the plugin.
     * @param {import('./pathResolver')} pathResolver The path-resolver.
     * @memberof SideEffects
     */
    constructor(options, pathResolver) {
        // pull out the side-effect options
        options = options.sideEffects;

        /** @type {Object.<string, PackageData>} */
        this.cache = {};

        this.enabled = options.enabled;
        this.default = options.default;
        this.projectPath = options.projectPath;

        // keep node-module search to the current project
        this.nmPaths = findNodeModules({ cwd: this.projectPath })
            .filter(path => !path.startsWith('..'));

        // split the ignore list into two
        this.ignoredModules = [];
        this.ignoredPatterns = [];

        options.ignore.forEach(str => {
            if (isPath(str)) {
                // check for ignored node_modules
                const packages = this.resolveNodePackages(str);
                if (packages.length > 0) {
                    packages.forEach(path => {
                        this.ignoredPatterns.push(path + '/**/*');
                    });
                    return;
                }

                // check for specifically ignored modules
                const resolved = pathResolver.resolve(str, this.projectPath);
                if (resolved) {
                    this.ignoredModules.push(resolved.path);
                    return;
                }
            }
            
            // otherwise, treat as a pattern
            this.ignoredPatterns.push(str);
        });

        debug('PROJECT PATH', this.projectPath);
        debug('NODE MODULE PATHS', this.nmPaths);
        debug('IGNORED MODULES', this.ignoredModules);
        debug('IGNORED PATTERNS', this.ignoredPatterns);
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
        const projectRelative = appendCurPath(ospath.relative(this.projectPath, filePath));
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
        const modulePath = appendCurPath(ospath.relative(packageData.dir, filePath));

        debug('SIDE EFFECT DATA', { modulePath, flagValue });

        return hasSideEffectsImpl(modulePath, flagValue, this.default);
    }

    /**
     * Tries to resolve the paths to a named node-module.
     * @param {string} moduleName The name of the node-module.
     * @returns {string[]} An array of project-root-relative paths to the module
     * or an empty-array if no such module could be located.
     */
    resolveNodePackages(moduleName) {
        const result = [];

        if (ospath.isAbsolute(moduleName) || moduleName.startsWith('.')) {
            return result;
        }

        this.nmPaths.forEach(nmPath => {
            const packagePath = ospath.join(nmPath, moduleName);
            const path = ospath.resolve(this.projectPath, packagePath);
            try {
                // check if the path exists
                // yes, this is the currently recommended way to do it
                // `fs.exists` is deprecated
                fs.accessSync(path);
                result.push(appendCurPath(packagePath));
            }
            catch (error) {
                return;
            }
        });

        return result;
    }

}

module.exports = SideEffects;