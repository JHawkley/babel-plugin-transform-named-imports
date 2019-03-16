const path = require('path');
const pluginTester = require('babel-plugin-tester');

const plugin = require('../src/index.js');
const babel = require('../src/babel-helper').getBabel();

const createBabelOptions = () => {
    if (process.env.FORCE_BABEL_SEVEN === 'true') {
        // the Babel presets are deprecated, so we're loading in
        // the relevant plugins individually
        return {
            filename: 'currentFile.js',
            plugins: [
                // stage 2
                ['@babel/plugin-proposal-decorators', { 'legacy': true }],
                '@babel/plugin-proposal-function-sent',
                '@babel/plugin-proposal-export-namespace-from',
                '@babel/plugin-proposal-numeric-separator',
                '@babel/plugin-proposal-throw-expressions',
            
                // stage 3
                '@babel/plugin-syntax-dynamic-import',
                '@babel/plugin-syntax-import-meta',
                ['@babel/plugin-proposal-class-properties', { 'loose': false }],
                '@babel/plugin-proposal-json-strings',
            ]
        }
    }
    else {
        const createBabylonOptions = require('babylon-options');

        return {
            filename: 'currentFile.js',
            parserOpts: createBabylonOptions({
                stage: 2
            }),
        };
    }
};

const babelOptions = createBabelOptions();

pluginTester({
    plugin,
    babel,
    babelOptions: babelOptions,
    pluginOptions: {
        webpackConfig: path.resolve(__dirname + '/webpack.config.js'),
        sideEffects: false,
    },
    tests: {
        // bare import
        'should leave imports with no specifiers alone': {
            code: `import 'testmodule'`,
            output: `import 'testmodule';`,
        },
        
        // single named import
        'should convert named imports to default equivalent': {
            code: `import { theFirstFunc } from "testmodule"`,
            output: `import theFirstFunc from "./tests/testmodule/myFirstFunc.js";`,
        },
        
        // import default module by-name then re-export
        'should convert by-name default import to default equivalent': {
            code: `import { byNameDefaultImportFunc } from "testmodule"`,
            output: `import byNameDefaultImportFunc from "./tests/testmodule/myFirstFunc.js";`,
        },
        
        // export-from default module by-name
        'should convert by-name default export-from to default equivalent': {
            code: `import { byNameDefaultExportFunc } from "testmodule"`,
            output: `import byNameDefaultExportFunc from "./tests/testmodule/myFirstFunc.js";`,
        },

        // import module re-exported multiple times
        'should be able to follow through multiple re-exports': {
            code: `import { theExportedSecondFunc } from "testmodule"`,
            output: `import { mySecondFunc as theExportedSecondFunc } from "./tests/testmodule/mySecondFunc.js";`,
        },

        // import module aliased multiple times
        'should be able to follow through multiple aliases': {
            code: `import { theSecondFunc } from "testmodule"`,
            output: `import { mySecondFunc as theSecondFunc } from "./tests/testmodule/mySecondFunc.js";`,
        },

        // multiple named imports
        'should be able to handle multiple named imports': {
            code: `import { theFirstFunc, theSecondFunc } from "testmodule"`,
            output: `
                import theFirstFunc from "./tests/testmodule/myFirstFunc.js";
                import { mySecondFunc as theSecondFunc } from "./tests/testmodule/mySecondFunc.js";
            `,
        },

        // default import with multiple named import
        'should be able to handle default and multiple named imports': {
            code: `import init, { theFirstFunc, theSecondFunc } from "testmodule"`,
            output: `
                import init from "./tests/testmodule/index.js";
                import theFirstFunc from "./tests/testmodule/myFirstFunc.js";
                import { mySecondFunc as theSecondFunc } from "./tests/testmodule/mySecondFunc.js";
            `,
        },

        // aliased named import
        'should correctly handle aliased imports': {
            code: `import { theFirstFunc as aliasedFunc } from "testmodule"`,
            output: `import aliasedFunc from "./tests/testmodule/myFirstFunc.js";`,
        },

        // default import
        'should leave single default imports alone': {
            code: `import myFirstFunc from "testmodule/myFirstFunc"`,
            output: `import myFirstFunc from "testmodule/myFirstFunc";`,
        },

        // unresolved default import
        'should leave unresolvable imports alone': {
            code: `import React from "reacty"`,
            output: `import React from "reacty";`,
        },

        // unresolved default import with named import
        'should leave multiple unresolvable imports alone': {
            code: `import React, { Component } from "reacty"`,
            output: `import React, { Component } from "reacty";`,
        },

        // common js default import
        'should leave common js imports alone': {
            code: `import React from "./commonjsmodule"`,
            output: `import React from "./commonjsmodule";`,
        },

        // common js default with named import
        'should leave multiple common js imports alone': {
            code: `import React, { Component } from "./commonjsmodule"`,
            output: `import React, { Component } from "./commonjsmodule";`,
        },

        // aliased namespace import
        'should be able to handle aliased namespaced re-exports': {
            code: `import { thangs } from "testmodule"`,
            output: `import * as thangs from "./tests/testmodule/constants.js";`,
        },

        // glob import
        'should leave namespaced imports alone': {
            code: `import * as testmodule from "testmodule"`,
            output: `import * as testmodule from "./tests/testmodule/index.js";`,
        },

        // export-from in single line
        'should follow through export-from': {
            code: `import { theInlineFirstFunc } from "testmodule"`,
            output: `import theInlineFirstFunc from "./tests/testmodule/myFirstFunc.js";`,
        },

        // export-from un-aliased
        'should follow through export-from, even if never aliased': {
            code: `import { myThirdFunc } from "testmodule"`,
            output: `import { myThirdFunc } from "./tests/testmodule/myThirdFunc.js";`,
        },
        
        // import nested default export
        'should not follow past the first encountered default import, using import-from': {
            code: `import { defaultFirstFunc } from "testmodule"`,
            output: `import defaultFirstFunc from "./tests/testmodule/defaultExport.js";`,
        },
        
        // import nested default export-from
        'should not follow past the first encountered default import, using export-from': {
            code: `import { byNameDefaultNestedFunc } from "testmodule"`,
            output: `import byNameDefaultNestedFunc from "./tests/testmodule/defaultExport.js";`,
        },

        // confusing naming
        // make sure it doesn't get confused by confusing exports
        'should be able to resolve properly despite confusing naming': {
            code: `import { FOO } from "testmodule"`,
            output: `import { mySecondFunc as FOO } from "./tests/testmodule/mySecondFunc.js";`,
        },
    },
});

