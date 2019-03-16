const debug = require('debug')('transform-named-imports');

// a little helper for working with Babel;
// can use either `@babel/core` via the `babel-bridge` or
// version 6 of `babel-core`

// Babel 7 can be forced to be used by setting the
// `FORCE_BABEL_SEVEN` environment variable to "true";
// useful for testing

function getBabel() {
    if (process.env.FORCE_BABEL_SEVEN === 'true') {
        return require('@babel/core');
    }

    return require('babel-core');
}

/**
 * Creates a function that can parse a file into a Babel AST.
 * @returns {function(string): *} A function that takes an absolute
 * path and returns a Babel AST.
 * @throws When no parser could be generated from the Node packages
 * installed.
 */
function makeParser() {
    const Babel = getBabel();

    // version 7 introduced the `parseSync` function
    if (typeof Babel.parseSync === 'function') {
        const fs = require('fs');

        return function babel7Parse(filePath) {
            try {
                return Babel.parseSync(fs.readFileSync(filePath, 'utf-8'), {
                    caller: {
                        name: 'transform-named-imports',
                        supportsStaticESM: true,
                    },
                    filename: filePath,
                    sourceType: 'module',
                });
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
            const result = Babel.transformFileSync(filePath, {
                sourceType: 'module',
                ast: true,
                code: false,
            });

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
    makeParser,
    types: getBabel().types,
};