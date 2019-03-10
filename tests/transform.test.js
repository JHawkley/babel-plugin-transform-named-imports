const path = require('path');
const pluginTester = require('babel-plugin-tester');
const createBabylonOptions = require('babylon-options');

const plugin = require('../src/index.js');

const babelOptions = {
    filename: 'currentFile.js',
    parserOpts: createBabylonOptions({
        stage: 2
    })
};

pluginTester({
    plugin,
    babelOptions: babelOptions,
    pluginOptions: {
        webpackConfig: path.resolve(__dirname + '/webpack.config.js'),
    },
    snapshot: true,
    tests: {
        // convert this into a default import that leads to `testmodule/myFirstFunc`
        'single named import':
            `import { theFirstFunc } from 'testmodule'`,
        
        // convert this into a default import that leads to `testmodule/myFirstFunc`
        'import default module by-name then re-export':
            `import { byNameDefaultImportFunc } from 'testmodule'`,
        
        // convert this into a default import that leads to `testmodule/myFirstFunc`
        'export-from default module by-name':
            `import { byNameDefaultExportFunc } from 'testmodule'`,

        // convert this into a named import that leads to `testmodule/mySecondFunc`
        'import module renamed multiple times':
            `import { theSecondFunc } from 'testmodule'`,
        
        // convert this into a named import that leads to `testmodule/mySecondFunc`
        'import module re-exported multiple times':
            `import { theExportedSecondFunc } from 'testmodule'`,

        // convert this into one default import that leads to `testmodule/myFirstFunc`
        // and a named import that leads to `testmodule/mySecondFunc`
        'multiple named imports':
            `import { theFirstFunc, theSecondFunc } from 'testmodule'`,

        // convert this into three imports, one default import for `init` and
        // one default import for `myFirstFunc` and a named one for `mySecondFunc`
        'default import with multiple named import':
            `import init, { theFirstFunc, theSecondFunc } from 'testmodule'`,

        // convert this into a default import with `aliasedFunc` leading to
        // `testmodule/myFirstFunc`
        'aliased named import':
            `import { theFirstFunc as aliasedFunc } from 'testmodule'`,

        // don't change existing default imports like this
        'default import':
            `import myFirstFunc from 'testmodule/myFirstFunc'`,

        // unresolved default imports should be left alone
        'unresolved default import':
            `import React from 'reacty'`,

        // unresolved imports should be left alone
        'unresolved default import with named import':
            `import React, { Component } from 'reacty'`,

        // common js imports should be left alone
        'common js default import':
            `import React from './commonjsmodule'`,

        // common js imports should be left alone
        'common js default with named import':
            `import React, { Component } from './commonjsmodule'`,

        // convert this into a namespace import that leads to `testmodule/constants`
        'aliased namespace import':
            `import { thangs } from 'testmodule'`,

        // leaves glob imports alone
        'glob import':
            `import * as testmodule from 'testmodule'`,

        // make sure we can follow export-from
        'export-from in single line':
            `import { theInlineFirstFunc } from 'testmodule'`,

        // make sure it doesn't get confused by confusing exports
        'confusing naming':
            `import { FOO } from 'testmodule'`,
    },
});
