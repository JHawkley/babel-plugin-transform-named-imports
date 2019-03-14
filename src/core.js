const debug = require('debug')('transform-named-imports');

const types = require('babel-types');

/** @typedef {import('./index').PluginState} PluginState */
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
 * Given a specifier, locates the next specifier in the import/export chain.
 * Returns `null` if no such specifier could be located.
 * @param {PluginState} state The state object provided to the plugin.
 * @param {Specifier} specifier The specifier to use in the search.
 * @returns {Specifier} The next specifier in the chain or `null` if it wasn't found.
 */
const findNextSpecifier = (state, specifier) => {
    const { searchName, path, type } = specifier;

    // stop at default imports if we're not transforming them
    if (!state.doDefaults && type === 'default') {
        debug('HIT DEFAULT IMPORT');
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
 * @param {PluginState} state The state object provided to the plugin.
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
 * @param {PluginState} state The state object provided to the plugin.
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
    case 'default':
        return types.importDeclaration(
            [types.importDefaultSpecifier(
                types.identifier(impSpecifier.name)
            )],
            types.stringLiteral(importPath),
        );

    case 'namespace':
        return types.importDeclaration(
            [types.importNamespaceSpecifier(
                types.identifier(impSpecifier.name)
            )],
            types.stringLiteral(importPath),
        );

    case 'named':
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
    abortSignal,
    toExportedSpecifier,
    toTransform,
};