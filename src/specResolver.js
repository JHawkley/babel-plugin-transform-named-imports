const fs = require('fs');

const types = require('babel-types');
const Babylon = require('babylon');

const extractExportSpecifiers = require('./extractExportSpecifiers');
const extractImportSpecifiers = require('./extractImportSpecifiers');

/**
 * Parses the specified JS/ES6 file with the Babylon parser
 * and returns the AST.
 * @param filePath The path to the file to parse.
 * @returns The AST of the specified file or null if the specified
 * file could not be found or could not be parsed.
 */
const parse = filePath => {
    try {
        return Babylon.parse(fs.readFileSync(filePath, 'utf-8'), {
            sourceType: 'module',
            plugins: [
                'jsx',
                'flow',
                'estree',
                'typescript',
                'doExpressions',
                'objectRestSpread',
                'decorators',
                'decorators2',
                'classProperties',
                'classPrivateProperties',
                'classPrivateMethods',
                'exportExtensions',
                'asyncGenerators',
                'functionBind',
                'functionSent',
                'dynamicImport',
                'numericSeparator',
                'optionalChaining',
                'importMeta',
                'bigInt',
                'optionalCatchBinding',
                'throwExpressions',
                'pipelineOperator',
                'nullishCoalescingOperator',
            ],
        });
    }
    catch (error) {
        return null;
    }
};

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
     * Initializes a new instance of {@link SpecResolver}.
     * @param {import('./pathResolver')} pathResolver The path-resolver to use when
     * resolving a file's path.
     */
    constructor(pathResolver) {
        this.cache = {};
        this.pathResolver = pathResolver;
    }

    /**
     * Resolves a file's AST and gets the specifiers from it.
     * @param {string} filePath The absolute path to the file to resolve specifiers for.
     * @returns An object containing the extracted specifiers or null if no AST
     * could be resolved.
     */
    resolve(filePath) {
        const cachedResult = this.cache[filePath];
        if (cachedResult !== undefined) {
            return cachedResult;
        }
        
        const ast = parse(filePath);
        const specifiers = this.getSpecifiers(ast, filePath);

        this.cache[filePath] = specifiers;
        return specifiers;
    }

    /**
     * Gets the specifiers from a file, given its AST and the file's path.
     * @param {*} ast The AST of the file.
     * @param {string} filePath The absolute path to the file to generate specifiers for.
     * @returns An object containing the extracted specifiers or null if the AST was not
     * available.
     */
    getSpecifiers(ast, filePath) {
        if (!ast) {
            return null;
        }

        const resolve = request => this.pathResolver.resolve(request, filePath);

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
