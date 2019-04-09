# resolve-imports-loader

[![MIT licensed](https://img.shields.io/badge/license-MIT-blue.svg)](https://raw.githubusercontent.com/JHawkley/resolve-imports-loader/master/LICENSE)
[![Build Status](https://scrutinizer-ci.com/g/JHawkley/resolve-imports-loader/badges/build.png?b=master)](https://scrutinizer-ci.com/g/JHawkley/resolve-imports-loader/build-status/master)
[![Code Coverage](https://scrutinizer-ci.com/g/JHawkley/resolve-imports-loader/badges/coverage.png?b=master)](https://scrutinizer-ci.com/g/JHawkley/resolve-imports-loader/?branch=master)

This loader attempts to transform named ES6 imports to the final, fully-resolved import:

```javascript
// from this
import { myFunc } from 'some-module';

// to this
import myFunc from './node_modules/some-module/myFunc.js';
```

The former causes `mymodule/index.js` to be imported, and therefor all other classes and methods to be imported as well.  Transforming the import before Webpack performs its tree-shaking has the potential to further reduce unnecessary bundling and improve module-concatenation optimizations.

## Installation
### Installing the Package
Install the package and its peer-dependency via Yarn or NPM:

```sh
yarn add -D @babel/core@7.x resolve-imports-loader
```

**--or--**

```sh
npm i -D @babel/core@7.x resolve-imports-loader
```

### Configure Webpack
This loader relies on an internal loader.  A pre-made rule for this loader is exposed by importing `resolve-imports-loader`.  It should be the first rule in the list.

```javascript
// webpack.config.js

module.exports = {
    module: {
        rules: [
            // Place this as the first rule.
            // This is required.
            require('resolve-imports-loader').specLoaderRule,

            // If you are using `babel-loader`, it
            // should be placed before the rule for
            // `resolve-imports-loader`.
            {
                test: /\.(js|jsx|mjs)$/i,
                exclude: /node_modules/,
                loader: 'babel-loader'
            },

            // This rule specifies which modules will
            // actually be transformed by this loader.
            {
                test: /\.(js|jsx|mjs)$/i,
                use: {
                    loader: 'resolve-imports-loader',
                    options: {
                        // Specify loader options here.
                    }
                }
            },
            
            // ...additional rules follow...
        ]
    }
}
```

It is generally best to only enable this loader on production builds, where payload size is important.

## Workings
1. Given a file that looks like this:

    ```javascript
    // src/user-code.js
    import { myFunc } from 'some-module';
    ```

2. For every import statement, resolve the full path to `my-module` and parse the file:

    ```javascript
    // node_modules/some-module/index.js
    import myFunc from './myFunc';
    export { myFunc };
    ```

3. Analyze the imports/exports in the resolved file and keep recursing until the file is found in which `myFunc` was declared.

4. Rewrite the original import to lead to the file in which `myFunc` was declared:

    ```javascript
    // src/user-code.js
    import myFunc from '../node_modules/some-module/myFunc.js';
    ```

## Options
* `ident: string` - Used to specify a name for an internal, shared context used by the loader.  If not provided, a default `ident` will be generated based on the options object provided.  Providing an `ident` can save a little bit of build time, since the loader will no longer need to hash the options object each time a module is processed by it.

* `syncMode: boolean` - Defaults to `false`.  If set to `true`, the loader will process the imports and exports of a module in a synchronous manner.  This is useful to help track the loader's path during debugging, but should not be necessary in normal use.

* `transformDefaultImports: boolean` - Defaults to `false`.  If set to `true`, the loader will traverse default imports and attempt to resolve them further.  Since it is rare that default exports are re-exported imports, this option can save a little bit of build time.  If you want to ensure that all possible imports are fully resolved, set this to `true`.

* `transformSideEffects: boolean` - Defaults to `false`.  If the loader encounters an import from a side-effecting module, it will normally stop there.  However, by setting this to `true`, you can make the loader continue to resolve beyond that export.  Any side-effecting module encountered will have a side-effecting import added to the module being transformed, IE: `import "side-effecting-module"`, to ensure those side-effects still execute.

* `babelConfig: Object | string` - Specify a Babel configuration to use when loading modules; can be either a [configuration object](https://babeljs.io/docs/en/options) or a path to a specific configuration to use.  This is rarely necessary, since Babel will load the appropriate configuration on its own based on the location of the file; this option is mostly intended for debugging and testing.  Setting this will prevent Babel from loading other configuration files from disk.

* `unsafeAstCaching: boolean` - Defaults to `false`.  Due to the nature of how the loader operates, the Babel AST is often parsed twice for each module loaded, once when resolving specifiers and again when transforming the file.  Setting this to `true` will have the `spec-loader` cache the AST onto the Webpack module instance so that it can be re-used by the `transform-loader`.  Both loaders *should* be working on the same source and therefore the same AST, but it is possible for loaders to interfere and change the execution order of loaders, thereby breaking this assumption.  Enabling this option can improve build-times, but be sure to test your application thoroughly before releasing it.

## FAQ
1. **Does this handle aliases?**
    Yes.

2. **Can I exclude certain paths?**
    Naturally, this is just a loader, so certain paths can be excluded by providing an `exclude` condition on the Webpack rule.

3. **Does it transform CommonJS or AMD imports?**
    No.  It currently only supports ES6+ modules, including modules using the new export extensions, like `export-from`.  For best results, check to see if your dependencies provide an ES6 version of their package.

5. **Is it safe to run on any code base?**
    It should be perfectly safe for any code base.  If you encounter any problems, be sure to report them as an issue.

6. **By how much will it decrease my bundle size?**
    This depends highly on how the modules are structured and how much of a module was actually utilized.  Webpack is already very good at determining what is and isn't used in a bundle, however it falters on namespace re-exports.  This loader has been seen to improve Webpack's handling of namespace re-exports.  I have also observed that it can increase the number of modules that can be safely concatenated through the `ModuleConcatenationPlugin`.

    On my own project, I saw only a 3% improvement on the final output, but your results will vary.

7. **Shouldn't this be a Webpack plugin instead?**
    Probably.  But, I am not yet familiar enough with Webpack's plugin system to implement it at this time.

## Debugging
Some more detailed logging is available when using the DEBUG environment variable:

```sh
DEBUG="resolve-imports-loader*" some-command-that-executes-webpack
```

## Thanks
This project is a fork of [`babel-plugin-transform-imports`](https://github.com/SectorLabs/babel-plugin-transform-named-imports), but heavily re-written to convert it into a Webpack loader.
