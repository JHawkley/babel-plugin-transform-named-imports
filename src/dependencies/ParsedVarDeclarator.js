const ConstDependency = require("webpack/lib/dependencies/ConstDependency");

const $ = require("../constants");

class ParsedVarDeclaratorDependency extends ConstDependency {

  constructor(parsedIdents, range) {
    super("", range);
    this.parsedIdents = parsedIdents;
  }

  static register(compiler) {
    compiler.hooks.compilation.tap($.webpackName, (compilation, params) => {
      compilation.dependencyFactories.set(
        ParsedVarDeclaratorDependency,
        params.normalModuleFactory
      );
  
      compilation.dependencyTemplates.set(
        ParsedVarDeclaratorDependency,
        new ConstDependency.Template()
      );
    });
  }

}

module.exports = ParsedVarDeclaratorDependency;