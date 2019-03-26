const $ = require('./constants');
const types = require('@babel/core').types;

/** @typedef {import('./babel').ImportSpecifierNode} ImportSpecifierNode */
/** @typedef {import('./babel').ImportNode} ImportNode */
/** @typedef {function(string): Promise.<?string>} ResolveFn */

/**
 * @typedef ImportSpecifier
 * @prop {string} name The local name of the imported value.
 * @prop {string} importedName The name of the value, as it was exported by its module.
 * @prop {string} searchName The name to search for when locating related exports.
 * @prop {?string} path The absolute path of the imported module, if resolved.
 * @prop {string} originalPath The original path that was used to import the module.
 * @prop {('default'|'namespace'|'named')} type The simple type.
 */

// eslint-disable-next-line jsdoc/require-param
/** @type {function(ImportSpecifierNode): ('default'|'namespace'|'named')} */
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
 * @param {ImportNode[]} declarations The declarations extract specifiers from.
 * @param {ResolveFn} resolve A function that resolves a relative path to
 * an absolute path.
 * @returns {ImportSpecifier[]}
 */
module.exports = async (declarations, resolve) => {
    const promisedImps = declarations.map(async (node) => {
        const specifiers = node.specifiers || [];
        const originalPath = node.source.value;
        const importPath = await resolve(originalPath);

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
                path: importPath,
                originalPath: originalPath,
                type: type,
            };
        });
    });

    const imps = await Promise.all(promisedImps);
    return [].concat(...imps).filter(Boolean);
};
