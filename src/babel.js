const types = require('@babel/core').types;
const $ = require('./constants');

/**
 * A specifier for an `ImportDeclaration` node.
 * @typedef ImportSpecifierNode
 * @prop {Object} local The local identifier.
 * @prop {string} local.name The name of the identifier.
 * @prop {Object} [imported] The imported identifier.
 * @prop {string} imported.name The name of the imported identifier.
 */

/**
 * A specifier for an `ExportNamedDeclaration` node.
 * @typedef ExportSpecifierNode
 * @prop {Object} local The local identifier.
 * @prop {string} local.name The name of the identifier.
 * @prop {Object} [exported] The exported identifier.
 * @prop {string} exported.name The name of the exported identifier.
 */

/** @typedef {(ImportSpecifierNode|ExportSpecifierNode)} SpecifierNode */

/**
 * A Babel `ImportDeclaration` node.
 * @typedef ImportNode
 * @prop {Object} source The source path container.
 * @prop {string} source.value The source path.
 * @prop {ImportSpecifierNode[]} specifiers The node's specifiers.
 */

/**
 * A Babel `ExportDefaultDeclaration` node.
 * @typedef ExportDefaultNode
 * @prop {Object} declaration The declaration.
 * @prop {string} declaration.name The local-name of the declaration.
 */

/**
 * A Babel `ExportNamedDeclaration` node.
 * @typedef ExportNamedNode
 * @prop {Object} [source] The source path container.
 * @prop {string} source.value The source path.
 * @prop {ExportSpecifierNode[]} specifiers The node's specifiers.
 */

/**
 * A Babel export node.
 * @typedef {(ExportDefaultNode|ExportNamedNode)} ExportNode
 */

/**
 * A Babel `Path` for an `ImportDeclaration` node.
 * @typedef ImportPath
 * @prop {ImportNode} node The node.
 */

/**
 * A Babel `Path` for an `ExportNamedDeclaration` node.
 * @typedef ExportPath
 * @prop {ExportNamedNode} node The node.
 */

/** @typedef {(ImportPath|ExportPath)} AnyPath */

/**
 * @typedef TransformData
 * @prop {('import'|'export')} declarationType
 * @prop {('default'|'namespace'|'named')} specifierType
 * @prop {string} exportedName
 * @prop {string} path
 * @prop {string[]} sideEffects
 */

/** @typedef BabelTransform */
/** @typedef {Map.<string, TransformData>} TransformsMap */
/** @typedef {Map.<string, TransformsMap>} AllTransformsMap */

/**
 * @typedef BabelContext
 * @prop {AllTransformsMap} allTransforms
 * @prop {Set.<string>} visitedNames
 * @prop {Set.<string>} sideEffects
 */

/** The domains for each type of input specifier. */
const domains = {
    [$.import]: {
        declaration: types.importDeclaration,
        defaultSpecifier: (local) =>
            types.importDefaultSpecifier(types.identifier(local)),
        namespaceSpecifier: (local) =>
            types.importNamespaceSpecifier(types.identifier(local)),
        namedSpecifier: (local, exported) =>
            types.importSpecifier(
                types.identifier(local),
                types.identifier(exported)
            )
    },
    [$.export]: {
        declaration: (specifiers, source) =>
            types.exportNamedDeclaration(null, specifiers, source),
        defaultSpecifier: (local, exported) =>
            local === exported
            ? types.exportDefaultSpecifier(types.identifier(exported))
            : domains[$.export].namedSpecifier(local, exported),
        namespaceSpecifier: (local, exported) =>
            types.exportNamespaceSpecifier(types.identifier(exported)),
        namedSpecifier: (local, exported) =>
            types.exportSpecifier(
                types.identifier(local),
                types.identifier(exported)
            )
    }
};

// eslint-disable-next-line jsdoc/require-param
/** @type {function(SpecifierNode): string} */
const getSpecifierName = (specifier) =>
    (specifier.exported || specifier.local).name;

// eslint-disable-next-line jsdoc/require-param
/** @type {function(TransformsMap, Set.<string>): function(string): BabelTransform} */
const toTransform = (transformData, sideEffects) => (localName) => {
    // replace our import/export with a new one that imports
    // straight from the place where it was exported...

    const {
        declarationType, specifierType,
        exportedName, path
    } = transformData.get(localName);

    // remove this path as a side-effect, since it is being imported
    sideEffects.delete(path);

    // determine the functions for creating the transforms
    const domain = domains[declarationType];

    switch (specifierType) {
        case $.default:
            return domain.declaration(
                [domain.defaultSpecifier(localName, exportedName)],
                types.stringLiteral(path)
            );

        case $.namespace:
            return domain.declaration(
                [domain.namespaceSpecifier(localName, exportedName)],
                types.stringLiteral(path)
            );

        case $.named:
            return domain.declaration(
                [domain.namedSpecifier(localName, exportedName)],
                types.stringLiteral(path)
            );

        default:
            // if we get here, something is seriously wrong
            throw new Error([
                'problem while creating transformations',
                `resolved export specifier has an unrecognized type: ${specifierType}`
            ].join('; '));
    }
};

// eslint-disable-next-line jsdoc/require-param
/** @type {function(BabelContext, AnyPath)} */
const visitor = (context, path) => {
    const { allTransforms, visitedNames, sideEffects } = context;
    const originalPath = path.node.source.value;
    const specifiers = path.node.specifiers;
    const transformData = allTransforms.get(originalPath);

    // abort in the case we have nothing to transform
    if (!transformData || transformData.size !== specifiers.length) return;

    // get the names of our imports
    const specifierNames = specifiers
        .map(getSpecifierName)
        .filter(name => !visitedNames.has(name));
    
    if (specifierNames.length === 0) return;

    // add imports to the visited list
    specifierNames.forEach(name => visitedNames.add(name));

    // produce the transforms, filtering out any identifiers that
    // have already been visited previously
    const transforms = specifierNames
        .map(toTransform(transformData, sideEffects));
    
    if (transforms.length > 0)
        path.replaceWithMultiple(transforms);
};

/**
 * Creates a Babel plugin that transforms `ImportDeclaration` nodes.
 * 
 * @param {AllTransformsMap} allTransforms
 * @returns A Babel plugin.
 */
const createBabelPlugin = (allTransforms) => {
    const visitedNames = new Set();
    const sideEffects = new Set();

    for (const kvpTransforms of allTransforms)
        for (const kvpData of kvpTransforms[1])
            for (const sideEffect of kvpData[1].sideEffects)
                sideEffects.add(sideEffect);
    
    const context = { allTransforms, visitedNames, sideEffects };

    return {
        name: $.pluginName,
        visitor: {
            // eslint-disable-next-line jsdoc/require-param
            /** @type {function(ImportPath)} */
            ImportDeclaration(path) {
                visitor(context, path);
            },
            // eslint-disable-next-line jsdoc/require-param
            /** @type {function(ExportPath)} */
            ExportNamedDeclaration(path) {
                // ignore nodes without a source path
                if (!path.node.source) return;
                visitor(context, path);
            }
        },
        post(file) {
            if (sideEffects.size === 0) return;

            const nodes = Array.from(sideEffects, (sideEffect) => {
                return types.importDeclaration(
                    [], types.stringLiteral(sideEffect)
                );
            });
            
            file.path.unshiftContainer('body', nodes);
        }
    };
};

module.exports = createBabelPlugin;