const ospath = require('path');

const isPath = require('is-valid-path');
const mm = require('micromatch');

const PathResolver = require('./pathResolver');
const utils = require('./utils');
const fixPath = utils.appendCurPath;

/** @typedef {import('./index').Context} Context */
/** @typedef {import('./specResolver').LoadedModule} LoadedModule */

/** @typedef {{type: Symbol, val: string}} IgnoreResult */

// eslint-disable-next-line jsdoc/require-param
/** @type {function(string, (string|string[])): boolean} */
const isMatch = (str, patterns) =>
    mm.isMatch(str, patterns, { matchBase: true });

/**
 * Determines whether a module has side-effects.
 */
class SideEffects {

    /**
     * Creates an instance of {@link SideEffects} and begins initializing it.
     * Be sure to `await` on the promise before using it.
     * 
     * @static
     * @param {Context} context The context object.
     * @param {PathResolver} pathResolver The path-resolver.
     * @returns {Promise.<SideEffects>} A new, initializing {@link SideEffects} instance.
     */
    static create(context, pathResolver) {
        return new SideEffects(context).init(pathResolver);
    }

    /**
     * Creates an instance of {@link SideEffects}.
     * The instance should be properly initialized by calling
     * {@link SideEffects#init} and awaiting its promise.  Consider using
     * {@link SideEffects.create} to generate a fully initialized instance
     * instead.
     * 
     * @param {Context} context The context object.
     */
    constructor(context) {
        const { ignoreSideEffects } = context.options;
        this.context = context;
        this.didInit = false;
        this.enabled = ignoreSideEffects !== true;
        this.rootPath = context.loader.rootContext;

        // the ignore list will be split into two;
        // the `init` method handles the setup of the ignore lists
        this.ignoredModules = [];
        this.ignoredPatterns = [];
    }

    /**
     * Initializes the ignore lists for this instance.
     * 
     * @async
     * @param {PathResolver} pathResolver The path-resolver.
     * @returns {SideEffects} This instance.
     */
    async init(pathResolver) {
        if (this.didInit) return this;
        const { ignoreSideEffects } = this.context.options;
        const debug = this.context.debug.extend('side-effects');
        const haveIgnores = Array.isArray(ignoreSideEffects);

        if (haveIgnores) {
            const { isInPath, checkPath, pathTypes: { dir: $dir } } = utils;

            // eslint-disable-next-line jsdoc/require-param
            /** @type {function(string): Promise.<IgnoreResult>} */
            const testPackage = async (str) => {
                const relPath = ospath.join('./node_modules', str);
                const modulePath = ospath.resolve(this.rootPath, relPath);
                const packagesPath = ospath.resolve(this.rootPath, './node_modules');

                if (!isInPath(modulePath, packagesPath)) return null;
                if (await checkPath(modulePath) !== $dir) return null;
                return { pattern: true, val: fixPath(ospath.join(relPath, '**/*')) };
            };

            // eslint-disable-next-line jsdoc/require-param
            /** @type {function(string): Promise.<IgnoreResult>} */
            const testModule = async (str) => {
                const resolved = await pathResolver.resolvePath(str, this.rootPath);
                return resolved ? { pattern: false, val: resolved } : null;
            };

            // eslint-disable-next-line jsdoc/require-param
            /** @type {function(string): Promise.<IgnoreResult>} */
            const mapFn = async (str) => {
                if (isPath(str)) {
                    const tested = await testPackage(str) || await testModule(str);
                    if (tested) return tested;
                }
                return { pattern: true, val: str };
            }

            try {
                const modules = [];
                const patterns = [];
                const results = await Promise.all(ignoreSideEffects.map(mapFn));

                for (const result of results)
                    (result.pattern ? patterns : modules).push(result.val);

                this.ignoredModules = modules;
                this.ignoredPatterns = patterns;
            }
            catch (error) {
                debug('INIT FAILED', error);
                throw error;
            }
        }

        this.didInit = true;

        debug(`INIT COMPLETED - ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
        if (this.enabled && haveIgnores) {
            debug('IGNORED MODULES %A', this.ignoredModules);
            debug('IGNORED PATTERNS %A', this.ignoredPatterns);
        }

        return this;
    }

    /**
     * Determines whether the given module has side-effects.
     * 
     * @param {LoadedModule} loadedModule The loaded module.
     * @returns {boolean}
     * @throws When this {@link SideEffects} instance has not yet been initialized.
     * @throws When the `loadedModule` argument was nullish.
     */
    test(loadedModule) {
        this.assertInit();

        if (loadedModule == null)
            throw new Error('cannot detect side-effects, the `loadedModule` was nullish');
        
        // decompose the path to remove webpack loaders, etc.
        const modulePath = PathResolver.decompose(loadedModule.path).path;

        if (!this.enabled) return false;
        if (this.isIgnored(modulePath)) return false;
        return this.hasSideEffects(loadedModule.instance);
    }

    /**
     * Determines if the module is in an ignore list.
     * 
     * @private
     * @param {string} modulePath
     * @returns {boolean}
     */
    isIgnored(modulePath) {
        // check if it is an ignored module
        if (this.ignoredModules.includes(modulePath))
            return true;

        // check if it matches an ignored pattern
        const projectRelative = fixPath(ospath.relative(this.rootPath, modulePath));
        return isMatch(projectRelative, this.ignoredPatterns);
    }

    /**
     * Determines whether the given module has side-effects.
     * 
     * @private
     * @param {WebpackModule} instance The module instance to test.
     * @returns {boolean}
     */
    hasSideEffects(instance) {
        if (!instance.factoryMeta) return false;
        return !instance.factoryMeta.sideEffectFree;
    }

    /**
     * Throws an error if this instance has not yet initialized.
     */
    assertInit() {
        if (this.didInit) return;
        if (!this.enabled) return;
        throw new Error('this `SideEffect` instance was not initialized completely');
    }

}

module.exports = SideEffects;