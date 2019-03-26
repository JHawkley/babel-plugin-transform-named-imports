const debug = require('debug')(require('./constants').loaderName);
const ospath = require('path');

const $ = require('./constants');
const NullImportSpecifierError = require('./errors').NullImportSpecifierError;
const SpecResolver = require('./specResolver');
const PathResolver = require('./pathResolver');
const SideEffects = require('./sideEffects');
const extractImportSpecifiers = require('./extractImportSpecifiers');
const { appendCurPath } = require('./utils');

/** @typedef {import('./index').Context} Context */
/** @typedef {import('./babel').ImportNode} ImportNode */
/** @typedef {import('./babel').TransformData} TransformData */
/** @typedef {import('./babel').TransformsMap} TransformsMap */
/** @typedef {import('./extractImportSpecifiers').ImportSpecifier} ImportSpecifier */
/** @typedef {import('./extractExportSpecifiers').ExportSpecifier} ExportSpecifier */

/** @typedef {[string, TransformData]} TransformDataKvp */
/** @typedef {[string, TransformDataKvp[]]} TransformsMapKvp */

/**
 * Either kind of specifier.
 * @typedef {(ImportSpecifier|ExportSpecifier)} Specifier
 */

/**
 * The state for this loader's work.
 * @typedef State
 * @prop {Object} loader The Webpack loader context.
 * @prop {PathResolver} pathResolver The path-resolver.
 * @prop {SpecResolver} specResolver The specifier-resolver.
 * @prop {SideEffects} sideEffects The side-effect checker.
 * @prop {string} sourcePath The path to the file being transformed by the plugin.
 * @prop {boolean} doDefaults Whether to transform default imports and exports.
 * @prop {function(Specifier): string} makeImportPath A function that will convert a
 * specifier into an import path.
 */

/**
 * Thrown to indicate the transformation process cannot be carried out.
 */
const abortSignal = Symbol('abort');

/**
 * Called by the `pre` method of the plugin to get the initial state.
 * 
 * @param {Context} context The current Babel plugin-pass object.
 * @returns {State} A new state object.
 */
const setupState = (context) => {
    // setup configuration only once per file
    const { loader, options } = context;
    const sourcePath = loader.resourcePath;
    const pathResolver = new PathResolver(context);

    // takes the specifier and builds the path, we prefer
    // the absolute path to the file, but if we weren't
    // able to resolve that, stick to the original path
    const makeImportPath = (specifier) => {
        if (!specifier) return null;
        if (!specifier.path) return specifier.originalPath;
        
        const decomposed = pathResolver.decompose(specifier.path);
        decomposed.path = appendCurPath(ospath.relative(
            ospath.dirname(sourcePath),
            decomposed.path
        ));

        return pathResolver.recompose(decomposed);
    };

    return {
        loader,
        pathResolver,
        sourcePath,
        makeImportPath,
        specResolver: new SpecResolver(context, pathResolver),
        sideEffects: new SideEffects(context, pathResolver),
        doDefaults: options.transformDefaultImports
    };
}

/**
 * @callback TransformsMapMapper
 * @param {ImportNode} node
 * @returns {Promise.<TransformsMapKvp>}
 */

/**
 * Creates a function that can be used with `Array#map` that converts a
 * Babel `ImportDeclaration` node into a map of transforms to be applied
 * by a plugin created by {@link import('./babel').createBabelPlugin}.
 * 
 * @param {State} state The current working state.
 * @returns {TransformsMapMapper}
 */
const toTransformsMap = (state) => async (node) => {
    const { sourcePath, doDefaults, pathResolver } = state;
    const originalPath = node.source.value;

    // get the declaration's import specifiers
    const specifiers = await extractImportSpecifiers(
        [node],
        request => pathResolver.resolve(request, sourcePath)
    );

    // if there is no work to do, exit immediately
    if (specifiers.length === 0)
        return null;

    // leave single, default imports alone if we're not transforming them
    if (!doDefaults && specifiers.length === 1 && specifiers[0].type === $.default)
        return null;

    try {
        const transforms = specifiers
            .map(toExportedSpecifier(state))
            .map(toTransformData(state));

        return [originalPath, await Promise.all(transforms)];
    }
    catch (error) {
        if (Object.is(error, abortSignal)) {
            // abort signal was thrown; just stop without
            // emitting any transformations
            return null;
        }

        // rethrow any other error
        throw error;
    }
};

