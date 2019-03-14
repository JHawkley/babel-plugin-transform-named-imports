const types = require('babel-types');

/**
 * @typedef ImportSpecifier
 * @prop {string} name The local name of the imported value.
 * @prop {string} importedName The name of the value, as it was exported by its module.
 * @prop {string} searchName The name to search for when locating related exports.
 * @prop {?string} path The absolute path of the imported module, if resolved.
 * @prop {string} originalPath The original path that was used to import the module.
 * @prop {('default'|'namespaced'|'named')} type The simple type.
 */

/** @type {function(*): ('default'|'namespaced'|'named')} */
const getSimpleType = node => {
    const { imported } = node;

    if (imported && imported.name === 'default') return 'default';
    if (types.isImportDefaultSpecifier(node)) return 'default';
    if (types.isImportNamespaceSpecifier(node)) return 'namespace';
    if (types.isImportSpecifier(node)) return 'named';
    return 'unknown';
};

/**
 * Given an array of import declarations, produces an array of import specifiers.
 * @param {Array} declarations The declarations extract specifiers from.
 * @param {function(string): string} resolve A function that resolves a
 * path, relative to the module being processed, to an absolute path.
 * @returns {ImportSpecifier[]}
 */
module.exports = (declarations, resolve) => {
    const imports = [];

    declarations.forEach(importNode => {
        const importPath = resolve(importNode.source.value);
        const specifiers = importNode.specifiers || [];

        specifiers.forEach(specifier => {
            const type = getSimpleType(specifier);

            if (type !== 'unknown') {
                const localName = specifier.local.name;
                const importedName
                    = type === 'default' ? 'default'
                    : specifier.imported ? specifier.imported.name
                    : specifier.local.name;

                imports.push({
                    name: localName,
                    importedName: importedName,
                    searchName: importedName,
                    path: importPath,
                    originalPath: importNode.source.value,
                    type: type,
                });
            }
        });
    });

    return imports;
};
