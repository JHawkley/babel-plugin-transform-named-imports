const util = require('util');
const $ = require('./constants');
const types = require('@babel/core').types;

/** @typedef {import('./babel').ExportSpecifierNode} ExportSpecifierNode */
/** @typedef {import('./babel').ExportDefaultNode} ExportDefaultNode */
/** @typedef {import('./babel').ExportNamedNode} ExportNamedNode */

/** @typedef {function(string): Promise.<?string>} ResolveFn */
/** @typedef {(ExportDefaultNode|ExportNamedNode)} ExportNode */

/**
* @typedef ExportSpecifier
* @prop {string} name The local name of the exported value.
* @prop {string} exportedName The name that the value was exported under.
* @prop {string} searchName The name to search for when locating related imports.
* @prop {?string} path The absolute path of the imported module.
* @prop {?string} originalPath The original path that was used to import the module.
* @prop {('default'|'namespace'|'named')} type The simple type.
*/

/** @type {function(): string} */
function customInspect() {
    const { name, type, exportedName: exp, searchName: search, originalPath: path } = this;
    const asName = exp === name ? name : `${exp} as ${name}`;
    return [
        `${type} export { ${asName} } via ${search}`,
        path && `from "${path}"`
    ].filter(Boolean).join(' ');
}

// eslint-disable-next-line jsdoc/require-param
/** @type {function(ExportSpecifierNode): ('default'|'namespace'|'named')} */
const getSimpleType = (node) => {
    const { local } = node;

    if (local && local.name === $.default) return $.default;
    if (types.isExportDefaultSpecifier(node)) return $.default;
    if (types.isExportNamespaceSpecifier(node)) return $.namespace;
    if (types.isExportSpecifier(node)) return $.named;
    return $.unknown;
};

// eslint-disable-next-line jsdoc/require-param
/** @type {function(ExportDefaultNode): ?ExportSpecifier} */
const handleDefaultExport = (node) => {
    // only try to follow if the declaration is an identifier;
    // any other kind of declaration will stop searching at the last
    // import, in this case
    if (!types.isIdentifier(node.declaration)) return null;

    const localName = node.declaration.name;

    return {
        name: localName,
        exportedName: $.default,
        searchName: localName,
        path: null,
        originalPath: null,
        type: $.default,
        [util.inspect.custom]: customInspect
    };
};

// eslint-disable-next-line jsdoc/require-param
/** @async @type {function(ExportNamedNode, ResolveFn): Array.<?ExportSpecifier>} */
const handleOtherExport = async (node, resolve) => {
    const specifiers = node.specifiers || [];
    const originalPath = node.source ? node.source.value : null;
    const importPath = originalPath && await resolve(originalPath);

    return specifiers.map((specifier) => {
        const type = getSimpleType(specifier);
        if (type === $.unknown) return null;

        const localName = (specifier.local || specifier.exported).name;
        const exportedName
            = specifier.exported ? specifier.exported.name
            : type === $.default ? $.default
            : localName;

        return {
            name: localName,
            exportedName: exportedName,
            searchName: localName,
            path: importPath,
            originalPath: originalPath,
            type: type,
            [util.inspect.custom]: customInspect
        };
    });
};

/**
 * Given an array of export declarations, produces an array of export specifiers.
 * 
 * @async
 * @param {ExportNode[]} declarations The declarations extract specifiers from.
 * @param {ResolveFn} resolve A function that resolves a relative path to
 * an absolute path.
 * @returns {ExportSpecifier[]}
 */
module.exports = async (declarations, resolve) => {
    const promisedExps = declarations.map((node) => {
        return types.isExportDefaultDeclaration(node)
            ? handleDefaultExport(node)
            : handleOtherExport(node, resolve);
    });

    const exps = await Promise.all(promisedExps);
    return [].concat(...exps).filter(Boolean);
};
