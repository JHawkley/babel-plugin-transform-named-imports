const $ = require('./constants');
const utils = require('./utils');
const NullImportSpecifierError = require('./errors').NullImportSpecifierError;
const ImportSpecifier = require('./extractImportSpecifiers').ImportSpecifier;

/** @typedef {import('./debugging').Debug} Debug */
/** @typedef {import('./common').LoaderContext} LoaderContext */
/** @typedef {import('./transformLoader').TransformContext} TransformContext */
/** @typedef {import('./babel').TransformData} TransformData */
/** @typedef {import('./babel').TransformsMap} TransformsMap */
/** @typedef {import('./babel').AllTransformsMap} AllTransformsMap */
/** @typedef {import('./pathResolver')} PathResolver */
/** @typedef {import('./specResolver')} SpecResolver */
/** @typedef {import('./specResolver').Specifier} Specifier */
/** @typedef {import('./extractImportSpecifiers').ImportSpecifier} ImportSpecifier */
/** @typedef {import('./extractExportSpecifiers').ExportSpecifier} ExportSpecifier */

/**
 * @typedef FoundSpecifier
 * @prop {boolean} hasSideEffects
 * Whether the module from which `specifier` originated from has side-effects.
 * @prop {?Specifier} specifier
 * The next specifier in the chain or `null` if none could be found.
 */

/**
 * @typedef ExportedSpecifierResult
 * @prop {Specifier} inSpecifier
 * The original specifier.
 * @prop {Specifier} outSpecifier
 * The resolved specifier.
 * @prop {Specifier[]} sideEffects
 * An array of specifiers that should be added as side-effecting imports.
 */

/**
 * The state for this loader's work.
 * @typedef State
 * @prop {string} ident
 * The `ident` option of the loader.
 * @prop {LoaderContext} loader
 * The Webpack loader context.
 * @prop {PathResolver} pathResolver
 * The path-resolver.
 * @prop {SpecResolver} specResolver
 * The specifier-resolver.
 * @prop {string} request
 * The resolved request of the module.  Includes the original inline-loaders
 * and query parameters used in the request, but only the module path is an
 * absolute path, and should be equal to `sourcePath`.
 * @prop {string} sourcePath
 * The path to the file being transformed by the loader.
 * @prop {string} sourceContext
 * The directory containing the file being transformed by the loader.
 * @prop {string} rootContext
 * The root-context path.
 * @prop {boolean} syncMode
 * Whether to execute the loader's work in a synchronous way.
 * @prop {boolean} doDefaults
 * Whether to transform default imports and exports.
 * @prop {boolean} doSideEffects
 * Whether to transform side-effecting imports and exports.
 * @prop {Debug} debug
 * The debug handle for this state.
 */

/**
 * Thrown to indicate the transformation process cannot be carried out.
 */
const abortSignal = Symbol('abort');

/**
 * Called by the loader to get the initial state.
 * 
 * @param {TransformContext} context
 * The working context of the transform-loader.
 * @returns {State}
 * A new state object.
 */
const setupState = (context) => {
    const {
        ident, request, loader, options,
        pathResolver, specResolver
    } = context;

    const rootContext = loader.rootContext;
    const sourcePath = loader.resourcePath;
    const sourceContext = loader.context;
    const debug = context.debugLoader.extend('core');

    return {
        ident,
        loader,
        pathResolver,
        specResolver,
        request,
        sourcePath,
        sourceContext,
        rootContext,
        debug,
        doDefaults: options.transformDefaultImports,
        doSideEffects: options.transformSideEffects,
        syncMode: options.syncMode
    };
};

/**
 * Processes the given `specifiers` and add their {@link TransformData} to
 * the given `importsMap`.
 * 
 * @param {State} state
 * @param {Specifier[]} specifiers
 * @param {AllTransformsMap} allTransformsMap
 * @returns {AllTransformsMap}
 */
