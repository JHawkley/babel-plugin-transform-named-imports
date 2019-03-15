/**
 * Prefixes a path with './', the current path, if necessary.
 * @param {string} path The path.
 * @returns {string}
 */
const appendCurPath = path => path.startsWith('.') ? path : './' + path;

module.exports = {
    appendCurPath,
};