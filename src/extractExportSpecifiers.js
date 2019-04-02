const util = require('util');
const $ = require('./constants');
const types = require('@babel/core').types;

/** @typedef {import('./babel').ExportSpecifierNode} ExportSpecifierNode */
/** @typedef {import('./babel').ExportDefaultNode} ExportDefaultNode */
/** @typedef {import('./babel').ExportNamedNode} ExportNamedNode */
/** @typedef {import('./babel').ExportNode} ExportNode */
/** @typedef {import('./pathResolver').ResolvedPath} ResolvedPath */

/**
 * @callback ResolveFn
 * @param {string} resolve
 * @returns {Promise.<ResolvedPath>}
 */

/**
* @typedef ExportSpecifier
* @prop {string} name The local name of the exported value.
* @prop {string} exportedName The name that the value was exported under.
* @prop {string} searchName The name to search for when locating related imports.
* @prop {?ResolvedPath} path The resolved path of the imported module.
* @prop {('default'|'namespace'|'named')} type The simple type.
*/

/**
 * A custom inspector for debugging.
 * 
 * @function
 * @this {ExportSpecifier}
 * @returns {string}
 */
function customInspect() {
    const { name, type, exportedName: exp, searchName: search, path } = this;
    const asName = exp === name ? name : `${name} as ${exp}`;
    return [
        `${type} export { ${asName} } via ${search}`,
        path && `from "${path.original}"`
    ].filter(Boolean).join(' ');
}

/**
 * @function
 * @param {ExportSpecifierNode} node
 * @returns {('default'|'namespace'|'named')}
 */
const getSimpleType = (node) => {
    const { local } = node;

    if (local && local.name === $.default) return $.default;
    if (types.isExportDefaultSpecifier(node)) return $.default;
    if (types.isExportNamespaceSpecifier(node)) return $.namespace;
    if (types.isExportSpecifier(node)) return $.named;
    return $.unknown;
};

/**
 * @function
 * @param {ExportDefaultNode} node
 * @returns {?ExportSpecifier}
 */
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
        type: $.default,
        [util.inspect.custom]: customInspect
    };
};

/**
 * @function
 * @async
 * @param {ExportNamedNode} node
 * @param {ResolveFn} resolve
 * @returns {Array.<?ExportSpecifier>}
 */
const handleOtherExport = async (node, resolve) => {
    const specifiers = node.specifiers || [];
    const resolvedPath = node.source && await resolve(node.source.value);

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
            path: resolvedPath || null,
            type: type,
            [util.inspect.custom]: customInspect
        };
    });
};

/**
 * Given an array of export declarations, produces an array of export specifiers.
 * 
 * @async
 * @param {ExportNode[]} declarations
 * The declarations extract specifiers from.
 * @param {ResolveFn} resolve
 * A function that resolves a relative path to an absolute path.
 * @returns {ExportSpecifier[]}
 */
module.exports = async (declarations, resolve) => {
    const promisedExps = declarations.map((node) => {
        return types.isExportDefaultDeclaration(node)
            ? handleDefaultExport(node)
            : handleOtherExport(node, resolve);
    });

    return Array.prototype.concat
        .apply([], await Promise.all(promisedExps))
        .filter(Boolean);
};
