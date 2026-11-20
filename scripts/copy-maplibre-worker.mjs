// MapLibre GL v6 loads its web worker from a separate module next to the main
// bundle. Bundlers rename and move the main file, so we serve the worker from
// /public and point MapLibre at it with setWorkerUrl().
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = dirname(require.resolve("maplibre-gl/package.json"));
const outDir = join(root, "public", "vendor");

mkdirSync(outDir, { recursive: true });
copyFileSync(join(pkgDir, "dist", "maplibre-gl-worker.mjs"), join(outDir, "maplibre-gl-worker.mjs"));
console.log("Copied maplibre-gl-worker.mjs to public/vendor");
