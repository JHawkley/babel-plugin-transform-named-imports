const ospath = require('path');
const arrayMove = require('array-move');
const loaderUtils = require('loader-utils');
const mm = require('micromatch');

const $ = require('./constants');
const common = require('./common');
const utils = require('./utils');

/** @typedef {import('./common').Debug} Debug */
/** @typedef {import('./common').SourceMap} SourceMap */
/** @typedef {import('./common').WebpackModule} WebpackModule */
/** @typedef {import('./common').LoaderContext} LoaderContext */
/** @typedef {import('./common').SharedContext} SharedContext */

/**
 * @typedef OwnContext
 * @prop {string} request
 * The restored request path, without the spec-loader.
 * @prop {LoaderContext} loader
 * The context object of the current loader instance.
 * @prop {Debug} debugLoader
 * The debug handle for the current loader instance.
 * @prop {boolean} hasSideEffects
 * Whether Webpack considers the module as having side-effects.
 */

/**
 * The complete context for a single spec-loader.
 * 
 * @typedef {SharedContext & OwnContext} SpecContext
 */

/** A regular-expression for removing the loader's query-parameter. */
const reLoaderQuery = new RegExp(`(\\?|&)${$.specLoaderQuery}=(.*?)$`);

/** A MicroMatch matcher for the transform-loader. */
const matchTransformLoader = [
    ospath.resolve(__dirname, '../index.js'),
    `${__dirname}/transformLoader.js`,
];

/**
 * Does the work of {@link specifierNormalLoader}.
 * 
 * @param {SpecContext} context
 * The working context.
 * @param {string} source
 * The source code of the module.
 * @returns {string}
 * A stringified JSON representation of a {@link SpecifierResult} instance.
 */
const getSpecifiers = async (context, source) => {
    const {
        unsafeAstCache, debugLoader,
        loader: { resourcePath, _module: instance }
    } = context;

    try {
        debugLoader('PARSING AST');
        const ast = await context.astParser.parse(resourcePath, source);

        debugLoader('EXTRACTING SPECIFIERS');
        const result = await context.specResolver.extractSpecifiers(context, ast);

        if (unsafeAstCache) instance.buildMeta[$.cachedAst] = ast;

        return result;
    }
    catch (error) {
        debugLoader('NON-CRITICAL FAILURE', error);
        return null;
    }
};

/** @this {LoaderContext} */
function specifierPitchLoader() {
    const indexThisLoader = this.loaderIndex;

    const indexTransformLoader = this.loaders.findIndex(
        loader => mm.every(loader.path, matchTransformLoader)
    );

    if (indexTransformLoader === -1) {
        // the transform loader is not applied to this module;
        // re-arrange the loaders so this loader executes last

        if (indexThisLoader > 0)
            this.loaders = arrayMove(this.loaders, indexThisLoader, 0);
    }
    else {
        // replace the transform loader with this loader and
        // remove all loaders before it

        this.loaders[indexTransformLoader] = this.loaders[indexThisLoader];
        this.loaders[indexThisLoader] = null;
        this.loaders = this.loaders.slice(indexTransformLoader).filter(Boolean);
    }

    // the loader-runner is smart enough not to re-execute
    // the pitch functions of loaders that have already been
    // visited, so this is safe to do
    this.loaderIndex = 0;
}

/**
 * @this {LoaderContext}
 * @param {string} source
 * The source code of the module.
 * @param {SourceMap} sourceMap
 * The source-map of the module.
 * @param {*} meta
 * The current loader meta-data.
 */
function specifierNormalLoader(source, sourceMap, meta) {
    const { resourcePath, rootContext, _module: instance } = this;
    const request = common.restoreRequest(resourcePath, instance)
        .replace(reLoaderQuery, '');

    if (this.cacheable) this.cacheable();

    const query = loaderUtils.parseQuery(this.resourceQuery);
    const options = { ident: query[$.specLoaderQuery] };
    const sharedContext = common.getSharedContext(this, options, false);

    if (!sharedContext)
        throw new Error(`no shared context exists for \`${options.ident}\``);

    const callback = this.async();
    const moduleIdent = utils.contextRelative(rootContext, request);
    const debugLoader = sharedContext.debugRoot.extend(`${moduleIdent}:specifiers`);
    const hasSideEffects
        = !instance.factoryMeta ? true
        : !instance.factoryMeta.sideEffectFree;

    /** @type {SpecContext} */
    const context = Object.assign({}, sharedContext, {
        request, hasSideEffects, debugLoader,
        loader: this
    });

    debugLoader('START');
    
    getSpecifiers(context, source).then(
        (result) => {
            debugLoader('DONE');
            const json = JSON.stringify(result)
                .replace(/\u2028/g, '\\u2028')
                .replace(/\u2029/g, '\\u2029');
            callback(null, `/* spec-loader */ module.exports = ${json};`, null, meta);
        },
        (err) => {
            debugLoader('FAILED', err);
            callback(err);
        }
    );

    return void 0;
}

module.exports = specifierNormalLoader;
module.exports.pitch = specifierPitchLoader;