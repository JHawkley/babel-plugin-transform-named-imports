const fs = require('fs');
const ospath = require('path');

/**
 * A decomposed request.
 * * [0] The path portion.
 * * [1] The loaders portion.
 * * [2] The query portion.
 * @typedef {[string, ?string, ?string]} DecomposedRequest
 */

/** @enum {Symbol} */
const pathTypes = {
    nil: Symbol('path-types:nil'),
    file: Symbol('path-types:file'),
    dir: Symbol('path-types:dir')
};

const rePath = /^(.*!)?(.*?)(\?.*)?$/;

/**
 * Decomposes a path into its module path, loaders, and query.
 * 
 * @static
 * @param {string} originalPath
 * The request to decompose.
 * @returns {DecomposedRequest}
 * The decomposed request.
 */
const decomposePath = (originalPath) => {
    const decomposedPath = rePath.exec(originalPath);

    if (!decomposedPath)
        return [originalPath, null, null];

    const [, loaders, newPath, query] = decomposedPath;
    return [newPath, loaders || null, query || null];
};

/**
 * Prefixes a path with './', the current path, if necessary.
 * Returns the path unaltered if the given path is absolute.
 * 
 * @param {string} path
 * A path.
 * @returns {string}
 * The same path with './' appended to it if needed.
 */
const appendCurPath = (path) =>
    ospath.isAbsolute(path) || path.startsWith('.') ? path : './' + path;

/**
 * Creates a function that can be used to determine the root-context relative
 * path of a file.
 * 
 * @param {string} rootContext
 * The root-context.
 * @param {?string} originalPath
 * The path to make relative to the root-context.
 * @returns {?string}
 * A function that will make a path relative to the root-context.
 */
const contextRelative = (rootContext, originalPath) => {
    if (!ospath.isAbsolute(rootContext))
        throw new Error('the `rootContext` must be an absolute path');

    if (!originalPath) return null;

    const [path, loaders, query] = decomposePath(originalPath);
    const relativePath = appendCurPath(ospath.relative(rootContext, path));
    return [loaders, relativePath, query].filter(Boolean).join('');
};

/**
 * Checks a path for accessibility and the type of file-system object
 * it points to.
 * 
 * @async
 * @param {string} path
 * The path whose existence is in question.
 * @returns {pathTypes}
 * The type of path.  Will be {@link pathTypes.nil} if the path was of an
 * unrecognized type or could not be accessed.
 */
const checkPath = async (path) => {
    return await new Promise(ok => {
        fs.stat(path, (err, stats) => {
            if (err) ok(pathTypes.nil);
            else if (stats.isFile()) ok(pathTypes.file);
            else if (stats.isDirectory()) ok(pathTypes.dir);
            else ok(pathTypes.nil);
        });
    });
};

/**
 * Determines if a `path` is inside of a `target` directory.
 * Both paths must be absolute.
 * 
 * @param {string} path
 * The absolute path in question.
 * @param {string} target
 * The absolute path in which to try to find `path`.
 * @returns {boolean}
 * Whether `path` is in `target`.
 * @throws
 * When either argument is not an absolute path.
 */
const isInPath = (path, target) => {
    if (!ospath.isAbsolute(path))
        throw new Error('argument `path` must be an absolute path');
    if (!ospath.isAbsolute(target))
        throw new Error('argument `target` must be an absolute path');
    
    const relPath = ospath.relative(target, path);
    return !relPath.startsWith('..');
};

/**
 * Provides iteration/forEach functions for arrays that run either
 * synchronously or asynchronously.
 */
const iterating = {
    /**
     * Iterates over the provided (promised) array using the given function.
     * This function executes asynchronously, running the iterator on all
     * elements before waiting for them all to complete.
     * 
     * @async
     * @template T
     * @param {(T[]|Promise.<T[]>)} arr
     * The array or promised array to transform.
     * @param {function(T, number, T[]): *} asyncIterFn
     * The asynchronous iteration function.
     * @returns {void}
     */
    async: async (arr, asyncIterFn) => {
        await Promise.all((await arr).map(asyncIterFn));
        return void 0;
    },

    /**
     * Iterates over the provided (promised) array using the given function.
     * This function executes synchronously, waiting for the iterator to return
     * before moving on to the next element.
     * 
     * @async
     * @template T
     * @param {(T[]|Promise.<T[]>)} arr
     * The array or promised array to transform.
     * @param {function(T, number, T[]): *} asyncIterFn
     * The asynchronous transformation function.
     * @returns {void}
     */
    sync: async (arr, asyncIterFn) => {
        arr = await arr;

        for (let i = 0, len = arr.length; i < len; i++)
            await asyncIterFn(arr[i], i, arr);

        return void 0;
    }
};

module.exports = {
    pathTypes,
    decomposePath,
    appendCurPath,
    contextRelative,
    checkPath,
    isInPath,
    iterating
};