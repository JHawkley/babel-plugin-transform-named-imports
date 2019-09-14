const ImportDependency = require("webpack/lib/dependencies/HarmonyImportSpecifierDependency");
const ExportSpecifierDependency = require("webpack/lib/dependencies/HarmonyExportSpecifierDependency");
const ExportExpressionDependency = require("webpack/lib/dependencies/HarmonyExportExpressionDependency");
const ExportImportedDependency = require("webpack/lib/dependencies/HarmonyExportImportedSpecifierDependency");
const Module = require("webpack/lib/Module");

const $ = require("../constants");
const { enumerateDependencies } = require("../utils");
const BadArgumentError = require("../errors/BadArgumentError");

const $$givenRefPath = Symbol("HarmonyImportDereferenceDependency::givenRefPath");
const $$optimize = Symbol("HarmonyImportDereferenceDependency::optimize");
const $$id = Symbol("HarmonyImportDereferenceDependency::id");
const $$module = Symbol("HarmonyImportDereferenceDependency::module");

const defaultOptions = {
  call: false,
  callArgs: void 0,
  shorthand: false,
  namespaceObjectAsContext: false
};

/**
 * Controls the behavior of the `id` and `module` properties.
 * While optimizing, these properties report their redirected value.
 * @type {boolean}
 */
let optimizing = false;

/**
 * A harmony dependency that dereferences re-exports to their original
 * export, when possible.  If no dereferences are possible, then this
 * dependency acts identically to `HarmonyImportSpecifierDependency`.
 * 
 * Created as a result of destructuring a harmony import with a variable
 * declaration statement or accessing an import via a member expression.
 *
 * @class HarmonyImportDereferenceDependency
 * @extends {ImportDependency}
 */
class HarmonyImportDereferenceDependency extends ImportDependency {

  /**
   * @param {string} request
   * The request for the external module which has been dereferenced.
   * @param {Module} originModule
   * The module that originated the request.
   * @param {number} sourceOrder
   * The order in which the requested module was imported in the original source.
   * @param {Object} parserScope
   * The current harmony scope of the parser.
   * @param {Array.<string>} refPath
   * An array of names that were followed during dereferencing that lead
   * to the creation of the identifier being replaced.
   * @param {string} name
   * The name by which the import was referenced by in the original source.
   * @param {SourceRange} range
   * The range in the source where the dereference occurred.
   * @param {Object} [options]
   * The context-sensitive options provided when generating the dependency.
   * @param {boolean} [options.call = false]
   * Whether the dependency is being called.
   * @param {Array.<any>} [options.callArgs]
   * An array of expression nodes describing each argument of a call.
   * @param {SourceLoc} [options.loc]
   * The location in the source where the dereference occurred.
   * @param {boolean} [options.shorthand = false]
   * Whether the dependency is being used in a shorthand context.
   * This applies to object literal initialization, where the name of
   * the property is also a local variable: `{ foo }` vs `{ foo: foo }`
   * @param {boolean} [options.namespaceObjectAsContext = false]
   * Whether the object imported should be used as the context for a
   * method-style call.
   * @param {boolean} [options.strictExportPresence = false]
   * Whether this dependency should follow a strict policy on the imported
   * export being detected on the module.
   */
  constructor(request, originModule, sourceOrder, parserScope, refPath, name, range, options = {}) {
    if (!refPath)
      throw new BadArgumentError("refPath");
    if (refPath.length < 1)
      throw new BadArgumentError("refPath.length", refPath.length);
    if (typeof name !== "string")
      throw new BadArgumentError("name");
    if (!Array.isArray(range) || range.length !== 2)
      throw new BadArgumentError("range");

    // Extract the current ref-path to initialize this instance.
    const [id, ...restRefPath] = refPath;

    super(
      request, originModule, sourceOrder, parserScope,
      id, name, range, Boolean(options.strictExportPresence)
    );

    /**
     * A cache of the remainder of the given ref-path.
     * @type {Array.<string>}
     */
    this[$$givenRefPath] = restRefPath;

    /**
     * The remaining path needing to be dereferenced after `this.id`.
     * @type {Array.<string>}
     */
    this.refPath = restRefPath;

    /**
     * Whether this was a direct import; always false for this type
     * of dependency.
     * @type {false}
     */
    this.directImport = false;

    // Assign remaining options to the instance.
    delete options.strictExportPresence;
    Object.assign(this, defaultOptions, options);
  }

  get id() { return optimizing ? this._id : this[$$id]; }
  set id(value) { this[$$id] = value; }

  get module() { return optimizing ? this._module : this[$$module]; }
  set module(value) { this[$$module] = value; }

  get type() { return "dereferenced harmony import"; }

  /**
   * Optimizes this dependency by dereferencing as many parts of
   * `refPath` as possible.  Any portion of the path that could not
   * be dereferenced will be resolved at runtime via a member expression.
   */
  optimizeDereferences() {
    let count = 0;
    const { _module: preModule } = this;
    while(this[$$optimize]()) count += 1;

    const { _module: postModule } = this;
    if (preModule === postModule) return;

    // An optimization occurred.
    // Update reasons for the module's inclusion.
    const newPreReasons = [];
    for (const reason of preModule.reasons) {
      if (reason.dependency === this) {
        const { module: m, explanation } = reason;
        const plurality = count > 1 ? "modules" : "module";
        const expParts = [explanation, `(dereferenced ${count} ${plurality})`];
        postModule.addReason(m, this, expParts.filter(Boolean).join(" "));
        continue;
      }
      newPreReasons.push(reason);
    }

    preModule.reasons = newPreReasons;
  }
  
