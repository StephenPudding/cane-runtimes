import type { RuntimeCapabilitiesV1 } from "./contracts.js";
import { deepFreeze } from "./internal.js";
import { SUPPORTED_RUNTIME_FEATURES_V1 } from "./validation.js";

const CAPABILITIES: RuntimeCapabilitiesV1 = deepFreeze<RuntimeCapabilitiesV1>({
  implementationName: "cane-typescript-runtime",
  implementationVersion: "0.1.0",
  runtimeFormat: { major: 1, minor: 0 },
  runtimeApi: { major: 1, minor: 3 },
  numericPrecision: "binary32",
  supportedRuntimeFeatures: [...SUPPORTED_RUNTIME_FEATURES_V1],
  limitations: [
    "decoded texture validation requires the host to supply a complete observed direct-image and atlas-page catalog",
    "PixiJS shaders and browser renderer behavior are adapter concerns and are not certified by the renderer-neutral Core conformance result",
    "matched performance parity with a licensed Spine runtime remains a separate benchmark claim",
  ],
  conformance: {
    suiteVersion: "1.8.0",
    manifestSha256: "b03eda20d50e550782c162bb9826c0340a8243fc03de0e42e50fed7eae690df9",
    status: "passed",
  },
});

export function runtimeCapabilitiesV1(): RuntimeCapabilitiesV1 {
  return CAPABILITIES;
}
