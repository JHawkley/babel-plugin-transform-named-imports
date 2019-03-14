const types = require('babel-types');

const getSimpleType = node => {
    if (node.local.name === 'default') return 'default';
    if (types.isExportDefaultSpecifier(node)) return 'default';
    if (types.isExportSpecifier(node)) return 'named';
    return 'unknown';
};

const handleDefaultDeclaration = (exps, node) => {
    // only try to follow if the declaration is for an identifier;
    // any other kind of declaration will stop searching at the last
    // import, in this case
    if (!types.isIdentifier(node.declaration)) {
        return;
    }

    const localName = node.declaration.name;

    exps.push({
        name: localName,
        exportedName: 'default',
        searchName: localName,
        path: null,
        type: 'default',
    });
};

const handleOtherDeclaration = (exps, resolve, node) => {
    const specifiers = node.specifiers || [];
    const importPath = node.source ? resolve(node.source.value) : null;

    specifiers.forEach(specifier => {
        const type = getSimpleType(specifier);

        if (type !== 'unknown') {
            const localName = specifier.local.name;
            const exportedName
                = type === 'default' ? 'default'
                : specifier.exported ? specifier.exported.name
                : specifier.local.name;

            exps.push({
                name: localName,
                exportedName: (specifier.exported || specifier.local).name,
                searchName: localName,
                path: importPath,
                type: type,
            });
        }
    });
};

module.exports = (declarations, resolve) => {
    const exps = [];

    declarations.forEach(node => {
        if (types.isExportDefaultDeclaration(node)) {
            handleDefaultDeclaration(exps, node);
        }
        else {
            handleOtherDeclaration(exps, resolve, node);
        }
    });

    return exps;
};
