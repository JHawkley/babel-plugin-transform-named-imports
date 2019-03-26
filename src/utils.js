const fs = require('fs');
const ospath = require('path');

/** @enum {Symbol} */
const pathTypes = {
    nil: Symbol('path-types:nil'),
    file: Symbol('path-types:file'),
    dir: Symbol('path-types:dir')
};

/**
 * Prefixes a path with './', the current path, if necessary.
 * Returns the path unaltered if the given path is absolute.
 * 
 * @param {string} path A path.
 * @returns {string}
 */
const appendCurPath = (path) =>
    ospath.isAbsolute(path) || path.startsWith('.') ? path : './' + path;

/**
 * @callback ContextPathFn
 * @param {string} path The path to make relative to the root-context.
 * @returns {string} The path, relative to the root-context.
 */

/**
 * Creates a function that can be used to determine the root-context relative
 * path of a file.
 * 
 * @param {string} rootContext The root-context.
 * @returns {ContextPathFn} A function that will make a path relative to the
 * root-context.
 */
const contextRelative = (rootContext) => {
    if (!ospath.isAbsolute(rootContext))
        throw new Error('the `rootContext` must be an absolute path');
    
    const PathResolver = require('./pathResolver');

    return (path) => {
        if (!path) return null;
    
        const decomposed = PathResolver.decompose(path);
        decomposed.path = appendCurPath(ospath.relative(
            rootContext,
            decomposed.path
        ));
    
        return PathResolver.recompose(decomposed);
    };
};

/**
 * Checks a path for accessibility and the type of file-system object
 * it points to.
 * 
 * @async
 * @param {string} path The path whose existence is in question.
 * @returns {pathTypes}
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
 * @param {string} path The absolute path in question.
 * @param {string} target The absolute path in which to try to find `path`.
 * @returns {boolean} Whether `path` is in `target`.
 * @throws When either argument is not an absolute path.
 */
const isInPath = (path, target) => {
    if (!ospath.isAbsolute(path))
        throw new Error('argument `path` must be an absolute path');
    if (!ospath.isAbsolute(target))
        throw new Error('argument `target` must be an absolute path');
    
    const relPath = ospath.relative(target, path);
    return !relPath.startsWith('..');
};

module.exports = {
    pathTypes,
    appendCurPath,
    contextRelative,
    checkPath,
    isInPath
};