const ospath = require('path');

const $ = require('./constants');
const NullImportSpecifierError = require('./errors').NullImportSpecifierError;
const utils = require('./utils');

/** @typedef {import('./index').Debug} Debug */
/** @typedef {import('./index').Context} Context */
/** @typedef {import('./index').LoaderContext} LoaderContext */
/** @typedef {import('./utils').KVP} KVP */
/** @typedef {import('./babel').ImportNode} ImportNode */
/** @typedef {import('./babel').TransformData} TransformData */
/** @typedef {import('./babel').TransformsMap} TransformsMap */
/** @typedef {import('./babel').AllTransformsMap} AllTransformsMap */
/** @typedef {import('./pathResolver')} PathResolver */
/** @typedef {import('./specResolver')} SpecResolver */
/** @typedef {import('./specResolver').LoadedModule} LoadedModule */
/** @typedef {import('./extractImportSpecifiers').ImportSpecifier} ImportSpecifier */
/** @typedef {import('./extractExportSpecifiers').ExportSpecifier} ExportSpecifier */

/** @typedef {[string, string, TransformData]} TransformDataEntry */

/**
 * @typedef ExportedSpecifierResult
 * @prop {ImportSpecifier} impSpecifier
 * The original import specifier.
 * @prop {Specifier} expSpecifier
 * The resolved specifier.
 */

/**
 * Either kind of specifier.
 * @typedef {(ImportSpecifier|ExportSpecifier)} Specifier
 */

/**
 * The state for this loader's work.
 * @typedef State
 * @prop {LoaderContext} loader
 * The Webpack loader context.
 * @prop {function(string): Promise.<?LoadedModule>} loadModule
 * Loads a module.
 * @prop {PathResolver} pathResolver
 * The path-resolver.
 * @prop {SpecResolver} specResolver
 * The specifier-resolver.
 * @prop {string} request
 * The resolved request of the module.  Includes the original inline-loaders
 * and query parameters used in the request, but only the module path is an
 * absolute path, and should be equal to `sourcePath`.
 * @prop {string} sourcePath
 * The path to the file being transformed by the plugin.
 * @prop {string} rootContext
 * The root-context path.
 * @prop {boolean} syncMode
 * Whether to execute the loader's work in a synchronous way.
 * @prop {boolean} doDefaults
 * Whether to transform default imports and exports.
 * @prop {Debug} debug
 * The debug handle for this state.
 * @prop {Debug} debugPath
 * The debug handle for the path-resolver.
 * @prop {Debug} debugSpec
 * The debug handle for the spec-resolver.
 */

/**
 * Thrown to indicate the transformation process cannot be carried out.
 */
const abortSignal = Symbol('abort');

/**
 * Called by the `pre` method of the plugin to get the initial state.
 * 
 * @param {Context} context
 * The working context of the loader.
 * @returns {State}
 * A new state object.
 */
const setupState = (context) => {
    // setup configuration only once per file
    const { request, loader, options, pathResolver, specResolver } = context;
    const rootContext = loader.rootContext;
    const sourcePath = loader.resourcePath;
    const debug = context.debugLoader.extend('core');

    const loadModule = (request) => {
        const relPath = utils.contextRelative(rootContext, request);
        debug('LOADING MODULE', relPath);

        return new Promise((ok, fail) => {
            loader.loadModule(request, (err, source, map, instance) => {
                if (err) {
                    debug(
                        'MODULE LOAD ERROR %A',
                        [relPath, err]
                    );
                    fail(err);
                }
                else if (!instance.type.startsWith('javascript/')) {
                    debug(
                        'MODULE LOAD WARNING %A',
                        [relPath, 'module type was not for a javascript source']
                    );
                    ok(null);
                }
                else {
                    const [resourcePath] = utils.decomposePath(request);
                    ok({ request, resourcePath, source, instance });
                }
            });
        });
    };

    return {
        loader,
        loadModule,
        pathResolver,
        specResolver,
        request,
        sourcePath,
        rootContext,
        debug,
        debugSpec: debug.extend('spec-resolver'),
        debugPath: debug.extend('path-resolver'),
        doDefaults: options.transformDefaultImports,
        syncMode: options.syncMode
    };
};

/**
 * Processes the given `specifiers` and add their {@link TransformData} to
 * the given `importsMap`.
 * 
 * @param {State} state
 * @param {ImportSpecifiers[]} specifiers
 * @param {AllTransformsMap} allTransformsMap
 * @returns {AllTransformsMap}
 */
const addImportTransforms = async (state, specifiers, allTransformsMap) => {
    const { doDefaults, syncMode } = state;

    // if there is no work to do, exit immediately
    if (specifiers.length === 0)
        return allTransformsMap;

    // leave single, default imports alone if we're not transforming them
    if (!doDefaults && specifiers.length === 1 && specifiers[0].type === $.default)
        return allTransformsMap;

    const forEach = syncMode ? utils.iterating.sync : utils.iterating.async;
    await forEach(specifiers, addImportsFrom(state, allTransformsMap));

    return allTransformsMap;
};

