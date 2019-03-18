const $ = require('./constants');
const types = require('./babelHelper').types;
const { emptyWebpackProps } = require('./utils');

/** @typedef {import('./utils').SpecifierProps} SpecifierProps */
/** @typedef {import('./utils').WebpackProps} WebpackProps */

/**
* @typedef ExportSpecifier
* @prop {string} name The local name of the exported value.
* @prop {string} exportedName The name that the value was exported under.
* @prop {string} searchName The name to search for when locating related imports.
* @prop {?string} path The absolute path of the imported module.
* @prop {?string} originalPath The original path that was used to import the module.
* @prop {WebpackProps} webpack The Webpack-specific parts of the original path.
* @prop {('default'|'namespace'|'named')} type The simple type.
*/

/** @type {function(*): ('default'|'namespace'|'named')} */
const getSimpleType = node => {
    const { local } = node;

    if (local && local.name === $.default) return $.default;
    if (types.isExportDefaultSpecifier(node)) return $.default;
    if (types.isExportNamespaceSpecifier(node)) return $.namespace;
    if (types.isExportSpecifier(node)) return $.named;
    return $.unknown;
};

/** @type {function(ExportSpecifier[], *): void} */
const handleDefaultExport = (exps, node) => {
    // only try to follow if the declaration is an identifier;
    // any other kind of declaration will stop searching at the last
    // import, in this case
    if (!types.isIdentifier(node.declaration)) {
        return;
    }

    const localName = node.declaration.name;

    exps.push({
        name: localName,
        exportedName: $.default,
        searchName: localName,
        path: null,
        originalPath: null,
        webpack: emptyWebpackProps,
        type: $.default,
    });
};

/** @type {function(ExportSpecifier[], function(string): SpecifierProps, *): void} */
const handleOtherExport = (exps, resolve, node) => {
    const specifiers = node.specifiers || [];
    const originalPath = node.source ? node.source.value : null;
    const { importPath, webpack } = resolve(originalPath);

    specifiers.forEach(specifier => {
        const type = getSimpleType(specifier);

        if (type !== $.unknown) {
            const localName = (specifier.local || specifier.exported).name;
            const exportedName
                = specifier.exported ? specifier.exported.name
                : type === $.default ? $.default
                : localName;

            exps.push({
                name: localName,
                exportedName: exportedName,
                searchName: localName,
                path: importPath,
                originalPath: originalPath,
                webpack: webpack,
                type: type,
            });
        }
    });
};

/**
 * Given an array of export declarations, produces an array of export specifiers.
 * @param {Array} declarations The declarations extract specifiers from.
 * @param {function(string): SpecifierProps} resolve A function that resolves
 * a path to the {@link SpecifierProps}.
 * @returns {ExportSpecifier[]}
 */
module.exports = (declarations, resolve) => {
    const exps = [];

    declarations.forEach(node => {
        if (types.isExportDefaultDeclaration(node)) {
            handleDefaultExport(exps, node);
        }
        else {
            handleOtherExport(exps, resolve, node);
        }
    });

    return exps;
};
