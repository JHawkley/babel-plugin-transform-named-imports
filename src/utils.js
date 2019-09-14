/**
 * A generator that enumerates all dependencies in a dependencies-block.
 * 
 * @param {DependenciesBlock} depBlock
 * @returns {IterableIterator.<Dependency>}
 */
const enumerateDependencies = function* (depBlock) {
  for (const dep of depBlock.dependencies)
    yield dep;
  for (const variable of depBlock.variables)
    for (const dep of variable.dependencies)
      yield dep;
  for (const block of depBlock.blocks)
    yield* enumerateDependencies(block);
};

module.exports = {
  enumerateDependencies
};

/** @typedef {import("webpack/lib/DependenciesBlock")} DependenciesBlock */
/** @typedef {import("webpack/lib/Dependency")} Dependency */