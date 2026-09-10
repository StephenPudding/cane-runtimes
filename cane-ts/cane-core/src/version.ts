import type { RuntimeApiInfoV1 } from "./contracts.js";

export const RUNTIME_API_MAJOR_V1 = 1;
export const RUNTIME_API_MINOR_V1 = 3;
export const RUNTIME_API_PATCH_V1 = 0;
export const RUNTIME_API_WIRE_SCHEMA_V1 = "cane.runtime/v1";

/** Runtime API 1.2 ordered one-evaluation pose modifiers. */
export const FEATURE_TRANSIENT_POSE_MODIFIERS_V1 = 2 ** 37;
/** Runtime API 1.3 instance-local Skin/Attachment/image/Atlas overlays. */
export const FEATURE_RUNTIME_RESOURCES_V1 = 2 ** 38;
/** Runtime API 1.3 current-frame bounds and hit testing. */
export const FEATURE_RUNTIME_BOUNDS_V1 = 2 ** 39;
/** Runtime API 1.3 explicit host-motion handling for stateful Physics. */
export const FEATURE_PHYSICS_HOST_MOTION_V1 = 2 ** 40;
/** Runtime API 1.3 Core-authoritative final geometry modifiers. */
export const FEATURE_FINAL_GEOMETRY_MODIFIERS_V1 = 2 ** 41;
/** Bits 0..41 match the language-neutral Runtime API v1 registry. */
export const RUNTIME_API_FEATURES_V1 = 2 ** 42 - 1;

const RUNTIME_API_INFO_V1: RuntimeApiInfoV1 = Object.freeze({
  apiMajor: RUNTIME_API_MAJOR_V1,
  apiMinor: RUNTIME_API_MINOR_V1,
  apiPatch: RUNTIME_API_PATCH_V1,
  wireSchema: RUNTIME_API_WIRE_SCHEMA_V1,
  featureBits: RUNTIME_API_FEATURES_V1,
});

export function runtimeApiInfoV1(): RuntimeApiInfoV1 {
  return RUNTIME_API_INFO_V1;
}
