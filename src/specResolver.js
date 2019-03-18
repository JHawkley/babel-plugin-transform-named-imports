const types = require('./babelHelper').types;
const pathHelper = require('./utils').pathHelper;
const extractExportSpecifiers = require('./extractExportSpecifiers');
const extractImportSpecifiers = require('./extractImportSpecifiers');

/** @typedef {import('./extractImportSpecifiers').ImportSpecifier} ImportSpecifier */
/** @typedef {import('./extractExportSpecifiers').ExportSpecifier} ExportSpecifier */

/**
 * A Babel-compatible AST.
 * @typedef BabelAST
 */

/**
 * A function that takes the absolute path to a module and tries to parse it
 * into a Babel-compatible AST.
 * @callback ResolveAstFn
 * @param {string} filePath The absolute path to the file to try to parse.
 * @returns {?BabelAST} A Babel-compatible AST or `null` if no AST could be
 * created, for any reason.
 */

/**
 * @typedef SpecifierResult
 * @prop {ImportSpecifier[]} importSpecifiers The extracted import specifiers.
 * @prop {ExportSpecifier[]} exportSpecifiers The extracted export specifiers.
 */

const isImport = node =>
    types.isImportDeclaration(node);

const isExport = node => {
    if (types.isExportDefaultDeclaration(node)) return true;
    if (types.isExportNamedDeclaration(node)) return true;
    return false;
};

/**
 * Resolves specifiers from a file.  Caches the results to speed later look-up.
 */
class SpecResolver {

    /**
     * Creates an ast-resolver that uses the installed Babel package.
     * This is used if a custom `advanced.pathResolver` is not provided
     * by the options.
     * @static
     * @param {Object} babelConfig
     * @returns {ResolveAstFn}
     */
    static defaultResolver(babelConfig) {
        return require('./babelHelper').makeParser(babelConfig);
    }

    /**
     * Initializes a new instance of {@link SpecResolver}.
     * @param {ResolveAstFn} astResolver A function that can parse a file into
     * a Babel AST.
     * @param {import('./pathResolver')} pathResolver The path-resolver to use when
     * resolving a file's path.
     */
    constructor(astResolver, pathResolver, cache) {
        this.cache = {};

        this.astResolver = astResolver;
        this.pathResolver = pathResolver;
    }

    /**
     * Resolves a file's AST and gets the specifiers from it.
     * @param {string} filePath The absolute path to the file to resolve specifiers for.
     * @returns {?SpecifierResult} An object containing the extracted specifiers or `null`
     * if no AST could be resolved.
     */
    resolve(filePath) {
        const cachedResult = this.cache[filePath];
        if (cachedResult !== undefined) {
            return cachedResult;
        }
        
        const ast = this.astResolver(filePath);
        const specifiers = this.getSpecifiers(ast, filePath);

        this.cache[filePath] = specifiers;
        return specifiers;
    }

    /**
     * Gets the specifiers from a file, given its AST and the file's path.
     * @param {*} ast The AST of the file.
     * @param {string} filePath The absolute path to the file to generate specifiers for.
     * @returns {?SpecifierResult} An object containing the extracted specifiers or `null`
     * if no AST could be resolved.
     */
    getSpecifiers(ast, filePath) {
        if (!ast) {
            return null;
        }

        const resolve = request => pathHelper(request, filePath, this.pathResolver);

        const importDeclarations = [];
        const exportDeclarations = [];

        ast.program.body.forEach(dec => {
            if (isImport(dec)) {
                importDeclarations.push(dec);
            }
            else if (isExport(dec)) {
                exportDeclarations.push(dec);
            }
        });
        
        const specifiers = {
            importSpecifiers: extractImportSpecifiers(importDeclarations, resolve),
            exportSpecifiers: extractExportSpecifiers(exportDeclarations, resolve),
        };

        return specifiers;
    }
}

module.exports = SpecResolver;
