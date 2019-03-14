const debug = require('debug')('transform-named-imports');
const fs = require('fs');
const ospath = require('path');

const types = require('babel-types');

const SpecResolver = require('./specResolver');
const PathResolver = require('./pathResolver');
const extractImportSpecifiers = require('./extractImportSpecifiers');

const Program = (path, state) => {
    // setup configuration once per program
    const pathResolver = new PathResolver(state.opts);

    state.pathResolver = pathResolver;
    state.specResolver = new SpecResolver(pathResolver);
    state.sourcePath = state.file.opts.filename;
    state.doDefaults = Boolean(state.opts.transformDefaultImports);

    // for every program, create some state to track identifier
    // names that have already been visited; this should prevent
    // unnecessary extra visits and infinite recursions
    state.visitedNames = new Set();
};

const ImportDeclaration = (path, state) => {
    const {
        visitedNames, sourcePath, doDefaults,
        pathResolver, specResolver
    } = state;

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
        return;
    }

    // takes the specifier and builds the path, we prefer
    // the absolute path to the file, but if we weren't
    // able to resolve that, stick to the original path
    const makeImportPath = (specifier) => {
        if (!specifier.path) {
            return specifier.originalPath;
        }

        return './' + ospath.relative(
            ospath.dirname(sourcePath), specifier.path);
    };

    const transforms = [];

    for (let i = 0; i < specifiers.length; ++i) {
        const specifier = specifiers[i];

        // we are visiting this import, so add it to the visited list
        visitedNames.add(specifier.name);

        let iteration = 0;
        let exportedSpecifier = specifier;

        while (exportedSpecifier.path) {
            const { searchName, path, type } = exportedSpecifier;

            iteration += 1;
            debug('ITERATION', iteration);

            // stop at default imports if we're not transforming them
            if (!doDefaults && type === 'default') {
                debug('HIT DEFAULT IMPORT');
                break;
            }

            // attempt to get the import/export specifiers for the file being imported
            const fileSpecifiers = specResolver.resolve(path);
            if (!fileSpecifiers) {
                return;
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
                    exportedSpecifier = expPointer;
                    continue;
                }

                // was it re-exported? find the matching local import
                const impPointer = importSpecifiers.find(imp => imp.name === expPointer.name);
                if (impPointer) {
                    debug('FOUND THE RE-EXPORT!', impPointer);

                    exportedSpecifier = impPointer;
                    continue;
                }
            }

            break;
        }

        debug('GOING WITH', exportedSpecifier);

        // found it, replace our import with a new one that imports
        // straight from the place where it was exported....

        const importPath = makeImportPath(exportedSpecifier);

        if (importPath == null) {
            if (debug.enabled) {
                const kvps = Object.keys(exportedSpecifier)
                    .map(k => [k, exportedSpecifier[k]].join(' => '));
                
                throw new Error(
                    ['the resolved specifier had no importable path', ...kvps].join('; ')
                );
            }

            // abort silently in production
            return;
        }

        switch (exportedSpecifier.type) {
        case 'default':
            transforms.push(types.importDeclaration(
                [types.importDefaultSpecifier(
                    types.identifier(specifier.name)
                )],
                types.stringLiteral(importPath),
            ));
            break;

        case 'namespace':
            transforms.push(types.importDeclaration(
                [types.importNamespaceSpecifier(
                    types.identifier(specifier.name)
                )],
                types.stringLiteral(importPath),
            ));
            break;

        case 'named':
            transforms.push(types.importDeclaration(
                [types.importSpecifier(
                    types.identifier(specifier.name),
                    types.identifier(exportedSpecifier.searchName),
                )],
                types.stringLiteral(importPath),
            ));
            break;
        }
    }

    if (transforms.length > 0) {
        path.replaceWithMultiple(transforms);
    }
};

module.exports = () => ({
    name: 'transform-named-imports',
    visitor: { Program, ImportDeclaration },
});
