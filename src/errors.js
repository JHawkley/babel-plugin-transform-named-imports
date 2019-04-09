class NullImportSpecifierError extends Error {
    
    constructor() {
        super('got a nullish import specifier');
    }
    
}

class SpecifierResolutionError extends Error {

    /**
     * Creates an instance of {@link SpecifierResolutionError}.
     * 
     * @param {string} request
     * The original request that generated the error.
     * @param {Error} error
     * The inner-error.
     */
    constructor(request, error) {
        super([
            `failed to resolve specifiers for \`${request}\``,
            `inner error's message: ${error.message}`
        ].join('; '));
        this.request = request;
        this.innerError = error;
    }

}

class AstParsingError extends Error {

    /**
     * Creates an instance of {@link AstParsingError}.
     * 
     * @param {string} path
     * The path of the file that failed to parse.
     * @param {string} source
     * The source code that failed to parse.
     * @param {Error} error
     * The inner-error.
     */
    constructor(path, source, error) {
        super([
            `failed to parse the source-code of \`${path}\``,
            `inner error's message: ${error.message}`
        ].join('; '));
        this.path = path;
        this.source = source;
        this.innerError = error;
    }
    
}

module.exports = {
    NullImportSpecifierError,
    SpecifierResolutionError,
    AstParsingError
};