/**
 * Given a specifier, locates the next specifier in the import/export chain.
 * Returns `null` if no such specifier could be located.
 * 
 * @async
 * @param {State} state The current working state.
 * @param {Specifier} specifier The specifier to use in the search.
 * @returns {Specifier} The next specifier in the chain or `null` if it wasn't found.
 */
const findNextSpecifier = async (state, specifier) => {
    const { searchName, path, type } = specifier;

    // stop at namespaced imports; there's nothing more that we can do without
    // doing some hardcore code analysis
    if (type === $.namespace) {
        debug('HIT NAMESPACE IMPORT');
        return null;
    }

    // stop at default imports if we're not transforming them
    if (!state.doDefaults && type === $.default) {
        debug('HIT DEFAULT IMPORT');
        return null;
    }

    // attempt to get the import/export specifiers for the file being imported
    const fileSpecifiers = await state.specResolver.resolve(path);

    // if `null`, either the AST failed to parse or the file had side-effects
    if (!fileSpecifiers) return null;

    const { importSpecifiers, exportSpecifiers } = fileSpecifiers;

    debug('LOOKING FOR', searchName);
    debug('SEARCHING FILE', path);
    debug('IMPORTS', importSpecifiers);
    debug('EXPORTS', exportSpecifiers);

    // search the export specifiers for a matching export
    const expPointer = exportSpecifiers.find(exp => exp.exportedName === searchName);
    if (expPointer) {
        debug('FOUND IT!', expPointer);

        // it could be that this export is also an import in the same line
        if (expPointer.path) return expPointer;

        // was it re-exported? find the matching local import
        const impPointer = importSpecifiers.find(imp => imp.name === expPointer.name);
        if (impPointer) {
            debug('FOUND THE RE-EXPORT!', impPointer);
            return impPointer;
        }
    }

    return null;
};

/**
 * @typedef ExportedSpecifierResult
 * @prop {ImportSpecifier} impSpecifier The original import specifier.
 * @prop {Specifier} expSpecifier The resolved specifier.
 */

/**
 * @callback ExportedSpecifierMapper
 * @param {ImportSpecifier} impSpecifier The input import specifier.
 * @returns {Promise.<ExportedSpecifierResult>} The result.
 */

/**
 * Creates a function that can be used with `Array#map` that converts an import
 * specifier into a result pair that can be processed by {@link toTransform} to
 * produce a Babel transformation.
 * 
 * @param {State} state The state object of the plugin.
 * @returns {ExportedSpecifierMapper} A function, to be used with `Array#map`.
 */
const toExportedSpecifier = (state) => async (impSpecifier) => {
    // sanity check
    if (!impSpecifier)
        throw new NullImportSpecifierError();

    let depth = 0;
    let nextSpecifier = impSpecifier;
    let expSpecifier;

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
 * @callback TransformDataMapper
 * @param {Promise.<ExportedSpecifierResult>} result The result of processing
 * an import specifier with {@link toExportedSpecifier}.
 * @returns {Promise.<TransformDataKvp>} A key-value-pair of the local
 * identifer name to the data describing a Babel transformation.
 */

/**
 * Creates a function that can be used with `Array#map` that will
 * map the results of {@link toExportedSpecifier} to the data needed
 * to create a Babel transformation.
 * 
 * @param {State} state The state object of the plugin.
 * @returns {TransformDataMapper}
 */
const toTransformData = (state) => async (result) => {
    const { impSpecifier, expSpecifier } = await result;
    const importPath = state.makeImportPath(expSpecifier);

    // sanity check
    if (!importPath) {
        state.loader.emitWarning([
            'problem while creating transformations',
            'the resolved specifier had no importable path',
            `no transformation will be performed on the import containing \`${impSpecifier.name}\``
        ].join('; '));

        const kvps = Object.keys(expSpecifier)
            .map(k => [k, expSpecifier[k]].join(' => '));

        state.loader.emitWarning(['resolved specifier', kvps.join('; ')].join(': '));

        throw abortSignal;
    }

    const transformData = {
        type: expSpecifier.type,
        exportedName: expSpecifier.searchName,
        path: importPath
    };

    return [impSpecifier.name, transformData];
};

module.exports = {
    setupState,
    toTransformsMap,
    abortSignal,
    toExportedSpecifier,
    toTransformData
};