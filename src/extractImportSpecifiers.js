const util = require('util');
const $ = require('./constants');
const types = require('@babel/core').types;

/** @typedef {import('./babel').ImportSpecifierNode} ImportSpecifierNode */
/** @typedef {import('./babel').ImportNode} ImportNode */
/** @typedef {import('./pathResolver').ResolvedPath} ResolvedPath */

/**
 * @callback ResolveFn
 * @param {string} resolve
 * @returns {Promise.<ResolvedPath>}
 */

/**
 * @typedef ImportSpecifier
 * @prop {string} name The local name of the imported value.
 * @prop {string} importedName The name of the value, as it was exported by its module.
 * @prop {string} searchName The name to search for when locating related exports.
 * @prop {ResolvedPath} path The resolved path of the imported module.
 * @prop {('default'|'namespace'|'named')} type The simple type.
 */

/**
 * A custom inspector for debugging.
 * 
 * @function
 * @this {ImportSpecifier}
 * @returns {string}
 */
function customInspect() {
    const { name, type, importedName: imp, searchName: search, path: { original } } = this;
    const asName = imp === name ? name : `${imp} as ${name}`;
    return `${type} import { ${asName} } via ${search} from "${original}"`;
}

/**
 * @function
 * @param {ImportSpecifierNode} node
 * @returns {('default'|'namespace'|'named')}
 */
const getSimpleType = (node) => {
    const { imported } = node;

    if (imported && imported.name === $.default) return $.default;
    if (types.isImportDefaultSpecifier(node)) return $.default;
    if (types.isImportNamespaceSpecifier(node)) return $.namespace;
    if (types.isImportSpecifier(node)) return $.named;
    return $.unknown;
};

/**
 * Given an array of import declarations, produces an array of import specifiers.
 * 
 * @async
 * @param {ImportNode[]} declarations
 * The declarations extract specifiers from.
 * @param {ResolveFn} resolve
 * A function that resolves a relative path to an absolute path.
 * @returns {ImportSpecifier[]}
 */
module.exports = async (declarations, resolve) => {
    const promisedImps = declarations.map(async (node) => {
        const specifiers = node.specifiers || [];
        const resolvedPath = await resolve(node.source.value);

        return specifiers.map((specifier) => {
            const type = getSimpleType(specifier);

            if (type === $.unknown) return null;

            const localName = specifier.local.name;
            const importedName
                = type === $.default ? $.default
                : specifier.imported ? specifier.imported.name
                : localName;

            return {
                name: localName,
                importedName: importedName,
                searchName: importedName,
                path: resolvedPath,
                type: type,
                [util.inspect.custom]: customInspect
            };
        });
    });

    return Array.prototype.concat
        .apply([], await Promise.all(promisedImps))
        .filter(Boolean);
};
