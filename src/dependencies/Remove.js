const ConstDependency = require("webpack/lib/dependencies/ConstDependency");

const $ = require("../constants");

class RemoveDependency extends ConstDependency {

  constructor(range) {
    super("", range);
  }

  static register(compiler) {
    compiler.hooks.compilation.tap($.webpackName, (compilation, params) => {
      compilation.dependencyFactories.set(
        RemoveDependency,
        params.normalModuleFactory
      );
  
      compilation.dependencyTemplates.set(
        RemoveDependency,
        new ConstDependency.Template()
      );
    });
  }

}

module.exports = RemoveDependency;