/**
 * Imports a module through a specifier the bundler cannot resolve statically.
 *
 * Two packages are only ever reached on the local-development path: the
 * in-memory MongoDB used when MONGODB_URI is unset, and the local embedding
 * model used when EMBEDDINGS_PROVIDER resolves to "local". A plain
 * `await import("...")` with a literal string is still followed by dependency
 * tracers, so both would be pulled into a serverless bundle that never executes
 * them, adding hundreds of megabytes and blowing the function size limit.
 *
 * Passing the name through a variable defeats that tracing while leaving runtime
 * behaviour identical, since Node resolves the specifier normally when the
 * package is installed. Callers must handle the module being absent.
 */
export function importOptional<T = unknown>(specifier: string): Promise<T> {
  const name = specifier;
  return import(name) as Promise<T>;
}
