const fs = require('fs');
const ospath = require('path');

/**
 * @template K,V
 * @typedef KVP
 * @prop {K} key
 * @prop {V} value
 */

/**
 * A decomposed request.
 * * [0] The path portions.
 * * [1] The loader portion.
 * * [2] The query portion.
 * @typedef {[string, ?string, ?string]} DecomposedRequest
 */

/**
 * @template T,U
 * @typedef Future
 * @prop {string} name
 * @prop {boolean} didResolve
 * @prop {boolean} didReject
 * @prop {boolean} didComplete
 * @prop {Promise.<U>} promise
 * @prop {function(T): void} resolve
 * @prop {function(Error): void} reject
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
 * @param {string} originalPath The request to decompose.
 * @returns {DecomposedRequest} The decomposed request.
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
 * @param {*} obj
 * @returns {obj is KVP}
 */
const isKVP = (obj) => obj && obj.key && obj.value;

/**
 * Creates a map-of-maps from the given entries.  Each entry should be
 * a {@link KVP} object.  If the {@link KVP#value} property is an array
 * and it contains only {@link KVP} objects, they will be merged into
 * a nested map.
 * 
 * @param {KVP[]} entries
 * An array of arrays.
 * @param {Map} [map]
 * The map to merge the entries into.  If not provided, a new map
 * will be created and returned.
 * @returns {Map}
 * The resulting map.
 */
const mergeMap = (entries, map = new Map()) => {
    if (entries.length === 0) return map;

    entries.forEach(({key, value}) => {
        if (!Array.isArray(value) || !value.every(isKVP))
            map.set(key, value);
        else {
            let nextMap = map.get(key);
            if (!nextMap) {
                nextMap = new Map();
                map.set(key, nextMap);
            }
            mergeMap(value, nextMap);
        }
    });

    return map;
};

/**
 * Flattens an array of arrays.
 * 
 * @template T
 * @param {T[][]} arrayOfArrays
 * An array of arrays to be flattened.
 * @returns {T[]}
 * The flattened array.
 */
const flatten = (arrayOfArrays) => Array.prototype.concat.apply([], arrayOfArrays);

/** Provides map functions for arrays that run either synchronously or asynchronously. */
const mapping = {
    /**
     * Transforms the provided (promised) array using the given transformation function.
     * This function executes asynchronously, transforming all elements at once.
     * 
     * @async
     * @template T,U
     * @param {(T[]|Promise.<T[]>)} arr
     * The array or promised array to transform.
     * @param {function(T, number, T[]): (U|Promise.<U>)} asyncMapFn
     * The asynchronous transformation function.
     * @returns {U[]}
     * The transformed result.
     */
    async: async (arr, asyncMapFn) => await Promise.all((await arr).map(asyncMapFn)),

    /**
     * Transforms the provided (promised) array using the given transformation function.
     * This function executes synchronously, transforming each element one at a time,
     * awaiting on the return value.
     * 
     * @async
     * @template T,U
     * @param {(T[]|Promise.<T[]>)} arr
     * The array or promised array to transform.
     * @param {function(T, number, T[]): (U|Promise.<U>)} asyncMapFn
     * The asynchronous transformation function.
     * @returns {U[]}
     * The transformed result.
     */
    sync: async (arr, asyncMapFn) => {
        arr = await arr;
        const out = new Array(arr.length);

        for (let i = 0, len = arr.length; i < len; i++)
            out[i] = await asyncMapFn(arr[i], i, arr);

        return out;
    }
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

/**
 * @template T,U
 * @param {string} [name]
 * The name of the future.
 * @param {function(Promise.<T>): Promise.<U>} [decorator]
 * A function that will transform the resolved value.
 * @returns {Future.<T, U>}
 * A new future.
 */
const future = (name = 'unnamed', decorator = null) => {
    /**
     * @template U
     * @typedef OuterRef
     * @prop {Promise.<U>} p
     * @prop {function(U): void} ok
     * @prop {function(Error): void} fail
     */

    let resolved = false;
    let rejected = false;
    let completed = false;

    /** @type {Promise.<OuterRef.<U>>} */
    const outer = new Promise((outerOk) => {
        const result = {};
        const p = new Promise((innerOk, innerFail) => {
            result.ok = innerOk;
            result.fail = innerFail;
            outerOk(result);
        });
        result.p = decorator ? decorator(p) : p;
    });

    const inner = outer.then(({p}) => p);

    const errorMsg = () => `future "${name}" already ${resolved ? 'resolved' : 'rejected'}`;

    return {
        get name() { return name; },
        get didResolve() { return resolved; },
        get didReject() { return rejected; },
        get didComplete() { return completed; },
        get promise() { return inner; },

        resolve(value) {
            if (completed) throw new Error(errorMsg());

            completed = resolved = true;
            outer.then(({ok}) => ok(value));
        },

        reject(reason) {
            if (completed) throw new Error(errorMsg());

            completed = rejected = true;
            outer.then(({fail}) => fail(reason));
        }
    };
};

module.exports = {
    pathTypes,
    decomposePath,
    appendCurPath,
    contextRelative,
    checkPath,
    isInPath,
    mergeMap,
    flatten,
    mapping,
    iterating,
    future
};