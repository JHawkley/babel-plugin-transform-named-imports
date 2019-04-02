const ospath = require('path');
const babel = require('@babel/core');
const $ = require('./constants');

const types = babel.types;

/** @typedef {import('./index').Debug} Debug */
/** @typedef BabelAST A Babel-compatible AST. */

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
 * @typedef TransformData
 * @prop {('default'|'namespace'|'named')} type
 * @prop {string} exportedName
 * @prop {string} path
 */

/** @typedef BabelTransform */
/** @typedef {Map.<string, TransformData>} TransformsMap */
/** @typedef {Map.<string, TransformsMap>} AllTransformsMap */

// eslint-disable-next-line jsdoc/require-param
/** @type {function(ImportSpecifierNode): string} */
const getImportName = (specifier) => specifier.local.name;

// eslint-disable-next-line jsdoc/require-param
/** @type {function(TransformsMap): function(string): BabelTransform} */
const toTransform = (transformData) => (localName) => {
    // replace our import with a new one that imports
    // straight from the place where it was exported...

    const { type, exportedName, path } = transformData.get(localName);

    switch (type) {
        case $.default:
            return types.importDeclaration(
                [types.importDefaultSpecifier(
                    types.identifier(localName)
                )],
                types.stringLiteral(path),
            );

        case $.namespace:
            return types.importDeclaration(
                [types.importNamespaceSpecifier(
                    types.identifier(localName)
                )],
                types.stringLiteral(path),
            );

        case $.named:
            return types.importDeclaration(
                [types.importSpecifier(
                    types.identifier(localName),
                    types.identifier(exportedName),
                )],
                types.stringLiteral(path),
            );

        default:
            // if we get here, something is seriously wrong
            throw new Error([
                'problem while creating transformations',
                `resolved export specifier has an unrecognized type: ${type}`
            ].join('; '));
    }
};

/**
 * Creates a Babel plugin that transforms `ImportDeclaration` nodes.
 * 
 * @param {AllTransformsMap} allTransforms
 * @returns A Babel plugin.
 */
const createBabelPlugin = (allTransforms) => {
    const visitedNames = new Set();

    return {
        name: $.pluginName,
        visitor: {
            // eslint-disable-next-line jsdoc/require-param
            /** @type {function(ImportPath)} */
            ImportDeclaration(path) {
                const originalPath = path.node.source.value;
                const specifiers = path.node.specifiers;
                const transformData = allTransforms.get(originalPath);

                // abort in the case we have nothing to transform
                if (!transformData || transformData.size !== specifiers.length) return;

                // get the names of our imports
                const specifierNames = specifiers
                    .map(getImportName)
                    .filter(name => !visitedNames.has(name));
                
                if (specifierNames.length === 0) return;

                // add imports to the visited list
                specifierNames.forEach(name => visitedNames.add(name));

                // produce the transforms, filtering out any identifiers that
                // have already been visited previously
                const transforms = specifierNames
                    .map(toTransform(transformData));
                
                if (transforms.length > 0)
                    path.replaceWithMultiple(transforms);
            }
        }
    };
};

const resolveConfig = (path, config) => {
    if(config) {
        if (typeof baseOptions === 'string') {
            if (ospath.basename(config) === '.babelrc') {
                const babelrcRoot = ospath.relative(path, config);
                return {
                    configFile: false,
                    babelrc: true,
                    babelrcRoots: [ospath.join(babelrcRoot, '**/*')]
                };
            }
            else {
                return {
                    configFile: config,
                    babelrc: false
                };
            }
        }
    }

    return config;
};

/**
 * Parses source code into a Babel AST.
 * 
 * @async
 * @param {string} path The path of the file being parsed.
 * @param {string} source The source code of the file.
 * @param {(string|Object)} [baseConfig] The Babel options to use as a base.
 * @returns {BabelAST} A Babel AST.
 */
const parseAst = async (path, source, baseConfig) => {
    const config = Object.assign({}, resolveConfig(path, baseConfig), {
        caller: {
            name: $.pluginName,
            supportsStaticESM: true
        },
        filename: path,
        sourceType: 'unambiguous'
    });

    return await babel.parseAsync(source, config);
};

module.exports = { createBabelPlugin, resolveConfig, parseAst };