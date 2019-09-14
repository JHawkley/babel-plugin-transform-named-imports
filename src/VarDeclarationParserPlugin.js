const StackedSetMap = require("webpack/lib/util/StackedSetMap");

const $ = require("./constants");
const BadArgumentError = require("./errors/BadArgumentError");
const ParsedVarDeclarator = require("./dependencies/ParsedVarDeclarator");
const RemoveDependency = require("./dependencies/Remove");

const $$apply = Symbol("VarDeclarationParserPlugin::apply");

class VarDeclarationParserPlugin {

  /**
   * @param {Parser} parser
   * The Webpack parser instance.
   * @param {Object} options
   * The plugin's options object.
   * @param {boolean} [options.strictExportPresence = false]
   * Whether dependencies should follow a strict policy on the imported
   * export being detected on the module.
   * @param {boolean} [options.strictThisContextOnImports = false]
   * Whether dependencies should follow a strict policy on calling a method
   * of a Harmony module with the module object as its `this` context.
   */
  constructor(parser, options) {
    if (!parser) throw new BadArgumentError("parser");

    this.parser = parser;
    this.strictExportPresence = Boolean(options.strictExportPresence);
    this.strictThisContextOnImports = Boolean(options.strictThisContextOnImports);
    
    this[$$apply]();
  }

  /**
   * Applies the plugin to the hooks of the parser.
   */
  [$$apply]() {
    const { parser } = this;

    // There is no hook for entering and exiting a scope.
    // So, we must do some monkey-patching to keep track of things properly.
    const origInScope = parser.inScope.bind(parser);
    parser.inScope = (params, fn) => {
      const derefMap = this.getDerefMap();

      origInScope(params, () => {
        // Create a child for this scope.
        parser.scope.harmonyDerefs = derefMap.createChild();
        fn();
      });
    };

    parser.hooks.statement.tap(
      $.webpackName,
      this.visitVariableDeclaration.bind(this)
    );
  }

  /**
   * Applies the plugin to the hooks of the parser.
   *
   * @param {*} statement
   */
  visitVariableDeclaration(statement) {
    if (statement.type !== "VariableDeclaration") return void 0;

    const { parser } = this;

    // Spoof `state.current` to catch `addDependency` calls.
    // This indicates that is is unsafe to remove the declaration.
    const unsafeToRemove = this.spoofCurrent(() => {
      // Have the parser to walk the declaration for other plugins.
      parser.walkVariableDeclaration(statement);
    });

    const dependencies = this.walkVariableDeclarators(statement.declarations);
    const derefMap = this.getDerefMap();
    let fullyParsed = true;

    for (const dependency of dependencies) {
      if (!dependency) {
        // A `null` dependency indicates a declarator could not be parsed.
        // This prevents this declaration from being removed.
        fullyParsed = false;
        continue;
      }

      // Register the parsed identifiers into the dereference map.
      for (const { ident: { name }, source, path } of dependency.parsedIdents) {
        parser.scope.definitions.delete(name);
        parser.scope.renames.set(name, $.derefVar);
        derefMap.set(name, { source, path });
      }
    }

    if (fullyParsed && !unsafeToRemove) {
      // Remove this declaration; we discard the dependencies in this case.
      parser.current.addDependency(new RemoveDependency(statement.range));
    }
    else if (!unsafeToRemove) {
      // Remove the declarators that succeeded by adding the dependencies.
      for (const dependency of dependencies)
        if (dependency)
          parser.current.addDependency(dependency);
    }

    return true;
  }

  walkVariableDeclarators(declarations) {
    const results = [];

    let prevDeclarator = null;
    for (var curDeclarator of declarations) {
      const parsedIdents = this.visitVariableDeclarator(curDeclarator);
      if (parsedIdents) {
        // Adjust the range slightly; this removes new-lines and commas.
        const start = prevDeclarator ? prevDeclarator.range[1] + 1 : curDeclarator.range[0];
        const end = curDeclarator.range[1];

        // Create a dependency that will remove the declarator.
        results.push(new ParsedVarDeclarator(parsedIdents, [start, end]));
      }
      else {
        // A `null` dependency will indicates a declarator could not be removed.
        results.push(null);
      }

      prevDeclarator = curDeclarator;
    }

    return results;
  }

  visitVariableDeclarator(declarator) {
    const parsedInit = this.parseVariableInitializer(declarator.init);
    if (!parsedInit) return void 0;

    const importMap = this.getImportMap();
    const derefMap = this.getDerefMap();
    const { nameGiven, nameNow, path: initPath } = parsedInit;
    let initialPath, source;

    switch (nameNow) {
      case $.derefVar: {
        const { source: derefSource, path: derefPath } = derefMap.get(nameGiven);
        initialPath = [...derefPath, ...initPath];
        source = derefSource;
        break;
      }

      case $.importedVar: {
        const { source: impSource, id: impId } = importMap.get(nameGiven);
        initialPath = impId ? [impId, ...initPath] : initPath;
        source = impSource;
        break;
      }

      default: {
        return void 0;
      }
    }

    const results = [];

    for (const identData of this.enumeratePattern(declarator.id, initialPath)) {
      // An unsupported pattern was used if `identData` is missing.
      if (!identData) return void 0;

      // We got a direct reference if `identData.path` is empty.  This
      // case is technically already handled by the parser itself through
      // reassignment aliasing.
      if (identData.path.length === 0) continue;

      identData.source = source;
      results.push(identData);
    }
    
    return results;
  }

