/* global test, describe, expect */
const path = require('path');
const webpack = require('webpack');
const memoryFS = require('memory-fs');

/**
 * The configuration object for Webpack.
 * @typedef {Object} WebpackConfig
 */

/**
 * The `Stats` object generated after Webpack has performed a compilation.
 * @typedef {Object} WebpackStats
 */

/**
 * The `rules` configuration for Webpack.
 * @typedef {Array} WebpackRules
 */

/**
 * The configuration for a test.
 * @typedef TestConfig
 * @prop {string} [entry]
 * The test fixture to run and the entry file for Webpack.
 * If not provided, the test will be labeled "todo".
 * @prop {string} [output]
 * The expected output from running the test.  All new-lines and indentation
 * are stripped in both the expected and reported output before comparisons
 * are performed.  Only lines with actual content are compared.
 * Mutually exclusive with {@link TestConfig.error}.
 * @prop {(string|RegExp|Error|typeof Error)} [error]
 * The expected error from running the test.  Supports all the same types
 * as Jest's `.toThrow()` assertion.
 * Mutually exclusive with {@link TestConfig.output}.
 * @prop {boolean} [todo]
 * If `true`, marks the test as still needing work; the test will not be run
 * and will be reported with "todo" in the test output.
 * @prop {boolean} [skip]
 * If `true`, the test will be skipped.
 * @prop {boolean} [only]
 * If `true`, only this test and any other tests marked with `only` will
 * have their tests run.  All others will be skipped.
 */

/**
 * The options describing the tests to run.
 * @typedef TestOptions
 * @prop {string} [describe]
 * A description of the tests being performed.
 * @prop {string} [context]
 * The `context` root to execute Webpack from; must be an absolute path.
 * May also be provided via {@link TestOptions.webpackConfig}.
 * @prop {WebpackRules|function(TestOptions): WebpackRules} [rules]
 * The `module.rules` for the Webpack configuration.
 * May also be provided via {@link TestOptions.webpackConfig}.
 * @prop {function(WebpackConfig, TestOptions): WebpackConfig} [webpackConfig]
 * A function that allows the Webpack configuration to be altered and
 * customized before tests are executed.
 * @prop {Object.<string, TestConfig>} [tests]
 * An object containing the tests to run.  The property name is used
 * as the description of the test.  If this property is missing,
 * no tests will be added.
 * @prop {boolean} [skip]
 * If `true`, all tests provided by these options will be skipped.
 * @prop {boolean} [only]
 * If `true`, only the tests provided by these options and any other
 * tests marked with `only` will have their tests run.  All others
 * will be skipped.
 */

const fixPath = (p) =>
    path.isAbsolute(p) || p.startsWith('.') ? p : `./${p}`;

const splitLines = (source) =>
    source.split('\n').map(line => line.trim()).filter(Boolean);

/**
 * An `Error` class for reporting errors from a Webpack compilation's `Stats` object.
 *
 * @class StatsError
 * @extends {Error}
 */
class StatsError extends Error {

    /**
     * Creates an instance of StatsError.
     *
     * @param {string[]} errors
     * The errors reported by a `Stats` object.
     * @memberof StatsError
     */
    constructor(errors) {
        super(errors.join('\n\n'));
        this.reportedErrors = errors;
    }
}

/**
 * Creates a new configuration object for Webpack.  The base configuration can be
 * influenced by `options.entry` and/or `options.webpackConfig`.
 * 
 * @param {TestOptions} options
 * The options object describing the test.
 * @returns {WebpackConfig}
 * A new Webpack configuration.
 */
const createWebpackConfig = (options) => {
    const { rules: rulesIn, context, webpackConfig } = options;
    const rules = typeof rulesIn === 'function' ? rulesIn(options) : rulesIn;

    let config = {
        context,
        resolve: { modules: [context, 'node_modules'] },
        output: {
            path: path.resolve(__dirname),
            filename: 'bundle.js',
        },
        module: { rules },
        optimization: {
            minimize: false,
            concatenateModules: false,
            usedExports: false
        }
    };

    if (webpackConfig != null) {
        if (typeof webpackConfig !== 'function')
            throw new Error('the `webpackConfig` property must be a function, when provided');

        const newConfig = webpackConfig(config, options);

        if (newConfig == null || typeof newConfig !== 'object')
            throw new Error('the `webpackConfig` property must return a Webpack configuration object');

        if (Array.isArray(newConfig))
            throw new Error('the `webpackConfig` property must return only a single Webpack configuration object');

        config = newConfig;
    }

    if (!config.context) {
        throw new Error([
            'no `context` property was provided in the Webpack configuration',
            'please provide a `context` or `webpackConfig` property to configure it'
        ].join('; '));
    }

    if (!path.isAbsolute(options.context)) {
        throw new Error([
            'the `context` property of the Webpack configuration must be an absolute path',
            'please check your `context` or `webpackConfig` property'
        ].join('; '));
    }
    
    if (!config.module || !config.module.rules) {
        throw new Error([
            'no `module.rules` property was specified in the Webpack configuration',
            'please provide a `rules` or `webpackConfig` property to configure them'
        ].join('; '));
    }

    if (!Array.isArray(config.module.rules)) {
        throw new Error([
            ['the `module.rules` property specified in the Webpack configuration',
            'is not an array'].join(' '),
            'please check your `rules` or `webpackConfig` property'
        ].join('; '));
    }

    return config;
};

