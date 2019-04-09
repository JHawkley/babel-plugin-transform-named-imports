const util = require('util');
const types = require('@babel/core').types;

const $ = require('./constants');

/** @typedef {import('./pathResolver').ResolvedPath} ResolvedPath */
/** @typedef {import('./babel').ImportSpecifierNode} ImportSpecifierNode */
/** @typedef {import('./babel').ImportNode} ImportNode */

/**
 * @callback ResolveFn
 * @param {string} resolve
 * @returns {Promise.<ResolvedPath>}
 */

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


/** A class representing the information for an import specifier. */
class ImportSpecifier {

    /**
     * Tries to creates a {@link ImportSpecifier} from an {@link ImportSpecifierNode}.
     * 
     * @param {ExportSpecifierNode} specifier
     * The specifier node to create the specifier from.
     * @param {ResolvedPath} path
     * The resolved path of the import being re-exported.  Only applicable to
     * the `export ... from` syntax.
     * @returns {?ImportSpecifier}
     * A new {@link ImportSpecifier} instance or `null` if the node had an
     * unrecognized type.
     */
    static fromSpecifier(specifier, path) {
        const type = getSimpleType(specifier);

        if (type === $.unknown) return null;

        const localName = specifier.local.name;
        const importedName
            = type === $.default ? $.default
            : specifier.imported ? specifier.imported.name
            : localName;
        
        return new ImportSpecifier(localName, importedName, path, type);
    }

    /**
     * Revives a {@link ImportSpecifier} that was serialized to JSON.
     * 
     * @param {Object} data
     * The parsed JSON object.
     * @returns {ImportSpecifier}
     * The revived {@link ImportSpecifier} instance.
     */
    static revive(data) {
        if (!data || data.__pickledType !== $.importSpec) return null;
        return new ImportSpecifier(...data.unapplied);
    }

    /**
     * Creates a new instance of {@link ImportSpecifier}.
     * 
     * @param {string} localName
     * The name of the export's local identifier.
     * @param {string} importedName
     * The imported name.
     * @param {ResolvedPath} path
     * The resolved path of the import.
     * @param {('default'|'namespace'|'named')} type
     * The type of the import.
     */
    constructor(localName, importedName, path, type) {
        /** The local name of the imported value. */
        this.name = localName;

        /** The name of the value, as it was exported by its module. */
        this.importedName = importedName;

        /** The name to search for when locating related exports. */
        this.searchName = importedName;

        /** The resolved path of the imported module. */
        this.path = path;

        /** The simple type. */
        this.type = type;
    }

    /**
     * Prepares this {@link ImportSpecifier} instance for JSON serialization.
     * 
     * @returns {Object}
     * The data for the instance.  Use {@link ImportSpecifier.revive} to
     * restore the instance later.
     */
    toJSON() {
        return {
            __pickledType: $.importSpec,
            unapplied: [
                this.name,
                this.importedName,
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
        const { name, type, importedName: imp, searchName: search, path: { original } } = this;
        const asName = imp === name ? name : `${imp} as ${name}`;
        return `${type} import { ${asName} } via ${search} from "${original}"`;
    }

}

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

        return specifiers.map((specifier) =>
            ImportSpecifier.fromSpecifier(specifier, resolvedPath)
        );
    });

    return Array.prototype.concat
        .apply([], await Promise.all(promisedImps))
        .filter(Boolean);
};

module.exports.ImportSpecifier = ImportSpecifier;