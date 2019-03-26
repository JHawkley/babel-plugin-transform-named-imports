const debug = require('debug')(require('./constants').loaderName);
const types = require('@babel/core').types;
const SideEffects = require('./sideEffects');
const extractImports = require('./extractImportSpecifiers');
const extractExports = require('./extractExportSpecifiers');

/** @typedef {import('./index').Context} Context */
/** @typedef {import('./babel').BabelAST} BabelAST */
/** @typedef {import('./pathResolver')} PathResolver */
/** @typedef {import('./extractImportSpecifiers').ImportSpecifier} ImportSpecifier */
/** @typedef {import('./extractExportSpecifiers').ExportSpecifier} ExportSpecifier */

/** @typedef {import('webpack/Module')} WebpackModule */

/**
 * @typedef SpecifierResult
 * @prop {ImportSpecifier[]} importSpecifiers The extracted import specifiers.
 * @prop {ExportSpecifier[]} exportSpecifiers The extracted export specifiers.
 */

/**
 * @typedef LoadedModule
 * @prop {string} path The absolute path to the module.
 * @prop {string} source The module's source code.
 * @prop {WebpackModule} instance The Webpack module instance.
 * @prop {BabelAST} [ast] The Babel AST, if available.
 */

const isImport = node =>
    types.isImportDeclaration(node);

const isExport = node => {
    if (types.isExportDefaultDeclaration(node)) return true;
    if (types.isExportNamedDeclaration(node)) return true;
    return false;
};

// eslint-disable-next-line jsdoc/require-param
/** @type {function(Context, PathResolver): function(string): Promise.<?BabelAST>} */
const makeAstResolver = (context, pathResolver) => {
    const babel = require('./babel');
    const { loader, cache, options: { babelConfig } } = context;
    const sideEffectsPromise = SideEffects.create(context, pathResolver);

    // eslint-disable-next-line jsdoc/require-param
    /** @type {function(LoadedModule): Promise.<?BabelAST>} */
    const parseAst = async ({path, source}) => {
        try { return await babel.parseAst(path, source, babelConfig); }
        catch (error) {
            debug('PARSE AST ERROR', error);
            return null;
        }
    };
    
    // eslint-disable-next-line jsdoc/require-param
    /** @type {function(string): Promise.<?LoadedModule>} */
    const loadModule = (path) => {
        let cached = cache.module.get(path);
        if (cached) return Promise.resolve(cached);

        return new Promise(ok => {
            loader.loadModule(path, (err, source, map, instance) => {
                ok(err ? null : { path, source, instance });
            });
        });
    };
    
    // eslint-disable-next-line jsdoc/require-param
    /** @type {function(string): Promise.<?BabelAST>} */
    return async (path) => {
        const loaded = await loadModule(path);
        if (!loaded) return null;

        const sideEffects = await sideEffectsPromise;
        if (sideEffects.test(loaded)) return null;

        return loaded.ast || await parseAst(loaded);
    };
};

/**
 * Resolves specifiers from a file.  Caches the results to speed later look-up.
 */
class SpecResolver {

    /**
     * Initializes a new instance of {@link SpecResolver}.
     * 
     * @param {Context} context A function that can parse a file into
     * a Babel AST.
     * @param {PathResolver} pathResolver The path-resolver to use when
     * resolving a file's path.
     */
    constructor(context, pathResolver) {
        this.loader = context.loader;
        this.cache = context.cache.specifier;
        this.pathResolver = pathResolver;
        this.astResolver = makeAstResolver(context, pathResolver);
    }

    /**
     * Resolves a file's AST and gets the specifiers from it.
     * 
     * @async
     * @param {string} filePath The absolute path to the file to resolve specifiers for.
     * @returns {?SpecifierResult} An object containing the extracted specifiers or `null`
     * if no AST could be resolved.
     */
    async resolve(filePath) {
        let specifiers = this.cache.get(filePath);
        if (typeof specifiers === 'undefined') {
            const ast = await this.astResolver(filePath);
            specifiers = await this.getSpecifiers(ast, filePath);

            this.cache.set(filePath, specifiers);
        }
        
        this.loader.addDependency(filePath);
        return specifiers;
    }

    /**
     * Gets the specifiers from a file, given its AST and the file's path.
     * 
     * @async
     * @param {BabelAST} ast The AST of the file.
     * @param {string} filePath The absolute path to the file to generate specifiers for.
     * @returns {?SpecifierResult} An object containing the extracted specifiers or `null`
     * if no AST could be resolved.
     */
    async getSpecifiers(ast, filePath) {
        if (!ast) return null;

        // eslint-disable-next-line jsdoc/require-param
        /** @type {function(string): Promise.<?string>} */
        const resolve = request => this.pathResolver.resolve(request, filePath);

        const importDeclarations = [];
        const exportDeclarations = [];

        ast.program.body.forEach(dec => {
            if (isImport(dec)) importDeclarations.push(dec);
            else if (isExport(dec)) exportDeclarations.push(dec);
        });
        
        const specifiers = {
            importSpecifiers: await extractImports(importDeclarations, resolve),
            exportSpecifiers: await extractExports(exportDeclarations, resolve),
        };

        return specifiers;
    }
}

module.exports = SpecResolver;
