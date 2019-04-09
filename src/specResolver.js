const types = require('@babel/core').types;

const $ = require('./constants');
const utils = require('./utils');
const { SpecifierResolutionError } = require('./errors');
const extractImports = require('./extractImportSpecifiers');
const extractExports = require('./extractExportSpecifiers');
const ResolvedPath = require('./pathResolver').ResolvedPath;

/** @typedef {import('./common').WebpackModule} WebpackModule */
/** @typedef {import('./specLoader').SpecifierContext} SpecifierContext */
/** @typedef {import('./core').State} State */
/** @typedef {import('./babel').BabelAST} BabelAST */
/** @typedef {import('./babel').ImportNode} ImportNode */
/** @typedef {import('./babel').ExportNode} ExportNode */
/** @typedef {import('./extractImportSpecifiers').ImportSpecifier} ImportSpecifier */
/** @typedef {import('./extractExportSpecifiers').ExportSpecifier} ExportSpecifier */

/**
 * Either kind of specifier.
 * 
 * @typedef {(ImportSpecifier|ExportSpecifier)} Specifier
 */

/**
 * @param {*} node
 * @returns {node is ImportNode}
 */
const isImport = (node) =>
    types.isImportDeclaration(node);

/**
 * @param {*} node
 * @returns {node is ExportNode}
 */
const isExport = (node) => {
    if (types.isExportDefaultDeclaration(node)) return true;
    if (types.isExportNamedDeclaration(node)) return true;
    return false;
};

/** A regular-expression to deal with inline-loader exclusions. */
const reInlineExclusions = /^(!!|-!|!)?(.*)$/;

/** A regular-expression to extract the JSON from the spec-loader's output. */
const reExtractJson = /^\/\* spec-loader \*\/ module\.exports = (.*?);$/;

/**
 * Revives a {@link SpecifierResult} and all related data.
 * 
 * @param {string} key
 * The key of the property being visited.
 * @param {*} value
 * The value being visited.
 */
const reviver = (key, value) => {
    if (value == null) return value;
    if (typeof value !== 'object') return value;
    if (typeof value.__pickledType !== 'string') return value;

    switch (value.__pickledType) {
        case $.specResult:
            return SpecifierResult.revive(value);
        case $.resolvedPath:
            return ResolvedPath.revive(value);
        case $.importSpec:
            return extractImports.ImportSpecifier.revive(value);
        case $.exportSpec:
            return extractExports.ExportSpecifier.revive(value);
        default:
            return value;
    }
};

/**
 * Loads a {@link SpecifierResult} via the spec-loader.
 * 
 * @template T
 * @param {LoaderContext} loader
 * @param {string} ident
 * @param {string} request
 * @param {function(SpecifierResult, WebpackModule): T} finalizer
 * @returns {Promise.<?T>}
 */
const loadSpecifiers = (loader, ident, request, finalizer) => {
    return new Promise((ok, fail) => {
        const [, exclaim, rest] = reInlineExclusions.exec(request);

        if (exclaim) return ok(null);

        const specQuery = `${$.specLoaderQuery}=${ident}`;
        let [file, loaders, query] = utils.decomposePath(rest);
        query = query ? `${query}&${specQuery}` : `?${specQuery}`;

        const path = [loaders, file, query].filter(Boolean).join('');
        
        loader.loadModule(path, (err, source, map, instance) => {
            if (err) {
                fail(new SpecifierResolutionError(request, err));
            }
            else {
                try {
                    const [, json] = reExtractJson.exec(source);
                    const result = JSON.parse(json, reviver);
                    ok(finalizer(result, instance));
                }
                catch (err) {
                    fail(new SpecifierResolutionError(request, err));
                }
            }
        });
    });
};

class SpecifierResult {

    /**
     * Revives a {@link SpecifierResult} that was serialized to JSON.
     * 
     * @param {Object} data
     * The data to revive an instance from.
     * @returns {?SpecifierResult}
     * The revived {@link SpecifierResult} instance, or `null` if the data
     * was invalid.
     */
    static revive(data) {
        if (!data || data.__pickledType !== $.specResult) return null;
        return new SpecifierResult(...data.unapplied);
    }

