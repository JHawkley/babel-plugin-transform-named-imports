const ospath = require('path');
const babel = require('@babel/core');

const $ = require('./constants');
const { AstParsingError } = require('./errors');

/** @typedef {import('./options').LoaderOptions} LoaderOptions */
/** @typedef BabelAST A Babel-compatible AST. */

const resolveConfig = (path, config) => {
    if (!config) return null;

    if (typeof config === 'string') {
        if (ospath.basename(config) === '.babelrc') {
            const babelrcRoot = ospath.relative(path, config);
            return {
                configFile: false,
                babelrc: true,
                babelrcRoots: [ospath.join(babelrcRoot, '**/*')]
            };
        }

        return {
            configFile: config,
            babelrc: false
        };
    }

    return config;
};

class AstParser {

    /**
     * Creates an instance of {@link AstParser}.
     * 
     * @param {LoaderOptions} options
     * The loader options.
     */
    constructor({babelConfig}) {
        this.babelConfig = babelConfig;
    }

    /**
     * Parses source code into a Babel AST.
     * 
     * @async
     * @param {string} path
     * The path of the file being parsed.
     * @param {string} source
     * The source code of the file.
     * @returns {BabelAST}
     * A Babel AST.
     * @throws {AstParsingError}
     * When the AST fails to parse.
     */
    async parse(path, source) {
        try {
            const config = Object.assign({}, resolveConfig(path, this.babelConfig), {
                caller: {
                    name: $.pluginName,
                    supportsStaticESM: true
                },
                filename: path,
                sourceType: 'unambiguous'
            });
        
            return await babel.parseAsync(source, config);
        }
        catch (error) {
            throw new AstParsingError(path, source, error);
        }
    }

}

module.exports = AstParser;