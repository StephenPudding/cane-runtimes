export { runtimeCapabilitiesV1 } from "./capabilities.js";
export type * from "./contracts.js";
export { RuntimeDataV1 } from "./data.js";
export { decodeCanebV1 } from "./binary/caneb.js";
export type { DecodedCanebV1 } from "./binary/caneb.js";
export {
  RuntimeErrorCodeV1,
  RuntimeErrorV1,
  runtimeError,
} from "./errors.js";
export type {
  RuntimeErrorCodeNumberV1,
  RuntimeErrorJsonV1,
  RuntimeErrorNameV1,
} from "./errors.js";
export {
  NO_CONTRIBUTION_V1,
  quantizeSampleTimeV1,
  sampleContinuousArrayKeysV1,
  sampleContinuousKeysV1,
  sampleCurveValueV1,
  sampleDiscreteKeysV1,
  selectPropertyCurveV1,
  wrapDegreesV1,
} from "./animation/curves.js";
export {
  childWorldAffineV1,
  determinantV1,
  IDENTITY_AFFINE_V1,
  IDENTITY_ROOT_TRANSFORM_V1,
  localBoneAffineV1,
  multiplyAffineV1,
  regionLocalAffineV1,
  rootAffineV1,
  transformPointV1,
} from "./math/affine.js";
export { RuntimePlayerV1 } from "./player.js";
export { RuntimeBoundsV1 } from "./bounds.js";
export {
  EMPTY_GEOMETRY_MODIFIERS_V1,
  applyRuntimeGeometryModifiersV1,
  cloneRuntimeGeometryModifiersV1,
  createRuntimeGeometryModifierWorkspaceV1,
  validateRuntimeGeometryModifiersV1,
} from "./geometry-modifiers.js";
export type { RuntimeGeometryModifierWorkspaceV1 } from "./geometry-modifiers.js";
export {
  FEATURE_FINAL_GEOMETRY_MODIFIERS_V1,
  FEATURE_PHYSICS_HOST_MOTION_V1,
  FEATURE_RUNTIME_BOUNDS_V1,
  FEATURE_RUNTIME_RESOURCES_V1,
  FEATURE_TRANSIENT_POSE_MODIFIERS_V1,
  RUNTIME_API_FEATURES_V1,
  RUNTIME_API_MAJOR_V1,
  RUNTIME_API_MINOR_V1,
  RUNTIME_API_PATCH_V1,
  RUNTIME_API_WIRE_SCHEMA_V1,
  runtimeApiInfoV1,
} from "./version.js";
export { RuntimePoseModifierBufferV1 } from "./pose-modifier-buffer.js";
export { RuntimeGeometryModifierBufferV1 } from "./geometry-modifier-buffer.js";
export {
  RuntimeAttachmentFactoryV1,
  RuntimeResourceTransactionV1,
  RuntimeSkinBuilderV1,
  cloneRuntimeAttachmentV1,
  cloneRuntimeSkinV1,
} from "./runtime-resources.js";
export type {
  RuntimeBoundingBoxAttachmentCreateV1,
  RuntimeClippingAttachmentCreateV1,
  RuntimeMeshAttachmentCreateV1,
  RuntimePathAttachmentCreateV1,
  RuntimePointAttachmentCreateV1,
  RuntimeRegionAttachmentCreateV1,
  RuntimeSkinBuilderOptionsV1,
} from "./runtime-resources.js";
export {
  CaneBoneHandleV1,
  CaneConstraintHandleV1,
  CaneRuntimeControllerV1,
  CaneSlotHandleV1,
} from "./controller.js";
export type {
  CaneBoneReferenceV1,
  CaneConstraintReferenceV1,
  CaneSlotReferenceV1,
} from "./controller.js";
export {
  evaluateVertexAttachmentWorldV1,
  identityAffineForGeometryV1,
  resolveMeshDeformOwnerV1,
  resolveMeshSourceV1,
  resolveVertexAttachmentDeformOwnerIdV1,
  resolveVertexAttachmentSourceV1,
  vertexAttachmentPositionForWorldTargetV1,
  vertexAttachmentWeightedOffsetsForWorldTargetV1,
  vertexAttachmentWeightLocalPositionsForWorldTargetV1,
  vertexPositionsToWeightedOffsetsV1,
  weightedOffsetsAfterVertexPositionEditV1,
  weightedOffsetsToVertexPositionsV1,
} from "./geometry/vertices.js";
export { buildMeshRenderAttachmentV1 } from "./render/mesh.js";
export { buildRegionRenderAttachmentV1 } from "./render/region.js";
export {
  CLIP_EPSILON_V1,
  clipTexturedGeometryV1,
  createRuntimeClipContextV1,
} from "./render/clipping.js";
export type { RuntimeClipContextV1 } from "./render/clipping.js";
export {
  buildRuntimeBoneWorldsV1,
  createRuntimeConstraintSolveScratchV1,
  queryRuntimeMatchedTransformConstraintOffsetsV1,
  queryRuntimePathConstraintPositionForWorldTargetV1,
  queryRuntimePathConstraintPositionV1,
  solveRuntimeConstraintsV1,
} from "./constraints/solve.js";
export type {
  RuntimeConstraintSolveContextV1,
  RuntimeConstraintSolveResultV1,
  RuntimeConstraintSolveScratchV1,
} from "./constraints/solve.js";
export { composeFinalTintV1, decodeRuntimeColorV1, isRuntimeColorV1 } from "./render/tint.js";
export { normalizeWindingV1, runtimeWindingIndexRevisionV1 } from "./render/winding.js";
export {
  parseAtlasDocumentV1,
  parseRuntimeProjectV1,
  SUPPORTED_RUNTIME_FEATURES_V1,
  UNVERIFIED_RUNTIME_FEATURES_V1,
} from "./validation.js";
