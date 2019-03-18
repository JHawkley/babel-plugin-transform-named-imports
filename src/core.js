const ospath = require('path');
const debug = require('debug')('transform-named-imports');

const $ = require('./constants');
const types = require('./babelHelper').types;
const validateOptions = require('./options').validate;
const SpecResolver = require('./specResolver');
const PathResolver = require('./pathResolver');
const SideEffects = require('./sideEffects');
const extractImportSpecifiers = require('./extractImportSpecifiers');
const { pathHelper, appendCurPath } = require('./utils');

/**
 * The state of this plugin.
 * @typedef OurState
 * @prop {PathResolver} pathResolver The path-resolver.
 * @prop {SpecResolver} specResolver The specifier-resolver.
 * @prop {SideEffects} sideEffects The side-effect checker.
 * @prop {string} sourcePath The path to the file being transformed by the plugin.
 * @prop {boolean} doDefaults Whether to transform default imports and exports.
 * @prop {Set<string>} visitedNames The identifiers that have already been processed.
 * @prop {function(Specifier): string} makeImportPath A function that will convert a
 * specifier into an import path.
 */

/** @typedef {import('./extractImportSpecifiers').ImportSpecifier} ImportSpecifier */
/** @typedef {import('./extractExportSpecifiers').ExportSpecifier} ExportSpecifier */

/**
 * Either kind of specifier.
 * @typedef {(ImportSpecifier|ExportSpecifier)} Specifier
 */

/**
 * Thrown to indicate the transformation process cannot be carried out.
 */
const abortSignal = Symbol('abort');

/**
 * Called by the `pre` method of the plugin to get the initial state.
 * @param {Map} pluginState The current Babel plugin-pass object.
 * @param {*} file The file instance provided by Babel.
 * @returns {OurState}
 */
const setupState = (pluginState, file) => {
    // setup configuration only once per file
    const options = validateOptions(pluginState.opts);
    const sourcePath = file.opts.filename;
    const pathResolver = new PathResolver(options.pathResolver);

    // for every program, create some state to track identifier
    // names that have already been visited; this should prevent
    // unnecessary extra visits and infinite recursions
    const visitedNames = new Set();

    // takes the specifier and builds the path, we prefer
    // the absolute path to the file, but if we weren't
    // able to resolve that, stick to the original path
    const makeImportPath = specifier => {
        if (!specifier.path) {
            return specifier.originalPath;
        }

        const newPath = appendCurPath(ospath.relative(
            ospath.dirname(sourcePath),
            specifier.path
        ));

        const decomposed = Object.assign({ path: newPath }, specifier.webpack);
        return pathResolver.recompose(decomposed);
    };

    return {
        pathResolver,
        sourcePath,
        visitedNames,
        makeImportPath,
        specResolver: new SpecResolver(options.astResolver, pathResolver),
        sideEffects: new SideEffects(options.sideEffects, pathResolver),
        doDefaults: options.transformDefaultImports,
    };
}

/**
 * Visits an `ImportDeclaration` node.
 * @param {*} path The current path in the AST.
 * @param {Map} pluginState The current Babel plugin-pass object.
 */
const importDeclarationVisitor = (path, pluginState) => {
    /** @type {OurState} */
    const state = pluginState.get($.pluginName);
    const { visitedNames, sourcePath, doDefaults, pathResolver } = state;

    // skip imports we cannot resolve
    if (!pathResolver.resolve(path.node.source.value, sourcePath)) {
        return;
    }

    // get the declaration's import specifiers, filtering out any
    // that have already been visited previously
    const specifiers = extractImportSpecifiers(
        [path.node],
        request => pathHelper(request, sourcePath, pathResolver)
    ).filter(spec => !visitedNames.has(spec.name));

    // if there is no work to do, exit immediately
    if (specifiers.length === 0) {
        return;
    }

    // leave single, default imports alone if we're not transforming them
    if (specifiers.length === 1 && !doDefaults && specifiers[0].type === $.default) {
        visitedNames.add(specifiers[0].name);
        return;
    }

    try {
        const transforms = specifiers
            .map(toExportedSpecifier(state))
            .map(toTransform(state));

        if (transforms.length > 0) {
            path.replaceWithMultiple(transforms);
        }
    }
    catch (error) {
        if (Object.is(error, abortSignal)) {
            // abort signal was thrown; just stop without
            // performing any transformations
            return;
        }

        // rethrow any other error
        throw error;
    }
};

/**
 * Given a specifier, locates the next specifier in the import/export chain.
 * Returns `null` if no such specifier could be located.
 * @param {OurState} state The state object of the plugin.
 * @param {Specifier} specifier The specifier to use in the search.
 * @returns {Specifier} The next specifier in the chain or `null` if it wasn't found.
 */
