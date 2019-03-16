const types = require('./babel-helper').types;

/** @typedef {import('./utils').SpecifierProps} SpecifierProps */
/** @typedef {import('./utils').WebpackProps} WebpackProps */

/**
 * @typedef ImportSpecifier
 * @prop {string} name The local name of the imported value.
 * @prop {string} importedName The name of the value, as it was exported by its module.
 * @prop {string} searchName The name to search for when locating related exports.
 * @prop {?string} path The absolute path of the imported module, if resolved.
 * @prop {string} originalPath The original path that was used to import the module.
 * @prop {WebpackProps} webpack The Webpack-specific parts of the original path.
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
 * @param {function(string): SpecifierProps} resolve A function that resolves
 * a path to the {@link SpecifierProps}.
 * @returns {ImportSpecifier[]}
 */
module.exports = (declarations, resolve) => {
    const imports = [];

    declarations.forEach(importNode => {
        const specifiers = importNode.specifiers || [];
        const originalPath = importNode.source.value;
        const { importPath, webpack } = resolve(originalPath);

        specifiers.forEach(specifier => {
            const type = getSimpleType(specifier);

            if (type !== 'unknown') {
                const localName = specifier.local.name;
                const importedName
                    = type === 'default' ? 'default'
                    : specifier.imported ? specifier.imported.name
                    : localName;

                imports.push({
                    name: localName,
                    importedName: importedName,
                    searchName: importedName,
                    path: importPath,
                    originalPath: originalPath,
                    webpack: webpack,
                    type: type,
                });
            }
        });
    });

    return imports;
};