    /**
     * Gets all the specifiers with a non-null `path` property.
     * 
     * @type {Specifier[]}
     */
    get pathedSpecifiers() {
        const pathedExports = this.exportSpecifiers.filter(exp => Boolean(exp.path));
        return Array.prototype.concat.call([], this.importSpecifiers, pathedExports);
    }

    /**
     * Creates an instance of {@link SpecifierResult}.
     * 
     * @param {ImportSpecifier[]} importSpecifiers
     * The import specifiers.
     * @param {ExportSpecifier[]} exportSpecifiers
     * The export specifiers.
     * @param {boolean} [hasSideEffects=true]
     * Whether the module that hosts these specifiers has side-effects.
     */
    constructor(importSpecifiers, exportSpecifiers, hasSideEffects = true) {
        this.importSpecifiers = importSpecifiers;
        this.exportSpecifiers = exportSpecifiers;
        this.hasSideEffects = hasSideEffects;
    }

    /**
     * Prepares this {@link SpecifierResult} instance for JSON serialization.
     * 
     * @returns {Object}
     * The data for the instance.  Use {@link SpecifierResult.revive} to
     * restore the instance later.
     */
    toJSON() {
        return {
            __pickledType: $.specResult,
            unapplied: [
                this.importSpecifiers,
                this.exportSpecifiers,
                this.hasSideEffects
            ]
        };
    }

}

/**
 * Handles resolution and extraction of specifiers.
 */
class SpecResolver {

    constructor() {
        /** @type {Map.<string, ?SpecifierResult>} */
        this.cache = new Map();
    }

    /**
     * Extracts the import and export specifiers from an AST.
     * 
     * @param {SpecifierContext} specContext
     * The {@link SpecifierContext} to use.
     * @param {BabelAST} ast
     * The Babel-compatible AST.
     * @return {SpecifierResult}
     * A new {@link SpecifierResult} instance.
     */
    async extractSpecifiers(specContext, ast) {
        const {
            pathResolver, hasSideEffects, debugLoader,
            request: issuer
        } = specContext;

        const debugPath = debugLoader.extend('path-resolver');
        const importDeclarations = [];
        const exportDeclarations = [];

        /**
         * @function
         * @param {string} request
         * @returns {Promise.<ResolvedPath>}
         */
        const resolve = (request) => pathResolver.resolve(request, issuer, debugPath);

        ast.program.body.forEach(dec => {
            if (isImport(dec)) importDeclarations.push(dec);
            else if (isExport(dec)) exportDeclarations.push(dec);
        });

        return new SpecifierResult(
            await extractImports(importDeclarations, resolve),
            await extractExports(exportDeclarations, resolve),
            hasSideEffects
        );
    }

    /**
     * Resolves a module's import and export specifiers.
     * 
     * @async
     * @param {State} state
     * The working state.
     * @param {string} request
     * The request path to the module to resolve specifiers for.  The path-portion
     * of the request must be an absolute path.
     * @returns {?SpecifierResult}
     * An object containing the extracted specifiers.
     * @throws {SpecifierResolutionError}
     * When the specifier module fails to resolve.
     */
    async resolve({ident, loader}, request) {
        const cachedResult = this.cache.get(request);
        
        if (typeof cachedResult !== 'undefined')
            return cachedResult;

        return await loadSpecifiers(
            loader, ident, request,
            (result) => {
                this.cache.set(request, result);
                return result;
            }
        );
    }

    /**
     * Resolves a module's import and export specifiers.  This version includes
     * the Webpack module instance produced by the `specLoader`.
     * 
     * @async
     * @param {State} state
     * The working state.
     * @param {string} request
     * The request path to the module to resolve specifiers for.  The path-portion
     * of the request must be an absolute path.
     * @returns {?[SpecifierResult, WebpackModule]}
     * A tuple of the {@link SpecifierResult} and {@link WebpackModule}.
     * @throws {SpecifierResolutionError}
     * When the specifier module fails to resolve.
     */
    async resolveModule({loader, ident}, request) {
        return await loadSpecifiers(
            loader, ident, request,
            (result, instance) => {
                this.cache.set(request, result);
                return [result, instance];
            }
        );
    }
}

module.exports = SpecResolver;
module.exports.SpecifierResult = SpecifierResult;