const findNextSpecifier = (state, specifier) => {
    const { searchName, path, webpack, type } = specifier;

    // stop at any import that is likely to be touched by a Webpack loader
    if (webpack.loaders || webpack.query) {
        debug('HIT WEBPACK-LOADER IMPORT');
        return null;
    }

    // stop at namespaced imports; there's nothing more that can be resolved
    if (type === $.namespace) {
        debug('HIT NAMESPACE IMPORT');
        return null;
    }

    // stop at default imports if we're not transforming them
    if (!state.doDefaults && type === $.default) {
        debug('HIT DEFAULT IMPORT');
        return null;
    }

    // do not resolve beyond a module with side-effects
    if (state.sideEffects.test(path)) {
        debug('DETECTED SIDE EFFECTS', path);
        return null;
    }

    // attempt to get the import/export specifiers for the file being imported
    const fileSpecifiers = state.specResolver.resolve(path);
    if (!fileSpecifiers) {
        // likely, the AST failed to parse;
        // this can happen if a Webpack loader was used to convert a
        // non-javascript file into a module, such as `css-loader`;
        // we'll just stop here
        return null;
    }

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
        if (expPointer.path) {
            return expPointer;
        }

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
 * @returns {ExportedSpecifierResult} The result.
 * @throws {typeof abortSignal} When the transformation process should not continue.
 */

/**
 * Creates a function that can be used with `Array#map` that converts an import
 * specifier into a result pair that can be processed by {@link toTransform} to
 * produce a Babel transformation.
 * @param {OurState} state The state object of the plugin.
 * @returns {ExportedSpecifierMapper} A function, to be used with `Array#map`.
 */
const toExportedSpecifier = state => impSpecifier => {
    // sanity check
    if (!impSpecifier) {
        if (debug.enabled) {
            throw new Error('got a nullish `impSpecifier`');
        }

        // abort silently in production
        throw abortSignal;
    }

    // we are visiting this import, so add it to the visited list
    state.visitedNames.add(impSpecifier.name);

    let depth = 0;
    let nextSpecifier = impSpecifier;
    let expSpecifier;

    while(nextSpecifier != null) {
        depth += 1;
        debug('DEPTH', depth);

        expSpecifier = nextSpecifier;
        nextSpecifier = findNextSpecifier(state, expSpecifier);
    }

    return { impSpecifier, expSpecifier };
};

/**
 * A transformation to apply using a Babel plugin.
 * @typedef BabelTransform
 */

/**
 * @callback TransformMapper
 * @param {ExportedSpecifierResult} result The result of processing an import
 * specifier with {@link toExportedSpecifier}.
 * @returns {BabelTransform} The transformation to apply.
 * @throws {typeof abortSignal} When an import path could not be generated.
 */

/**
 * Creates a function that can be used with `Array#map` that will
 * map the results of {@link toExportedSpecifier} to a Babel transformation.
 * @param {OurState} state The state object of the plugin.
 * @returns {TransformMapper}
 */
const toTransform = state => ({impSpecifier, expSpecifier}) => {
    // replace our import with a new one that imports
    // straight from the place where it was exported....

    const importPath = state.makeImportPath(expSpecifier);

    // sanity check
    if (importPath == null) {
        if (debug.enabled) {
            const kvps = Object.keys(expSpecifier)
                .map(k => [k, expSpecifier[k]].join(' => '));
            
            throw new Error(
                ['the resolved specifier had no importable path', ...kvps].join('; ')
            );
        }

        // abort silently in production
        throw abortSignal;
    }

    switch (expSpecifier.type) {
    case $.default:
        return types.importDeclaration(
            [types.importDefaultSpecifier(
                types.identifier(impSpecifier.name)
            )],
            types.stringLiteral(importPath),
        );

    case $.namespace:
        return types.importDeclaration(
            [types.importNamespaceSpecifier(
                types.identifier(impSpecifier.name)
            )],
            types.stringLiteral(importPath),
        );

    case $.named:
        return types.importDeclaration(
            [types.importSpecifier(
                types.identifier(impSpecifier.name),
                types.identifier(expSpecifier.searchName),
            )],
            types.stringLiteral(importPath),
        );

    default:
        // if we get here, something is seriously wrong
        if (debug.enabled) {
            throw new Error([
                'error while creating transformations',
                `unrecognized type for \`expSpecifier.type\`: ${expSpecifier.type}`
            ].join('; '));
        }

        // abort silently in production
        throw abortSignal;
    }
};

module.exports = {
    setupState,
    importDeclarationVisitor,
    abortSignal,
    toExportedSpecifier,
    toTransform,
};