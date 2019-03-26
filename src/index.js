const debugFn = require('debug');
const debugRoot = debugFn(require('./constants').loaderName);
const loaderUtils = require('loader-utils');

const core = require('./core');
const utils = require('./utils');
const validateOptions = require('./options').validate;
const babel = require('@babel/core');
const { createBabelPlugin, parseAst } = require('./babel');

const setupState = core.setupState;
const toTransformsMap = core.toTransformsMap;

/** @typedef {import('./options').LoaderOptions} LoaderOptions */
/** @typedef {import('./specResolver').SpecifierResult} SpecifierResult */
/** @typedef {import('./specResolver').LoadedModule} LoadedModule */
/** @typedef {import('./babel').ImportNode} ImportNode */

/**
 * @template A,B
 * @typedef {Array.<(A|B)>} Tuple
 */

/**
 * @typedef Cache
 * @prop {Map.<string, LoadedModule>} module The module cache.
 * @prop {Map.<string, SpecifierResult>} specifier The specifier cache.
 * @prop {Map.<string, string>} path The path cache.
 */

/** 
 * @typedef Context
 * @prop {Object} loader The Webpack loader context.
 * @prop {LoaderOptions} options The options for this loader.
 * @prop {Cache} cache The caches for the loader.
 * @prop {Function} debug The debug handle for the current loader.
 */

/** A custom debug formatter for arrays. */
debugFn.formatters.A = (() => {
    const util = require('util');
    return function(v) {
        if (!Array.isArray(v)) return debugFn.formatters.O(v);
        if (v.length === 0) return '[]';
        this.inspectOpts.colors = this.useColors;
        v = v.map(el => `    ${util.inspect(el, this.inspectOpts).replace(/\n/g, '\n     ')},`);
        return [].concat('[', ...v, ']').join('\n');
    };
})();

/** @type {Map.<string, Cache} */
const globalCache = new Map();

/**
 * Creates a function that performs clean-up for the loader.
 *
 * @param {Function} callback The loader's callback.
 * @param {(string|false)} cacheKey The cache key or `false` if the cache
 * shouldn't be cleaned up.
 * @returns {function(?Error, Array)}
 */
const finalize = (callback, cacheKey) => (err, result) => {
    if (cacheKey) globalCache.delete(cacheKey);
    callback(err, ...result);
};

/**
 * @async
 * @param {Object} webpack
 * @param {string} source
 * @param {Object} sourceMap
 * @param {LoaderOptions} options
 * @param {Cache} cache
 * @returns {Tuple<string, Object>}
 */
const transform = async (webpack, source, sourceMap, options, cache) => {
    let result;
    const { resource, resourcePath } = webpack;
    const debug = debugRoot.extend(`${options.ident}:${cache.module.size}`);
    const contextRelative = utils.contextRelative(webpack.rootContext);

    debug(`START`, contextRelative(resource));

    const ast = await parseAst(resourcePath, source, options.babelConfig);

    /** @type {ImportNode[]} */
    const importDeclarations = ast.program.body
        .filter(babel.types.isImportDeclaration);
    
    if (importDeclarations.length === 0) {
        result = [source, sourceMap];
    }
    else {
        cache.module.set(resource, {
            source, ast,
            path: resource,
            instance: webpack._module
        });

        const state = setupState({ loader: webpack, options, cache, debug });
        const allTransformsMap = new Map();
        const kvps = await Promise.all(importDeclarations.map(toTransformsMap(state)));
        
        kvps.filter(Boolean).forEach(([path, dataKvps]) => {
            let transformData = allTransformsMap.get(path);
            if (!transformData) {
                transformData = new Map();
                allTransformsMap.set(path, transformData);
            }
            dataKvps.forEach(([name, data]) => transformData.set(name, data));
        });

        const babelPlugin = createBabelPlugin(allTransformsMap);

        const { code, map } = await babel.transformFromAstAsync(ast, source, {
            inputSourceMap: sourceMap || void 0,
            configFile: false,
            babelrc: false,
            plugins: [babelPlugin]
        });

        cache.module.delete(resource);

        result = [code, map];
    }

    debug(`DONE`, contextRelative(resource));
    return result;
};

function transformImportsLoader(source, sourceMap) {
    if (this.cacheable) this.cacheable();

    const options = validateOptions(loaderUtils.getOptions(this));
    const cacheKey = options.ident;

    let localCache = globalCache.get(cacheKey);
    let builtCache = false;

    if (!localCache) {
        builtCache = true;

        localCache = {
            module: new Map(),
            specifier: new Map(),
            path: new Map()
        };

        globalCache.set(cacheKey, localCache);
    }

    const callback = finalize(this.async(), builtCache && cacheKey);

    transform(this, source, sourceMap, options, localCache).then(
        (result) => callback(null, result),
        (err) => callback(err, [])
    );
    
    return void 0;
}

module.exports = transformImportsLoader;
