const ospath = require('path');

const isPath = require('is-valid-path');
const mm = require('micromatch');

const utils = require('./utils');
const fixPath = utils.appendCurPath;

/** @typedef {import('./debugging').Debug} Debug */
/** @typedef {import('./common').Context} Context */
/** @typedef {import('./common').LoaderContext} LoaderContext */
/** @typedef {import('./options').LoaderOptions} LoaderOptions */
/** @typedef {import('./pathResolver')} PathResolver */

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
     * @param {string} rootContext
     * The root-context path.
     * @param {LoaderOptions} options
     * The loader options.
     * @param {PathResolver} pathResolver
     * The path-resolver to use when resolving a file's path.
     * @param {Debug} debugRoot
     * The root debug instance.
     * @returns {Promise.<SideEffects>}
     * A new, initializing {@link SideEffects} instance.
     */
    static create(rootContext, options, pathResolver, debugRoot) {
        return new SideEffects(rootContext, options).init(pathResolver, debugRoot);
    }

    /**
     * Creates an instance of {@link SideEffects}.
     * The instance should be properly initialized by calling
     * {@link SideEffects#init} and awaiting its promise.  Consider using
     * {@link SideEffects.create} to generate a fully initialized instance
     * instead.
     * 
     * @param {string} rootContext
     * The root-context path.
     * @param {LoaderOptions} options
     * The loader options.
     */
    constructor(rootContext, {ignoreSideEffects}) {
        this.didInit = false;
        this.enabled = ignoreSideEffects !== true;
        this.rootContext = rootContext;
        this.ignoreList = Array.isArray(ignoreSideEffects) ? ignoreSideEffects : [];

        // the ignore list will be split into two;
        // the `init` method handles the setup of the ignore lists
        this.ignoredModules = [];
        this.ignoredPatterns = [];
    }

    /**
     * Initializes the ignore lists for this instance.
     * 
     * @async
     * @param {PathResolver} pathResolver
     * The path-resolver to use when resolving a file's path.
     * @param {Debug} debugRoot
     * The root debug instance.
     * @returns {SideEffects}
     * This instance.
     */
    async init(pathResolver, debugRoot) {
        if (this.didInit) return this;

        const debug = debugRoot.extend('side-effects');
        const haveIgnores = this.ignoreList.length > 0;

        if (haveIgnores) {
            const { isInPath, checkPath, pathTypes: { dir: $dir } } = utils;

            // eslint-disable-next-line jsdoc/require-param
            /** @type {function(string): Promise.<IgnoreResult>} */
            const testPackage = async (str) => {
                const relPath = ospath.join('./node_modules', str);
                const modulePath = ospath.resolve(this.rootContext, relPath);
                const packagesPath = ospath.resolve(this.rootContext, './node_modules');

                if (!isInPath(modulePath, packagesPath)) return null;
                if (await checkPath(modulePath) !== $dir) return null;
                return { pattern: true, val: fixPath(ospath.join(relPath, '**/*')) };
            };

            // eslint-disable-next-line jsdoc/require-param
            /** @type {function(string): Promise.<IgnoreResult>} */
            const testModule = (str) => {
                return pathResolver.resolve(str, this.rootContext).then(
                    (resolved) => ({ pattern: false, val: resolved.resolvedPath }),
                    () => null
                );
            };

            // eslint-disable-next-line jsdoc/require-param
            /** @type {function(string): Promise.<IgnoreResult>} */
            const mapFn = async (str) => {
                if (isPath(str)) {
                    const tested = await testPackage(str) || await testModule(str);
                    if (tested) return tested;
                }
                return { pattern: true, val: str };
            };

            try {
                const modules = [];
                const patterns = [];
                const results = await Promise.all(this.ignoreList.map(mapFn));

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
     * Determines whether a module should be treated as having side-effects.
     * 
     * @param {string} modulePath
     * The absolute path of the module.
     * @param {boolean} hasSideEffects
     * Whether Webpack reports that the module has side-effects.
     * @returns {boolean}
     * If `true`, the module should be treated as having side-effects.
     * @throws {Error}
     * When this {@link SideEffects} instance has not yet been initialized.
     */
    test(modulePath, hasSideEffects) {
        this.assertInit();

        if (!this.enabled) return false;
        if (this.isIgnored(modulePath)) return false;
        return hasSideEffects;
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
        const projectRelative = fixPath(ospath.relative(this.rootContext, modulePath));
        return isMatch(projectRelative, this.ignoredPatterns);
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