/**
 * Clones a Webpack configuration and inserts the given `entry` point into it.
 * 
 * @param {WebpackConfig} config
 * The webpack configuration.
 * @param {string} entry
 * The entry point of the test.
 * @returns {WebpackConfig}
 * A new Webpack configuration object, with the `entry` property set.
 */
const configureEntry = (config, entry) => Object.assign({}, config, { entry });

/**
 * Creates a compiler and executes it asynchronously.
 * 
 * @param {WebpackConfig} config
 * The Webpack configuration object.
 * @returns {Promise.<WebpackStats>}
 * A promise that will resolve to the resulting `Stats` object.
 */
const compile = (config) => {
    return new Promise((resolve, reject) => {
        const compiler = webpack(config);
        compiler.outputFileSystem = new memoryFS();

        compiler.run((err, stats) => {
            if (err) reject(err);
            const statsJson = stats.toJson();
            if (stats.hasErrors()) reject(new StatsError(statsJson.errors));
            resolve(statsJson);
        });
    });
};

/**
 * Creates the Jest tests from the `options` provided.
 * 
 * @param {TestOptions} options
 * The test options.
 */
const createTests = (options) => () => {
    const tests = options.tests;

    // do nothing if there are no tests
    if (!tests) return;

    const config = createWebpackConfig(options);

    // prevents an error in Jest;
    // it checks for more than one argument and throws
    // in such a case
    const testTodo = (name) => test.todo(name);

    const expectNoop = () => expect.assertions(0);

    const expectOutput = ({entry, output}) => async () => {
        expect.assertions(2);

        const entryPath = fixPath(entry);
        const stats = await compile(configureEntry(config, entryPath));
        const moduleData = stats.modules.find(m => m.name === entryPath);

        expect(moduleData != null).toBe(true);
        
        const sourceLines = splitLines(moduleData.source).join('\n');
        const outputLines = splitLines(output).join('\n');

        expect(sourceLines).toEqual(outputLines);
    };

    const expectError = ({entry, error}) => async () => {
        expect.assertions(1);
        const entryPath = fixPath(entry);

        await expect(compile(configureEntry(config, entryPath)))
            .rejects.toThrow(error);
    };

    for (const name of Object.keys(tests)) {
        const testObj = tests[name];

        if (testObj.entry && typeof testObj.entry !== 'string')
            throw new Error(`test '${name}' requires an \`entry\` property that is a string`);

        if (testObj.output && testObj.error)
            throw new Error(`test '${name}' cannot have both \`output\` and \`error\` properties`);

        const runnerFn
            = !testObj.entry ? expectNoop
            : testObj.output ? expectOutput
            : testObj.error ? expectError
            : expectNoop;
        
        const testFn
            = runnerFn === expectNoop ? testTodo
            : testObj.todo === true ? testTodo
            : (options.skip || testObj.skip) === true ? test.skip
            : (options.only || testObj.only) === true ? test.only
            : test;
        
        testFn(name, runnerFn(testObj));
    }
};

let testBlockCount = 1;

/**
 * Uses Jest to test a Webpack loader.
 * 
 * @param {(TestOptions|TestOptions[])} options
 * The options describing the tests to run.  May be an array of options.
 */
module.exports = (options) => {
    if (!Array.isArray(options))
        options = [options].filter(Boolean);

    if (options.length === 0)
        throw new Error('at least one test options object must be provided');

    for (const testOptions of options) {
        const description = testOptions.describe || `test block ${testBlockCount}`;

        testBlockCount += 1;
        describe(description, createTests(testOptions));
    }
};