const addTransforms = async (state, specifiers, allTransformsMap) => {
    const { doDefaults, syncMode } = state;

    // if there is no work to do, exit immediately
    if (specifiers.length === 0)
        return allTransformsMap;

    // leave single, default imports alone if we're not transforming them
    if (!doDefaults && specifiers.length === 1 && specifiers[0].type === $.default)
        return allTransformsMap;

    const forEach = syncMode ? utils.iterating.sync : utils.iterating.async;
    await forEach(specifiers, addSpecifiersFrom(state, allTransformsMap));

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
 * @param {Specifier} specifier
 * The specifier of an import or export declaration.
 * @returns {Promise.<void>}
 * A promise that will complete when the function has finished adding
 * the {@link TransformData} to the map.
 */
const addSpecifiersFrom = (state, allTransformsMap) => async (specifier) => {
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
 * The specifier to search for.
 * @returns {FoundSpecifier}
 * Information about the module and potentially another specifier that continues
 * the chain of the given `specifier`.
 */
const findNextSpecifier = async (state, specifier) => {
    const { debug, rootContext, doDefaults, doSideEffects, specResolver } = state;
    const { searchName, path, type } = specifier;

    // attempt to get the import/export specifiers for the file being imported
    const fileSpecifiers = await specResolver.resolve(state, path.resolved);

    // if `null`, the file failed to parse
    if (!fileSpecifiers) return { specifier: null, hasSideEffects: false };

    const { importSpecifiers, exportSpecifiers, hasSideEffects } = fileSpecifiers;

    // stop at namespaced imports; there's nothing more that we can do without
    // doing some hardcore code analysis
    if (type === $.namespace) {
        debug('HIT NAMESPACE IMPORT');
        return { specifier: null, hasSideEffects };
    }

    // stop at default imports if we're not transforming them
    if (!doDefaults && type === $.default) {
        debug('HIT DEFAULT IMPORT');
        return { specifier: null, hasSideEffects };
    }

    if (!doSideEffects && hasSideEffects) {
        debug('HIT SIDE-EFFECTING IMPORT');
        return { specifier: null, hasSideEffects };
    }

    debug('LOOKING FOR', searchName);
    debug('SEARCHING FILE', path.toString(rootContext));
    debug('IMPORTS %A', importSpecifiers);
    debug('EXPORTS %A', exportSpecifiers);

    // search the export specifiers for a matching export
    const expPointer = exportSpecifiers.find(exp => exp.exportedName === searchName);
    if (expPointer) {
        debug('FOUND', expPointer);

        // it could be that this export is also an import in the same line
        if (expPointer.path) return { specifier: expPointer, hasSideEffects };

        // was it re-exported? find the matching local import
        const impPointer = importSpecifiers.find(imp => imp.name === expPointer.name);
        if (impPointer) {
            debug('RE-EXPORTED AS', impPointer);
            return { specifier: impPointer, hasSideEffects };
        }
    }

    return { specifier: null, hasSideEffects };
};

/**
 * Produces a {@link ExportedSpecifierResult} for the given
 * {@link ImportSpecifier `impSpecifier`}.
 * 
 * @async
 * @param {State} state
 * The state object of the plugin.
 * @param {Specifier} inSpecifier
 * The input specifier.
 * @returns {ExportedSpecifierResult}
 * The result.
 */
const findExportedSpecifier = async (state, inSpecifier) => {
    // sanity check
    if (!inSpecifier)
        throw new NullImportSpecifierError();

    const { debug } = state;

    let depth = 0;
    let sideEffects = [];
    let nextSpecifier = inSpecifier;
    let outSpecifier = null;
    let hadSideEffects = false;

    debug('RESOLVING', inSpecifier);

    while(nextSpecifier != null) {
        depth += 1;
        debug('DEPTH', depth);

        if (hadSideEffects)
            sideEffects.push(outSpecifier);

        outSpecifier = nextSpecifier;

        const found = await findNextSpecifier(state, outSpecifier);
        hadSideEffects = found.hasSideEffects;
        nextSpecifier = found.specifier;
    }

    debug('GOING WITH', outSpecifier);

    return { inSpecifier, outSpecifier, sideEffects };
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
    const {
        inSpecifier, outSpecifier,
        sideEffects: inSideEffects
    } = result;

    const outSideEffects = inSideEffects
        .map(spec => spec.path.toString(state.sourceContext));
    
    const isImport = inSpecifier instanceof ImportSpecifier;
    const identifier = isImport ? inSpecifier.name : inSpecifier.exportedName;
    const exportedName
        = isImport ? outSpecifier.searchName
        : outSpecifier.importedName || outSpecifier.name;

    transformsMap.set(identifier, {
        declarationType: isImport ? $.import : $.export,
        specifierType: outSpecifier.type,
        exportedName: exportedName,
        path: outSpecifier.path.toString(state.sourceContext),
        sideEffects: outSideEffects
    });
};

module.exports = {
    setupState,
    addTransforms,
    abortSignal
};