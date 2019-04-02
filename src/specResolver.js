const types = require('@babel/core').types;
const utils = require('./utils');
const SideEffects = require('./sideEffects');

/** @typedef {import('./index').Debug} Debug */
/** @typedef {import('./index').Context} Context */
/** @typedef {import('./index').LoaderContext} LoaderContext */
/** @typedef {import('./index').WebpackModule} WebpackModule */
/** @typedef {import('./options').LoaderOptions} LoaderOptions */
/** @typedef {import('./core').State} State */
/** @typedef {import('./utils').Future} Future */
/** @typedef {import('./babel').BabelAST} BabelAST */
/** @typedef {import('./babel').ImportNode} ImportNode */
/** @typedef {import('./babel').ExportNode} ExportNode */
/** @typedef {import('./pathResolver')} PathResolver */
/** @typedef {import('./pathResolver').ResolvedPath} ResolvedPath */
/** @typedef {import('./extractImportSpecifiers').ImportSpecifier} ImportSpecifier */
/** @typedef {import('./extractExportSpecifiers').ExportSpecifier} ExportSpecifier */

/**
 * A loaded module.
 * 
 * @typedef LoadedModule
 * @prop {string} request
 * The Webpack request path, including loaders and query parameters.
 * @prop {string} resourcePath
 * The actual, absolute path to the underlying resource.
 * @prop {string} source
 * The source of the module.
 * @prop {WebpackModule} instance
 * The module's Webpack instance.
 * @prop {BabelAST} [ast]
 * The AST of the module.
 * @prop {boolean} [hasSideEffects]
 * Whether Webpack reports that the module has side-effects.
 */

/**
 * @typedef WithSideEffects
 * @prop {boolean} hasSideEffects
 * Whether Webpack reports that the module has side-effects.
 */

/**
 * The specifiers of a module.
 * 
 * @typedef SpecifierResult
 * @prop {ImportSpecifier[]} importSpecifiers
 * The extracted import specifiers.
 * @prop {ExportSpecifier[]} exportSpecifiers
 * The extracted export specifiers.
 */

const $$filterSideEffects = Symbol('spec-resolver:filter-side-effects');
const $$parseAst = Symbol('spec-resolver:parse-ast');
const $$getSpecifiers = Symbol('spec-resolver:get-specifiers');
const $$getFutureFor = Symbol('spec-resolver:get-future-for');

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

/**
 * Creates a private method that filters modules with side-effects.
 * 
 * @currying 2,1,1
 * @param {string} rootContext
 * @param {Promise.<SideEffects>} initSideEffects
 * @param {Debug} debug
 * @param {?LoadedModule} loadedModule
 * @returns {Promise.<?LoadedModule>}
 */
const _filterSideEffects = (rootContext, initSideEffects) => (debug) => {
    return async function hasSideEffectsImpl(loadedModule) {
        if (!loadedModule) return null;
        if (typeof loadedModule.hasSideEffects === 'boolean') return loadedModule;

        const { request, resourcePath, instance } = loadedModule;
        const sideEffectsReported
            = !instance.factoryMeta ? true
            : !instance.factoryMeta.sideEffectFree;

        const sideEffects = await initSideEffects;
        const hasSideEffects = sideEffects.test(resourcePath, sideEffectsReported);

        if (hasSideEffects && debug.enabled) {
            const relativePath = utils.contextRelative(rootContext, request);
            debug('SIDE-EFFECTS DETECTED', relativePath);
        }

        loadedModule.hasSideEffects = hasSideEffects;
        return loadedModule;
    };
};

/**
 * Creates a private method that attempts to parse a module's source to a
 * Babel AST.
 * 
 * @currying 2,1,1
 * @param {string} rootContext
 * @param {Object} babelConfig
 * @param {Debug} debug
 * @param {?LoadedModule} loadedModule
 * @returns {Promise.<?LoadedModule>}
 */
const _parseAst = (rootContext, babelConfig) => (debug) => {
    const babel = require('./babel');

    return async function parseAstImpl(loadedModule) {
        if (!loadedModule) return null;
        if (loadedModule.ast) return loadedModule;
        if (loadedModule.hasSideEffects === true) return loadedModule;

        const { request, resourcePath, source } = loadedModule;

        try {
            loadedModule.ast = await babel.parseAst(resourcePath, source, babelConfig);
            return loadedModule;
        }
        catch (error) {
            const relativePath = utils.contextRelative(rootContext, request);
            debug('AST PARSING ERROR %A', [relativePath, error]);
            throw error;
        }
    };
};

/**
 * Creates a private method that attempts to convert an AST into import and
 * export specifiers.
 * 
 * @currying 0,2,1
 * @param {PathResolver} pathResolver
 * @param {Debug} debugPath
 * @param {?LoadedModule} loadedModule
 * @returns {Promise.<?(SpecifierResult & WithSideEffects)>}
 */
