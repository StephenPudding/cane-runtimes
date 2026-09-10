import terser from "@rollup/plugin-terser";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const coreEntry = resolve(packageDirectory, "../cane-core/dist/index.js");
const packageManifest = JSON.parse(readFileSync(resolve(packageDirectory, "package.json"), "utf8"));

export default {
  input: resolve(packageDirectory, "dist/browser-entry.js"),
  onwarn(warning, warn) {
    if (warning.code === "UNRESOLVED_IMPORT") {
      throw new Error(`Unresolved browser-bundle import: ${warning.source}`);
    }
    warn(warning);
  },
  output: [{
    file: resolve(packageDirectory, "dist/esm/cane-layaair-3.4.1.js"),
    format: "es",
    banner: `/*! @cane-runtime/layaair-3.4.1 v${packageManifest.version} | LayaAir 3.4.1 is an external peer */`,
    generatedCode: { constBindings: true, objectShorthand: true },
    sourcemap: false,
  }, {
    file: resolve(packageDirectory, "dist/iife/cane-layaair-3.4.1.min.js"),
    format: "iife",
    name: "CaneLaya",
    exports: "named",
    extend: true,
    intro: [
      "if (typeof globalThis.Laya !== 'object' && typeof globalThis.Laya !== 'function') {",
      "  throw new Error('@cane-runtime/layaair-3.4.1 requires LayaAir 3.4.1 to be loaded first as globalThis.Laya.');",
      "}",
    ].join("\n"),
    banner: `/*! @cane-runtime/layaair-3.4.1 v${packageManifest.version} | LayaAir 3.4.1 is an external peer */`,
    generatedCode: { constBindings: true, objectShorthand: true },
    sourcemap: false,
  }],
  plugins: [
    {
      name: "cane-workspace-core",
      resolveId(id) {
        return id === "@cane-runtime/core" ? coreEntry : null;
      },
    },
    terser({
      compress: { passes: 2 },
      format: { comments: /^!/ },
      mangle: true,
    }),
  ],
};
