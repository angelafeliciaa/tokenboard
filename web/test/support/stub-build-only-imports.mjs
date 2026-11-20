// Imports that only resolve inside the Next build: `server-only` (throws outside a react-server bundle,
// not installed in web/) and CSS modules. Tests resolve them to stubs; a CSS module's class names are
// returned as their own key so assertions can target `styles.pg` as "pg". Registered via --import.
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
const EMPTY = "data:text/javascript,";
const CSS = "data:text/javascript," + encodeURIComponent("export default new Proxy({}, { get: (_, k) => String(k) });");
export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: EMPTY, shortCircuit: true };
  if (specifier.endsWith(".module.css")) return { url: CSS, shortCircuit: true };
  return next(specifier, context);
}`),
);
