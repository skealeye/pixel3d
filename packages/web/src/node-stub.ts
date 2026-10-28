/**
 * Stand-in for the `node:` built-ins that core (decode.ts, manifold.ts) and manifold-3d import only on their Node
 * branch. Aliased in vite.config.ts so the browser bundle needs no externalised modules; never called in a browser.
 */
const nodeOnly = (): never => { throw new Error('pixel3d: a Node built-in was called in the browser'); };
export const readFile = nodeOnly;
export const createRequire = nodeOnly;
export const fileURLToPath = nodeOnly;
export const pathToFileURL = nodeOnly;
export default {};
