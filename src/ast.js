const fs = require('fs');

const Babylon = require('babylon');

const extractExportSpecifiers = require('./extractExportSpecifiers');
const extractImportSpecifiers = require('./extractImportSpecifiers');

/**
 * Small wrapper over the Babylon ES6 AST.
 * @deprecated Use {@link import('./specResolver')|SpecResolver} to extract
 * specifiers from a file instead.
 */
class AST {
    /**
     * Initializes a new instance of {@link AST}.
     * @param {*} ast The AST to wrap.
     * @param {import('./resolver')} resolver The resolver to use when resolving a file.
     * @param {string} sourcePath The path to the file from which this AST was parsed.
     */
    constructor(ast, resolver, sourcePath) {
        this.ast = ast;
        this.resolver = resolver;
        this.sourcePath = sourcePath;
    }

    /**
     * Parses the specified JS/ES6 file with the Babylon parser
     * and returns the AST.
     * @param {string} filePath The path to the file to parse.
     * @param {import('./resolver')} resolver The resolver to use to resolve the specified file.
     * @returns The AST of the specified file or null if the specified
     * file could not be found or could not be parsed.
     */
    static parseFrom(filePath, resolver) {
        try {
            const ast = Babylon.parse(fs.readFileSync(filePath, 'utf-8'), {
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

            return new AST(ast, resolver, filePath);
        } catch (error) {
            return null;
        }
    }

    /**
     * Resolves the absolute path to the specified file,
     * relative to the file being parsed.
     * @param {string} path The path to resolve.
     * @returns {string} The absolute path to the specified file or
     * null if the path could not be resolved.
     */
    resolve(path) {
        return this.resolver.resolveFile(path, this.sourcePath);
    }

    /**
     * Gets a flat list of all the import specifiers in this file.
     */
    importSpecifiers() {
        const declarations = this.ast.program.body
            .filter(node => node.type === 'ImportDeclaration');

        return extractImportSpecifiers(declarations, this.resolve.bind(this));
    }

    /**
     * Gets a flat list of all the export specifiers in this file.
     */
    exportSpecifiers() {
        const declarations = this.ast.program.body
            .filter(node => node.type === 'ExportDefaultDeclaration' || node.type === 'ExportNamedDeclaration');

        return extractExportSpecifiers(declarations, this.resolve.bind(this));
    }
}

module.exports = AST;
