/**
 * Classic-browser bundle entry.
 *
 * The regular ESM package keeps Core as a package dependency. The optional
 * IIFE distribution exposes that same Core under `CanePixi.Core`, so a host
 * loading plain `<script>` tags does not need a second Cane script.
 */
export * from "./index.js";
export * as Core from "@cane-runtime/core";
