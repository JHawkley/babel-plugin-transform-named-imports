class NullImportSpecifierError extends Error {
    
    constructor() {
        super('got a nullish import specifier');
    }
    
}

module.exports = {
    NullImportSpecifierError
};