  *enumeratePattern(pattern, path) {
    if (!pattern) return;

		switch (pattern.type) {
			case "Identifier": {
        yield { ident: pattern, path: [...path] };
        break;
      }

			case "ObjectPattern": {
				for (const property of pattern.properties) {
          if (!property) continue;
    
          const parsedKey = this.parsePropertyKey(property);
          if (!parsedKey) yield null;
    
          path.push(parsedKey);
          yield* this.enumeratePattern(property.value, path);
          path.pop();
        }
        break;
      }

      default: {
        yield null;
        break;
      }
		}
  }

  /**
   * Applies the plugin to the hooks of the parser.
   *
   * @param {*} init
   * @param {Array.<string>} [path]
   * @returns {ParsedVariableInitializer | void}
   */
  parseVariableInitializer(init, path) {
    switch (true) {
      case !init:
      default: {
        return void 0;
      }

      case init.type === "Identifier": {
        const nameGiven = init.name;
        const nameNow = this.parser.scope.renames.get(nameGiven) || nameGiven;
        const finalPath = path ? path.reverse() : [];
        return { nameGiven, nameNow, path: finalPath };
      }

      case init.type === "MemberExpression" && init.computed: {
        path = path || [];
        const { object, property } = init;
        const evalProp = this.parser.evaluateExpression(property);

        switch (true) {
          case !evalProp:
          case !evalProp.string: {
            // Cannot handle this kind of computed property.
            return void 0;
          }

          default: {
            path.push(evalProp.string);
            return this.parseVariableInitializer(object, path);
          }
        }
      }

      case init.type === "MemberExpression" && !init.computed: {
        const { object, property } = init;
        path.push(property.name);
        return this.parseVariableInitializer(object, path);
      }
    }
  }

  parsePropertyKey(property) {
    switch (true) {
      case !property:
      case property.type !== "Property":
      case !property.key:
      default: {
        return void 0;
      }

      case !property.computed: {
        return property.key.name;
      }

      case property.computed: {
        const { key } = property;
        const evalKey = this.parser.evaluateExpression(key);

        switch (true) {
          case !evalKey:
          case !evalKey.string: {
            // Cannot handle this kind of computed property.
            return void 0;
          }

          default: {
            return evalKey.string;
          }
        }
      }
    }
  }

  /**
   * Gets the parser's current import dereference map.
   *
   * @returns {StackedTypedMap.<string, Object>}
   */
  getDerefMap() {
    const { scope } = this.parser, { harmonyDerefs = new StackedSetMap() } = scope;
    if (!scope.harmonyDerefs) scope.harmonyDerefs = harmonyDerefs;
    return harmonyDerefs;
  }

  /**
   * Gets the parser's current harmony import map.
   *
   * @returns {Map.<string, Object>}
   */
  getImportMap() {
    const { state } = this.parser, { harmonySpecifier = new Map() } = state;
    if (!state.harmonySpecifier) state.harmonyDerefs = harmonySpecifier;
    return harmonySpecifier;
  }

  spoofCurrent(fn) {
    let addedDependencies = false;

    // Create a spoof of `current`.
    const { parser } = this;
    const { current: oldCurrent } = parser.state;
    const spoofedCurrent = {};

    spoofedCurrent.addDependency = (dep) => {
      addedDependencies = true;
      return oldCurrent.addDependency(dep);
    };

    if (oldCurrent.addVariable) {
      spoofedCurrent.addVariable = (name, expression, dependencies) =>
        oldCurrent.addVariable(name, expression, dependencies);
    }

    if (oldCurrent.addBlock) {
      spoofedCurrent.addBlock = (block) =>
        oldCurrent.addBlock(block);
    }

    if (oldCurrent.hasDependencies) {
      spoofedCurrent.hasDependencies = (filter) =>
        oldCurrent.hasDependencies(filter);
    }

    parser.state.current = spoofedCurrent;

    try {
      // Execute the function in spoofed context.
      fn();
    }
    finally {
      // Restore the original `current`.
      parser.state.current = oldCurrent;
    }

    return addedDependencies;
  }

  /**
   * Registers this parser into Webpack.
   *
   * @static
   * @param {Compiler} compiler
   * The Webpack compiler.
   * @param {Object} options
   * The plugin's options object.
   */
  static register(compiler, options) {
    const tryHookIntoParser = (parser, { harmony: harmonyEnabled = true }) => {
      if (!harmonyEnabled) return;
      new VarDeclarationParserPlugin(parser, options);
    };

    compiler.hooks.compilation.tap($.webpackName, (compilation, params) => {
      const { normalModuleFactory } = params;

      normalModuleFactory.hooks.parser
        .for($.jsAuto)
        .tap($.webpackName, tryHookIntoParser);
      normalModuleFactory.hooks.parser
        .for($.jsEsm)
        .tap($.webpackName, tryHookIntoParser);
    });
  }

}

module.export = VarDeclarationParserPlugin;

/** @typedef {import("webpack/lib/Compiler")} Compiler */
/** @typedef {import("webpack/lib/Parser")} Parser */

/**
 * @template K, V
 * @typedef {Object} OverrideStackedSetMap
 * @prop {(item: K) => boolean} has
 * @prop {(item: K, value: V) => void} set
 * @prop {(item: K) => V} get
 * @prop {() => TStackedSetMap.<K, V>} createChild
 */

/**
 * @template K, V
 * @typedef {OverrideStackedSetMap.<K, V> & StackedSetMap} StackedTypedMap
 */

/**
 * @typedef {Object} ParsedVariableInitializer
 * @prop {string} nameGiven
 * @prop {string} nameNow
 * @prop {Array.<string>} path 
 */