// tests for when `transformDefaultImports === true`
pluginTester({
    plugin,
    babel,
    babelOptions: babelOptions,
    pluginOptions: {
        webpackConfig: path.resolve(__dirname + '/webpack.config.js'),
        transformDefaultImports: true,
    },
    tests: {
        // non-javascript imports
        'should stop when AST parsing fails': {
            code: `import { transformedCss } from "testmodule"`,
            output: `import transformedCss from "./tests/testmodule/styles.css";`,
        },

        // stop at webpack-influenced imports
        'should stop at webpack-influenced imports': {
            code: `import { webpackLoadedFunc } from "testmodule"`,
            output: `import { myExportedSecondFunc as webpackLoadedFunc } from "my-loader!./tests/testmodule/reexport.js";`,
        },

        // inline-loader syntax
        'should preserve Webpack\'s inline-loader syntax': {
            code: `import { inlineLoaderCss } from "testmodule"`,
            output: `import inlineLoaderCss from "style-loader!css-loader?modules!./tests/testmodule/styles.css";`,
        },
        
        // query-params syntax
        'should preserve Webpack\'s query parameters syntax': {
            code: `import { queryParamsCss } from "testmodule"`,
            output: `import queryParamsCss from "./tests/testmodule/styles.css?as-js";`,
        },

        // transformDefaultImports = true: import nested default export
        'transform defaults: should follow past first encountered default import, using import-from': {
            code: `import { defaultFirstFunc } from "testmodule"`,
            output: `import defaultFirstFunc from "./tests/testmodule/myFirstFunc.js";`,
        },
        
        // transformDefaultImports = true: import nested default export-from
        'transform defaults: should follow past first encountered default import, using export-from': {
            code: `import { byNameDefaultNestedFunc } from "testmodule"`,
            output: `import byNameDefaultNestedFunc from "./tests/testmodule/myFirstFunc.js";`,
        },
    },
});

