const types = require('babel-types');

const getSimpleType = node => {
    const { imported } = node;

    if (imported && imported.name === 'default') return 'default';
    if (types.isImportDefaultSpecifier(node)) return 'default';
    if (types.isImportNamespaceSpecifier(node)) return 'namespace';
    if (types.isImportSpecifier(node)) return 'named';
    return 'unknown';
};

module.exports = (declarations, resolve) => {
    const imports = [];

    declarations.forEach(importNode => {
        const importPath = resolve(importNode.source.value);
        const specifiers = importNode.specifiers || [];

        specifiers.forEach(specifier => {
            const type = getSimpleType(specifier);

            if (type !== 'unknown') {
                const localName = specifier.local.name;
                const importedName
                    = type === 'default' ? 'default'
                    : specifier.imported ? specifier.imported.name
                    : specifier.local.name;

                imports.push({
                    name: localName,
                    importedName: importedName,
                    searchName: importedName,
                    path: importPath,
                    originalPath: importNode.source.value,
                    type: type,
                });
            }
        });
    });

    return imports;
};
