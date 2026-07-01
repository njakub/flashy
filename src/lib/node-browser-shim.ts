/**
 * Empty browser stub for Node.js built-ins that @xenova/transformers imports
 * but never actually uses in a browser context (they are only used for the
 * `RUNNING_LOCALLY` environment detection in env.js).
 *
 * Turbopack resolves `"browser": { "fs": false }` in package.json as
 * `undefined` rather than the empty-object stub that webpack would provide.
 * This stub gives `isEmpty(fs)` a real empty object so it returns `true`
 * without throwing `TypeError: can't convert undefined to object`.
 */
const empty = {};
export default empty;