/**
 * Creates a function that can be used with `Array#map` or one of the
 * {@link import('./utils').iterating} functions that converts an
 * {@link ImportSpecifier} into a {@link TransformData} and adds it to the
 * given {@link AllTransformsMap}.  The map should be applied by a plugin
 * created by {@link import('./babel').createBabelPlugin}.
 * 
 * @currying 2,1
 * @param {State} state
 * The current working state.
 * @param {AllTransformsMap} allTtansformsMap
 * The map to add the import and their transform data to.
 * @param {ImportSpecifier} specifier
 * The specifier of an import declaration.
 * @returns {Promise.<void>}
 * A promise that will complete when the function has finished adding
 * the {@link TransformData} to the map.
 */
const addImportsFrom = (state, allTransformsMap) => async (specifier) => {
    const importedPath = specifier.path.original;

    let transformsMap = allTransformsMap.get(importedPath);
    if (typeof transformsMap === 'undefined') {
        transformsMap = new Map();
        allTransformsMap.set(importedPath, transformsMap);
    }

    const specResult = await findExportedSpecifier(state, specifier);
    addTransformData(state, transformsMap, specResult);
};

/**
 * Given a specifier, locates the next specifier in the import/export chain.
 * Returns `null` if no such specifier could be located.
 * 
 * @async
 * @param {State} state
 * The current working state.
 * @param {Specifier} specifier
 * The specifier to use in the search.
 * @returns {?Specifier}
 * The next specifier in the chain or `null` if it wasn't found.
 */
const findNextSpecifier = async (state, specifier) => {
    const { debug, rootContext, doDefaults, specResolver } = state;
    const { searchName, path, type } = specifier;

    // stop at namespaced imports; there's nothing more that we can do without
    // doing some hardcore code analysis
    if (type === $.namespace) {
        debug('HIT NAMESPACE IMPORT');
        return null;
    }

    // stop at default imports if we're not transforming them
    if (!doDefaults && type === $.default) {
        debug('HIT DEFAULT IMPORT');
        return null;
    }

    // attempt to get the import/export specifiers for the file being imported
    const fileSpecifiers = await specResolver.resolve(state, path.resolved);

    // if `null`, the file failed to parse or had side-effects
    if (!fileSpecifiers) return null;

    const { importSpecifiers, exportSpecifiers } = fileSpecifiers;

    debug('LOOKING FOR', searchName);
    debug('SEARCHING FILE', path.toString(rootContext));
    debug('IMPORTS %A', importSpecifiers);
    debug('EXPORTS %A', exportSpecifiers);

    // search the export specifiers for a matching export
    const expPointer = exportSpecifiers.find(exp => exp.exportedName === searchName);
    if (expPointer) {
        debug('FOUND', expPointer);

        // it could be that this export is also an import in the same line
        if (expPointer.path) return expPointer;

        // was it re-exported? find the matching local import
        const impPointer = importSpecifiers.find(imp => imp.name === expPointer.name);
        if (impPointer) {
            debug('RE-EXPORTED AS', impPointer);
            return impPointer;
        }
    }

    return null;
};

/**
 * Produces a {@link ExportedSpecifierResult} for the given
 * {@link ImportSpecifier `impSpecifier`}.
 * 
 * @async
 * @param {State} state
 * The state object of the plugin.
 * @param {ImportSpecifier} impSpecifier
 * The input import specifier.
 * @returns {ExportedSpecifierResult}
 * The result.
 */
const findExportedSpecifier = async (state, impSpecifier) => {
    // sanity check
    if (!impSpecifier)
        throw new NullImportSpecifierError();

    const { debug } = state;
    let depth = 0;
    let nextSpecifier = impSpecifier;
    let expSpecifier;

    debug('RESOLVING', impSpecifier);

    while(nextSpecifier != null) {
        depth += 1;
        debug('DEPTH', depth);

        expSpecifier = nextSpecifier;
        nextSpecifier = await findNextSpecifier(state, expSpecifier);
    }

    debug('GOING WITH', expSpecifier);

    return { impSpecifier, expSpecifier };
};

/**
 * Produces {@link TransformData} from the {@link ExportedSpecifierResult `result`}
 * and adds it to the given {@link TransformsMap `transformsMap`}.
 * 
 * @param {State} state
 * The state object of the plugin.
 * @param {TransformsMap} transformsMap
 * The map to add the transform data to.
 * @param {ExportedSpecifierResult} result
 * The result of processing an import specifier with {@link findExportedSpecifier}.
 */
const addTransformData = (state, transformsMap, result) => {
    const { impSpecifier, expSpecifier } = result;

    // sanity check
    if (!expSpecifier.path) {
        state.loader.emitWarning(new Error([
            'problem while creating transformations',
            'the resolved specifier had no importable path',
            'no transformations will be performed for this module'
        ].join('; ')));

        state.loader.emitWarning(new Error([
            'resolved specifier',
            require('util').inspect(expSpecifier)
        ].join(': ')));

        throw abortSignal;
    }

    transformsMap.set(impSpecifier.name, {
        type: expSpecifier.type,
        exportedName: expSpecifier.searchName,
        path: expSpecifier.path.toString(ospath.dirname(state.sourcePath))
    });
};

module.exports = {
    setupState,
    addImportTransforms,
    abortSignal
};