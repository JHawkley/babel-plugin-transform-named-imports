const $ = require('./constants');
const core = require('./core');

const setupState = core.setupState;
const ImportDeclaration = core.importDeclarationVisitor;

module.exports = () => ({
    name: $.pluginName,
    visitor: { ImportDeclaration },
    pre(file) {
        this.set($.pluginName, setupState(this, file));
    },
});
