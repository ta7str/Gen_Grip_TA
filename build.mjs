// Bundles the app and the CAD worker into ./js, and copies the WebAssembly binary.
// Run:  npm install && npm run build
import { build } from "esbuild";
import { copyFileSync } from "node:fs";

const common = { bundle: true, format: "esm", minify: true, target: "es2022", logLevel: "info" };

await build({ ...common, entryPoints: ["src/main.js"], outfile: "js/app.js" });
await build({
  ...common,
  entryPoints: ["src/cad-worker.js"],
  outfile: "js/cad-worker.js",
  platform: "browser",
  external: ["fs", "path", "url", "module", "worker_threads", "node:*"],
});
copyFileSync("node_modules/replicad-opencascadejs/dist/replicad_single.wasm", "js/replicad_single.wasm");
console.log("built -> js/app.js, js/cad-worker.js, js/replicad_single.wasm");