const _getSpecifiers = () => (pathResolver, debugPath) => {
    const extractImports = require('./extractImportSpecifiers');
    const extractExports = require('./extractExportSpecifiers');

    return async function getSpecifiersImpl(loadedModule) {
        if (!loadedModule) return null;
        if (!loadedModule.ast) return null;

        const { request: issuer, ast, hasSideEffects } = loadedModule;

        /**
         * @function
         * @param {string} request
         * @returns {Promise.<ResolvedPath>}
         */
        const resolve = (request) => pathResolver.resolve(request, issuer, debugPath);

        const importDeclarations = [];
        const exportDeclarations = [];

        ast.program.body.forEach(dec => {
            if (isImport(dec)) importDeclarations.push(dec);
            else if (isExport(dec)) exportDeclarations.push(dec);
        });

        const specifiers = {
            hasSideEffects: typeof hasSideEffects === 'boolean' ? hasSideEffects : true,
            importSpecifiers: await extractImports(importDeclarations, resolve),
            exportSpecifiers: await extractExports(exportDeclarations, resolve)
        };

        return specifiers;
    };
};

/**
 * Creates a private method that attempts to convert an AST into import and
 * export specifiers.
 * 
 * @currying 0,2
 * @param {State} state
 * @param {string} modulePath
 * @returns {({ isNew: boolean, future: Future.<LoadedModule, (SpecifierResult & WithSideEffects)>})}
 */
const _getFutureFor = () => {
    return function getFutureFor(state, modulePath) {
        let isNew = false;
        let future = this.specCache.get(modulePath);

        if (typeof future === 'undefined') {
            const { pathResolver, debugSpec, debugPath } = state;

            future = utils.future(modulePath, (promise) => {
                return promise
                    .then(this[$$filterSideEffects](debugSpec))
                    .then(this[$$parseAst](debugSpec))
                    .then(this[$$getSpecifiers](pathResolver, debugPath));
            });

            isNew = true;
            this.specCache.set(modulePath, future);
        }

        return { isNew, future };
    };
};

/**
 * Resolves specifiers from a file.  Caches the results to speed later look-up.
 */
class SpecResolver {

    /**
     * Initializes a new instance of {@link SpecResolver}.
     * 
     * @param {LoaderContext} loader
     * The loader context.
     * @param {LoaderOptions} options
     * The loader options.
     * @param {PathResolver} pathResolver
     * The path-resolver to use when resolving a module's path.
     * @param {Debug} debugRoot
     * The root debug instance.
     */
    constructor(loader, options, pathResolver, debugRoot) {
        const { rootContext } = loader;
        const sideEffects = SideEffects.create(
            rootContext, options, pathResolver, debugRoot
        );

        /** @type {Map.<string, Future.<LoadedModule, SpecifierResult>} */
        this.specCache = new Map();

        this[$$filterSideEffects] = _filterSideEffects(rootContext, sideEffects);
        this[$$parseAst] = _parseAst(rootContext, options.babelConfig);
        this[$$getSpecifiers] = _getSpecifiers();
        this[$$getFutureFor] = _getFutureFor();
    }

    /**
     * Caches the specifiers for a module.
     * 
     * @async
     * @param {State} state
     * The working state.
     * @param {LoadedModule} loadedModule
     * The loaded module.
     * @returns {?({ ast: BabelAST, specifiers: SpecifierResult })}
     * A promise that will complete with the module's AST and specifiers, once they
     * have been resolved.
     */
    async registerModule(state, loadedModule) {
        const { debugSpec } = state;
        const { request } = loadedModule;

        // begin resolving the AST; we want to produce specifiers despite the
        // side-effect status of the module
        loadedModule = await this[$$parseAst](debugSpec)(loadedModule);

        const { future } = this[$$getFutureFor](state, request);
        if (!future.didComplete) future.resolve(loadedModule);
        const specifiers = await future.promise;

        if (!loadedModule.ast || !specifiers)
            return null;

        return { ast: loadedModule.ast, specifiers };
    }

    /**
     * Resolves a module's AST and gets the specifiers from it.
     * 
     * @async
     * @param {State} state
     * The working state.
     * @param {string} request
     * The request path to the module to resolve specifiers for.  The path-portion
     * of the request must be an absolute path.
     * @returns {?SpecifierResult}
     * An object containing the extracted specifiers or `null` if no AST could
     * be resolved of the module had side-effects.
     */
    async resolve(state, request) {
        const { isNew, future } = this[$$getFutureFor](state, request);

        if (isNew) {
            state.loadModule(request).then(
                (loadedModule) => !future.didComplete && future.resolve(loadedModule),
                (reason) => !future.didComplete && future.reject(reason)
            );
        }
        else {
            state.loader.addDependency(request);
        }

        try {
            const specifiers = await future.promise;
            if (!specifiers || specifiers.hasSideEffects) return null;

            return specifiers;
        }
        catch (error) {
            return null;
        }
    }
}

module.exports = SpecResolver;
