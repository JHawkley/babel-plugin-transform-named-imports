const util = require('util');
const types = require('@babel/core').types;

const $ = require('./constants');

/** @typedef {import('./pathResolver').ResolvedPath} ResolvedPath */
/** @typedef {import('./babel').ExportSpecifierNode} ExportSpecifierNode */
/** @typedef {import('./babel').ExportDefaultNode} ExportDefaultNode */
/** @typedef {import('./babel').ExportNamedNode} ExportNamedNode */
/** @typedef {import('./babel').ExportNode} ExportNode */

/**
 * @callback ResolveFn
 * @param {string} resolve
 * @returns {Promise.<ResolvedPath>}
 */

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

/** A class representing the information for an export specifier. */
class ExportSpecifier {

    /**
     * Tries to creates a {@link ExportSpecifier} from an {@link ExportDefaultNode}.
     * Only nodes that export an identifier are compatible.
     * 
     * @param {ExportDefaultNode} node
     * The node to create the specifier from.
     * @returns {?ExportSpecifier}
     * A new {@link ExportSpecifier} instance or `null` if the node was incompatible.
     */
    static fromDefaultExport(node) {
        // only try to follow if the declaration is an identifier;
        // any other kind of declaration will stop searching at the last
        // import, in this case
        if (!types.isIdentifier(node.declaration)) return null;

        const localName = node.declaration.name;

        return new ExportSpecifier(localName, null, $.default, null, $.default);
    }

    /**
     * Tries to creates a {@link ExportSpecifier} from an {@link ExportSpecifierNode}.
     * 
     * @param {ExportSpecifierNode} specifier
     * The specifier node to create the specifier from.
     * @param {ResolvedPath} path
     * The resolved path of the import being re-exported.  Only applicable to
     * the `export ... from` syntax.
     * @returns {?ExportSpecifier}
     * A new {@link ExportSpecifier} instance or `null` if the node had an
     * unrecognized type.
     */
    static fromSpecifier(specifier, path) {
        const type = getSimpleType(specifier);
        if (type === $.unknown) return null;

        const localName = (specifier.local || specifier.exported).name;
        const importedName
            = !path ? null
            : type === $.default ? $.default
            : localName;
        const exportedName
            = specifier.exported ? specifier.exported.name
            : type === $.default ? $.default
            : localName;
        
        return new ExportSpecifier(localName, importedName, exportedName, path, type);
    }

    /**
     * Revives a {@link ExportSpecifier} that was serialized to JSON.
     * 
     * @param {Object} data
     * The parsed JSON object.
     * @returns {ExportSpecifier}
     * The revived {@link ExportSpecifier} instance.
     */
    static revive(data) {
        if (!data || data.__pickledType !== $.exportSpec) return null;
        return new ExportSpecifier(...data.unapplied);
    }

    /**
     * Creates a new instance of {@link ExportSpecifier}.
     * 
     * @param {string} localName
     * The name of the export's local identifier.
     * @param {?string} importedName
     * The imported name.
     * @param {?string} exportedName
     * The exported name.
     * @param {?ResolvedPath} path
     * The resolved path of the import being re-exported.  Only applicable to
     * the `export ... from` syntax.
     * @param {('default'|'namespace'|'named')} type
     * The type of the export.
     */
    constructor(localName, importedName, exportedName, path, type) {
        /** The local name of the exported value. */
        this.name = localName;

        /** The name that the value was imported under. */
        this.importedName = importedName || null;

        /** The name that the value was exported under. */
        this.exportedName = exportedName || null;

        /** The name to search for when locating related imports. */
        this.searchName = importedName || localName;

        /** The resolved path of the imported module. */
        this.path = path || null;

        /** The simple type. */
        this.type = type;
    }

    /**
     * Prepares this {@link ExportSpecifier} instance for JSON serialization.
     * 
     * @returns {Object}
     * The data for the instance.  Use {@link ExportSpecifier.revive} to
     * restore the instance later.
     */
    toJSON() {
        return {
            __pickledType: $.exportSpec,
            unapplied: [
                this.name,
                this.importedName,
                this.exportedName,
                this.path,
                this.type
            ]
        };
    }

    /**
     * A custom inspector for debugging.
     * 
     * @returns {string}
     */
    [util.inspect.custom]() {
        const { name, path, type, importedName: imp, exportedName: exp, searchName: search } = this;
        const properName = type === $.namespace ? '*' : imp || name;
        const asName = exp === properName ? exp : `${properName} as ${exp}`;
        return [
            `${type} export { ${asName} } via ${search}`,
            path && `from "${path.original}"`
        ].filter(Boolean).join(' ');
    }

}

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

    return specifiers.map((specifier) =>
        ExportSpecifier.fromSpecifier(specifier, resolvedPath)
    );
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
            ? ExportSpecifier.fromDefaultExport(node)
            : handleOtherExport(node, resolve);
    });

    return Array.prototype.concat
        .apply([], await Promise.all(promisedExps))
        .filter(Boolean);
};

module.exports.ExportSpecifier = ExportSpecifier;