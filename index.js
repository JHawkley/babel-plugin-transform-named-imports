// TODO: Export the final plugin here.

// TODO: Revise `package.json`.

// TODO: Redo the readme.

// TODO: Add tests.

// TODO: Add configuration for different optimizations:
//
// * `namedImports` - Opt in/out of aggressive dereferencing of named
//   imports, IE: when the `id` of an "imported var" is present.
// * `varDeclarations` - Opt in/out of dereferencing variable declarations
//   and destructuring of "imported var" and "deref imported var".
// * `memberAccess` - Opt in/out of dereferencing simple member access
//   expressions of "imported var" and "deref imported var".
// * `cumulative` - Opt in/out of dereferencing a "deref imported var"
//   further; when enabled, accessing or destructuring a member of a
//   previously deref'd import will add that member to the deref path.

// TODO: Split utility methods of the parser plugin into a base class.
// We'll need additional parser plugins, and many of these methods
// are applicable to many of them.