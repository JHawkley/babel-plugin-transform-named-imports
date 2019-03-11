const debug = require('debug')('transform-named-imports');
const fs = require('fs');
const ospath = require('path');

const Babylon = require('babylon');
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

    // for every program, create some state to track identifier
    // names that have already been visited; this should prevent
    // unnecessary extra visits and infinite recursions
    state.visitedNames = new Set();
};

const ImportDeclaration = (path, state) => {
    const { visitedNames, pathResolver, specResolver, sourcePath } = state;

    // skip imports we cannot resolve
    if (!pathResolver.resolve(path.node.source.value, sourcePath)) {
        return;
    }

    // get the declaration's import specifiers, filtering out any
    // that have already been visited previously
    const specifiers = extractImportSpecifiers(
        [path.node], path => pathResolver.resolve(path, sourcePath)
    ).filter(spec => !visitedNames.has(spec.importedName));

    // if there is no work to do, exit immediately
    if (specifiers.length === 0) {
        return;
    }

    // leave single, default imports alone
    if (specifiers.length === 1 && specifiers[0].type === 'default') {
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

        let exportedSpecifier;
        let pointer;
        let iteration = 0;
        let path = specifier.path;
        let name = specifier.importedName;

        // we are visiting this import, so add it to the visited list
        visitedNames.add(name);

        // default imports can usually not be further resolved,
        // bail out and leave it as is.. we do have to do a transform
        // because the same import line might also contain named imports
        // that get split over multiple lines
        if (specifier.type === 'default') {
            transforms.push(types.importDeclaration(
                [types.importDefaultSpecifier(
                    types.identifier(name)
                )],
                types.stringLiteral(makeImportPath(specifier)),
            ));

            continue;
        }

        do {
            iteration += 1;

            // attempt to get the import/export specifiers for the file being imported
            const fileSpecifiers = specResolver.resolve(path);
            if (!fileSpecifiers) {
                return;
            }

            const { importSpecifiers, exportSpecifiers } = fileSpecifiers;

            // attempt to find an export that matches our import
            debug('ITERATION', iteration);
            debug('LOOKING FOR', name);
            debug('IMPORTS', importSpecifiers);
            debug('EXPORTS', exportSpecifiers);

            // perhaps there was a re-export, check the export specifiers
            pointer = exportSpecifiers.find(exp => exp.exportedName === name);
            if (pointer) {
                debug('FOUND IT!', pointer);

                // it could be that this export is also an import in the same line
                if (pointer.path) {
                    name = pointer.name;
                    path = pointer.path;
                    exportedSpecifier = pointer;
                    continue;
                }

                // it was re-exported! find the matching local import
                pointer = importSpecifiers.find(imp => imp.name === pointer.name);
                if (pointer) {
                    debug('FOUND THE RE-EXPORT!', pointer);
                    
                    name = pointer.importedName;
                    path = pointer.path;
                    exportedSpecifier = pointer;
                    continue;
                }
            }

            if (!pointer && !exportedSpecifier) {
                return;
            } else if (exportedSpecifier) {
                break;
            } else {
                exportedSpecifier = pointer;
                break;
            }
        } while (path);

        debug('GOING WITH', exportedSpecifier);

        // found it, replace our import with a new one that imports
        // straight from the place where it was exported....

        switch (exportedSpecifier.type) {
        case 'default':
            transforms.push(types.importDeclaration(
                [types.importDefaultSpecifier(
                    types.identifier(specifier.name)
                )],
                types.stringLiteral(makeImportPath(exportedSpecifier)),
            ));
            break;

        case 'namespace':
            transforms.push(types.importDeclaration(
                [types.importNamespaceSpecifier(
                    types.identifier(specifier.name)
                )],
                types.stringLiteral(makeImportPath(exportedSpecifier)),
            ));
            break;

        case 'named':
            transforms.push(types.importDeclaration(
                [types.importSpecifier(
                    types.identifier(specifier.name),
                    types.identifier(exportedSpecifier.name),
                )],
                types.stringLiteral(makeImportPath(exportedSpecifier)),
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
