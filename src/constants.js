/** @enum {string} */
module.exports = Object.freeze({
    // common strings
    loaderName: 'resolve-imports-loader',
    pluginName: 'babel-plugin-resolve-imports',
    cachedAst: 'resolve-imports-loader:babel-ast',
    specLoaderQuery: 'resolve-imports-spec-loader',

    // declaration types
    export: 'export',
    import: 'import',

    // specifier types
    default: 'default',
    namespace: 'namespace',
    named: 'named',
    unknown: 'unknown',

    // pickling types
    specResult: 'specifier-result',
    resolvedPath: 'resolved-path',
    exportSpec: 'export-specifier',
    importSpec: 'import-specifier'
});