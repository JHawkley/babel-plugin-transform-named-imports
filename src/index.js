const fs = require('fs');
const ospath = require('path');

const SpecResolver = require('./specResolver');
const PathResolver = require('./pathResolver');
const SideEffects = require('./sideEffects');
const extractImportSpecifiers = require('./extractImportSpecifiers');
const { abortSignal, toExportedSpecifier, toTransform } = require('./core');

/** @typedef {import('./core').Specifier} Specifier */
/** @typedef {import('./sideEffects').SideEffectOptions} SideEffectOptions */

/**
 * The options recognized by the plugin.
 * @typedef PluginOptions
 * @prop {string} [webpackConfig] Path to the webpack configuration file to use.
 * @prop {number} [webpackConfigIndex] The index of the configuration to use in
 * case the specified configuration file is a multi-config file.
 * @prop {boolean} [transformDefaultImports] Whether to try and transform default
 * imports and exports.
 * @prop {(boolean|SideEffectOptions)} [sideEffects]
 * The options for side-effects.  When a `boolean` value, indicates whether
 * side-effect checking is enabled.  When an object, allows customizing the
 * behavior of side-effect checking.
 */

/**
 * The state of the plugin.
 * @typedef PluginState
 * @prop {PluginOptions} opts The original options given to the plugin.
 * @prop {PathResolver} pathResolver The path-resolver.
 * @prop {SpecResolver} specResolver The specifier-resolver.
 * @prop {SideEffects} sideEffects The side-effect checker.
 * @prop {string} sourcePath The path to the file being transformed by the plugin.
 * @prop {boolean} doDefaults Whether to transform default imports and exports.
 * @prop {Set<string>} visitedNames The identifiers that have already been processed.
 * @prop {function(Specifier): string} makeImportPath A function that will convert a
 * specifier into an import path.
 */

/**
 * Visits a `Program` node.
 * @param {*} path The current path in the AST.
 * @param {PluginState} state The current plugin state.
 */
const Program = (path, state) => {
    // setup configuration once per program
    const pathResolver = new PathResolver(state.opts);
    const sourcePath = state.file.opts.filename;

    state.pathResolver = pathResolver;
    state.specResolver = new SpecResolver(pathResolver);
    state.sideEffects = new SideEffects(state.opts, pathResolver);
    state.sourcePath = sourcePath;
    state.doDefaults = Boolean(state.opts.transformDefaultImports);

    // for every program, create some state to track identifier
    // names that have already been visited; this should prevent
    // unnecessary extra visits and infinite recursions
    state.visitedNames = new Set();

    // takes the specifier and builds the path, we prefer
    // the absolute path to the file, but if we weren't
    // able to resolve that, stick to the original path
    state.makeImportPath = specifier => {
        if (!specifier.path) {
            return specifier.originalPath;
        }

        return './' + ospath.relative(
            ospath.dirname(sourcePath), specifier.path
        );
    };
};

/**
 * Visits an `ImportDeclaration` node.
 * @param {*} path The current path in the AST.
 * @param {PluginState} state The current plugin state.
 */
const ImportDeclaration = (path, state) => {
    const { visitedNames, sourcePath, doDefaults, pathResolver } = state;

    // skip imports we cannot resolve
    if (!pathResolver.resolve(path.node.source.value, sourcePath)) {
        return;
    }

    // get the declaration's import specifiers, filtering out any
    // that have already been visited previously
    const specifiers = extractImportSpecifiers(
        [path.node], path => pathResolver.resolve(path, sourcePath)
    ).filter(spec => !visitedNames.has(spec.name));

    // if there is no work to do, exit immediately
    if (specifiers.length === 0) {
        return;
    }

    // leave single, default imports alone if we're not transforming them
    if (specifiers.length === 1 && !doDefaults && specifiers[0].type === 'default') {
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

module.exports = () => ({
    name: 'transform-named-imports',
    visitor: { Program, ImportDeclaration },
});
