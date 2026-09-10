import terser from "@rollup/plugin-terser";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const coreEntry = resolve(packageDirectory, "../cane-core/dist/index.js");
const packageManifest = JSON.parse(
  readFileSync(resolve(packageDirectory, "package.json"), "utf8"),
);

export default {
  input: resolve(packageDirectory, "dist/browser-entry.js"),
  external: (id) => id === "pixi.js",
  onwarn(warning, warn) {
    if (warning.code === "UNRESOLVED_IMPORT") {
      throw new Error(`Unresolved browser-bundle import: ${warning.source}`);
    }
    warn(warning);
  },
  output: {
    file: resolve(packageDirectory, "dist/iife/cane-pixi-v8.min.js"),
    format: "iife",
    name: "CanePixi",
    exports: "named",
    extend: true,
    globals: {
      "pixi.js": "globalThis.PIXI",
    },
    intro: [
      "if (typeof globalThis.PIXI !== 'object' || globalThis.PIXI === null) {",
      "  throw new Error('@cane-runtime/pixi-v8 requires PixiJS to be loaded first as globalThis.PIXI.');",
      "}",
    ].join("\n"),
    banner: `/*! @cane-runtime/pixi-v8 v${packageManifest.version} | PixiJS is an external dependency */`,
    generatedCode: {
      constBindings: true,
      objectShorthand: true,
    },
    sourcemap: false,
  },
  plugins: [
    {
      name: "cane-workspace-core",
      resolveId(id) {
        return id === "@cane-runtime/core" ? coreEntry : null;
      },
    },
    terser({
      compress: {
        passes: 2,
      },
      format: {
        comments: /^!/,
      },
      mangle: true,
    }),
  ],
};
