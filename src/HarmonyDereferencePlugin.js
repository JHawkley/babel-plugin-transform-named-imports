const ImportDereferenceDependency = require("./dependencies/HarmonyImportDereference");
const ParsedVarDeclaratorDependency = require("./dependencies/ParsedVarDeclarator");
const RemoveDependency = require("./dependencies/Remove");
const VarDeclarationParserPlugin = require("./VarDeclarationParserPlugin");

const $$givenOptions = Symbol("HarmonyDereferencePlugin::givenOptions");

class HarmonyDereferencePlugin {

  /**
   * @param {Object} [options]
   * The plugin's options object.
   * @param {boolean} [options.strictExportPresence]
   * Whether dependencies should follow a strict policy on the imported
   * export being detected on the module.
   * @param {boolean} [options.strictThisContextOnImports]
   * Whether dependencies should follow a strict policy on calling a method
   * of a Harmony module with the module object as its `this` context.
   */
  constructor(options) {
    this[$$givenOptions] = options;
    this.options = options || {};
  }

  /**
   * Applies this plugin to Webpack.
   *
   * @param {Compiler} compiler
   */
  apply(compiler) {
    // Slip some of the module options in as defaults for any options
    // that were not provided to this plugin explicitly.  These are the
    // same options that `HarmonyModulesPlugin` initializes from.
    const { strictExportPresence, strictThisContextOnImports } = compiler.options.modules;
    this.options = Object.assign(
      { strictExportPresence, strictThisContextOnImports },
      this[$$givenOptions]
    );

    // Register plugin classes.
    ImportDereferenceDependency.register(compiler, this.options);
    ParsedVarDeclaratorDependency.register(compiler, this.options);
    RemoveDependency.register(compiler, this.options);
  
    VarDeclarationParserPlugin.register(compiler, this.options);
  }

}

module.exports = HarmonyDereferencePlugin;

/** @typedef {import("webpack/lib/Compiler")} Compiler */