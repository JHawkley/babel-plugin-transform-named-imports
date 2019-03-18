const debug = require('debug')('transform-named-imports');
const compareVersions = require('compare-versions');

// a little helper for working with Babel;
// can use either `@babel/core` via the `babel-bridge` or
// version 6 of `babel-core`

// Babel 7 can be forced to be used by setting the
// `FORCE_BABEL_SEVEN` environment variable to "true";
// useful for testing

/** @typedef {import('./specResolver').ResolveAstFn} ResolveAstFn */

/**
 * Gets the `babel-core` module.  Be mindful of the version returned,
 * as it could be for either Babel 6 or Babel 7.
 * @returns The `babel-core` module.
 */
const getBabel = (() => {
    const needSeven = process.env.FORCE_BABEL_SEVEN === 'true';
    let babel = null;

    return function getBabel() {
        if (babel) return babel;

        babel = require(needSeven ? '@babel/core' : 'babel-core');
        return babel;
    }
})();

/**
 * Checks that the version of Babel in use meets a minimum version.
 * @param {string} neededVersion A semver string.
 * @returns {boolean} Whether Babel meets or exceeds the needed version.
 */
const checkVersion = neededVersion =>
    compareVersions(getBabel().version, neededVersion) >= 0;

/**
 * Creates a function that can parse a file into a Babel AST.
 * @param {?Object} babelConfig The Babel configuration to use.
 * @returns {ResolveAstFn} A function that tries to resolve an AST.
 * @throws When no parser could be generated from the Node packages
 * installed.
 */
const makeParser = babelConfig => {
    const Babel = getBabel();

    // version 7 introduced the `parseSync` function
    if (typeof Babel.parseSync === 'function') {
        const fs = require('fs');

        return function babel7Parse(filePath) {
            try {
                const options = Object.assign({}, babelConfig, {
                    caller: {
                        name: 'transform-named-imports',
                        supportsStaticESM: true,
                    },
                    filename: filePath,
                    sourceType: 'module',
                });

                return Babel.parseSync(fs.readFileSync(filePath, 'utf-8'), options);
            } catch (error) {
                debug('BABEL 7 PARSER ERROR', error);
                return null;
            }
        };
    }

    // fall-back on `transformFileSync` in AST-only mode;
    // this should not perform any transformations
    return function babel6Parse(filePath) {
        try {
            const options = Object.assign({}, babelConfig, {
                filename: filePath,
                sourceType: 'module',
                ast: true,
                code: false,
            });

            const result = Babel.transformFileSync(filePath, options);
            return result && result.ast ? result.ast : null;
        }
        catch (error) {
            debug('BABEL 6 PARSER ERROR', error);
            return null;
        }
    };
};

module.exports = {
    getBabel,
    checkVersion,
    makeParser,
    types: getBabel().types,
};