// tests for when considering side-effects
pluginTester({
    plugin,
    babel,
    babelOptions: babelOptions,
    pluginOptions: {
        webpackConfig: path.resolve(__dirname + '/webpack.config.js'),
        sideEffects: {
            projectPath: path.resolve(__dirname),
        },
    },
    tests: {
        // side-effect checking: local side-effecting import
        'side-effects: should stop when the local `package.json` declares side-effects': {
            code: `import { sideEffectFoo } from "testmodule"`,
            output: `import { FOO as sideEffectFoo } from "./tests/testmodule/sideEffects.js";`,
        },
        
        // side-effect checking: node-module side-effecting import
        'side-effects: should stop when a node-module\'s `package.json` declares side-effects': {
            code: `import { doTheThing } from "side-effecty"`,
            output: `import { doTheThing } from "./tests/node_modules/side-effecty/index.js";`,
        },
            
        // side-effect checking: pure import
        'side-effects: should transform when a node-module\'s `package.json` declares itself pure': {
            code: `import { doTheThing } from "pure-boy"`,
            output: `import doTheThing from "./tests/node_modules/pure-boy/doTheThing.js";`,
        },
        
        // side-effect checking: node-module unclear import
        'side-effects: should assume side-effects when the `sideEffect` property is undefined': {
            code: `import { doTheThing } from "unclr"`,
            output: `import { doTheThing } from "./tests/node_modules/unclr/index.js";`,
        },
    },
});

// tests for when ignoring side-effects
pluginTester({
    plugin,
    babel,
    babelOptions: babelOptions,
    pluginOptions: {
        webpackConfig: path.resolve(__dirname + '/webpack.config.js'),
        sideEffects: {
            projectPath: path.resolve(__dirname),
            ignore: [
                'side-effecty',
                './testmodule/**/*',
            ],
        },
    },
    tests: {
        // side-effect ignore option: local side-effecting import
        'side-effect ignore option: should ignore local side-effects': {
            code: `import { sideEffectFoo } from "testmodule"`,
            output: `import { FOO as sideEffectFoo } from "./tests/testmodule/constants.js";`,
        },
        
        // side-effect ignore option: node-module side-effecting import
        'side-effect ignore option: should be able to ignore node-modules by name': {
            code: `import { doTheThing } from "side-effecty"`,
            output: `import doTheThing from "./tests/node_modules/side-effecty/doTheThing.js";`,
        },
    },
});

// tests for when assuming side-effects
pluginTester({
    plugin,
    babel,
    babelOptions: babelOptions,
    pluginOptions: {
        webpackConfig: path.resolve(__dirname + '/webpack.config.js'),
        sideEffects: {
            projectPath: path.resolve(__dirname),
            default: false,
        },
    },
    tests: {
        // side-effect default option: node-module unclear import
        'side-effect default option: should respect the default assumption': {
            code: `import { doTheThing } from "unclr"`,
            output: `import doTheThing from "./tests/node_modules/unclr/doTheThing.js";`,
        },
    },
});

// tests to ensure options validation works
pluginTester({
    plugin,
    babel,
    babelOptions: babelOptions,
    pluginOptions: {
        webpackConfig: path.resolve(__dirname + '/webpack.config.js'),
        sideEffects: {
            // this is an invalid option; not an absolute path
            projectPath: './tests',
            default: false,
        },
    },
    tests: {
        // side-effect default option: node-module unclear import
        'should throw an error on an invalid option': {
            code: `import "testmodule"`,
            error: 'the `sideEffects.projectPath` option must be an absolute path',
        },
    },
});