  updateHash(hash) {
    super.updateHash(hash);
    
    // Include the ref-path in the hash.
    const { _module: m, refPath } = this;
    hash.update(String(m && JSON.stringify(refPath)));
	}

	disconnect() {
    super.disconnect();
    
    // Reset the ref-path from cache.
    this.refPath = this[$$givenRefPath];
  }
  
  /**
   * Performs one optimization step when called.
   *
   * @returns {boolean}
   * Whether optimization should continue.
   */
  [$$optimize]() {
    const { _module: curModule, _id: curId, refPath } = this;
    if (!curModule || !(curModule instanceof Module)) return false;
    if (!curModule.factoryMeta.sideEffectFree) return false;
    if (refPath.length === 0) return false;
    if (!curModule.isProvided(refPath[0])) return false;

    const [nextRef, ...restPath] = refPath;

    depLoop: for (const dep of curModule.dependencies) {
      switch (true) {
        case dep instanceof ExportSpecifierDependency: {
          if (nextRef === dep.name) return false;
          continue;
        }

        case dep instanceof ExportExpressionDependency: {
          if (nextRef === $.default) return false;
          continue;
        }

        case dep instanceof ExportImportedDependency: {
          const mode = dep.getMode(true);
          switch (mode.type) {
            case "reexport-named-default": {
              if (mode.name !== nextRef) continue;

              this.redirectedId = $.default;
              this.redirectedModule = mode.module;
              break depLoop;
            }

            case "reexport-namespace-object": {
              if (mode.name !== nextRef) continue;

              // The ID does not change in this case.
              // `nextRef` is simply consumed.
              this.redirectedModule = mode.module;
              break depLoop;
            }

            case "safe-reexport":
            case "checked-reexport": {
              const exportedAs = mode.map.get(nextRef);
              if (!exportedAs) continue;

              this.redirectedId = exportedAs;
              this.redirectedModule = mode.module;
              break depLoop;
            }

            default: continue;
          }
        }
      }
    }

    switch (true) {
      case this.redirectedModule !== curModule:
      case this.redirectedId !== curId: {
        // A redirection happened; consume the dereference.
        this.refPath = restPath;
        return true;
      }

      default: {
        // Stop optimizing if no dereference occurred.
        return false;
      }
    }
  }

  static get Template() { return HarmonyImportDereferenceDependencyTemplate; }

  /**
   * Registers this dependency into Webpack.
   *
   * @static
   * @param {Compiler} compiler
   * The Webpack compiler instance.
   */
  static register(compiler) {
    const setOptimizing = () => {
      // Locks the dependencies.
      // While locked, the `id` and `module` properties provide their
      // redirectable `_id` and `_module` counterparts instead. Without this,
      // `SideEffectsFlagPlugin` may revert the optimization, since it assumes
      // no optimization before-hand and uses the raw properties directly.
      optimizing = true;
    };

    const doOptimize = (modules) => {
      // Carries out optimization of this type of dependency.
      for (const m of modules)
        for (const dep of enumerateDependencies(m))
          if (dep instanceof HarmonyImportDereferenceDependency)
            dep.optimizeDereferences();
    };

    const clearOptimizing = () => {
      // Clear the `optimizing` flag to restore normal behavior.
      optimizing = false;
    };

    compiler.hooks.compilation.tap($.webpackName, (compilation, params) => {
      // Register the dependency.
      compilation.dependencyFactories.set(
        HarmonyImportDereferenceDependency,
        params.normalModuleFactory
      );
  
      compilation.dependencyTemplates.set(
        HarmonyImportDereferenceDependency,
        new HarmonyImportDereferenceDependencyTemplate()
      );
  
      // Add dependency specific hooks.
      compilation.hooks.seal.tap($.webpackName, setOptimizing);
      compilation.hooks.optimizeDependencies.tap($.webpackName, doOptimize);
      compilation.hooks.afterOptimizeDependencies.tap($.webpackName, clearOptimizing);
    });

    // Just in case a failure occurs...
    compiler.hooks.failed.tap($.webpackName, clearOptimizing);
  }

}

/**
 * Handles rendering of this dependency type.
 * 
 * Produces identical results to the `HarmonyImportSpecifierDependency`
 * template, except that it will add on member expressions for any
 * portion of the ref-path that could not be dereferenced.
 *
 * @class HarmonyImportDereferenceDependencyTemplate
 * @extends {ImportDependency.Template}
 */
class HarmonyImportDereferenceDependencyTemplate extends ImportDependency.Template {

  getContent(dep, runtime) {
    const content = super.getContent(dep, runtime);
    const { refPath } = dep;

    // Return if no further dereferencing is needed.
    if (refPath.length === 0) return content;

    const remPath = refPath.map(p => `[${JSON.stringify(p)}]`).join("");
    return `${content}${remPath}`;
  }

}

module.exports = HarmonyImportDereferenceDependency;

/** @typedef {import("webpack/lib/Compiler")} Compiler */

/** @typedef {[number, number]} SourceRange */

/**
 * @typedef {Object} SourceLoc
 * @prop {Object} start
 * @prop {number} start.line
 * @prop {number} start.column
 * @prop {Object} end
 * @prop {number} end.line
 * @prop {number} end.column
 */