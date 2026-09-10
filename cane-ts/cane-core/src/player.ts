import type {
  AffineV1,
  RootTransformV1,
  RuntimeAttachmentGeometryV1,
  RuntimeAttachmentV1,
  RuntimeAuthoringOverrideOperationV1,
  RuntimeAuthoringOverridesV1,
  RuntimeAuthoringSnapshotV1,
  RuntimeAfterConstraintsListenerV1,
  RuntimeBeforeConstraintsListenerV1,
  RuntimeBoneLocalAdditiveV1,
  RuntimeBoneLocalPatchV1,
  RuntimeBoneLocalStateV1,
  RuntimeBoneLocalV1,
  RuntimeBoneFrameV1,
  RuntimeBoundsOptionsV1,
  RuntimeBoundsSnapshotV1,
  RuntimeConstraintParametersV1,
  RuntimeConstraintOverrideV1,
  RuntimeConstraintStateV1,
  RuntimeConstraintV1,
  RuntimeClippingGeometryV1,
  RuntimeExecutionModeV1,
  RuntimeEvaluationStatsV1,
  RuntimeEventListenerV1,
  RuntimeFrameV1,
  RuntimeGeometryModifiersV1,
  RuntimeGeometryModifierStatsV1,
  RuntimeEventV1,
  RuntimeLifecycleEventKindV1,
  RuntimeMixV1,
  RuntimePhysicsEnvironmentV1,
  RuntimePhysicsHostMotionModeV1,
  RuntimePathConstraintPositionV1,
  RuntimePointV1,
  RuntimePointAttachmentPoseV1,
  RuntimePlayerOptionsV1,
  RuntimePoseModifierOperationV1,
  RuntimePoseModifiersV1,
  RuntimePoseEditorV1,
  RuntimeQueueEmptyAnimationV1,
  RuntimeQueueAnimationV1,
  RuntimeQueuedEntryOptionsV1,
  RuntimeQueuedTrackEntryV1,
  RuntimeResourceChangesV1,
  RuntimeResourceSnapshotV1,
  RuntimeRenderAttachmentV1,
  RuntimeRenderPacketV1,
  RuntimeRegionAttachmentPoseV1,
  RuntimeRootTransformOptionsV1,
  RuntimeSamplingV1,
  RuntimeSeekV1,
  RuntimeSetAnimationV1,
  RuntimeSetEmptyAnimationV1,
  RuntimeSetTrackAnimationRangeV1,
  RuntimeSetTrackEndV1,
  RuntimeSetTrackMixDurationV1,
  RuntimeStepV1,
  RuntimeSlotV1,
  RuntimeSlotStateV1,
  RuntimeSlotTintOverrideV1,
  RuntimeTrackOptionsV1,
  RuntimeTrackStateV1,
  RuntimeTransformConstraintOffsetsV1,
  RuntimeVertexAttachmentSourceGeometryV1,
  RuntimeVertexDeformInputV1,
  RuntimeVertexDeformV1,
  RuntimeVertexDeformOverrideV1,
  RuntimeVertexDeformSpaceV1,
  RuntimeVertexWorldTargetV1,
} from "./contracts.js";
import { RuntimeBoundsV1 } from "./bounds.js";
import type { RuntimeDataV1 } from "./data.js";
import {
  RuntimeAnimationStateV1,
  type RuntimePrimaryClockV1,
} from "./animation/state.js";
import {
  createRuntimeSamplingScratchV1,
  sampleAnimationLayersV1,
  type RuntimeAnimationLayerV1,
  type RuntimeSampledPoseV1,
  type RuntimeSamplingScratchV1,
} from "./animation/sampling.js";
import { quantizeSampleTimeV1 } from "./animation/curves.js";
import { RuntimeErrorV1 } from "./errors.js";
import { asRuntimeError, deepFreeze } from "./internal.js";
import {
  IDENTITY_ROOT_TRANSFORM_V1,
  rootAffineV1,
  transformPointV1,
} from "./math/affine.js";
import {
  F32_DEGREES_TO_RADIANS,
  F32_RADIANS_TO_DEGREES,
  f32,
  f32MatrixAxisLength,
  finiteF32,
  f32Add,
  f32Mul,
} from "./math/f32.js";
import {
  buildPreparedRegionRenderAttachmentV1,
  prepareRegionSourceGeometryV1,
  type RegionRenderInputV1,
  type RuntimeRegionSourceGeometryV1,
} from "./render/region.js";
import {
  buildPreparedMeshRenderAttachmentV1,
  prepareMeshTextureSourceV1,
  type MeshRenderInputV1,
  type RuntimeMeshTextureSourceV1,
} from "./render/mesh.js";
import {
  composeFinalTintV1,
  runtimeSlotTintBytesV1,
  setRuntimeSlotTintBytesV1,
} from "./render/tint.js";
import {
  createRuntimeClipContextV1,
  type RuntimeClipContextV1,
} from "./render/clipping.js";
import {
  createRuntimeConstraintSolveScratchV1,
  queryRuntimeMatchedTransformConstraintOffsetsV1,
  queryRuntimePathConstraintPositionForWorldTargetV1,
  queryRuntimePathConstraintPositionV1,
  solveRuntimeConstraintsV1,
  type RuntimeConstraintSolveContextV1,
  type RuntimeConstraintSolveScratchV1,
} from "./constraints/solve.js";
import {
  DEFAULT_PHYSICS_ENVIRONMENT_V1,
  MAX_PHYSICS_SUBSTEPS_PER_OPERATION_V1,
  RuntimePhysicsStateStoreV1,
  type RuntimePhysicsClockStepV1,
  type RuntimePhysicsClockStepScratchV1,
  type RuntimePhysicsBudgetV1,
} from "./constraints/physics.js";
import {
  evaluateVertexAttachmentWorldV1,
  resolveVertexAttachmentDeformOwnerIdV1,
  resolveVertexAttachmentSourceV1,
  vertexAttachmentPositionForWorldTargetV1,
  vertexAttachmentWeightedOffsetsForWorldTargetV1,
  vertexAttachmentWeightLocalPositionsForWorldTargetV1,
  weightedOffsetsToVertexPositionsV1,
  weightedOffsetsAfterVertexPositionEditV1,
  vertexPositionsToWeightedOffsetsV1,
} from "./geometry/vertices.js";
import {
  cloneRuntimeResourceStateV1,
  createRuntimeResourceStateV1,
  runtimeResourceSnapshotV1,
  runtimeResourceStateEmptyV1,
  stageRuntimeResourceChangesV1,
  type RuntimeResourceStateV1,
} from "./runtime-resources.js";
import {
  applyRuntimeGeometryModifiersV1,
  cloneRuntimeGeometryModifiersV1,
  createRuntimeGeometryModifierWorkspaceV1,
  EMPTY_GEOMETRY_MODIFIERS_V1,
  validateRuntimeGeometryModifiersV1,
  type RuntimeGeometryModifierWorkspaceV1,
} from "./geometry-modifiers.js";

const AUTHORED_SAMPLING: RuntimeSamplingV1 = Object.freeze({ mode: "authored" });
const EMPTY_RUNTIME_EVENTS_V1: RuntimeFrameV1["events"] = Object.freeze([] as RuntimeEventV1[]);
const EMPTY_POSE_MODIFIERS_V1: RuntimePoseModifiersV1 = Object.freeze({
  operations: Object.freeze([] as RuntimePoseModifierOperationV1[]),
});
const MAX_REPLAY_STEPS = 1_000_000;
const MAX_REPLAY_EVENTS = 1_000_000;
const MAX_POSE_MODIFIER_OPERATIONS_V1 = 1_000_000;
const PHYSICS_RESET_TIMES_CACHE = new WeakMap<object, readonly number[]>();
const HOST_VERTEX_DEFORM_ORDER_CACHE = new WeakMap<
  object,
  readonly (readonly [string, RuntimeVertexDeformOverrideV1])[]
>();
const HOST_SLOT_TINT_ENCODING_CACHE = new WeakMap<
  object,
  { readonly light: string; readonly dark: string | null }
>();

interface RuntimeEvaluationSnapshotV1 {
  readonly pose: RuntimeSampledPoseV1;
  readonly worldByBoneId: ReadonlyMap<string, AffineV1>;
  readonly geometryModifierStats: RuntimeGeometryModifierStatsV1;
}

type MutableRuntimeEvaluationSnapshotV1 = {
  -readonly [Property in keyof RuntimeEvaluationSnapshotV1]: RuntimeEvaluationSnapshotV1[Property]
};

interface RuntimeHostOverridesV1 {
  readonly boneLocals: ReadonlyMap<string, RuntimeBoneLocalV1>;
  readonly regionPoses: ReadonlyMap<string, RuntimeRegionAttachmentPoseV1>;
  readonly drawOrder: readonly string[] | null;
  readonly vertexDeforms: ReadonlyMap<string, RuntimeVertexDeformOverrideV1>;
  readonly slotAttachments: ReadonlyMap<string, string | null>;
  readonly slotTints: ReadonlyMap<string, RuntimeSlotTintOverrideV1>;
  readonly constraints: ReadonlyMap<string, RuntimeConstraintOverrideV1>;
}

interface MutableRuntimeHostOverridesV1 {
  readonly boneLocals: Map<string, RuntimeBoneLocalV1>;
  readonly regionPoses: Map<string, RuntimeRegionAttachmentPoseV1>;
  drawOrder: string[] | null;
  readonly vertexDeforms: Map<string, RuntimeVertexDeformOverrideV1>;
  readonly slotAttachments: Map<string, string | null>;
  readonly slotTints: Map<string, RuntimeSlotTintOverrideV1>;
  readonly constraints: Map<string, RuntimeConstraintOverrideV1>;
}

type MutableRuntimeBoneFrameV1 = { -readonly [Property in keyof RuntimeBoneFrameV1]: RuntimeBoneFrameV1[Property] };
type MutableRuntimeBoneV1 = { -readonly [Property in keyof RuntimeSampledPoseV1["bones"][number]]: RuntimeSampledPoseV1["bones"][number][Property] };
type MutableDistributiveV1<Value> = Value extends unknown
  ? { -readonly [Property in keyof Value]: Value[Property] }
  : never;
type MutableRuntimeConstraintV1 = MutableDistributiveV1<RuntimeConstraintV1>;
interface MutableRuntimeSampledDeformV1 {
  weighted: boolean;
  readonly values: number[];
}
type MutableRuntimeEvaluationStatsV1 = { -readonly [Property in keyof RuntimeEvaluationStatsV1]: RuntimeEvaluationStatsV1[Property] };
type MutableRuntimeRenderPacketV1 = {
  -readonly [Property in keyof RuntimeRenderPacketV1]: RuntimeRenderPacketV1[Property]
};
type MutableRuntimeFrameV1 = { -readonly [Property in keyof RuntimeFrameV1]: RuntimeFrameV1[Property] };
type MutableRegionRenderInputV1 = {
  -readonly [Property in keyof RegionRenderInputV1]: RegionRenderInputV1[Property]
} & { preparedSource: RuntimeRegionSourceGeometryV1 };
type MutableMeshRenderInputV1 = {
  -readonly [Property in keyof MeshRenderInputV1]: MeshRenderInputV1[Property]
} & { preparedTextureSource: RuntimeMeshTextureSourceV1 };
type MutableRuntimeConstraintSolveContextV1 = {
  -readonly [Property in keyof RuntimeConstraintSolveContextV1]: RuntimeConstraintSolveContextV1[Property]
};

interface RuntimePerformanceWorkspaceV1 {
  readonly samplingScratch: RuntimeSamplingScratchV1;
  readonly constraintScratch: RuntimeConstraintSolveScratchV1;
  readonly rootAffineScratch: MutableDistributiveV1<AffineV1>;
  readonly slotByIdScratch: Map<string, RuntimeSlotV1>;
  boneProjectionLinearCache: Float32Array;
  frame: MutableRuntimeFrameV1 | null;
  evaluationSnapshot: MutableRuntimeEvaluationSnapshotV1 | null;
  readonly renderAttachmentPool: Map<string, RuntimeRenderAttachmentV1>;
  readonly regionRenderInputPool: Map<string, MutableRegionRenderInputV1>;
  readonly meshRenderInputPool: Map<string, MutableMeshRenderInputV1>;
  readonly hostDeformPool: Map<string, MutableRuntimeSampledDeformV1>;
  constraintContextScratch: MutableRuntimeConstraintSolveContextV1 | null;
  readonly geometryModifierWorkspace: RuntimeGeometryModifierWorkspaceV1;
}

interface RuntimeHookRecordV1<Listener> {
  readonly listener: Listener;
  active: boolean;
  pendingRemoval: boolean;
}

interface RuntimeEventHookRecordV1 extends RuntimeHookRecordV1<RuntimeEventListenerV1> {
  readonly kind: RuntimeLifecycleEventKindV1 | null;
}

class RuntimePoseEditorImplV1 implements RuntimePoseEditorV1 {
  #data: RuntimeDataV1 | null = null;
  #pose: RuntimeSampledPoseV1 | null = null;
  #lookup: RuntimePoseLookupV1 | null = null;

  activate(data: RuntimeDataV1, pose: RuntimeSampledPoseV1): void {
    this.#data = data;
    this.#pose = pose;
    this.#lookup = runtimePoseLookupV1(data);
  }

  deactivate(): void {
    this.#data = null;
    this.#pose = null;
    this.#lookup = null;
  }

  queryBone(boneId: string): RuntimeBoneLocalV1 {
    this.#requireActive("queryBone");
    const pose = this.#pose as RuntimeSampledPoseV1;
    const lookup = this.#lookup as RuntimePoseLookupV1;
    const bone = mutablePoseBoneV1(pose, lookup, boneId, "beforeConstraints");
    return {
      x: bone.x,
      y: bone.y,
      rotationDegrees: bone.rotation,
      shearXDegrees: bone.shearX,
      shearYDegrees: bone.shearY,
      scaleX: bone.scaleX,
      scaleY: bone.scaleY,
    };
  }

  writeBone(boneId: string, output: {
    x: number;
    y: number;
    rotationDegrees: number;
    shearXDegrees: number;
    shearYDegrees: number;
    scaleX: number;
    scaleY: number;
  }): boolean {
    this.#requireActive("writeBone");
    const pose = this.#pose as RuntimeSampledPoseV1;
    const lookup = this.#lookup as RuntimePoseLookupV1;
    const index = lookup.boneIndexById.get(boneId);
    const bone = index === undefined ? undefined : pose.bones[index];
    if (bone === undefined) return false;
    output.x = bone.x;
    output.y = bone.y;
    output.rotationDegrees = bone.rotation;
    output.shearXDegrees = bone.shearX;
    output.shearYDegrees = bone.shearY;
    output.scaleX = bone.scaleX;
    output.scaleY = bone.scaleY;
    return true;
  }

  replaceBoneLocal(boneId: string, local: RuntimeBoneLocalV1): void {
    this.#requireActive("replaceBoneLocal");
    const pose = this.#pose as RuntimeSampledPoseV1;
    const lookup = this.#lookup as RuntimePoseLookupV1;
    requirePoseTargetV1(boneId, lookup.boneIndexById, "bone", "beforeConstraints", "boneId");
    if (local === null || typeof local !== "object") {
      throw new RuntimeErrorV1("invalidArgument", "beforeConstraints", "local must be an object.", {
        field: "local",
        entityId: boneId,
      });
    }
    for (const [input, , field] of BONE_REPLACE_FIELDS_V1) {
      validateModifierFiniteV1(local[input], "beforeConstraints", null, field);
    }
    const bone = mutablePoseBoneV1(pose, lookup, boneId, "beforeConstraints");
    for (const [input, output] of BONE_REPLACE_FIELDS_V1) bone[output] = f32(local[input]);
  }

  patchBoneLocal(boneId: string, patch: RuntimeBoneLocalPatchV1): void {
    this.#requireActive("patchBoneLocal");
    const pose = this.#pose as RuntimeSampledPoseV1;
    const lookup = this.#lookup as RuntimePoseLookupV1;
    requirePoseTargetV1(boneId, lookup.boneIndexById, "bone", "beforeConstraints", "boneId");
    if (patch === null || typeof patch !== "object") {
      throw new RuntimeErrorV1("invalidArgument", "beforeConstraints", "patch must be an object.", {
        field: "patch",
        entityId: boneId,
      });
    }
    for (const [input, , field] of BONE_PATCH_FIELDS_V1) {
      const value = patch[input];
      if (value !== undefined && value !== null) validateModifierFiniteV1(value, "beforeConstraints", null, field);
    }
    const bone = mutablePoseBoneV1(pose, lookup, boneId, "beforeConstraints");
    for (const [input, output] of BONE_PATCH_FIELDS_V1) {
      const value = patch[input];
      if (value !== undefined && value !== null) bone[output] = f32(value);
    }
  }

  addBoneLocal(boneId: string, delta: RuntimeBoneLocalAdditiveV1): void {
    this.#requireActive("addBoneLocal");
    const pose = this.#pose as RuntimeSampledPoseV1;
    const lookup = this.#lookup as RuntimePoseLookupV1;
    requirePoseTargetV1(boneId, lookup.boneIndexById, "bone", "beforeConstraints", "boneId");
    if (delta === null || typeof delta !== "object") {
      throw new RuntimeErrorV1("invalidArgument", "beforeConstraints", "delta must be an object.", {
        field: "delta",
        entityId: boneId,
      });
    }
    const bone = mutablePoseBoneV1(pose, lookup, boneId, "beforeConstraints");
    for (const [input, output, field] of BONE_ADDITIVE_FIELDS_V1) {
      const value = delta[input];
      if (value === undefined || value === null) continue;
      const finite = validateModifierFiniteV1(value, "beforeConstraints", null, field);
      const result = f32Add(bone[output], finite);
      if (!Number.isFinite(result)) {
        throw new RuntimeErrorV1("nonFinite", "beforeConstraints", `${input} produced a non-finite binary32 result.`, {
          field,
          entityId: boneId,
        });
      }
    }
    for (const [input, output] of BONE_ADDITIVE_FIELDS_V1) {
      const value = delta[input];
      if (value !== undefined && value !== null) bone[output] = f32Add(bone[output], value);
    }
  }

  patchConstraint(constraintId: string, parameters: RuntimeConstraintOverrideV1): void {
    this.#requireActive("patchConstraint");
    const data = this.#data as RuntimeDataV1;
    const pose = this.#pose as RuntimeSampledPoseV1;
    const lookup = this.#lookup as RuntimePoseLookupV1;
    const index = requirePoseTargetV1(
      constraintId,
      lookup.constraintIndexById,
      "constraint",
      "beforeConstraints",
      "constraintId",
    );
    const setup = data.document.constraints[index];
    const sampled = pose.constraints[index];
    if (setup === undefined || sampled === undefined) {
      throw new RuntimeErrorV1("internal", "beforeConstraints", "Validated constraint is unavailable.", {
        entityId: constraintId,
      });
    }
    validateConstraintModifierV1(setup, parameters, "beforeConstraints", null);
    applyConstraintOverrideInPlaceV1(sampled, parameters);
  }

  setConstraintTarget(constraintId: string, x: number, y: number): void {
    const index = this.#constraintIndex(constraintId, "setConstraintTarget");
    const setup = (this.#data as RuntimeDataV1).document.constraints[index];
    const sampled = (this.#pose as RuntimeSampledPoseV1).constraints[index];
    if (setup === undefined || sampled === undefined) {
      throw new RuntimeErrorV1("internal", "beforeConstraints", "Validated constraint is unavailable.", {
        entityId: constraintId,
      });
    }
    if (setup.type !== "ik" || sampled.type !== "ik") {
      throw new RuntimeErrorV1("invalidArgument", "beforeConstraints", "Constraint override kind does not match the target.", {
        field: "parameters.type",
        entityId: constraintId,
      });
    }
    // Validate both channels before mutating the sampled pose so one editor
    // operation is atomic even before the enclosing evaluation rollback.
    const targetX = overrideFinite(x, "beforeConstraints", "parameters.target.x");
    const targetY = overrideFinite(y, "beforeConstraints", "parameters.target.y");
    const target = sampled.target as { x: number; y: number };
    target.x = targetX;
    target.y = targetY;
    (sampled as MutableDistributiveV1<typeof sampled>).targetBoneId = null;
  }

  setConstraintMix(constraintId: string, mix: number): void {
    const index = this.#constraintIndex(constraintId, "setConstraintMix");
    const setup = (this.#data as RuntimeDataV1).document.constraints[index];
    const sampled = (this.#pose as RuntimeSampledPoseV1).constraints[index];
    if (setup === undefined || sampled === undefined || setup.type !== sampled.type) {
      throw new RuntimeErrorV1("internal", "beforeConstraints", "Validated constraint is unavailable.", {
        entityId: constraintId,
      });
    }
    const normalized = setup.type === "transform" || setup.type === "slider"
      ? overrideFinite(mix, "beforeConstraints", "parameters.mix")
      : overrideUnit(mix, "beforeConstraints", "parameters.mix");
    const mutable = sampled as MutableRuntimeConstraintV1;
    switch (mutable.type) {
      case "ik": mutable.mix = normalized; return;
      case "transform":
        mutable.mixRotate = normalized;
        mutable.mixX = normalized;
        mutable.mixY = normalized;
        mutable.mixScaleX = normalized;
        mutable.mixScaleY = normalized;
        mutable.mixShearY = normalized;
        return;
      case "path":
        mutable.mixRotate = normalized;
        mutable.mixX = normalized;
        mutable.mixY = normalized;
        return;
      case "physics": mutable.mix = normalized; return;
      case "slider": mutable.mix = normalized;
    }
  }

  #constraintIndex(constraintId: string, operation: string): number {
    this.#requireActive(operation);
    return requirePoseTargetV1(
      constraintId,
      (this.#lookup as RuntimePoseLookupV1).constraintIndexById,
      "constraint",
      "beforeConstraints",
      "constraintId",
    );
  }

  #requireActive(operation: string): void {
    if (this.#data === null || this.#pose === null || this.#lookup === null) {
      throw new RuntimeErrorV1("invalidState", operation, "Pose editor is valid only inside beforeConstraints.");
    }
  }
}

export class RuntimePlayerV1 {
  #sourceData: RuntimeDataV1;
  #data: RuntimeDataV1;
  #runtimeResources: RuntimeResourceStateV1;
  #geometryModifiers: RuntimeGeometryModifiersV1;
  readonly #executionMode: RuntimeExecutionModeV1;
  #animationState: RuntimeAnimationStateV1;
  #sampleOriginState: RuntimeAnimationStateV1;
  #timeSeconds = 0;
  #sequence = 0;
  #rootTransform: RootTransformV1 = IDENTITY_ROOT_TRANSFORM_V1;
  #currentFrame: RuntimeFrameV1 | null = null;
  #currentPose: RuntimeSampledPoseV1 | null = null;
  #currentWorldByBoneId: ReadonlyMap<string, AffineV1> | null = null;
  readonly #evaluationSnapshots = new WeakMap<RuntimeFrameV1, RuntimeEvaluationSnapshotV1>();
  #hostOverrides: RuntimeHostOverridesV1 = emptyHostOverridesV1();
  #pendingEvents: RuntimeEventV1[] = [];
  #activeSkinIds: string[];
  #sampleOriginSkinIds: string[];
  #physicsStates: RuntimePhysicsStateStoreV1;
  #performancePhysicsStates: [RuntimePhysicsStateStoreV1, RuntimePhysicsStateStoreV1];
  #physicsEnvironment: RuntimePhysicsEnvironmentV1 = DEFAULT_PHYSICS_ENVIRONMENT_V1;
  #performanceAnimationStates: [RuntimeAnimationStateV1, RuntimeAnimationStateV1];
  #performanceWorkspaces: [RuntimePerformanceWorkspaceV1, RuntimePerformanceWorkspaceV1];
  #performanceWorkspaceIndex = -1;
  readonly #physicsBudgetScratch: RuntimePhysicsBudgetV1 = {
    remaining: MAX_PHYSICS_SUBSTEPS_PER_OPERATION_V1,
  };
  readonly #physicsClockInputScratch: RuntimePrimaryClockV1 = {
    animationId: null,
    trackTime: 0,
    duration: 0,
    looping: false,
  };
  readonly #physicsClockStepScratch: RuntimePhysicsClockStepScratchV1 = {
    animationId: null,
    trackTime: 0,
    duration: 0,
    looping: false,
    from: null,
    delta: 0,
    discontinuity: false,
  };
  readonly #evaluationStatsScratch: MutableRuntimeEvaluationStatsV1 = {
    animationSamples: 0,
    constraintGeometrySolves: 0,
    framesPublished: 0,
  };
  readonly #lastEvaluationStatsValue: MutableRuntimeEvaluationStatsV1 = {
    animationSamples: 0,
    constraintGeometrySolves: 0,
    framesPublished: 0,
  };
  readonly #lastGeometryModifierStatsValue: {
    -readonly [Property in keyof RuntimeGeometryModifierStatsV1]: RuntimeGeometryModifierStatsV1[Property]
  } = {
    persistentOperations: 0,
    transientOperations: 0,
    attachmentVisits: 0,
    vertexWrites: 0,
    uvWrites: 0,
    tintWrites: 0,
  };
  #evaluationStatsSequence = -1;
  readonly #poseEditor = new RuntimePoseEditorImplV1();
  readonly #beforeConstraintHooks: RuntimeHookRecordV1<RuntimeBeforeConstraintsListenerV1>[] = [];
  readonly #afterConstraintHooks: RuntimeHookRecordV1<RuntimeAfterConstraintsListenerV1>[] = [];
  readonly #eventHooks: RuntimeEventHookRecordV1[] = [];
  #hookPhase: "beforeConstraints" | "afterConstraints" | "events" | null = null;
  #dispatchingHookRecords: object | null = null;

  constructor(data: RuntimeDataV1, options: RuntimePlayerOptionsV1 = {}) {
    const executionMode = options.executionMode ?? "strict";
    if (executionMode !== "strict" && executionMode !== "performance") {
      throw new RuntimeErrorV1("invalidArgument", "createPlayer", "Unknown Runtime execution mode.", {
        field: "executionMode",
      });
    }
    this.#sourceData = data;
    this.#runtimeResources = createRuntimeResourceStateV1(options.runtimeResources ?? null);
    this.#data = runtimeResourceStateEmptyV1(this.#runtimeResources)
      ? data
      : data.withRuntimeResources(runtimeResourceSnapshotV1(this.#runtimeResources));
    const geometryModifiers = options.geometryModifiers ?? EMPTY_GEOMETRY_MODIFIERS_V1;
    validateRuntimeGeometryModifiersV1(this.#data, geometryModifiers, "createPlayer");
    this.#geometryModifiers = geometryModifiers === EMPTY_GEOMETRY_MODIFIERS_V1
      ? EMPTY_GEOMETRY_MODIFIERS_V1
      : cloneRuntimeGeometryModifiersV1(geometryModifiers);
    this.#executionMode = executionMode;
    // Animation state identity follows the player's effective immutable data
    // view, including instance-local runtime resources.  Binding the retained
    // performance states to `data` (the shared source view) made the first
    // frame after a runtime-resource transaction fail when the reconciled live
    // state was correctly bound to `this.#data`.
    this.#performanceAnimationStates = [
      new RuntimeAnimationStateV1(this.#data),
      new RuntimeAnimationStateV1(this.#data),
    ];
    this.#animationState = this.#performanceAnimationStates[0];
    this.#sampleOriginState = new RuntimeAnimationStateV1(this.#data);
    this.#performancePhysicsStates = [new RuntimePhysicsStateStoreV1(), new RuntimePhysicsStateStoreV1()];
    this.#physicsStates = this.#performancePhysicsStates[0];
    this.#performanceWorkspaces = [createPerformanceWorkspaceV1(), createPerformanceWorkspaceV1()];
    const defaultSkin = this.#data.document.skins[0];
    this.#activeSkinIds = defaultSkin === undefined ? [] : [defaultSkin.id];
    this.#sampleOriginSkinIds = [...this.#activeSkinIds];
    const physics = this.#physicsForEvaluation();
    const frame = this.#evaluate(
      this.#animationState,
      1,
      AUTHORED_SAMPLING,
      EMPTY_RUNTIME_EVENTS_V1,
      0,
      this.#activeSkinIds,
      physics,
      null,
      this.#physicsBudgetForEvaluation(),
    );
    this.#physicsStates = physics;
    this.#sequence = 1;
    this.#commitEvaluatedFrame(frame);
  }

  get data(): RuntimeDataV1 {
    return this.#data;
  }

  /** Shared immutable input before this player's instance-local resource overlay. */
  get sourceData(): RuntimeDataV1 {
    return this.#sourceData;
  }

  get project(): RuntimeDataV1 {
    return this.#data;
  }

  /** Owned snapshot of runtime-only images, atlases, attachments, and skins. */
  queryRuntimeResources(): RuntimeResourceSnapshotV1 {
    return runtimeResourceSnapshotV1(this.#runtimeResources);
  }

  /** Atomically applies ordered changes and publishes exactly one revalidated frame. */
  applyRuntimeResources(changes: RuntimeResourceChangesV1): RuntimeFrameV1 {
    const operation = "applyRuntimeResources";
    this.#requireNextSequence(operation);
    try {
      const nextResources = stageRuntimeResourceChangesV1(this.#runtimeResources, changes, operation);
      return this.#replaceRuntimeResources(nextResources, operation);
    } catch (error) {
      throw remapRuntimeErrorV1(error, operation, "Runtime resource transaction failed.");
    }
  }

  clearRuntimeResources(): RuntimeFrameV1 {
    const operation = "clearRuntimeResources";
    this.#requireNextSequence(operation);
    try {
      return this.#replaceRuntimeResources(createRuntimeResourceStateV1(), operation);
    } catch (error) {
      throw remapRuntimeErrorV1(error, operation, "Runtime resource clear failed.");
    }
  }

  get executionMode(): RuntimeExecutionModeV1 {
    return this.#executionMode;
  }

  get timeSeconds(): number {
    return this.#timeSeconds;
  }

  get currentFrame(): RuntimeFrameV1 {
    if (this.#currentFrame === null) {
      throw new RuntimeErrorV1("invalidState", "queryFrame", "No published frame is available.");
    }
    return this.#currentFrame;
  }

  get frame(): RuntimeFrameV1 {
    return this.currentFrame;
  }

  get rootTransform(): RootTransformV1 {
    return this.#rootTransform;
  }

  /** Diagnostic counts for the operation that published the current frame. */
  get lastEvaluationStats(): RuntimeEvaluationStatsV1 {
    return { ...this.#lastEvaluationStatsValue };
  }

  /** Diagnostic counts for final-geometry effects on the current frame. */
  get lastGeometryModifierStats(): RuntimeGeometryModifierStatsV1 {
    return { ...this.#lastGeometryModifierStatsValue };
  }

  /** Ordered immutable persistent final-geometry effects for this instance. */
  get geometryModifiers(): RuntimeGeometryModifiersV1 {
    return this.#geometryModifiers;
  }

  /** Atomically replaces persistent final-geometry effects and publishes one frame. */
  setGeometryModifiers(modifiers: RuntimeGeometryModifiersV1): RuntimeFrameV1 {
    const operation = "setGeometryModifiers";
    this.#requireNextSequence(operation);
    try {
      validateRuntimeGeometryModifiersV1(this.#data, modifiers, operation);
      const next = modifiers.operations.length === 0
        ? EMPTY_GEOMETRY_MODIFIERS_V1
        : cloneRuntimeGeometryModifiersV1(modifiers);
      const physics = this.#physicsForEvaluation();
      const frame = this.#evaluate(
        this.#animationState,
        this.#sequence + 1,
        AUTHORED_SAMPLING,
        EMPTY_RUNTIME_EVENTS_V1,
        this.#timeSeconds,
        this.#activeSkinIds,
        physics,
        null,
        this.#physicsBudgetForEvaluation(),
        this.#physicsEnvironment,
        this.#rootTransform,
        this.#hostOverrides,
        EMPTY_POSE_MODIFIERS_V1,
        operation,
        true,
        next,
        EMPTY_GEOMETRY_MODIFIERS_V1,
      );
      this.#geometryModifiers = next;
      this.#physicsStates = physics;
      this.#sequence += 1;
      this.#commitEvaluatedFrame(frame);
      return frame;
    } catch (error) {
      throw remapRuntimeErrorV1(error, operation, "Persistent geometry modifier update failed.");
    }
  }

  clearGeometryModifiers(): RuntimeFrameV1 {
    return this.setGeometryModifiers(EMPTY_GEOMETRY_MODIFIERS_V1);
  }

  /** Registers an animation-after, constraint-before procedural pose hook. */
  beforeConstraints(listener: RuntimeBeforeConstraintsListenerV1): () => void {
    return this.#registerHook(this.#beforeConstraintHooks, listener, "beforeConstraints");
  }

  /** Registers a read-only observer of the fully solved candidate frame. */
  afterConstraints(listener: RuntimeAfterConstraintsListenerV1): () => void {
    return this.#registerHook(this.#afterConstraintHooks, listener, "afterConstraints");
  }

  /** Registers for all committed lifecycle and authored user events. */
  onEvent(listener: RuntimeEventListenerV1): () => void;
  /** Registers for one event kind while retaining a narrowed listener type. */
  onEvent<Kind extends RuntimeLifecycleEventKindV1>(
    kind: Kind,
    listener: RuntimeEventListenerV1<Kind>,
  ): () => void;
  onEvent<Kind extends RuntimeLifecycleEventKindV1>(
    kindOrListener: Kind | RuntimeEventListenerV1,
    filteredListener?: RuntimeEventListenerV1<Kind>,
  ): () => void {
    const kind = typeof kindOrListener === "string" ? kindOrListener : null;
    const listener = typeof kindOrListener === "function" ? kindOrListener : filteredListener;
    if (listener === undefined || typeof listener !== "function") {
      throw new RuntimeErrorV1("invalidArgument", "onEvent", "listener must be a function.", {
        field: "listener",
      });
    }
    if (kind !== null && !isRuntimeEventKindV1(kind)) {
      throw new RuntimeErrorV1("invalidArgument", "onEvent", "Unknown Runtime event kind.", {
        field: "kind",
      });
    }
    const record: RuntimeEventHookRecordV1 = {
      kind,
      listener: listener as RuntimeEventListenerV1,
      active: true,
      pendingRemoval: false,
    };
    this.#eventHooks.push(record);
    return () => this.#removeHookRecord(this.#eventHooks, record);
  }

  #registerHook<Listener>(
    records: RuntimeHookRecordV1<Listener>[],
    listener: Listener,
    operation: string,
  ): () => void {
    if (typeof listener !== "function") {
      throw new RuntimeErrorV1("invalidArgument", operation, "listener must be a function.", { field: "listener" });
    }
    const record: RuntimeHookRecordV1<Listener> = { listener, active: true, pendingRemoval: false };
    records.push(record);
    return () => this.#removeHookRecord(records, record);
  }

  #removeHookRecord<Listener>(
    records: RuntimeHookRecordV1<Listener>[],
    record: RuntimeHookRecordV1<Listener>,
  ): void {
    if (!record.active || record.pendingRemoval) return;
    if (this.#dispatchingHookRecords === records) {
      // A removal during this list's dispatch becomes visible only after the
      // current snapshot has finished, so later callbacks are not skipped.
      record.pendingRemoval = true;
      return;
    }
    record.active = false;
    compactHooksV1(records);
  }

  setRootTransform(
    root: RootTransformV1,
    options: RuntimeRootTransformOptionsV1 = {},
  ): RuntimeFrameV1 {
    const next = normalizeRootTransform(root);
    const rootOptions = normalizeRootTransformOptionsV1(this.#data, options);
    this.#requireNextSequence("setRootTransform");
    try {
      const physics = this.#physicsForEvaluation();
      physics.applyHostMotion(
        this.#rootTransform,
        next,
        rootOptions.physicsMode,
        rootOptions.constraintId ?? undefined,
      );
      const frame = this.#evaluate(
        this.#animationState,
        this.#sequence + 1,
        AUTHORED_SAMPLING,
        EMPTY_RUNTIME_EVENTS_V1,
        this.#timeSeconds,
        this.#activeSkinIds,
        physics,
        null,
        this.#physicsBudgetForEvaluation(),
        this.#physicsEnvironment,
        next,
      );
      this.#rootTransform = deepFreeze(next);
      this.#physicsStates = physics;
      this.#sequence += 1;
      this.#commitEvaluatedFrame(frame);
      return frame;
    } catch (error) {
      throw remapRuntimeErrorV1(error, "setRootTransform", "Root transform update failed.");
    }
  }

  setRootPosition(
    x: number,
    y: number,
    options: RuntimeRootTransformOptionsV1 = {},
  ): RuntimeFrameV1 {
    return this.setRootTransform({ ...this.#rootTransform, x, y }, options);
  }

  setRootRotation(
    rotationDegrees: number,
    options: RuntimeRootTransformOptionsV1 = {},
  ): RuntimeFrameV1 {
    return this.setRootTransform({ ...this.#rootTransform, rotationDegrees }, options);
  }

  teleportRoot(
    root: RootTransformV1,
    physicsMode: Exclude<RuntimePhysicsHostMotionModeV1, "move"> = "teleport",
    constraintId?: string,
  ): RuntimeFrameV1 {
    if ((physicsMode as string) === "move") {
      throw new RuntimeErrorV1("invalidArgument", "teleportRoot", "teleportRoot does not accept move mode.", {
        field: "physicsMode",
      });
    }
    return this.setRootTransform(root, {
      physicsMode,
      ...(constraintId === undefined ? {} : { constraintId }),
    });
  }

  setSkin(skinId: string | null): RuntimeFrameV1 {
    return this.setSkins(skinId === null ? [] : [skinId]);
  }

  setSkins(skinIds: readonly string[]): RuntimeFrameV1 {
    const next: string[] = [];
    for (let index = 0; index < skinIds.length; index += 1) {
      const skinId = skinIds[index];
      if (typeof skinId !== "string" || skinId.length === 0) {
        throw new RuntimeErrorV1("invalidArgument", "setSkins", "skinIds must contain non-empty strings.", {
          field: `skinIds[${index}]`,
        });
      }
      try {
        this.#data.skin(skinId);
      } catch (error) {
        throw remapRuntimeErrorV1(error, "setSkins", "Skin lookup failed.");
      }
      if (!next.includes(skinId)) next.push(skinId);
    }
    this.#requireNextSequence("setSkins");
    try {
      const physics = this.#physicsForEvaluation();
      const frame = this.#evaluate(
        this.#animationState,
        this.#sequence + 1,
        AUTHORED_SAMPLING,
        EMPTY_RUNTIME_EVENTS_V1,
        this.#timeSeconds,
        next,
        physics,
        null,
        this.#physicsBudgetForEvaluation(),
      );
      this.#activeSkinIds = next;
      this.#sampleOriginSkinIds = [...next];
      this.#physicsStates = physics;
      this.#sequence += 1;
      this.#commitEvaluatedFrame(frame);
      return frame;
    } catch (error) {
      throw remapRuntimeErrorV1(error, "setSkins", "Skin configuration failed.");
    }
  }

  get activeSkinIds(): readonly string[] {
    return deepFreeze([...this.#activeSkinIds]);
  }

  queryRootTransform(): RootTransformV1 {
    return deepFreeze({ ...this.#rootTransform });
  }

  queryBoneLocal(boneId: string): RuntimeBoneLocalV1 {
    const pose = this.#publishedPose("queryBoneLocal");
    const bone = pose.bones.find((candidate) => candidate.id === boneId);
    if (bone === undefined) throw queryNotFound("queryBoneLocal", "boneId", "bone", boneId);
    return deepFreeze({
      x: bone.x,
      y: bone.y,
      rotationDegrees: bone.rotation,
      shearXDegrees: bone.shearX,
      shearYDegrees: bone.shearY,
      scaleX: bone.scaleX,
      scaleY: bone.scaleY,
    });
  }

  queryBoneTransformMode(boneId: string): RuntimeBoneLocalStateV1["transformMode"] {
    const pose = this.#publishedPose("queryBoneTransformMode");
    const bone = pose.bones.find((candidate) => candidate.id === boneId);
    if (bone === undefined) throw queryNotFound("queryBoneTransformMode", "boneId", "bone", boneId);
    return bone.transformMode;
  }

  queryBoneLocalState(boneId: string): RuntimeBoneLocalStateV1 {
    return deepFreeze({
      boneId,
      local: this.queryBoneLocal(boneId),
      transformMode: this.queryBoneTransformMode(boneId),
    });
  }

  queryRegionAttachmentPose(attachmentId: string): RuntimeRegionAttachmentPoseV1 {
    const pose = this.#publishedPose("queryRegionAttachmentPose");
    const attachment = this.#attachmentForQuery(attachmentId, "queryRegionAttachmentPose");
    if (attachment.type !== "region") {
      throw new RuntimeErrorV1("invalidArgument", "queryRegionAttachmentPose", "Attachment is not a Region.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    const sampled = pose.regions.get(attachmentId) ?? attachment;
    return deepFreeze({
      attachmentId,
      x: sampled.x,
      y: sampled.y,
      rotationDegrees: sampled.rotation,
      scaleX: sampled.scaleX,
      scaleY: sampled.scaleY,
    });
  }

  querySlotState(slotId: string): RuntimeSlotStateV1 {
    const pose = this.#publishedPose("querySlotState");
    const slot = pose.slots.find((candidate) => candidate.id === slotId);
    if (slot === undefined) throw queryNotFound("querySlotState", "slotId", "slot", slotId);
    const drawIndex = pose.drawOrderSlotIds.indexOf(slotId);
    if (drawIndex < 0) {
      throw new RuntimeErrorV1("invalidState", "querySlotState", "Published draw order does not contain the slot.", {
        field: "slotId",
        entityId: slotId,
      });
    }
    return deepFreeze({
      slotId,
      attachmentKey: pose.slotAttachmentKeys.get(slotId) ?? null,
      attachmentId: slot.attachmentId,
      tint: composeFinalTintV1(
        slot.color,
        slot.alpha,
        "#ffffff",
        1,
        slot.darkColor,
        null,
        runtimeSlotTintBytesV1(slot),
      ),
      drawIndex,
    });
  }

  /**
   * Returns the selected attachment without allocating a Slot-state DTO.
   * This is intended for renderer integration and never evaluates a new frame.
   */
  querySlotAttachmentId(slotId: string): string | null {
    const pose = this.#publishedPose("querySlotAttachmentId");
    const slot = pose.slots.find((candidate) => candidate.id === slotId);
    if (slot === undefined) {
      throw queryNotFound("querySlotAttachmentId", "slotId", "slot", slotId);
    }
    return slot.attachmentId;
  }

  /** Returns sampled Slot alpha without allocating a Slot-state DTO. */
  querySlotAlpha(slotId: string): number {
    const pose = this.#publishedPose("querySlotAlpha");
    const slot = pose.slots.find((candidate) => candidate.id === slotId);
    if (slot === undefined) {
      throw queryNotFound("querySlotAlpha", "slotId", "slot", slotId);
    }
    return slot.alpha;
  }

  /** Owned snapshot of the complete current Slot draw order. */
  queryDrawOrderSlotIds(): readonly string[] {
    return deepFreeze([...this.#publishedPose("queryDrawOrder").drawOrderSlotIds]);
  }

  /** Copies draw order into retained host storage without allocating in Core. */
  writeDrawOrderSlotIds(output: string[]): number {
    if (!Array.isArray(output)) {
      throw new RuntimeErrorV1("invalidArgument", "queryDrawOrder", "output must be an array.", {
        field: "output",
      });
    }
    const drawOrder = this.#publishedPose("queryDrawOrder").drawOrderSlotIds;
    output.length = drawOrder.length;
    for (let index = 0; index < drawOrder.length; index += 1) {
      const slotId = drawOrder[index];
      if (slotId !== undefined) output[index] = slotId;
    }
    return drawOrder.length;
  }

  querySequenceIndex(attachmentId: string): number {
    const pose = this.#publishedPose("querySequenceIndex");
    const attachment = this.#attachmentForQuery(attachmentId, "querySequenceIndex");
    if ((attachment.type !== "region" && attachment.type !== "mesh") || attachment.sequence === null) {
      throw new RuntimeErrorV1("invalidArgument", "querySequenceIndex", "Attachment does not own a sequence.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    const index = pose.sequenceIndices.get(attachmentId) ?? attachment.sequence.setupIndex;
    if (!Number.isInteger(index) || index < 0 || index >= attachment.sequence.imageIds.length) {
      throw new RuntimeErrorV1("invalidState", "querySequenceIndex", "Sampled sequence index is out of bounds.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    return index;
  }

  queryPointAttachmentPose(attachmentId: string): RuntimePointAttachmentPoseV1 {
    const attachment = this.#attachmentForQuery(attachmentId, "queryPointAttachmentPose");
    if (attachment.type !== "point") {
      throw new RuntimeErrorV1("invalidArgument", "queryPointAttachmentPose", "Attachment is not a Point.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    const slot = this.#data.slot(attachment.slotId);
    const world = this.#publishedWorld("queryPointAttachmentPose").get(slot.boneId);
    if (world === undefined) {
      throw new RuntimeErrorV1("invalidState", "queryPointAttachmentPose", "Point attachment bone world state is unavailable.", {
        entityId: attachmentId,
      });
    }
    const [x, y] = transformPointV1(world, attachment.x, attachment.y);
    const radians = f32Mul(attachment.rotation, F32_DEGREES_TO_RADIANS);
    const localX = f32(Math.cos(radians));
    const localY = f32(Math.sin(radians));
    const directionX = f32Add(f32Mul(world.a, localX), f32Mul(world.c, localY));
    const directionY = f32Add(f32Mul(world.b, localX), f32Mul(world.d, localY));
    const rotationDegrees = f32Mul(Math.atan2(directionY, directionX), F32_RADIANS_TO_DEGREES);
    if (![x, y, rotationDegrees].every(Number.isFinite)) {
      throw new RuntimeErrorV1("nonFinite", "queryPointAttachmentPose", "Point attachment pose is non-finite.", {
        entityId: attachmentId,
      });
    }
    return deepFreeze({ attachmentId, x, y, rotationDegrees });
  }

  queryAttachmentGeometry(attachmentId: string): RuntimeAttachmentGeometryV1 {
    const pose = this.#publishedPose("queryAttachmentGeometry");
    const attachment = this.#attachmentForQuery(attachmentId, "queryAttachmentGeometry");
    if (attachment.type !== "path" && attachment.type !== "boundingbox" && attachment.type !== "clipping") {
      throw new RuntimeErrorV1("invalidArgument", "queryAttachmentGeometry", "Attachment has no non-renderable geometry projection.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    const slot = this.#data.slot(attachment.slotId);
    const worlds = this.#publishedWorld("queryAttachmentGeometry");
    const slotWorld = worlds.get(slot.boneId);
    if (slotWorld === undefined) {
      throw new RuntimeErrorV1("invalidState", "queryAttachmentGeometry", "Attachment bone world state is unavailable.", {
        entityId: attachmentId,
      });
    }
    let worldVerticesXy: readonly number[];
    try {
      worldVerticesXy = evaluateVertexAttachmentWorldV1(
        attachment,
        slotWorld,
        worlds,
        pose.deforms.get(attachment.id) ?? null,
      );
    } catch (error) {
      throw new RuntimeErrorV1("invalidState", "queryAttachmentGeometry", "Attachment world geometry could not be resolved.", {
        entityId: attachmentId,
        cause: error,
      });
    }
    if (!worldVerticesXy.every(Number.isFinite)) {
      throw new RuntimeErrorV1("nonFinite", "queryAttachmentGeometry", "Attachment world geometry is non-finite.", {
        entityId: attachmentId,
      });
    }
    return deepFreeze({
      attachmentId,
      kind: attachment.type === "boundingbox" ? "boundingBox" : attachment.type,
      worldVerticesXy: [...worldVerticesXy],
      closed: attachment.type === "path" ? attachment.closed : null,
    });
  }

  /**
   * Projects the exact Core clipping pieces for renderer-native masks. This
   * only reads the already-published pose; it does not sample or solve again.
   */
  queryClippingGeometry(attachmentId: string): RuntimeClippingGeometryV1 | null {
    const operation = "queryClippingGeometry";
    const pose = this.#publishedPose(operation);
    const attachment = this.#attachmentForQuery(attachmentId, operation);
    if (attachment.type !== "clipping") {
      throw new RuntimeErrorV1("invalidArgument", operation, "Attachment is not Clipping.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    const slot = this.#data.slot(attachment.slotId);
    const worlds = this.#publishedWorld(operation);
    const slotWorld = worlds.get(slot.boneId);
    if (slotWorld === undefined) {
      throw new RuntimeErrorV1("invalidState", operation, "Clipping attachment bone world state is unavailable.", {
        entityId: attachmentId,
      });
    }
    const clip = createRuntimeClipContextV1(
      attachment,
      slotWorld,
      worlds,
      pose.deforms.get(attachment.id) ?? null,
    );
    if (clip === null) return null;
    return deepFreeze({
      attachmentId,
      slotId: attachment.slotId,
      endSlotId: clip.endSlotId,
      inverse: clip.inverse,
      convexPolygonsXy: clip.convexPieces.map((piece) => piece.flatMap((point) => [point.x, point.y])),
    });
  }

  /**
   * Creates an owned bounds snapshot from the already-published frame.
   * This query never samples animation or solves constraints.
   */
  queryBounds(options: RuntimeBoundsOptionsV1 = {}): RuntimeBoundsSnapshotV1 {
    const output = new RuntimeBoundsV1();
    this.writeBounds(output, options);
    return output.snapshot();
  }

  /**
   * Writes frame bounds into retained storage without evaluating a new frame.
   * Reuse the same RuntimeBoundsV1 to avoid stable-frame temporary allocation.
   */
  writeBounds(output: RuntimeBoundsV1, options: RuntimeBoundsOptionsV1 = {}): RuntimeBoundsV1 {
    const operation = "writeBounds";
    if (!(output instanceof RuntimeBoundsV1)) {
      throw new RuntimeErrorV1("invalidArgument", operation, "output must be a RuntimeBoundsV1.", {
        field: "output",
      });
    }
    const normalized = normalizeBoundsOptionsV1(options, operation);
    const frame = this.currentFrame;
    const pose = this.#publishedPose(operation);
    const worlds = this.#publishedWorld(operation);
    output.beginWrite(frame.sequence);

    if (normalized.includeRenderGeometry) {
      for (let index = 0; index < frame.renderPacket.attachments.length; index += 1) {
        const attachment = frame.renderPacket.attachments[index];
        if (attachment === undefined || (!normalized.includeTransparent && attachment.tint.alpha <= 0)) continue;
        output.includeVertices(attachment.worldVerticesXy);
      }
    }

    if (normalized.includeBoundingBoxes) {
      for (let drawIndex = 0; drawIndex < pose.drawOrderSlotIds.length; drawIndex += 1) {
        const slotId = pose.drawOrderSlotIds[drawIndex];
        if (slotId === undefined) continue;
        const slot = pose.slots.find((candidate) => candidate.id === slotId);
        if (slot?.attachmentId === null || slot?.attachmentId === undefined) continue;
        const attachment = this.#data.document.attachments.find(
          (candidate) => candidate.id === slot.attachmentId,
        );
        if (attachment?.type !== "boundingbox") continue;
        const slotData = this.#data.slot(slotId);
        const slotWorld = worlds.get(slotData.boneId);
        if (slotWorld === undefined) {
          throw new RuntimeErrorV1("invalidState", operation, "Bounding Box bone world state is unavailable.", {
            entityId: attachment.id,
          });
        }
        const vertices = output.acquirePolygon(slotId, attachment.id, drawIndex);
        try {
          evaluateVertexAttachmentWorldV1(
            attachment,
            slotWorld,
            worlds,
            pose.deforms.get(attachment.id) ?? null,
            vertices,
          );
          output.commitPolygon();
        } catch (error) {
          throw remapRuntimeErrorV1(error, operation, "Bounding Box world geometry could not be resolved.");
        }
      }
    }
    return output;
  }

  queryVertexAttachmentSourceGeometry(
    attachmentId: string,
    deformSpace: RuntimeVertexDeformSpaceV1 = "vertexPositions",
  ): RuntimeVertexAttachmentSourceGeometryV1 {
    const operation = "queryVertexAttachmentSourceGeometry";
    const pose = this.#publishedPose(operation);
    const attachment = this.#attachmentForQuery(attachmentId, operation);
    if (attachment.type === "region" || attachment.type === "point") {
      throw new RuntimeErrorV1("invalidArgument", operation, "Attachment has no editable source vertices.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    if (deformSpace !== "vertexPositions" && deformSpace !== "weightedInfluenceOffsets") {
      throw new RuntimeErrorV1("invalidArgument", operation, "Unknown deform space.", { field: "deformSpace" });
    }
    const source = resolveVertexAttachmentSourceV1(attachment, this.#data);
    const deformAttachmentId = resolveVertexAttachmentDeformOwnerIdV1(attachment, this.#data);
    const currentDeform = pose.deforms.get(deformAttachmentId) ?? null;
    const fullyWeighted = source.weights.length > 0
      && source.weights.length * 2 === source.vertices.length
      && source.weights.every((influences) => influences.length > 0);
    let weightedOffsets: readonly number[] | null = null;
    let sampledVerticesXy: readonly number[];
    if (source.weights.length === 0) {
      if (currentDeform !== null && currentDeform.weighted) {
        throw new RuntimeErrorV1("invalidState", operation, "Unweighted attachment owns weighted deform state.", {
          entityId: attachmentId,
        });
      }
      sampledVerticesXy = currentDeform?.values ?? source.vertices;
    } else {
      const offsetCount = source.weights.reduce((count, influences) => count + influences.length * 2, 0);
      weightedOffsets = currentDeform === null
        ? new Array(offsetCount).fill(0)
        : currentDeform.weighted ? currentDeform.values : null;
      if (weightedOffsets === null || !fullyWeighted) {
        throw new RuntimeErrorV1("invalidState", operation, "Weighted attachment deform state is unavailable.", {
          entityId: attachmentId,
        });
      }
      const positions = weightedOffsetsToVertexPositionsV1(source, weightedOffsets);
      if (positions === null) {
        throw new RuntimeErrorV1("invalidState", operation, "Weighted deform cannot be projected to logical positions.", {
          entityId: attachmentId,
        });
      }
      sampledVerticesXy = positions;
    }
    if (sampledVerticesXy.length !== source.vertices.length || sampledVerticesXy.some((value) => !Number.isFinite(value))) {
      throw new RuntimeErrorV1("invalidState", operation, "Sampled source geometry has an invalid shape.", {
        entityId: attachmentId,
      });
    }
    if (deformSpace === "weightedInfluenceOffsets" && weightedOffsets === null) {
      throw new RuntimeErrorV1("invalidArgument", operation, "Unweighted attachments do not support weighted influence offsets.", {
        field: "deformSpace",
        entityId: attachmentId,
      });
    }

    const slot = this.#data.slot(attachment.slotId);
    const worlds = this.#publishedWorld(operation);
    const slotWorld = worlds.get(slot.boneId);
    if (slotWorld === undefined) {
      throw new RuntimeErrorV1("invalidState", operation, "Attachment bone world state is unavailable.", {
        entityId: attachmentId,
      });
    }
    const setupWorldVerticesXy = evaluateVertexAttachmentWorldV1(source, slotWorld, worlds, null);
    const worldVerticesXy = evaluateVertexAttachmentWorldV1(source, slotWorld, worlds, currentDeform);
    for (const values of [source.vertices, setupWorldVerticesXy, sampledVerticesXy, worldVerticesXy]) {
      if (values.length !== source.vertices.length || values.some((value) => !Number.isFinite(value))) {
        throw new RuntimeErrorV1("invalidState", operation, "Source geometry projections do not share one finite vertex shape.", {
          entityId: attachmentId,
        });
      }
    }
    return deepFreeze({
      attachmentId,
      sourceAttachmentId: source.id,
      deformAttachmentId,
      kind: attachment.type === "boundingbox" ? "boundingBox" : attachment.type,
      setupVerticesXy: [...source.vertices],
      setupWorldVerticesXy,
      sampledVerticesXy: [...sampledVerticesXy],
      worldVerticesXy,
      deformSpace,
      deformValues: [...(deformSpace === "vertexPositions" ? sampledVerticesXy : weightedOffsets ?? [])],
      fullyWeighted,
    });
  }

  /** Read-only inverse edit: moves one stable source vertex to an exact world target. */
  vertexAttachmentDeformForWorldTarget(request: RuntimeVertexWorldTargetV1): RuntimeVertexDeformV1 {
    const operation = "vertexAttachmentDeformForWorldTarget";
    if (request === null || typeof request !== "object") {
      throw new RuntimeErrorV1("invalidArgument", operation, "request must be an object.", { field: "request" });
    }
    const attachment = this.#attachmentForBatch(request.attachmentId, operation, "attachmentId");
    if (attachment.type === "region" || attachment.type === "point") {
      throw new RuntimeErrorV1("invalidArgument", operation, "Attachment has no editable source vertices.", {
        field: "attachmentId",
        entityId: request.attachmentId,
      });
    }
    const pointIndex = normalizeSourceVertexIndex(request.sourceVertexIndex, operation);
    const target = normalizePointV1(request.targetWorld, operation, "targetWorld");
    const deformInput = normalizeVertexDeformInputV1(request.currentDeform, operation);
    const geometry = this.queryVertexAttachmentSourceGeometry(request.attachmentId, deformInput.space);
    if (pointIndex >= geometry.setupVerticesXy.length / 2) {
      throw new RuntimeErrorV1("invalidArgument", operation, "sourceVertexIndex is outside the attachment vertex count.", {
        field: "sourceVertexIndex",
        entityId: request.attachmentId,
      });
    }
    const values = deformInput.source === "playerCurrent"
      ? [...geometry.deformValues]
      : normalizeDeformValuesV1(
          deformInput.values,
          geometry.deformValues.length,
          operation,
          "currentDeform.values",
          request.attachmentId,
        );
    const source = resolveVertexAttachmentSourceV1(attachment, this.#data);
    const slot = this.#data.slot(attachment.slotId);
    const worlds = this.#publishedWorld(operation);
    const slotWorld = worlds.get(slot.boneId);
    if (slotWorld === undefined) {
      throw new RuntimeErrorV1("invalidState", operation, "Attachment bone world state is unavailable.", {
        entityId: request.attachmentId,
      });
    }
    let resolved: number[] | null;
    if (deformInput.space === "vertexPositions") {
      const point = vertexAttachmentPositionForWorldTargetV1(
        source,
        slotWorld,
        worlds,
        pointIndex,
        target.x,
        target.y,
      );
      if (point === null) resolved = null;
      else {
        resolved = values;
        resolved[pointIndex * 2] = point[0];
        resolved[pointIndex * 2 + 1] = point[1];
      }
    } else {
      resolved = vertexAttachmentWeightedOffsetsForWorldTargetV1(
        source,
        slotWorld,
        worlds,
        pointIndex,
        values,
        target.x,
        target.y,
      );
    }
    if (resolved === null || resolved.length !== geometry.deformValues.length || resolved.some((value) => !Number.isFinite(value))) {
      throw new RuntimeErrorV1("invalidState", operation, "Inverse deform is singular or invalid.", {
        field: "targetWorld",
        entityId: request.attachmentId,
      });
    }
    return deepFreeze({
      attachmentId: request.attachmentId,
      deformAttachmentId: geometry.deformAttachmentId,
      space: deformInput.space,
      values: resolved,
    });
  }

  /** Returns one bone-local target point per influence in stable source order. */
  vertexAttachmentWeightLocalPositionsForWorldTarget(
    attachmentId: string,
    sourceVertexIndex: number,
    targetWorld: RuntimePointV1,
  ): readonly RuntimePointV1[] {
    const operation = "vertexAttachmentWeightLocalPositionsForWorldTarget";
    const attachment = this.#attachmentForBatch(attachmentId, operation, "attachmentId");
    if (attachment.type === "region" || attachment.type === "point") {
      throw new RuntimeErrorV1("invalidArgument", operation, "Attachment does not support vertex-weight editing.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    const pointIndex = normalizeSourceVertexIndex(sourceVertexIndex, operation);
    const target = normalizePointV1(targetWorld, operation, "targetWorld");
    const source = resolveVertexAttachmentSourceV1(attachment, this.#data);
    if (pointIndex >= source.vertices.length / 2) {
      throw new RuntimeErrorV1("invalidArgument", operation, "sourceVertexIndex is outside the attachment vertex count.", {
        field: "sourceVertexIndex",
        entityId: attachmentId,
      });
    }
    const result = vertexAttachmentWeightLocalPositionsForWorldTargetV1(
      source,
      this.#publishedWorld(operation),
      pointIndex,
      target.x,
      target.y,
    );
    if (result === null) {
      throw new RuntimeErrorV1("invalidState", operation, "Weight-local positions cannot be resolved for the world target.", {
        field: "targetWorld",
        entityId: attachmentId,
      });
    }
    return deepFreeze(result.map(([x, y]) => ({ x, y })));
  }

  /** Converts a complete logical source-position edit into complete weighted offsets. */
  vertexAttachmentWeightedDeformOffsetsAfterPositionEdit(
    attachmentId: string,
    currentWeightedOffsets: readonly number[],
    beforePositions: readonly number[],
    afterPositions: readonly number[],
  ): readonly number[] {
    const operation = "vertexAttachmentWeightedDeformOffsetsAfterPositionEdit";
    const attachment = this.#attachmentForBatch(attachmentId, operation, "attachmentId");
    if (attachment.type === "region" || attachment.type === "point") {
      throw new RuntimeErrorV1("invalidArgument", operation, "Attachment has no weighted source geometry.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    const geometry = this.queryVertexAttachmentSourceGeometry(attachmentId, "weightedInfluenceOffsets");
    const current = normalizeDeformValuesV1(
      currentWeightedOffsets,
      geometry.deformValues.length,
      operation,
      "currentWeightedOffsets",
      attachmentId,
    );
    const before = normalizeDeformValuesV1(
      beforePositions,
      geometry.sampledVerticesXy.length,
      operation,
      "beforePositions",
      attachmentId,
    );
    const after = normalizeDeformValuesV1(
      afterPositions,
      geometry.sampledVerticesXy.length,
      operation,
      "afterPositions",
      attachmentId,
    );
    const source = resolveVertexAttachmentSourceV1(attachment, this.#data);
    const values = weightedOffsetsAfterVertexPositionEditV1(source, current, before, after);
    if (values === null || values.length !== current.length) {
      throw new RuntimeErrorV1("invalidState", operation, "Weighted position edit could not be converted.", {
        field: "afterPositions",
        entityId: attachmentId,
      });
    }
    return deepFreeze(values);
  }

  /** Translates every current world vertex of a fully weighted Mesh without mutating the player. */
  translateWeightedMeshDeform(
    attachmentId: string,
    space: RuntimeVertexDeformSpaceV1,
    worldDelta: RuntimePointV1,
  ): readonly number[] {
    const operation = "translateWeightedMeshDeform";
    const attachment = this.#attachmentForBatch(attachmentId, operation, "attachmentId");
    if (attachment.type !== "mesh") {
      throw new RuntimeErrorV1("invalidArgument", operation, "Attachment is not a Mesh.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    if (space !== "vertexPositions" && space !== "weightedInfluenceOffsets") {
      throw new RuntimeErrorV1("invalidArgument", operation, "Unknown deform space.", { field: "space" });
    }
    const delta = normalizePointV1(worldDelta, operation, "worldDelta");
    const geometry = this.queryVertexAttachmentSourceGeometry(attachmentId, "weightedInfluenceOffsets");
    if (!geometry.fullyWeighted || geometry.worldVerticesXy.length === 0) {
      throw new RuntimeErrorV1("invalidArgument", operation, "Mesh is not fully weighted.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    const source = resolveVertexAttachmentSourceV1(attachment, this.#data);
    const worlds = this.#publishedWorld(operation);
    const slot = this.#data.slot(attachment.slotId);
    const slotWorld = worlds.get(slot.boneId);
    if (slotWorld === undefined) {
      throw new RuntimeErrorV1("invalidState", operation, "Mesh bone world state is unavailable.", {
        entityId: attachmentId,
      });
    }
    let offsets = [...geometry.deformValues];
    const positions: number[] = [];
    for (let pointIndex = 0; pointIndex < geometry.worldVerticesXy.length / 2; pointIndex += 1) {
      const currentX = geometry.worldVerticesXy[pointIndex * 2];
      const currentY = geometry.worldVerticesXy[pointIndex * 2 + 1];
      if (currentX === undefined || currentY === undefined) {
        throw new RuntimeErrorV1("invalidState", operation, "Mesh world vertex buffer is incomplete.", {
          field: `vertices[${pointIndex}]`,
          entityId: attachmentId,
        });
      }
      const targetX = f32Add(currentX, delta.x);
      const targetY = f32Add(currentY, delta.y);
      if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
        throw new RuntimeErrorV1("nonFinite", operation, "worldDelta produces a non-finite world target.", {
          field: "worldDelta",
          entityId: attachmentId,
        });
      }
      if (space === "vertexPositions") {
        const point = vertexAttachmentPositionForWorldTargetV1(
          source,
          slotWorld,
          worlds,
          pointIndex,
          targetX,
          targetY,
        );
        if (point === null) {
          throw new RuntimeErrorV1("invalidState", operation, "Mesh inverse deform could not be solved.", {
            field: `vertices[${pointIndex}]`,
            entityId: attachmentId,
          });
        }
        positions.push(point[0], point[1]);
      } else {
        const next = vertexAttachmentWeightedOffsetsForWorldTargetV1(
          source,
          slotWorld,
          worlds,
          pointIndex,
          offsets,
          targetX,
          targetY,
        );
        if (next === null) {
          throw new RuntimeErrorV1("invalidState", operation, "Weighted Mesh inverse deform could not be solved.", {
            field: `vertices[${pointIndex}]`,
            entityId: attachmentId,
          });
        }
        offsets = next;
      }
    }
    const result = space === "vertexPositions" ? positions : offsets;
    if (result.some((value) => !Number.isFinite(value))) {
      throw new RuntimeErrorV1("nonFinite", operation, "Translated Mesh deform is non-finite.", {
        field: "values",
        entityId: attachmentId,
      });
    }
    return deepFreeze(result);
  }

  queryPathConstraintPosition(constraintId: string): RuntimePathConstraintPositionV1 {
    const operation = "queryPathConstraintPosition";
    const pose = this.#publishedPose(operation);
    const constraint = pose.constraints.find((candidate) => candidate.id === constraintId);
    if (constraint === undefined) throw queryNotFound(operation, "constraintId", "constraint", constraintId);
    if (constraint.type !== "path") {
      throw new RuntimeErrorV1("invalidArgument", operation, "Constraint is not a Path constraint.", {
        field: "constraintId",
        entityId: constraintId,
      });
    }
    const result = queryRuntimePathConstraintPositionV1(
      constraint,
      pose,
      this.#publishedWorld(operation),
      this.#data,
    );
    if (result === null) {
      throw new RuntimeErrorV1("invalidState", operation, "Path constraint has no resolvable current target Path.", {
        entityId: constraintId,
      });
    }
    return deepFreeze(result);
  }

  queryPathConstraintPositionForWorldTarget(
    constraintId: string,
    targetWorld: RuntimePointV1,
  ): number {
    const operation = "queryPathConstraintPositionForWorldTarget";
    const target = normalizePointV1(targetWorld, operation, "targetWorld");
    const pose = this.#publishedPose(operation);
    const constraint = pose.constraints.find((candidate) => candidate.id === constraintId);
    if (constraint === undefined) throw queryNotFound(operation, "constraintId", "constraint", constraintId);
    if (constraint.type !== "path") {
      throw new RuntimeErrorV1("invalidArgument", operation, "Constraint is not a Path constraint.", {
        field: "constraintId",
        entityId: constraintId,
      });
    }
    const result = queryRuntimePathConstraintPositionForWorldTargetV1(
      constraint,
      pose,
      this.#publishedWorld(operation),
      this.#data,
      target,
    );
    if (result === null) {
      throw new RuntimeErrorV1("invalidState", operation, "World target cannot be projected to the active Path.", {
        field: "targetWorld",
        entityId: constraintId,
      });
    }
    return result;
  }

  queryConstraintState(constraintId: string): RuntimeConstraintStateV1 {
    const operation = "queryConstraintState";
    const pose = this.#publishedPose(operation);
    const constraint = pose.constraints.find((candidate) => candidate.id === constraintId);
    if (constraint === undefined) throw queryNotFound(operation, "constraintId", "constraint", constraintId);
    const diagnostic = pose.constraintDiagnostics.get(constraintId) ?? null;
    if (diagnostic !== null && diagnostic.type !== constraint.type) {
      throw new RuntimeErrorV1("invalidState", operation, "Constraint diagnostic kind does not match sampled parameters.", {
        entityId: constraintId,
      });
    }
    return deepFreeze({
      constraintId,
      kind: constraint.type,
      sampledParameters: constraintParametersV1(constraint),
      sampledSliderTimeSeconds: constraint.type === "slider"
        ? pose.sampledSliderTimes.get(constraintId) ?? null
        : null,
      diagnostic,
    });
  }

  queryMatchedTransformConstraintOffsets(constraintId: string): RuntimeTransformConstraintOffsetsV1 {
    const operation = "queryMatchedTransformConstraintOffsets";
    const pose = this.#publishedPose(operation);
    const constraint = pose.constraints.find((candidate) => candidate.id === constraintId);
    if (constraint === undefined) throw queryNotFound(operation, "constraintId", "constraint", constraintId);
    if (constraint.type !== "transform") {
      throw new RuntimeErrorV1("invalidArgument", operation, "Constraint is not a Transform constraint.", {
        field: "constraintId",
        entityId: constraintId,
      });
    }
    const result = queryRuntimeMatchedTransformConstraintOffsetsV1(
      constraint,
      pose.bones,
      this.#publishedWorld(operation),
    );
    if (result === null) {
      throw new RuntimeErrorV1(
        "invalidState",
        operation,
        "Transform constraint does not have canonical matchable routing.",
        { entityId: constraintId },
      );
    }
    return deepFreeze(result);
  }

  /** Captures every authoring-facing projection from the current published pose without resampling. */
  authoringSnapshot(): RuntimeAuthoringSnapshotV1 {
    const boneLocalStates = this.#data.document.bones.map((bone) => this.queryBoneLocalState(bone.id));
    const slotStates = this.#data.document.slots.map((slot) => this.querySlotState(slot.id));
    const constraintStates = this.#data.document.constraints.map((constraint) => this.queryConstraintState(constraint.id));
    const pointAttachmentPoses = this.#data.document.attachments
      .filter((attachment) => attachment.type === "point")
      .map((attachment) => this.queryPointAttachmentPose(attachment.id));
    const attachmentGeometries = this.#data.document.attachments
      .filter((attachment) => attachment.type === "path"
        || attachment.type === "boundingbox"
        || attachment.type === "clipping")
      .map((attachment) => this.queryAttachmentGeometry(attachment.id));
    const vertexAttachmentSourceGeometries = this.#data.document.attachments
      .filter((attachment) => attachment.type === "mesh"
        || attachment.type === "path"
        || attachment.type === "boundingbox"
        || attachment.type === "clipping")
      .map((attachment) => this.queryVertexAttachmentSourceGeometry(attachment.id, "vertexPositions"));
    const pathConstraintPositions: RuntimePathConstraintPositionV1[] = [];
    for (const constraint of this.#data.document.constraints) {
      if (constraint.type !== "path") continue;
      try {
        pathConstraintPositions.push(this.queryPathConstraintPosition(constraint.id));
      } catch (error) {
        if (error instanceof RuntimeErrorV1 && error.runtimeName === "invalidState") continue;
        throw error;
      }
    }
    return deepFreeze({
      frame: this.currentFrame,
      boneLocalStates,
      slotStates,
      constraintStates,
      pointAttachmentPoses,
      attachmentGeometries,
      vertexAttachmentSourceGeometries,
      pathConstraintPositions,
    });
  }

  setBoneLocalOverride(boneId: string, local: RuntimeBoneLocalV1): RuntimeFrameV1 {
    const bone = this.#data.document.bones.find((candidate) => candidate.id === boneId);
    if (bone === undefined) throw queryNotFound("setBoneLocalOverride", "boneId", "bone", boneId);
    const normalized = normalizeBoneLocalOverride(local, "setBoneLocalOverride");
    return this.#configureHostOverrides("setBoneLocalOverride", (next) => {
      next.boneLocals.set(boneId, normalized);
    });
  }

  clearBoneLocalOverride(boneId: string): RuntimeFrameV1 {
    if (!this.#data.document.bones.some((bone) => bone.id === boneId)) {
      throw queryNotFound("clearBoneLocalOverride", "boneId", "bone", boneId);
    }
    return this.#configureHostOverrides("clearBoneLocalOverride", (next) => {
      next.boneLocals.delete(boneId);
    });
  }

  setRegionAttachmentPoseOverride(
    attachmentId: string,
    pose: RuntimeRegionAttachmentPoseV1,
  ): RuntimeFrameV1 {
    const attachment = this.#attachmentForQuery(attachmentId, "setRegionAttachmentPoseOverride");
    if (attachment.type !== "region") {
      throw new RuntimeErrorV1("invalidArgument", "setRegionAttachmentPoseOverride", "Attachment is not a Region.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    const normalized = normalizeRegionPoseOverride(attachmentId, pose);
    return this.#configureHostOverrides("setRegionAttachmentPoseOverride", (next) => {
      next.regionPoses.set(attachmentId, normalized);
    });
  }

  clearRegionAttachmentPoseOverride(attachmentId: string): RuntimeFrameV1 {
    const attachment = this.#attachmentForQuery(attachmentId, "clearRegionAttachmentPoseOverride");
    if (attachment.type !== "region") {
      throw new RuntimeErrorV1("invalidArgument", "clearRegionAttachmentPoseOverride", "Attachment is not a Region.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    return this.#configureHostOverrides("clearRegionAttachmentPoseOverride", (next) => {
      next.regionPoses.delete(attachmentId);
    });
  }

  setDrawOrderOverride(slotIds: readonly string[]): RuntimeFrameV1 {
    const normalized = normalizeDrawOrderOverride(this.#data, slotIds);
    return this.#configureHostOverrides("setDrawOrderOverride", (next) => {
      next.drawOrder = normalized;
    });
  }

  clearDrawOrderOverride(): RuntimeFrameV1 {
    return this.#configureHostOverrides("clearDrawOrderOverride", (next) => {
      next.drawOrder = null;
    });
  }

  setVertexDeformOverride(
    attachmentId: string,
    override: RuntimeVertexDeformOverrideV1,
  ): RuntimeFrameV1 {
    const attachment = this.#attachmentForQuery(attachmentId, "setVertexDeformOverride");
    if (attachment.type === "region" || attachment.type === "point") {
      throw new RuntimeErrorV1("invalidArgument", "setVertexDeformOverride", "Attachment has no deformable source vertices.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    const normalized = normalizeVertexDeformOverride(this.#data, attachment, override);
    return this.#configureHostOverrides("setVertexDeformOverride", (next) => {
      next.vertexDeforms.set(attachmentId, normalized);
    });
  }

  clearVertexDeformOverride(attachmentId: string): RuntimeFrameV1 {
    const attachment = this.#attachmentForQuery(attachmentId, "clearVertexDeformOverride");
    if (attachment.type === "region" || attachment.type === "point") {
      throw new RuntimeErrorV1("invalidArgument", "clearVertexDeformOverride", "Attachment has no deformable source vertices.", {
        field: "attachmentId",
        entityId: attachmentId,
      });
    }
    return this.#configureHostOverrides("clearVertexDeformOverride", (next) => {
      next.vertexDeforms.delete(attachmentId);
    });
  }

  setSlotAttachmentOverride(slotId: string, attachmentId: string | null): RuntimeFrameV1 {
    const slot = this.#data.document.slots.find((candidate) => candidate.id === slotId);
    if (slot === undefined) throw queryNotFound("setSlotAttachmentOverride", "slotId", "slot", slotId);
    if (attachmentId !== null) {
      const attachment = this.#attachmentForQuery(attachmentId, "setSlotAttachmentOverride");
      if (attachment.slotId !== slotId) {
        throw new RuntimeErrorV1("invalidArgument", "setSlotAttachmentOverride", "Attachment belongs to another slot.", {
          field: "attachmentId",
          entityId: attachmentId,
        });
      }
    }
    return this.#configureHostOverrides("setSlotAttachmentOverride", (next) => {
      next.slotAttachments.set(slotId, attachmentId);
    });
  }

  clearSlotAttachmentOverride(slotId: string): RuntimeFrameV1 {
    if (!this.#data.document.slots.some((slot) => slot.id === slotId)) {
      throw queryNotFound("clearSlotAttachmentOverride", "slotId", "slot", slotId);
    }
    return this.#configureHostOverrides("clearSlotAttachmentOverride", (next) => {
      next.slotAttachments.delete(slotId);
    });
  }

  setSlotTintOverride(slotId: string, tint: RuntimeSlotTintOverrideV1): RuntimeFrameV1 {
    if (!this.#data.document.slots.some((slot) => slot.id === slotId)) {
      throw queryNotFound("setSlotTintOverride", "slotId", "slot", slotId);
    }
    const normalized = normalizeSlotTintOverride(tint);
    return this.#configureHostOverrides("setSlotTintOverride", (next) => {
      next.slotTints.set(slotId, normalized);
    });
  }

  clearSlotTintOverride(slotId: string): RuntimeFrameV1 {
    if (!this.#data.document.slots.some((slot) => slot.id === slotId)) {
      throw queryNotFound("clearSlotTintOverride", "slotId", "slot", slotId);
    }
    return this.#configureHostOverrides("clearSlotTintOverride", (next) => {
      next.slotTints.delete(slotId);
    });
  }

  setConstraintOverride(constraintId: string, override: RuntimeConstraintOverrideV1): RuntimeFrameV1 {
    const constraint = this.#data.document.constraints.find((candidate) => candidate.id === constraintId);
    if (constraint === undefined) throw queryNotFound("setConstraintOverride", "constraintId", "constraint", constraintId);
    const normalized = normalizeConstraintOverride(constraint, override);
    return this.#configureHostOverrides("setConstraintOverride", (next) => {
      next.constraints.set(constraintId, normalized);
    });
  }

  clearConstraintOverride(constraintId: string): RuntimeFrameV1 {
    if (!this.#data.document.constraints.some((constraint) => constraint.id === constraintId)) {
      throw queryNotFound("clearConstraintOverride", "constraintId", "constraint", constraintId);
    }
    return this.#configureHostOverrides("clearConstraintOverride", (next) => {
      next.constraints.delete(constraintId);
    });
  }

  applyAuthoringOverrides(request: RuntimeAuthoringOverridesV1): RuntimeFrameV1 {
    return this.applyAuthoringOverridesWithSampling(request, AUTHORED_SAMPLING);
  }

  applyAuthoringOverridesWithSampling(
    request: RuntimeAuthoringOverridesV1,
    sampling: RuntimeSamplingV1,
  ): RuntimeFrameV1 {
    const operation = "applyAuthoringOverrides";
    if (request === null || typeof request !== "object" || !Array.isArray(request.operations)) {
      throw new RuntimeErrorV1("invalidArgument", operation, "request.operations must be an array.", {
        field: "operations",
      });
    }
    return this.#configureHostOverrides(operation, (next) => {
      for (let index = 0; index < request.operations.length; index += 1) {
        const candidate = request.operations[index];
        if (candidate === undefined || candidate === null || typeof candidate !== "object") {
          throw new RuntimeErrorV1("invalidArgument", operation, "Authoring override operation must be an object.", {
            field: `operations[${index}]`,
          });
        }
        this.#stageHostOverrideOperation(next, candidate, operation, index);
      }
    }, sampling);
  }

  #replaceRuntimeResources(
    nextResources: RuntimeResourceStateV1,
    operation: "applyRuntimeResources" | "clearRuntimeResources",
  ): RuntimeFrameV1 {
    const resources = runtimeResourceSnapshotV1(nextResources);
    const candidate = new RuntimePlayerV1(this.#sourceData, {
      executionMode: this.#executionMode,
      runtimeResources: resources,
    });
    const nextData = candidate.#data;
    validateRuntimeGeometryModifiersV1(nextData, this.#geometryModifiers, operation);
    candidate.#geometryModifiers = this.#geometryModifiers;
    candidate.#animationState = this.#animationState.reconciled(nextData);
    candidate.#sampleOriginState = this.#sampleOriginState.reconciled(nextData);
    candidate.#timeSeconds = candidate.#animationState.animationTime();
    candidate.#sequence = this.#sequence;
    candidate.#rootTransform = this.#rootTransform;
    candidate.#physicsEnvironment = this.#physicsEnvironment;
    candidate.#activeSkinIds = retainKnownSkinIdsV1(nextData, this.#activeSkinIds);
    candidate.#sampleOriginSkinIds = retainKnownSkinIdsV1(nextData, this.#sampleOriginSkinIds);
    candidate.#hostOverrides = retainCompatibleHostOverridesV1(nextData, this.#hostOverrides);
    candidate.#pendingEvents = [...this.#pendingEvents];
    candidate.#physicsStates = this.#physicsStates.clone();
    for (const record of this.#beforeConstraintHooks) {
      if (record.active) candidate.#beforeConstraintHooks.push(record);
    }
    for (const record of this.#afterConstraintHooks) {
      if (record.active) candidate.#afterConstraintHooks.push(record);
    }
    for (const record of this.#eventHooks) {
      if (record.active) candidate.#eventHooks.push(record);
    }
    const frame = candidate.#evaluate(
      candidate.#animationState,
      candidate.#sequence + 1,
      AUTHORED_SAMPLING,
      EMPTY_RUNTIME_EVENTS_V1,
      candidate.#timeSeconds,
      candidate.#activeSkinIds,
      candidate.#physicsStates,
      null,
      candidate.#physicsBudgetForEvaluation(),
      candidate.#physicsEnvironment,
      candidate.#rootTransform,
      candidate.#hostOverrides,
      EMPTY_POSE_MODIFIERS_V1,
      operation,
    );
    candidate.#sequence += 1;
    candidate.#commitEvaluatedFrame(frame);
    this.#adopt(candidate, frame);
    return frame;
  }

  /**
   * Atomically replaces immutable Runtime data while retaining playback and
   * host configuration that is still valid for the replacement catalog.
   */
  replaceProject(data: RuntimeDataV1): RuntimeFrameV1 {
    const operation = "replaceProject";
    if (data === null || typeof data !== "object" || !("document" in data)) {
      throw new RuntimeErrorV1("invalidArgument", operation, "data must be a RuntimeDataV1 instance.", {
        field: "data",
      });
    }
    this.#requireNextSequence(operation);
    try {
      const candidate = new RuntimePlayerV1(data, {
        executionMode: this.#executionMode,
        runtimeResources: runtimeResourceSnapshotV1(this.#runtimeResources),
      });
      const nextData = candidate.#data;
      validateRuntimeGeometryModifiersV1(nextData, this.#geometryModifiers, operation);
      candidate.#geometryModifiers = this.#geometryModifiers;
      candidate.#animationState = this.#animationState.reconciled(nextData);
      candidate.#sampleOriginState = this.#sampleOriginState.reconciled(nextData);
      candidate.#timeSeconds = candidate.#animationState.animationTime();
      candidate.#sequence = this.#sequence;
      candidate.#rootTransform = this.#rootTransform;
      candidate.#physicsEnvironment = this.#physicsEnvironment;
      candidate.#activeSkinIds = retainKnownSkinIdsV1(nextData, this.#activeSkinIds);
      candidate.#sampleOriginSkinIds = retainKnownSkinIdsV1(nextData, this.#sampleOriginSkinIds);
      candidate.#hostOverrides = retainCompatibleHostOverridesV1(nextData, this.#hostOverrides);
      for (const record of this.#beforeConstraintHooks) {
        if (record.active) candidate.#beforeConstraintHooks.push(record);
      }
      for (const record of this.#afterConstraintHooks) {
        if (record.active) candidate.#afterConstraintHooks.push(record);
      }
      for (const record of this.#eventHooks) {
        if (record.active) candidate.#eventHooks.push(record);
      }
      candidate.#pendingEvents.length = 0;
      candidate.#physicsStates = new RuntimePhysicsStateStoreV1();
      const frame = candidate.#evaluate(
        candidate.#animationState,
        candidate.#sequence + 1,
        AUTHORED_SAMPLING,
        EMPTY_RUNTIME_EVENTS_V1,
        candidate.#timeSeconds,
        candidate.#activeSkinIds,
        candidate.#physicsStates,
        null,
        candidate.#physicsBudgetForEvaluation(),
      );
      candidate.#sequence += 1;
      candidate.#commitEvaluatedFrame(frame);
      this.#adopt(candidate, frame);
      return frame;
    } catch (error) {
      throw remapRuntimeErrorV1(error, operation, "Runtime project replacement failed.");
    }
  }

  /** Compatibility spelling for immutable Runtime data reconciliation. */
  reconcileProject(data: RuntimeDataV1): RuntimeFrameV1 {
    return this.replaceProject(data);
  }

  /**
   * Creates a fresh player with configuration and persistent authoring
   * overrides copied, but without tracks, clocks, queued events or physics history.
   */
  cloneConfiguration(): RuntimePlayerV1 {
    const operation = "cloneConfiguration";
    try {
      const clone = new RuntimePlayerV1(this.#sourceData, {
        executionMode: this.#executionMode,
        runtimeResources: runtimeResourceSnapshotV1(this.#runtimeResources),
      });
      validateRuntimeGeometryModifiersV1(clone.#data, this.#geometryModifiers, operation);
      clone.#geometryModifiers = this.#geometryModifiers;
      clone.#animationState = this.#animationState.configurationClone(clone.#data);
      clone.#sampleOriginState = this.#sampleOriginState.configurationClone(clone.#data);
      clone.#timeSeconds = 0;
      clone.#activeSkinIds = [...this.#activeSkinIds];
      clone.#sampleOriginSkinIds = [...this.#activeSkinIds];
      clone.#rootTransform = this.#rootTransform;
      clone.#physicsEnvironment = this.#physicsEnvironment;
      clone.#hostOverrides = freezeHostOverridesV1(cloneHostOverridesV1(this.#hostOverrides));
      clone.#pendingEvents.length = 0;
      clone.#physicsStates = new RuntimePhysicsStateStoreV1();
      const frame = clone.#evaluate(
        clone.#animationState,
        clone.#sequence + 1,
        AUTHORED_SAMPLING,
        EMPTY_RUNTIME_EVENTS_V1,
        0,
        clone.#activeSkinIds,
        clone.#physicsStates,
        null,
        clone.#physicsBudgetForEvaluation(),
      );
      clone.#sequence += 1;
      clone.#commitEvaluatedFrame(frame);
      return clone;
    } catch (error) {
      throw remapRuntimeErrorV1(error, operation, "Runtime configuration clone failed.");
    }
  }

  setPhysicsEnvironment(environment: RuntimePhysicsEnvironmentV1): RuntimeFrameV1 {
    const next = normalizePhysicsEnvironment(environment);
    this.#requireNextSequence("setPhysicsEnvironment");
    try {
      const physics = this.#physicsForEvaluation();
      const frame = this.#evaluate(
        this.#animationState,
        this.#sequence + 1,
        AUTHORED_SAMPLING,
        EMPTY_RUNTIME_EVENTS_V1,
        this.#timeSeconds,
        this.#activeSkinIds,
        physics,
        null,
        this.#physicsBudgetForEvaluation(),
        next,
      );
      this.#physicsEnvironment = deepFreeze(next);
      this.#physicsStates = physics;
      this.#sequence += 1;
      this.#commitEvaluatedFrame(frame);
      return frame;
    } catch (error) {
      throw remapRuntimeErrorV1(error, "setPhysicsEnvironment", "Physics environment update failed.");
    }
  }

  resetPhysics(): RuntimeFrameV1 {
    return this.#resetPhysicsState().frame;
  }

  resetPhysicsConstraint(constraintId: string): boolean {
    let constraint: RuntimeConstraintV1;
    try {
      constraint = this.#data.constraint(constraintId);
    } catch (error) {
      throw remapRuntimeErrorV1(error, "resetPhysicsConstraint", "Physics constraint lookup failed.");
    }
    if (constraint.type !== "physics") {
      throw new RuntimeErrorV1("invalidArgument", "resetPhysicsConstraint", "Constraint is not Physics.", {
        field: "constraintId",
        entityId: constraintId,
      });
    }
    return this.#resetPhysicsState(constraintId).cleared;
  }

  setAnimation(request: RuntimeSetAnimationV1): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    const events = live.setAnimation(request);
    origin.setAnimation(request);
    return this.#publishConfiguration("setAnimation", live, origin, events);
  }

  setEmptyAnimation(request: RuntimeSetEmptyAnimationV1): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    const events = live.setEmptyAnimation(request);
    origin.setEmptyAnimation(request);
    return this.#publishConfiguration("setEmptyAnimation", live, origin, events);
  }

  queueAnimation(request: RuntimeQueueAnimationV1): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    const events = live.queueAnimation(request);
    origin.queueAnimation(request);
    return this.#publishConfiguration("queueAnimation", live, origin, events);
  }

  queueEmptyAnimation(request: RuntimeQueueEmptyAnimationV1): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    const events = live.queueEmptyAnimation(request);
    origin.queueEmptyAnimation(request);
    return this.#publishConfiguration("queueEmptyAnimation", live, origin, events);
  }

  removeQueuedEntry(trackIndex: number, queueIndex: number): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    const events = live.removeQueuedEntry(trackIndex, queueIndex);
    origin.removeQueuedEntry(trackIndex, queueIndex);
    return this.#publishConfiguration("removeQueuedEntry", live, origin, events);
  }

  setQueuedEntryOptions(request: RuntimeQueuedEntryOptionsV1): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    live.setQueuedEntryOptions(request);
    origin.setQueuedEntryOptions(request);
    return this.#publishConfiguration("setQueuedEntryOptions", live, origin, []);
  }

  clearTrack(trackIndex: number): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    const events = live.clearTrack(trackIndex);
    origin.clearTrack(trackIndex);
    return this.#publishConfiguration("clearTrack", live, origin, events);
  }

  clearTracks(): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    const events = live.clearTracks();
    origin.clearTracks();
    return this.#publishConfiguration("clearTracks", live, origin, events);
  }

  setDefaultMix(durationSeconds: number): void {
    this.#assertMutationAllowed("setDefaultMix");
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    live.setDefaultMix(durationSeconds);
    origin.setDefaultMix(durationSeconds);
    this.#animationState = live;
    this.#sampleOriginState = origin;
  }

  setMix(request: RuntimeMixV1): void {
    this.#assertMutationAllowed("setMix");
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    live.setMix(request);
    origin.setMix(request);
    this.#animationState = live;
    this.#sampleOriginState = origin;
  }

  queryDefaultMixSeconds(): number {
    return this.#animationState.defaultMixSeconds();
  }

  setTrackTime(trackIndex: number, timeSeconds: number): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    live.setTrackTime(trackIndex, timeSeconds);
    origin.setTrackTime(trackIndex, timeSeconds);
    return this.#publishConfiguration("setTrackTime", live, origin, []);
  }

  setAnimationTime(timeSeconds: number): RuntimeFrameV1 {
    const time = overrideNonNegative(timeSeconds, "setAnimationTime", "timeSeconds");
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    live.setAnimationTime(time);
    origin.setAnimationTime(time);
    return this.#publishConfiguration("setAnimationTime", live, origin, []);
  }

  setTrackMixDuration(request: RuntimeSetTrackMixDurationV1): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    live.setTrackMixDuration(request);
    origin.setTrackMixDuration(request);
    return this.#publishConfiguration("setTrackMixDuration", live, origin, []);
  }

  setTrackEnd(request: RuntimeSetTrackEndV1): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    live.setTrackEnd(request);
    origin.setTrackEnd(request);
    return this.#publishConfiguration("setTrackEnd", live, origin, []);
  }

  setTrackAnimationRange(request: RuntimeSetTrackAnimationRangeV1): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    live.setTrackAnimationRange(request);
    origin.setTrackAnimationRange(request);
    return this.#publishConfiguration("setTrackAnimationRange", live, origin, []);
  }

  setTrackOptions(request: RuntimeTrackOptionsV1): RuntimeFrameV1 {
    const live = this.#animationState.clone();
    const origin = this.#sampleOriginState.clone();
    live.setTrackOptions(request);
    origin.setTrackOptions(request);
    return this.#publishConfiguration("setTrackOptions", live, origin, []);
  }

  queryTrackState(trackIndex: number): RuntimeTrackStateV1 | null {
    const result = this.#animationState.trackState(trackIndex);
    return result === null ? null : deepFreeze({ ...result });
  }

  queryQueuedEntries(trackIndex: number): readonly RuntimeQueuedTrackEntryV1[] {
    return deepFreeze(this.#animationState.queuedEntries(trackIndex));
  }

  queryTrackCount(): number {
    return this.#animationState.trackCount();
  }

  update(deltaSeconds: number): RuntimeStepV1 {
    this.#assertMutationAllowed("update");
    const delta = validateDelta(deltaSeconds, "update");
    const changed = this.#animationState.hasActiveEntries();
    const events = this.#advanceAnimationClock(delta, "update");
    const step: RuntimeStepV1 = {
      changed,
      timeSeconds: this.#timeSeconds,
      frameSequence: this.#sequence,
      events,
    };
    this.#dispatchRuntimeEvents(events);
    return this.#executionMode === "performance" ? step : deepFreeze(step);
  }

  apply(sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING): RuntimeFrameV1 {
    return this.#applyWithModifiersInternal(
      EMPTY_POSE_MODIFIERS_V1,
      EMPTY_GEOMETRY_MODIFIERS_V1,
      sampling,
      "apply",
    );
  }

  /**
   * Evaluates an ordered one-frame modifier batch after animation and
   * persistent overrides and before the single constraint/geometry solve.
   */
  applyWithModifiers(
    modifiers: RuntimePoseModifiersV1,
    sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING,
  ): RuntimeFrameV1 {
    return this.#applyWithModifiersInternal(
      modifiers,
      EMPTY_GEOMETRY_MODIFIERS_V1,
      sampling,
      "applyWithModifiers",
    );
  }

  /** Evaluates one transient final-geometry batch after the authoritative solve. */
  applyWithGeometryModifiers(
    geometryModifiers: RuntimeGeometryModifiersV1,
    sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING,
  ): RuntimeFrameV1 {
    return this.#applyWithModifiersInternal(
      EMPTY_POSE_MODIFIERS_V1,
      geometryModifiers,
      sampling,
      "applyWithGeometryModifiers",
    );
  }

  /** Evaluates transient procedural pose and geometry batches in their defined stages. */
  applyWithFrameModifiers(
    poseModifiers: RuntimePoseModifiersV1,
    geometryModifiers: RuntimeGeometryModifiersV1,
    sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING,
  ): RuntimeFrameV1 {
    return this.#applyWithModifiersInternal(
      poseModifiers,
      geometryModifiers,
      sampling,
      "applyWithFrameModifiers",
    );
  }

  #applyWithModifiersInternal(
    poseModifiers: RuntimePoseModifiersV1,
    geometryModifiers: RuntimeGeometryModifiersV1,
    sampling: RuntimeSamplingV1,
    operation: "apply" | "applyWithModifiers" | "applyWithGeometryModifiers" | "applyWithFrameModifiers",
  ): RuntimeFrameV1 {
    this.#requireNextSequence(operation);
    try {
      validatePoseModifiersV1(this.#data, poseModifiers, operation);
      validateRuntimeGeometryModifiersV1(this.#data, geometryModifiers, operation);
      const physics = this.#physicsForEvaluation();
      const frame = this.#evaluate(
        this.#animationState,
        this.#sequence + 1,
        sampling,
        EMPTY_RUNTIME_EVENTS_V1,
        this.#timeSeconds,
        this.#activeSkinIds,
        physics,
        null,
        this.#physicsBudgetForEvaluation(),
        this.#physicsEnvironment,
        this.#rootTransform,
        this.#hostOverrides,
        poseModifiers,
        operation,
        true,
        this.#geometryModifiers,
        geometryModifiers,
      );
      this.#physicsStates = physics;
      this.#sequence += 1;
      this.#commitEvaluatedFrame(frame);
      return frame;
    } catch (error) {
      throw remapRuntimeErrorV1(error, operation, "Runtime evaluation failed.");
    }
  }

  applyWithSampling(sampling: RuntimeSamplingV1): RuntimeFrameV1 {
    return this.apply(sampling);
  }

  advance(deltaSeconds: number, sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING): RuntimeFrameV1 {
    return this.#advanceWithModifiersInternal(
      deltaSeconds,
      EMPTY_POSE_MODIFIERS_V1,
      EMPTY_GEOMETRY_MODIFIERS_V1,
      sampling,
      "advance",
    );
  }

  /** Atomically advances clocks and evaluates one transient modifier batch. */
  advanceWithModifiers(
    deltaSeconds: number,
    modifiers: RuntimePoseModifiersV1,
    sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING,
  ): RuntimeFrameV1 {
    return this.#advanceWithModifiersInternal(
      deltaSeconds,
      modifiers,
      EMPTY_GEOMETRY_MODIFIERS_V1,
      sampling,
      "advanceWithModifiers",
    );
  }

  advanceWithGeometryModifiers(
    deltaSeconds: number,
    geometryModifiers: RuntimeGeometryModifiersV1,
    sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING,
  ): RuntimeFrameV1 {
    return this.#advanceWithModifiersInternal(
      deltaSeconds,
      EMPTY_POSE_MODIFIERS_V1,
      geometryModifiers,
      sampling,
      "advanceWithGeometryModifiers",
    );
  }

  advanceWithFrameModifiers(
    deltaSeconds: number,
    poseModifiers: RuntimePoseModifiersV1,
    geometryModifiers: RuntimeGeometryModifiersV1,
    sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING,
  ): RuntimeFrameV1 {
    return this.#advanceWithModifiersInternal(
      deltaSeconds,
      poseModifiers,
      geometryModifiers,
      sampling,
      "advanceWithFrameModifiers",
    );
  }

  #advanceWithModifiersInternal(
    deltaSeconds: number,
    poseModifiers: RuntimePoseModifiersV1,
    geometryModifiers: RuntimeGeometryModifiersV1,
    sampling: RuntimeSamplingV1,
    operation: "advance" | "advanceWithModifiers" | "advanceWithGeometryModifiers" | "advanceWithFrameModifiers",
  ): RuntimeFrameV1 {
    this.#requireNextSequence(operation);
    const previousState = this.#animationState;
    const previousTime = this.#timeSeconds;
    const previousPendingLength = this.#pendingEvents.length;
    let committedFrame: RuntimeFrameV1;
    let committedEvents: RuntimeEventV1[];
    try {
      const delta = validateDelta(deltaSeconds, operation);
      validatePoseModifiersV1(this.#data, poseModifiers, operation);
      validateRuntimeGeometryModifiersV1(this.#data, geometryModifiers, operation);
      const events = this.#advanceAnimationClock(delta, operation);
      const physics = this.#physicsForEvaluation();
      const frame = this.#evaluate(
        this.#animationState,
        this.#sequence + 1,
        sampling,
        events,
        this.#timeSeconds,
        this.#activeSkinIds,
        physics,
        null,
        this.#physicsBudgetForEvaluation(),
        this.#physicsEnvironment,
        this.#rootTransform,
        this.#hostOverrides,
        poseModifiers,
        operation,
        true,
        this.#geometryModifiers,
        geometryModifiers,
      );
      this.#physicsStates = physics;
      this.#sequence += 1;
      this.#commitEvaluatedFrame(frame);
      committedFrame = frame;
      committedEvents = events;
    } catch (error) {
      this.#animationState = previousState;
      this.#timeSeconds = previousTime;
      this.#pendingEvents.length = previousPendingLength;
      throw remapRuntimeErrorV1(error, operation, "Runtime advancement failed.");
    }
    this.#dispatchRuntimeEvents(committedEvents);
    return committedFrame;
  }

  #advanceAnimationClock(
    delta: number,
    operation: "update" | "advance" | "advanceWithModifiers"
      | "advanceWithGeometryModifiers" | "advanceWithFrameModifiers",
  ): RuntimeEventV1[] {
    const candidate = this.#executionMode === "performance"
      ? this.#performanceAnimationCandidate().copyFrom(this.#animationState)
      : this.#animationState.clone();
    let events: RuntimeEventV1[];
    try {
      events = candidate.update(delta, undefined, this.#executionMode === "performance");
    } catch (error) {
      throw animationUpdateErrorV1(error, operation, "deltaSeconds");
    }
    const nextTime = candidate.animationTime();
    if (!Number.isFinite(nextTime)) {
      throw new RuntimeErrorV1("nonFinite", operation, "The player clock exceeded binary32 range.", {
        field: "deltaSeconds",
      });
    }
    this.#animationState = candidate;
    this.#timeSeconds = nextTime;
    appendEventsV1(this.#pendingEvents, events);
    return events;
  }

  advanceStep(deltaSeconds: number, sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING): RuntimeStepV1 {
    const changed = this.#animationState.hasActiveEntries();
    const frame = this.advance(deltaSeconds, sampling);
    return deepFreeze({
      changed,
      timeSeconds: frame.timeSeconds,
      frameSequence: frame.sequence,
      events: frame.events,
    });
  }

  advanceWithSampling(deltaSeconds: number, sampling: RuntimeSamplingV1): RuntimeStepV1 {
    return this.advanceStep(deltaSeconds, sampling);
  }

  advanceWithModifiersStep(
    deltaSeconds: number,
    modifiers: RuntimePoseModifiersV1,
    sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING,
  ): RuntimeStepV1 {
    const changed = this.#animationState.hasActiveEntries();
    const frame = this.advanceWithModifiers(deltaSeconds, modifiers, sampling);
    const step = {
      changed,
      timeSeconds: frame.timeSeconds,
      frameSequence: frame.sequence,
      events: frame.events,
    };
    return this.#executionMode === "performance" ? step : deepFreeze(step);
  }

  advancePhysics(deltaSeconds: number): RuntimeStepV1 {
    const delta = validateDelta(deltaSeconds, "advancePhysics");
    this.#requireNextSequence("advancePhysics");
    try {
      const physics = this.#physicsForEvaluation();
      const frame = this.#evaluate(
        this.#animationState,
        this.#sequence + 1,
        AUTHORED_SAMPLING,
        EMPTY_RUNTIME_EVENTS_V1,
        this.#timeSeconds,
        this.#activeSkinIds,
        physics,
        delta,
        this.#physicsBudgetForEvaluation(),
      );
      this.#physicsStates = physics;
      this.#sequence += 1;
      this.#commitEvaluatedFrame(frame);
      return deepFreeze({
        changed: delta > 0,
        timeSeconds: frame.timeSeconds,
        frameSequence: frame.sequence,
        events: [],
      });
    } catch (error) {
      throw remapRuntimeErrorV1(error, "advancePhysics", "Physics-only advancement failed.");
    }
  }

  sampleAt(request: RuntimeSeekV1): RuntimeStepV1 {
    this.#assertMutationAllowed("seek");
    const timeSeconds = validateAbsoluteTime(request.timeSeconds);
    const fixedStepSeconds = validateFixedStep(request.fixedStepSeconds);
    const sampling = request.sampling ?? AUTHORED_SAMPLING;
    const stepCount = Math.ceil(timeSeconds / fixedStepSeconds);
    if (stepCount > MAX_REPLAY_STEPS) {
      throw new RuntimeErrorV1("resourceLimit", "seek", "Absolute sampling requires more than 1,000,000 replay steps.", {
        field: "fixedStepSeconds",
      });
    }
    this.#requireNextSequence("seek");

    const committedEvents: RuntimeEventV1[] = [];
    let committedStep: RuntimeStepV1;
    try {
      const candidate = this.#sampleOriginState.clone();
      const physics = new RuntimePhysicsStateStoreV1();
      const budget = physicsBudget();
      let previousTarget = 0;
      let frame: RuntimeFrameV1 | null = this.#evaluate(
        candidate,
        this.#sequence + 1,
        sampling,
        EMPTY_RUNTIME_EVENTS_V1,
        candidate.animationTime(),
        this.#sampleOriginSkinIds,
        physics,
        null,
        budget,
        undefined,
        undefined,
        undefined,
        undefined,
        "seek",
        stepCount === 0,
      );
      for (let index = 1; index <= stepCount; index += 1) {
        const target = index === stepCount
          ? timeSeconds
          : Math.min(f32(index * fixedStepSeconds), timeSeconds);
        const delta = f32(Math.max(0, target - previousTarget));
        try {
          appendEventsV1(
            committedEvents,
            candidate.update(delta, MAX_REPLAY_EVENTS - committedEvents.length),
          );
        } catch (error) {
          throw animationUpdateErrorV1(error, "seek", "timeSeconds");
        }
        frame = this.#evaluate(
          candidate,
          this.#sequence + 1,
          sampling,
          index === stepCount ? committedEvents : EMPTY_RUNTIME_EVENTS_V1,
          candidate.animationTime(),
          this.#sampleOriginSkinIds,
          physics,
          null,
          budget,
          undefined,
          undefined,
          undefined,
          undefined,
          "seek",
          index === stepCount,
        );
        previousTarget = target;
      }
      if (frame === null) throw new RuntimeErrorV1("internal", "seek", "Absolute sampling produced no frame.");
      this.#animationState = candidate;
      this.#physicsStates = physics;
      this.#timeSeconds = candidate.animationTime();
      this.#sequence += 1;
      this.#commitEvaluatedFrame(frame);
      committedStep = deepFreeze({
        changed: stepCount > 0,
        timeSeconds: frame.timeSeconds,
        frameSequence: frame.sequence,
        events: committedEvents,
      });
    } catch (error) {
      if (error instanceof RuntimeErrorV1) {
        throw new RuntimeErrorV1(error.runtimeName, "seek", error.message, {
          field: error.field,
          entityId: error.entityId,
          cause: error,
        });
      }
      throw asRuntimeError(error, "seek", "Absolute runtime sampling failed.");
    }
    this.#dispatchRuntimeEvents(committedEvents);
    return committedStep;
  }

  seek(request: RuntimeSeekV1): RuntimeStepV1 {
    return this.sampleAt(request);
  }

  drainEvents(): RuntimeFrameV1["events"] {
    this.#assertMutationAllowed("drainEvents");
    const events = deepFreeze([...this.#pendingEvents]);
    this.#pendingEvents.length = 0;
    return events;
  }

  reset(): RuntimeFrameV1 {
    this.#requireNextSequence("reset");
    const animationState = new RuntimeAnimationStateV1(this.#data);
    const sampleOriginState = new RuntimeAnimationStateV1(this.#data);
    const defaultSkin = this.#data.document.skins[0];
    const activeSkinIds = defaultSkin === undefined ? [] : [defaultSkin.id];
    const physics = new RuntimePhysicsStateStoreV1();
    try {
      const frame = this.#evaluate(
        animationState,
        this.#sequence + 1,
        AUTHORED_SAMPLING,
        EMPTY_RUNTIME_EVENTS_V1,
        0,
        activeSkinIds,
        physics,
        null,
        this.#physicsBudgetForEvaluation(),
        DEFAULT_PHYSICS_ENVIRONMENT_V1,
        IDENTITY_ROOT_TRANSFORM_V1,
      );
      this.#animationState = animationState;
      this.#sampleOriginState = sampleOriginState;
      this.#activeSkinIds = activeSkinIds;
      this.#sampleOriginSkinIds = [...activeSkinIds];
      this.#timeSeconds = 0;
      this.#rootTransform = IDENTITY_ROOT_TRANSFORM_V1;
      this.#physicsStates = physics;
      this.#physicsEnvironment = DEFAULT_PHYSICS_ENVIRONMENT_V1;
      this.#hostOverrides = emptyHostOverridesV1();
      this.#sequence += 1;
      this.#commitEvaluatedFrame(frame);
      this.#pendingEvents.length = 0;
      return frame;
    } catch (error) {
      throw remapRuntimeErrorV1(error, "reset", "Runtime reset failed.");
    }
  }

  #publishConfiguration(
    operation: string,
    live: RuntimeAnimationStateV1,
    origin: RuntimeAnimationStateV1,
    events: readonly RuntimeEventV1[],
  ): RuntimeFrameV1 {
    this.#requireNextSequence(operation);
    let committedFrame: RuntimeFrameV1;
    try {
      const timeSeconds = live.animationTime();
      const physics = this.#physicsForEvaluation();
      const frame = this.#evaluate(
        live,
        this.#sequence + 1,
        AUTHORED_SAMPLING,
        EMPTY_RUNTIME_EVENTS_V1,
        timeSeconds,
        this.#activeSkinIds,
        physics,
        null,
        this.#physicsBudgetForEvaluation(),
      );
      this.#animationState = live;
      this.#sampleOriginState = origin;
      this.#timeSeconds = timeSeconds;
      this.#physicsStates = physics;
      appendEventsV1(this.#pendingEvents, events);
      this.#sequence += 1;
      this.#commitEvaluatedFrame(frame);
      committedFrame = frame;
    } catch (error) {
      throw remapRuntimeErrorV1(error, operation, "Animation-state configuration failed.");
    }
    this.#dispatchRuntimeEvents(events);
    return committedFrame;
  }

  #configureHostOverrides(
    operation: string,
    configure: (next: MutableRuntimeHostOverridesV1) => void,
    sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING,
  ): RuntimeFrameV1 {
    this.#requireNextSequence(operation);
    const next = cloneHostOverridesV1(this.#hostOverrides);
    configure(next);
    const candidate = freezeHostOverridesV1(next);
    const physics = this.#physicsForEvaluation();
    try {
      const frame = this.#evaluate(
        this.#animationState,
        this.#sequence + 1,
        sampling,
        EMPTY_RUNTIME_EVENTS_V1,
        this.#timeSeconds,
        this.#activeSkinIds,
        physics,
        null,
        this.#physicsBudgetForEvaluation(),
        this.#physicsEnvironment,
        this.#rootTransform,
        candidate,
      );
      this.#hostOverrides = candidate;
      this.#physicsStates = physics;
      this.#sequence += 1;
      this.#commitEvaluatedFrame(frame);
      return frame;
    } catch (error) {
      throw remapRuntimeErrorV1(error, operation, "Host override transaction failed.");
    }
  }

  #stageHostOverrideOperation(
    next: MutableRuntimeHostOverridesV1,
    request: RuntimeAuthoringOverrideOperationV1,
    operation: string,
    index: number,
  ): void {
    const field = `operations[${index}]`;
    switch (request.operation) {
      case "setBoneLocal": {
        if (!this.#data.document.bones.some((bone) => bone.id === request.boneId)) {
          throw batchNotFound(operation, `${field}.boneId`, "bone", request.boneId);
        }
        next.boneLocals.set(request.boneId, normalizeBoneLocalOverride(request.local, operation, `${field}.local`));
        return;
      }
      case "clearBoneLocal":
        if (!this.#data.document.bones.some((bone) => bone.id === request.boneId)) {
          throw batchNotFound(operation, `${field}.boneId`, "bone", request.boneId);
        }
        next.boneLocals.delete(request.boneId);
        return;
      case "setRegionAttachmentPose": {
        const attachment = this.#attachmentForBatch(request.attachmentId, operation, `${field}.attachmentId`);
        if (attachment.type !== "region") throw batchAttachmentKind(operation, field, request.attachmentId, "Region");
        next.regionPoses.set(
          request.attachmentId,
          normalizeRegionPoseOverride(request.attachmentId, request.pose, operation, `${field}.pose`),
        );
        return;
      }
      case "clearRegionAttachmentPose": {
        const attachment = this.#attachmentForBatch(request.attachmentId, operation, `${field}.attachmentId`);
        if (attachment.type !== "region") throw batchAttachmentKind(operation, field, request.attachmentId, "Region");
        next.regionPoses.delete(request.attachmentId);
        return;
      }
      case "setDrawOrder":
        next.drawOrder = normalizeDrawOrderOverride(this.#data, request.slotIds, operation, `${field}.slotIds`);
        return;
      case "clearDrawOrder":
        next.drawOrder = null;
        return;
      case "setVertexDeform": {
        const attachment = this.#attachmentForBatch(request.attachmentId, operation, `${field}.attachmentId`);
        if (attachment.type === "region" || attachment.type === "point") {
          throw batchAttachmentKind(operation, field, request.attachmentId, "vertex attachment");
        }
        next.vertexDeforms.set(
          request.attachmentId,
          normalizeVertexDeformOverride(
            this.#data,
            attachment,
            { space: request.space, values: request.values },
            operation,
            field,
          ),
        );
        return;
      }
      case "clearVertexDeform": {
        const attachment = this.#attachmentForBatch(request.attachmentId, operation, `${field}.attachmentId`);
        if (attachment.type === "region" || attachment.type === "point") {
          throw batchAttachmentKind(operation, field, request.attachmentId, "vertex attachment");
        }
        next.vertexDeforms.delete(request.attachmentId);
        return;
      }
      case "setSlotAttachment": {
        const slot = this.#data.document.slots.find((candidate) => candidate.id === request.slotId);
        if (slot === undefined) throw batchNotFound(operation, `${field}.slotId`, "slot", request.slotId);
        if (request.attachmentId !== null) {
          const attachment = this.#attachmentForBatch(request.attachmentId, operation, `${field}.attachmentId`);
          if (attachment.slotId !== request.slotId) {
            throw new RuntimeErrorV1("invalidArgument", operation, "Attachment belongs to another slot.", {
              field: `${field}.attachmentId`,
              entityId: request.attachmentId,
            });
          }
        }
        next.slotAttachments.set(request.slotId, request.attachmentId);
        return;
      }
      case "clearSlotAttachment":
        if (!this.#data.document.slots.some((slot) => slot.id === request.slotId)) {
          throw batchNotFound(operation, `${field}.slotId`, "slot", request.slotId);
        }
        next.slotAttachments.delete(request.slotId);
        return;
      case "setSlotTint":
        if (!this.#data.document.slots.some((slot) => slot.id === request.slotId)) {
          throw batchNotFound(operation, `${field}.slotId`, "slot", request.slotId);
        }
        next.slotTints.set(request.slotId, normalizeSlotTintOverride(request.tint, operation, `${field}.tint`));
        return;
      case "clearSlotTint":
        if (!this.#data.document.slots.some((slot) => slot.id === request.slotId)) {
          throw batchNotFound(operation, `${field}.slotId`, "slot", request.slotId);
        }
        next.slotTints.delete(request.slotId);
        return;
      case "setConstraint": {
        const constraint = this.#data.document.constraints.find((candidate) => candidate.id === request.constraintId);
        if (constraint === undefined) {
          throw batchNotFound(operation, `${field}.constraintId`, "constraint", request.constraintId);
        }
        next.constraints.set(
          request.constraintId,
          normalizeConstraintOverride(constraint, request.parameters, operation, `${field}.parameters`),
        );
        return;
      }
      case "clearConstraint":
        if (!this.#data.document.constraints.some((constraint) => constraint.id === request.constraintId)) {
          throw batchNotFound(operation, `${field}.constraintId`, "constraint", request.constraintId);
        }
        next.constraints.delete(request.constraintId);
        return;
      default:
        throw new RuntimeErrorV1("invalidArgument", operation, "Unknown authoring override operation.", {
          field: `${field}.operation`,
        });
    }
  }

  #attachmentForBatch(attachmentId: string, operation: string, field: string): RuntimeAttachmentV1 {
    const attachment = this.#data.document.attachments.find((candidate) => candidate.id === attachmentId);
    if (attachment === undefined) throw batchNotFound(operation, field, "attachment", attachmentId);
    return attachment;
  }

  #physicsForEvaluation(): RuntimePhysicsStateStoreV1 {
    if (this.#executionMode !== "performance") return this.#physicsStates.clone();
    const candidate = this.#physicsStates === this.#performancePhysicsStates[0]
      ? this.#performancePhysicsStates[1]
      : this.#performancePhysicsStates[0];
    return candidate.copyFrom(this.#physicsStates);
  }

  #performanceAnimationCandidate(): RuntimeAnimationStateV1 {
    return this.#animationState === this.#performanceAnimationStates[0]
      ? this.#performanceAnimationStates[1]
      : this.#performanceAnimationStates[0];
  }

  #performanceWorkspaceForEvaluation(): RuntimePerformanceWorkspaceV1 {
    return this.#performanceWorkspaceIndex === 0
      ? this.#performanceWorkspaces[1]
      : this.#performanceWorkspaces[0];
  }

  #physicsBudgetForEvaluation(): RuntimePhysicsBudgetV1 {
    if (this.#executionMode !== "performance") return physicsBudget();
    this.#physicsBudgetScratch.remaining = MAX_PHYSICS_SUBSTEPS_PER_OPERATION_V1;
    return this.#physicsBudgetScratch;
  }

  #beginEvaluationStats(sequence: number): void {
    if (this.#evaluationStatsSequence === sequence) return;
    this.#evaluationStatsSequence = sequence;
    this.#evaluationStatsScratch.animationSamples = 0;
    this.#evaluationStatsScratch.constraintGeometrySolves = 0;
    this.#evaluationStatsScratch.framesPublished = 0;
  }

  #runBeforeConstraintHooks(pose: RuntimeSampledPoseV1): void {
    if (this.#beforeConstraintHooks.length === 0) return;
    this.#hookPhase = "beforeConstraints";
    this.#dispatchingHookRecords = this.#beforeConstraintHooks;
    this.#poseEditor.activate(this.#data, pose);
    const count = this.#beforeConstraintHooks.length;
    try {
      for (let index = 0; index < count; index += 1) {
        const record = this.#beforeConstraintHooks[index];
        if (record?.active === true) record.listener(this.#poseEditor);
      }
    } finally {
      this.#poseEditor.deactivate();
      this.#dispatchingHookRecords = null;
      this.#hookPhase = null;
      commitPendingHookRemovalsV1(this.#beforeConstraintHooks);
      compactHooksV1(this.#beforeConstraintHooks);
    }
  }

  #runAfterConstraintHooks(frame: RuntimeFrameV1): void {
    if (this.#afterConstraintHooks.length === 0) return;
    this.#hookPhase = "afterConstraints";
    this.#dispatchingHookRecords = this.#afterConstraintHooks;
    const count = this.#afterConstraintHooks.length;
    try {
      for (let index = 0; index < count; index += 1) {
        const record = this.#afterConstraintHooks[index];
        if (record?.active === true) record.listener(frame);
      }
    } finally {
      this.#dispatchingHookRecords = null;
      this.#hookPhase = null;
      commitPendingHookRemovalsV1(this.#afterConstraintHooks);
      compactHooksV1(this.#afterConstraintHooks);
    }
  }

  #dispatchRuntimeEvents(events: readonly RuntimeEventV1[]): void {
    if (events.length === 0 || this.#eventHooks.length === 0) return;
    this.#hookPhase = "events";
    this.#dispatchingHookRecords = this.#eventHooks;
    const listenerCount = this.#eventHooks.length;
    try {
      // Event order is authoritative. Registration order is the stable
      // tiebreaker when more than one listener observes the same event.
      for (const event of events) {
        for (let index = 0; index < listenerCount; index += 1) {
          const record = this.#eventHooks[index];
          if (record?.active !== true || (record.kind !== null && record.kind !== event.kind)) continue;
          record.listener(event);
        }
      }
    } finally {
      this.#dispatchingHookRecords = null;
      this.#hookPhase = null;
      commitPendingHookRemovalsV1(this.#eventHooks);
      compactHooksV1(this.#eventHooks);
    }
  }

  #evaluate(
    animationState: RuntimeAnimationStateV1,
    sequence: number,
    sampling: RuntimeSamplingV1,
    events: RuntimeFrameV1["events"],
    timeSeconds = animationState.animationTime(),
    activeSkinIds: readonly string[] = this.#activeSkinIds,
    physicsStates: RuntimePhysicsStateStoreV1 = this.#physicsStates,
    physicsDeltaOverride: number | null = null,
    physicsStepBudget: RuntimePhysicsBudgetV1 | null = null,
    physicsEnvironment: RuntimePhysicsEnvironmentV1 = this.#physicsEnvironment,
    rootTransform: RootTransformV1 = this.#rootTransform,
    hostOverrides: RuntimeHostOverridesV1 = this.#hostOverrides,
    poseModifiers: RuntimePoseModifiersV1 = EMPTY_POSE_MODIFIERS_V1,
    operation = "apply",
    publishCandidate = true,
    persistentGeometryModifiers: RuntimeGeometryModifiersV1 = this.#geometryModifiers,
    transientGeometryModifiers: RuntimeGeometryModifiersV1 = EMPTY_GEOMETRY_MODIFIERS_V1,
  ): RuntimeFrameV1 {
    this.#beginEvaluationStats(sequence);
    this.#evaluationStatsScratch.animationSamples += 1;
    const reuseFrameStorage = this.#executionMode === "performance";
    const performanceWorkspace = reuseFrameStorage ? this.#performanceWorkspaceForEvaluation() : null;
    const layers = animationState.layers(sampling, reuseFrameStorage);
    const physicsClockInput = primaryPhysicsClock(
      animationState,
      timeSeconds,
      sampling,
      reuseFrameStorage ? this.#physicsClockInputScratch : null,
    );
    const physicsClock = physicsStates.advanceClock(
      physicsClockInput,
      reuseFrameStorage ? this.#physicsClockStepScratch : null,
    );
    const resolvedPhysicsStepBudget = physicsStepBudget ?? this.#physicsBudgetForEvaluation();
    const animated = sampleAnimationLayersV1(
      this.#data,
      layers,
      activeSkinIds,
      performanceWorkspace?.samplingScratch ?? null,
    );
    const sampled = applyHostOverridesV1(
      this.#data,
      animated,
      hostOverrides,
      performanceWorkspace?.hostDeformPool ?? null,
    );
    applyPoseModifiersV1(this.#data, sampled, poseModifiers, operation);
    // Fixed-step seek replay needs the authoritative sampled/constraint state
    // for Physics continuity, but only the requested final sample is an
    // observable evaluation. Hooks and renderer output therefore run once.
    if (publishCandidate) this.#runBeforeConstraintHooks(sampled);
    applyPhysicsResetEdgesV1(this.#data, sampled, layers, physicsClock, physicsStates);
    const physicsDeltaSeconds = physicsDeltaOverride ?? physicsClock.delta;
    const root = rootAffineV1(
      rootTransform,
      performanceWorkspace?.rootAffineScratch ?? null,
    );
    let constraintContext: MutableRuntimeConstraintSolveContextV1;
    if (reuseFrameStorage) {
      constraintContext = performanceWorkspace?.constraintContextScratch ?? {
        data: this.#data,
        slots: sampled.slots,
        deforms: sampled.deforms,
        physicsStates,
        physicsDeltaSeconds,
        physicsEnvironment,
        physicsBudget: resolvedPhysicsStepBudget,
        referenceScale: this.#data.document.skeleton.referenceScale,
        rootScaleX: rootTransform.scaleX,
        rootScaleY: rootTransform.scaleY,
        sampling,
        scratch: performanceWorkspace?.constraintScratch ?? null,
      };
      constraintContext.data = this.#data;
      constraintContext.slots = sampled.slots;
      constraintContext.deforms = sampled.deforms;
      constraintContext.physicsStates = physicsStates;
      constraintContext.physicsDeltaSeconds = physicsDeltaSeconds;
      constraintContext.physicsEnvironment = physicsEnvironment;
      constraintContext.physicsBudget = resolvedPhysicsStepBudget;
      constraintContext.referenceScale = this.#data.document.skeleton.referenceScale;
      constraintContext.rootScaleX = rootTransform.scaleX;
      constraintContext.rootScaleY = rootTransform.scaleY;
      constraintContext.sampling = sampling;
      constraintContext.scratch = performanceWorkspace?.constraintScratch ?? null;
      if (performanceWorkspace !== null) performanceWorkspace.constraintContextScratch = constraintContext;
    } else {
      constraintContext = {
        data: this.#data,
        slots: sampled.slots,
        deforms: sampled.deforms,
        physicsStates,
        physicsDeltaSeconds,
        physicsEnvironment,
        physicsBudget: resolvedPhysicsStepBudget,
        referenceScale: this.#data.document.skeleton.referenceScale,
        rootScaleX: rootTransform.scaleX,
        rootScaleY: rootTransform.scaleY,
        sampling,
        scratch: null,
      };
    }
    this.#evaluationStatsScratch.constraintGeometrySolves += 1;
    const solved = solveRuntimeConstraintsV1(
      sampled,
      this.#data.document.skins,
      root,
      rootTransform.rotationDegrees,
      constraintContext,
    );
    if (!publishCandidate) {
      if (this.#currentFrame === null) {
        throw new RuntimeErrorV1("internal", "seek", "Replay requires an existing published frame.");
      }
      return this.#currentFrame;
    }
    const worldByBoneId = solved.worldByBoneId;
    const reusableFrame = performanceWorkspace?.frame ?? null;
    const bones = reusableFrame?.bones as MutableRuntimeBoneFrameV1[] | undefined
      ?? new Array<MutableRuntimeBoneFrameV1>(solved.bones.length);
    bones.length = solved.bones.length;
    const boneProjectionLinearCache = performanceWorkspace === null
      ? null
      : ensureBoneProjectionLinearCacheV1(performanceWorkspace, solved.bones.length);
    for (let index = 0; index < solved.bones.length; index += 1) {
      const bone = solved.bones[index];
      if (bone === undefined) continue;
      const matrix = worldByBoneId.get(bone.id);
      if (matrix === undefined) {
        throw new RuntimeErrorV1("missingReference", "apply", "Validated bone world state is unavailable.", {
          entityId: bone.id,
        });
      }
      let output = bones[index];
      const cacheOffset = index * 4;
      const projectionChanged = output === undefined
        || boneProjectionLinearCache === null
        || !Object.is(boneProjectionLinearCache[cacheOffset], matrix.a)
        || !Object.is(boneProjectionLinearCache[cacheOffset + 1], matrix.b)
        || !Object.is(boneProjectionLinearCache[cacheOffset + 2], matrix.c)
        || !Object.is(boneProjectionLinearCache[cacheOffset + 3], matrix.d);
      if (output === undefined) {
        output = {
          id: bone.id,
          matrix,
          x: matrix.tx,
          y: matrix.ty,
          rotationDegrees: 0,
          scaleX: 0,
          scaleY: 0,
        };
        bones[index] = output;
      }
      output.id = bone.id;
      output.matrix = matrix;
      output.x = matrix.tx;
      output.y = matrix.ty;
      if (projectionChanged) {
        output.rotationDegrees = f32Mul(Math.atan2(matrix.b, matrix.a), F32_RADIANS_TO_DEGREES);
        output.scaleX = f32MatrixAxisLength(matrix.a, matrix.b);
        output.scaleY = f32MatrixAxisLength(matrix.c, matrix.d);
        if (boneProjectionLinearCache !== null) {
          boneProjectionLinearCache[cacheOffset] = matrix.a;
          boneProjectionLinearCache[cacheOffset + 1] = matrix.b;
          boneProjectionLinearCache[cacheOffset + 2] = matrix.c;
          boneProjectionLinearCache[cacheOffset + 3] = matrix.d;
        }
      }
    }

    const slotById = performanceWorkspace !== null
      ? performanceWorkspace.slotByIdScratch
      : new Map<string, RuntimeSlotV1>();
    if (!slotMapShapeMatchesV1(slotById, solved.slots)) slotById.clear();
    for (let index = 0; index < solved.slots.length; index += 1) {
      const slot = solved.slots[index];
      if (slot !== undefined) slotById.set(slot.id, slot);
    }
    const attachments = reusableFrame?.renderPacket.attachments as RuntimeRenderAttachmentV1[] | undefined
      ?? [];
    let attachmentCount = 0;
    let activeClip: RuntimeClipContextV1 | null = null;
    for (let drawOrdinal = 0; drawOrdinal < solved.drawOrderSlotIds.length; drawOrdinal += 1) {
      const slotId = solved.drawOrderSlotIds[drawOrdinal];
      if (slotId === undefined) continue;
      const slot = slotById.get(slotId);
      if (slot === undefined) continue;
      if (slot.attachmentId === null) {
        if (activeClip?.endSlotId === slot.id) activeClip = null;
        continue;
      }
      const attachment = solved.regions.get(slot.attachmentId) ?? this.#data.attachment(slot.attachmentId);
      const boneWorld = worldByBoneId.get(slot.boneId);
      if (boneWorld === undefined) {
        throw new RuntimeErrorV1("missingReference", "apply", "Validated slot bone is unavailable.", {
          field: "boneId",
          entityId: slot.id,
        });
      }
      const sourceZIndex = solved.drawOrderSampled ? drawOrdinal : slot.zIndex;
      if (attachment.type === "clipping") {
        activeClip = createRuntimeClipContextV1(
          attachment,
          boneWorld,
          worldByBoneId,
          solved.deforms.get(attachment.id) ?? null,
        );
      } else if (attachment.type === "region") {
        const imageId = selectedSequenceImageId(
          attachment.imageId,
          attachment.sequence,
          solved.sequenceIndices.get(attachment.id),
        );
        const image = this.#data.image(imageId);
        const atlas = this.#data.atlas(image.atlasId);
        let regionInput: RegionRenderInputV1;
        let preparedRegionSource: RuntimeRegionSourceGeometryV1 | null = null;
        if (this.#executionMode === "performance") {
          let reusableInput = performanceWorkspace?.regionRenderInputPool.get(attachment.id);
          if (reusableInput === undefined) {
            reusableInput = {
              drawIndex: attachmentCount,
              sourceZIndex,
              slot,
              attachment,
              boneWorld,
              image,
              atlas,
              clip: activeClip,
              preparedSource: prepareRegionSourceGeometryV1(image, atlas),
            };
            performanceWorkspace?.regionRenderInputPool.set(attachment.id, reusableInput);
          } else {
            reusableInput.drawIndex = attachmentCount;
            reusableInput.sourceZIndex = sourceZIndex;
            reusableInput.slot = slot;
            reusableInput.attachment = attachment;
            reusableInput.boneWorld = boneWorld;
            reusableInput.image = image;
            reusableInput.atlas = atlas;
            reusableInput.clip = activeClip;
            if (reusableInput.preparedSource.texture.imageId !== image.imageId) {
              reusableInput.preparedSource = prepareRegionSourceGeometryV1(image, atlas);
            }
          }
          preparedRegionSource = reusableInput.preparedSource;
          regionInput = reusableInput;
        } else {
          regionInput = {
            drawIndex: attachmentCount,
            sourceZIndex,
            slot,
            attachment,
            boneWorld,
            image,
            atlas,
            clip: activeClip,
          };
        }
        const rendered = buildPreparedRegionRenderAttachmentV1(
          regionInput,
          performanceWorkspace !== null
            ? performanceWorkspace.renderAttachmentPool.get(attachment.id) ?? null
            : null,
          preparedRegionSource,
        );
        if (rendered !== null) {
          attachments[attachmentCount] = rendered;
          attachmentCount += 1;
          if (this.#executionMode === "performance") {
            performanceWorkspace?.renderAttachmentPool.set(attachment.id, rendered);
          }
        }
      } else if (attachment.type === "mesh") {
        const sampledSequenceIndex = solved.sequenceIndices.get(attachment.id);
        const sequenceIndex = sampledSequenceIndex ?? null;
        let meshInput: MeshRenderInputV1;
        let preparedMeshTexture: RuntimeMeshTextureSourceV1 | null = null;
        if (this.#executionMode === "performance") {
          const imageId = selectedSequenceImageId(
            attachment.imageId,
            attachment.sequence,
            sampledSequenceIndex,
          );
          let reusableInput = performanceWorkspace?.meshRenderInputPool.get(attachment.id);
          if (reusableInput === undefined) {
            const image = this.#data.image(imageId);
            reusableInput = {
              drawIndex: attachmentCount,
              sourceZIndex,
              slot,
              mesh: attachment,
              slotWorld: boneWorld,
              worldByBoneId,
              data: this.#data,
              deforms: solved.deforms,
              sequenceIndex,
              clip: activeClip,
              preparedTextureSource: prepareMeshTextureSourceV1(
                image,
                this.#data.atlas(image.atlasId),
              ),
            };
            performanceWorkspace?.meshRenderInputPool.set(attachment.id, reusableInput);
          } else {
            reusableInput.drawIndex = attachmentCount;
            reusableInput.sourceZIndex = sourceZIndex;
            reusableInput.slot = slot;
            reusableInput.mesh = attachment;
            reusableInput.slotWorld = boneWorld;
            reusableInput.worldByBoneId = worldByBoneId;
            reusableInput.data = this.#data;
            reusableInput.deforms = solved.deforms;
            reusableInput.sequenceIndex = sequenceIndex;
            reusableInput.clip = activeClip;
            if (reusableInput.preparedTextureSource.texture.imageId !== imageId) {
              const image = this.#data.image(imageId);
              reusableInput.preparedTextureSource = prepareMeshTextureSourceV1(
                image,
                this.#data.atlas(image.atlasId),
              );
            }
          }
          preparedMeshTexture = reusableInput.preparedTextureSource;
          meshInput = reusableInput;
        } else {
          meshInput = {
            drawIndex: attachmentCount,
            sourceZIndex,
            slot,
            mesh: attachment,
            slotWorld: boneWorld,
            worldByBoneId,
            data: this.#data,
            deforms: solved.deforms,
            sequenceIndex,
            clip: activeClip,
          };
        }
        const rendered = buildPreparedMeshRenderAttachmentV1(
          meshInput,
          performanceWorkspace !== null
            ? performanceWorkspace.renderAttachmentPool.get(attachment.id) ?? null
            : null,
          preparedMeshTexture,
        );
        if (rendered !== null) {
          attachments[attachmentCount] = rendered;
          attachmentCount += 1;
          if (this.#executionMode === "performance") {
            performanceWorkspace?.renderAttachmentPool.set(attachment.id, rendered);
          }
        }
      }
      if (activeClip?.endSlotId === slot.id) activeClip = null;
    }

    attachments.length = attachmentCount;

    const geometryModifierStats = applyRuntimeGeometryModifiersV1(
      attachments,
      persistentGeometryModifiers,
      transientGeometryModifiers,
      sequence,
      timeSeconds,
      performanceWorkspace?.geometryModifierWorkspace ?? null,
    );

    let renderPacket: RuntimeRenderPacketV1;
    let frame: RuntimeFrameV1;
    if (reusableFrame !== null) {
      const mutablePacket = reusableFrame.renderPacket as MutableRuntimeRenderPacketV1;
      mutablePacket.attachments = attachments;
      reusableFrame.sequence = sequence;
      reusableFrame.timeSeconds = timeSeconds;
      reusableFrame.bones = bones;
      reusableFrame.activeSkinIds = activeSkinIds;
      reusableFrame.sampledSkinIds = solved.sampledSkinIds;
      reusableFrame.events = events;
      renderPacket = mutablePacket;
      frame = reusableFrame;
    } else {
      renderPacket = {
        coordinateSystem: "xRightYUp",
        uvOrigin: "topLeft",
        tintColorSpace: "srgb",
        tintAlphaMode: "straight",
        attachments,
      };
      const frameValue: RuntimeFrameV1 = {
        sequence,
        timeSeconds,
        bones,
        activeSkinIds: this.#executionMode === "performance" ? activeSkinIds : [...activeSkinIds],
        sampledSkinIds: this.#executionMode === "performance" ? solved.sampledSkinIds : [...solved.sampledSkinIds],
        events: this.#executionMode === "performance" ? events : [...events],
        renderPacket,
      };
      frame = this.#executionMode === "performance" ? frameValue : deepFreeze(frameValue);
      if (performanceWorkspace !== null) performanceWorkspace.frame = frameValue as MutableRuntimeFrameV1;
    }
    let evaluationSnapshot: RuntimeEvaluationSnapshotV1;
    if (performanceWorkspace !== null) {
      const reusableSnapshot = performanceWorkspace.evaluationSnapshot;
      if (reusableSnapshot === null) {
        performanceWorkspace.evaluationSnapshot = { pose: solved, worldByBoneId, geometryModifierStats };
      } else {
        reusableSnapshot.pose = solved;
        reusableSnapshot.worldByBoneId = worldByBoneId;
        reusableSnapshot.geometryModifierStats = geometryModifierStats;
      }
      evaluationSnapshot = performanceWorkspace.evaluationSnapshot as RuntimeEvaluationSnapshotV1;
    } else {
      evaluationSnapshot = { pose: solved, worldByBoneId, geometryModifierStats };
    }
    this.#runAfterConstraintHooks(frame);
    this.#evaluationSnapshots.set(frame, evaluationSnapshot);
    return frame;
  }

  #resetPhysicsState(constraintId?: string): { readonly frame: RuntimeFrameV1; readonly cleared: boolean } {
    const operation = constraintId === undefined ? "resetPhysics" : "resetPhysicsConstraint";
    this.#requireNextSequence(operation);
    try {
      const physics = this.#physicsForEvaluation();
      const cleared = physics.reset(constraintId);
      const frame = this.#evaluate(
        this.#animationState,
        this.#sequence + 1,
        AUTHORED_SAMPLING,
        EMPTY_RUNTIME_EVENTS_V1,
        this.#timeSeconds,
        this.#activeSkinIds,
        physics,
        null,
        this.#physicsBudgetForEvaluation(),
      );
      this.#physicsStates = physics;
      this.#sequence += 1;
      this.#commitEvaluatedFrame(frame);
      return { frame, cleared };
    } catch (error) {
      throw remapRuntimeErrorV1(error, operation, "Physics reset failed.");
    }
  }

  #publishedPose(operation: string): RuntimeSampledPoseV1 {
    if (this.#currentPose === null) {
      throw new RuntimeErrorV1("invalidState", operation, "No published sampled pose is available.");
    }
    return this.#currentPose;
  }

  #publishedWorld(operation: string): ReadonlyMap<string, AffineV1> {
    if (this.#currentWorldByBoneId === null) {
      throw new RuntimeErrorV1("invalidState", operation, "No published bone world state is available.");
    }
    return this.#currentWorldByBoneId;
  }

  #attachmentForQuery(attachmentId: string, operation: string): RuntimeAttachmentV1 {
    const attachment = this.#data.document.attachments.find((candidate) => candidate.id === attachmentId);
    if (attachment === undefined) throw queryNotFound(operation, "attachmentId", "attachment", attachmentId);
    return attachment;
  }

  #commitEvaluatedFrame(frame: RuntimeFrameV1): void {
    const snapshot = this.#evaluationSnapshots.get(frame);
    if (snapshot === undefined) {
      throw new RuntimeErrorV1("internal", "apply", "Evaluated frame snapshot is unavailable.");
    }
    this.#currentPose = snapshot.pose;
    this.#currentWorldByBoneId = snapshot.worldByBoneId;
    this.#currentFrame = frame;
    this.#lastGeometryModifierStatsValue.persistentOperations = snapshot.geometryModifierStats.persistentOperations;
    this.#lastGeometryModifierStatsValue.transientOperations = snapshot.geometryModifierStats.transientOperations;
    this.#lastGeometryModifierStatsValue.attachmentVisits = snapshot.geometryModifierStats.attachmentVisits;
    this.#lastGeometryModifierStatsValue.vertexWrites = snapshot.geometryModifierStats.vertexWrites;
    this.#lastGeometryModifierStatsValue.uvWrites = snapshot.geometryModifierStats.uvWrites;
    this.#lastGeometryModifierStatsValue.tintWrites = snapshot.geometryModifierStats.tintWrites;
    if (this.#executionMode === "performance") {
      const workspaceIndex = this.#performanceWorkspaces[0].frame === frame
        ? 0
        : this.#performanceWorkspaces[1].frame === frame ? 1 : -1;
      if (workspaceIndex < 0) {
        throw new RuntimeErrorV1("internal", "apply", "Performance frame does not belong to a retained workspace.");
      }
      this.#performanceWorkspaceIndex = workspaceIndex;
    }
    this.#evaluationStatsScratch.framesPublished = 1;
    this.#lastEvaluationStatsValue.animationSamples = this.#evaluationStatsScratch.animationSamples;
    this.#lastEvaluationStatsValue.constraintGeometrySolves = this.#evaluationStatsScratch.constraintGeometrySolves;
    this.#lastEvaluationStatsValue.framesPublished = this.#evaluationStatsScratch.framesPublished;
  }

  #adopt(candidate: RuntimePlayerV1, frame: RuntimeFrameV1): void {
    const pose = candidate.#currentPose;
    const worlds = candidate.#currentWorldByBoneId;
    if (pose === null || worlds === null) {
      throw new RuntimeErrorV1("internal", "replaceProject", "Replacement player has no published pose.");
    }
    this.#sourceData = candidate.#sourceData;
    this.#data = candidate.#data;
    this.#runtimeResources = cloneRuntimeResourceStateV1(candidate.#runtimeResources);
    this.#geometryModifiers = candidate.#geometryModifiers;
    this.#animationState = candidate.#animationState;
    this.#performanceAnimationStates = candidate.#performanceAnimationStates;
    this.#sampleOriginState = candidate.#sampleOriginState;
    this.#timeSeconds = candidate.#timeSeconds;
    this.#sequence = candidate.#sequence;
    this.#rootTransform = candidate.#rootTransform;
    this.#currentFrame = frame;
    if (this.#executionMode === "performance") {
      this.#performanceWorkspaces = candidate.#performanceWorkspaces;
      this.#performanceWorkspaceIndex = candidate.#performanceWorkspaceIndex;
    }
    this.#currentPose = pose;
    this.#currentWorldByBoneId = worlds;
    this.#evaluationSnapshots.set(
      frame,
      this.#executionMode === "performance"
        ? this.#performanceWorkspaces[this.#performanceWorkspaceIndex]?.evaluationSnapshot
          ?? { pose, worldByBoneId: worlds, geometryModifierStats: candidate.#lastGeometryModifierStatsValue }
        : { pose, worldByBoneId: worlds, geometryModifierStats: candidate.#lastGeometryModifierStatsValue },
    );
    this.#hostOverrides = candidate.#hostOverrides;
    this.#pendingEvents = [...candidate.#pendingEvents];
    this.#activeSkinIds = [...candidate.#activeSkinIds];
    this.#sampleOriginSkinIds = [...candidate.#sampleOriginSkinIds];
    this.#physicsStates = candidate.#physicsStates;
    this.#performancePhysicsStates = candidate.#performancePhysicsStates;
    this.#physicsEnvironment = candidate.#physicsEnvironment;
    this.#evaluationStatsSequence = candidate.#evaluationStatsSequence;
    this.#evaluationStatsScratch.animationSamples = candidate.#evaluationStatsScratch.animationSamples;
    this.#evaluationStatsScratch.constraintGeometrySolves = candidate.#evaluationStatsScratch.constraintGeometrySolves;
    this.#evaluationStatsScratch.framesPublished = candidate.#evaluationStatsScratch.framesPublished;
    this.#lastGeometryModifierStatsValue.persistentOperations = candidate.#lastGeometryModifierStatsValue.persistentOperations;
    this.#lastGeometryModifierStatsValue.transientOperations = candidate.#lastGeometryModifierStatsValue.transientOperations;
    this.#lastGeometryModifierStatsValue.attachmentVisits = candidate.#lastGeometryModifierStatsValue.attachmentVisits;
    this.#lastGeometryModifierStatsValue.vertexWrites = candidate.#lastGeometryModifierStatsValue.vertexWrites;
    this.#lastGeometryModifierStatsValue.uvWrites = candidate.#lastGeometryModifierStatsValue.uvWrites;
    this.#lastGeometryModifierStatsValue.tintWrites = candidate.#lastGeometryModifierStatsValue.tintWrites;
    this.#lastEvaluationStatsValue.animationSamples = candidate.#lastEvaluationStatsValue.animationSamples;
    this.#lastEvaluationStatsValue.constraintGeometrySolves = candidate.#lastEvaluationStatsValue.constraintGeometrySolves;
    this.#lastEvaluationStatsValue.framesPublished = candidate.#lastEvaluationStatsValue.framesPublished;
  }

  #requireNextSequence(operation: string): void {
    this.#assertMutationAllowed(operation);
    if (this.#sequence >= Number.MAX_SAFE_INTEGER) {
      throw new RuntimeErrorV1("resourceLimit", operation, "Frame sequence exceeded JavaScript safe integer range.");
    }
  }

  #assertMutationAllowed(operation: string): void {
    if (this.#hookPhase !== null) {
      throw new RuntimeErrorV1(
        "invalidState",
        operation,
        `Player mutation is unavailable during ${this.#hookPhase}.`,
      );
    }
  }
}

function createPerformanceWorkspaceV1(): RuntimePerformanceWorkspaceV1 {
  return {
    samplingScratch: createRuntimeSamplingScratchV1(),
    constraintScratch: createRuntimeConstraintSolveScratchV1(),
    rootAffineScratch: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    slotByIdScratch: new Map(),
    boneProjectionLinearCache: new Float32Array(0),
    frame: null,
    evaluationSnapshot: null,
    renderAttachmentPool: new Map(),
    regionRenderInputPool: new Map(),
    meshRenderInputPool: new Map(),
    hostDeformPool: new Map(),
    constraintContextScratch: null,
    geometryModifierWorkspace: createRuntimeGeometryModifierWorkspaceV1(),
  };
}

interface NormalizedRuntimeBoundsOptionsV1 {
  readonly includeRenderGeometry: boolean;
  readonly includeBoundingBoxes: boolean;
  readonly includeTransparent: boolean;
}

function normalizeBoundsOptionsV1(
  options: RuntimeBoundsOptionsV1,
  operation: string,
): NormalizedRuntimeBoundsOptionsV1 {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new RuntimeErrorV1("invalidArgument", operation, "options must be an object.", { field: "options" });
  }
  const fields = ["includeRenderGeometry", "includeBoundingBoxes", "includeTransparent"] as const;
  for (const field of fields) {
    const value = options[field];
    if (value !== undefined && typeof value !== "boolean") {
      throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be a boolean.`, { field });
    }
  }
  return {
    includeRenderGeometry: options.includeRenderGeometry ?? true,
    includeBoundingBoxes: options.includeBoundingBoxes ?? true,
    includeTransparent: options.includeTransparent ?? false,
  };
}

function ensureBoneProjectionLinearCacheV1(
  workspace: RuntimePerformanceWorkspaceV1,
  boneCount: number,
): Float32Array {
  const requiredLength = boneCount * 4;
  if (workspace.boneProjectionLinearCache.length !== requiredLength) {
    const cache = new Float32Array(requiredLength);
    // World matrices are required to be finite, so NaN is an unambiguous
    // first-use marker and also protects project/topology replacement.
    cache.fill(Number.NaN);
    workspace.boneProjectionLinearCache = cache;
  }
  return workspace.boneProjectionLinearCache;
}

function isRuntimeEventKindV1(value: string): value is RuntimeLifecycleEventKindV1 {
  return value === "start"
    || value === "interrupt"
    || value === "end"
    || value === "dispose"
    || value === "complete"
    || value === "user";
}

function commitPendingHookRemovalsV1<Listener>(records: RuntimeHookRecordV1<Listener>[]): void {
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) continue;
    if (!record.pendingRemoval) continue;
    record.pendingRemoval = false;
    record.active = false;
  }
}

function compactHooksV1<Listener>(records: RuntimeHookRecordV1<Listener>[]): void {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < records.length; readIndex += 1) {
    const record = records[readIndex];
    if (record === undefined || !record.active) continue;
    records[writeIndex] = record;
    writeIndex += 1;
  }
  records.length = writeIndex;
}

interface RuntimePoseLookupV1 {
  readonly boneIndexById: ReadonlyMap<string, number>;
  readonly constraintIndexById: ReadonlyMap<string, number>;
}

const RUNTIME_POSE_LOOKUPS_V1 = new WeakMap<RuntimeDataV1, RuntimePoseLookupV1>();

const BONE_PATCH_FIELDS_V1 = [
  ["x", "x", "patch.x"],
  ["y", "y", "patch.y"],
  ["rotationDegrees", "rotation", "patch.rotationDegrees"],
  ["shearXDegrees", "shearX", "patch.shearXDegrees"],
  ["shearYDegrees", "shearY", "patch.shearYDegrees"],
  ["scaleX", "scaleX", "patch.scaleX"],
  ["scaleY", "scaleY", "patch.scaleY"],
] as const;

const BONE_ADDITIVE_FIELDS_V1 = [
  ["xDelta", "x", "delta.xDelta"],
  ["yDelta", "y", "delta.yDelta"],
  ["rotationDegreesDelta", "rotation", "delta.rotationDegreesDelta"],
  ["shearXDegreesDelta", "shearX", "delta.shearXDegreesDelta"],
  ["shearYDegreesDelta", "shearY", "delta.shearYDegreesDelta"],
  ["scaleXDelta", "scaleX", "delta.scaleXDelta"],
  ["scaleYDelta", "scaleY", "delta.scaleYDelta"],
] as const;

const BONE_REPLACE_FIELDS_V1 = [
  ["x", "x", "local.x"],
  ["y", "y", "local.y"],
  ["rotationDegrees", "rotation", "local.rotationDegrees"],
  ["shearXDegrees", "shearX", "local.shearXDegrees"],
  ["shearYDegrees", "shearY", "local.shearYDegrees"],
  ["scaleX", "scaleX", "local.scaleX"],
  ["scaleY", "scaleY", "local.scaleY"],
] as const;

function runtimePoseLookupV1(data: RuntimeDataV1): RuntimePoseLookupV1 {
  const cached = RUNTIME_POSE_LOOKUPS_V1.get(data);
  if (cached !== undefined) return cached;
  const boneIndexById = new Map<string, number>();
  for (let index = 0; index < data.document.bones.length; index += 1) {
    const bone = data.document.bones[index];
    if (bone !== undefined) boneIndexById.set(bone.id, index);
  }
  const constraintIndexById = new Map<string, number>();
  for (let index = 0; index < data.document.constraints.length; index += 1) {
    const constraint = data.document.constraints[index];
    if (constraint !== undefined) constraintIndexById.set(constraint.id, index);
  }
  const created = { boneIndexById, constraintIndexById };
  RUNTIME_POSE_LOOKUPS_V1.set(data, created);
  return created;
}

function validatePoseModifiersV1(
  data: RuntimeDataV1,
  modifiers: RuntimePoseModifiersV1,
  operation: string,
): void {
  if (modifiers === null || typeof modifiers !== "object" || !Array.isArray(modifiers.operations)) {
    throw new RuntimeErrorV1("invalidArgument", operation, "modifiers.operations must be an array.", {
      field: "modifiers.operations",
    });
  }
  if (modifiers.operations.length > MAX_POSE_MODIFIER_OPERATIONS_V1) {
    throw new RuntimeErrorV1("resourceLimit", operation, "Pose modifier count exceeds 1,000,000.", {
      field: "modifiers.operations",
    });
  }
  if (modifiers.operations.length === 0) return;
  const lookup = runtimePoseLookupV1(data);
  for (let index = 0; index < modifiers.operations.length; index += 1) {
    const modifier = modifiers.operations[index] as RuntimePoseModifierOperationV1 | undefined;
    if (modifier === undefined || modifier === null || typeof modifier !== "object") {
      const field = poseModifierFieldV1(index, "");
      throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be an object.`, { field });
    }
    switch (modifier.operation) {
      case "replaceBoneLocal": {
        requirePoseModifierTargetV1(modifier.boneId, lookup.boneIndexById, "bone", operation, index, "boneId");
        if (modifier.local === null || typeof modifier.local !== "object") {
          const field = poseModifierFieldV1(index, "local");
          throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be an object.`, {
            field,
            entityId: modifier.boneId,
          });
        }
        for (const [input, , field] of BONE_REPLACE_FIELDS_V1) {
          validateModifierFiniteV1(modifier.local[input], operation, index, field);
        }
        break;
      }
      case "patchBoneLocal": {
        requirePoseModifierTargetV1(modifier.boneId, lookup.boneIndexById, "bone", operation, index, "boneId");
        if (modifier.patch === null || typeof modifier.patch !== "object") {
          const field = poseModifierFieldV1(index, "patch");
          throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be an object.`, {
            field,
            entityId: modifier.boneId,
          });
        }
        for (const [input, , field] of BONE_PATCH_FIELDS_V1) {
          const value = modifier.patch[input];
          if (value !== undefined && value !== null) validateModifierFiniteV1(value, operation, index, field);
        }
        break;
      }
      case "addBoneLocal": {
        requirePoseModifierTargetV1(modifier.boneId, lookup.boneIndexById, "bone", operation, index, "boneId");
        if (modifier.delta === null || typeof modifier.delta !== "object") {
          const field = poseModifierFieldV1(index, "delta");
          throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be an object.`, {
            field,
            entityId: modifier.boneId,
          });
        }
        for (const [input, , field] of BONE_ADDITIVE_FIELDS_V1) {
          const value = modifier.delta[input];
          if (value !== undefined && value !== null) validateModifierFiniteV1(value, operation, index, field);
        }
        break;
      }
      case "patchConstraint": {
        const constraintIndex = requirePoseModifierTargetV1(
          modifier.constraintId,
          lookup.constraintIndexById,
          "constraint",
          operation,
          index,
          "constraintId",
        );
        const constraint = data.document.constraints[constraintIndex];
        if (constraint === undefined) {
          throw new RuntimeErrorV1("internal", operation, "Validated constraint index is unavailable.", {
            entityId: modifier.constraintId,
          });
        }
        validateConstraintModifierV1(constraint, modifier.parameters, operation, index);
        break;
      }
      default:
        throw new RuntimeErrorV1("invalidArgument", operation, "Unknown pose modifier operation.", {
          field: poseModifierFieldV1(index, "operation"),
        });
    }
  }
}

function requirePoseModifierTargetV1(
  id: string,
  indexById: ReadonlyMap<string, number>,
  kind: "bone" | "constraint",
  operation: string,
  modifierIndex: number,
  fieldSuffix: string,
): number {
  if (typeof id !== "string" || id.length === 0) {
    const field = poseModifierFieldV1(modifierIndex, fieldSuffix);
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be non-empty.`, { field });
  }
  const index = indexById.get(id);
  if (index === undefined) {
    throw new RuntimeErrorV1("notFound", operation, `${kind} \`${id}\` does not exist.`, { entityId: id });
  }
  return index;
}

function poseModifierFieldV1(modifierIndex: number | null, suffix: string): string {
  if (modifierIndex === null) return suffix;
  const root = `modifiers.operations[${modifierIndex}]`;
  return suffix.length === 0 ? root : `${root}.${suffix}`;
}

function validateModifierFiniteV1(
  value: number,
  operation: string,
  modifierIndex: number | null,
  fieldSuffix: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    const field = poseModifierFieldV1(modifierIndex, fieldSuffix);
    throw new RuntimeErrorV1("nonFinite", operation, `${field} must be finite.`, { field });
  }
  const result = Math.fround(value);
  if (!Number.isFinite(result)) {
    const field = poseModifierFieldV1(modifierIndex, fieldSuffix);
    throw new RuntimeErrorV1("nonFinite", operation, `${field} is outside binary32 range.`, { field });
  }
  return result;
}

function validateOptionalModifierNumberV1(
  value: number | null | undefined,
  range: "finite" | "unit" | "nonNegative" | "positive",
  operation: string,
  modifierIndex: number | null,
  fieldSuffix: string,
): void {
  if (value === undefined || value === null) return;
  const result = validateModifierFiniteV1(value, operation, modifierIndex, fieldSuffix);
  const valid = range === "finite"
    || (range === "unit" && result >= 0 && result <= 1)
    || (range === "nonNegative" && result >= 0)
    || (range === "positive" && result > 0);
  if (valid) return;
  const field = poseModifierFieldV1(modifierIndex, fieldSuffix);
  const expectation = range === "unit" ? "in [0,1]" : range === "positive" ? "positive" : "non-negative";
  throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be ${expectation}.`, { field });
}

function validateOptionalModifierBooleanV1(
  value: boolean | null | undefined,
  operation: string,
  modifierIndex: number | null,
  fieldSuffix: string,
): void {
  if (value === undefined || value === null || typeof value === "boolean") return;
  const field = poseModifierFieldV1(modifierIndex, fieldSuffix);
  throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be boolean.`, { field });
}

function validateConstraintModifierV1(
  constraint: RuntimeConstraintV1,
  override: RuntimeConstraintOverrideV1,
  operation: string,
  modifierIndex: number | null,
): void {
  if (override === null || typeof override !== "object") {
    const field = poseModifierFieldV1(modifierIndex, "parameters");
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be an object.`, { field });
  }
  if (override.type !== constraint.type) {
    const field = poseModifierFieldV1(modifierIndex, "parameters.type");
    throw new RuntimeErrorV1("invalidArgument", operation, "Constraint override kind does not match the target.", {
      field,
      entityId: constraint.id,
    });
  }
  switch (override.type) {
    case "ik":
      validateOptionalModifierNumberV1(override.mix, "unit", operation, modifierIndex, "parameters.mix");
      validateOptionalModifierNumberV1(override.softness, "nonNegative", operation, modifierIndex, "parameters.softness");
      if (override.target !== undefined && override.target !== null) {
        if (typeof override.target !== "object") {
          const field = poseModifierFieldV1(modifierIndex, "parameters.target");
          throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be an object.`, { field });
        }
        validateModifierFiniteV1(override.target.x, operation, modifierIndex, "parameters.target.x");
        validateModifierFiniteV1(override.target.y, operation, modifierIndex, "parameters.target.y");
      }
      validateOptionalModifierBooleanV1(override.bendPositive, operation, modifierIndex, "parameters.bendPositive");
      validateOptionalModifierBooleanV1(override.compress, operation, modifierIndex, "parameters.compress");
      validateOptionalModifierBooleanV1(override.stretch, operation, modifierIndex, "parameters.stretch");
      return;
    case "transform":
      validateOptionalModifierNumberV1(override.rotationDegrees, "finite", operation, modifierIndex, "parameters.rotationDegrees");
      validateOptionalModifierNumberV1(override.x, "finite", operation, modifierIndex, "parameters.x");
      validateOptionalModifierNumberV1(override.y, "finite", operation, modifierIndex, "parameters.y");
      validateOptionalModifierNumberV1(override.scaleX, "finite", operation, modifierIndex, "parameters.scaleX");
      validateOptionalModifierNumberV1(override.scaleY, "finite", operation, modifierIndex, "parameters.scaleY");
      validateOptionalModifierNumberV1(override.shearYDegrees, "finite", operation, modifierIndex, "parameters.shearYDegrees");
      validateOptionalModifierNumberV1(override.mixRotate, "finite", operation, modifierIndex, "parameters.mixRotate");
      validateOptionalModifierNumberV1(override.mixX, "finite", operation, modifierIndex, "parameters.mixX");
      validateOptionalModifierNumberV1(override.mixY, "finite", operation, modifierIndex, "parameters.mixY");
      validateOptionalModifierNumberV1(override.mixScaleX, "finite", operation, modifierIndex, "parameters.mixScaleX");
      validateOptionalModifierNumberV1(override.mixScaleY, "finite", operation, modifierIndex, "parameters.mixScaleY");
      validateOptionalModifierNumberV1(override.mixShearY, "finite", operation, modifierIndex, "parameters.mixShearY");
      return;
    case "path":
      validateOptionalModifierNumberV1(override.rotationDegrees, "finite", operation, modifierIndex, "parameters.rotationDegrees");
      validateOptionalModifierNumberV1(override.position, "finite", operation, modifierIndex, "parameters.position");
      validateOptionalModifierNumberV1(override.spacing, "finite", operation, modifierIndex, "parameters.spacing");
      validateOptionalModifierNumberV1(override.mixRotate, "unit", operation, modifierIndex, "parameters.mixRotate");
      validateOptionalModifierNumberV1(override.mixX, "unit", operation, modifierIndex, "parameters.mixX");
      validateOptionalModifierNumberV1(override.mixY, "unit", operation, modifierIndex, "parameters.mixY");
      return;
    case "physics":
      validateOptionalModifierNumberV1(override.x, "unit", operation, modifierIndex, "parameters.x");
      validateOptionalModifierNumberV1(override.y, "unit", operation, modifierIndex, "parameters.y");
      validateOptionalModifierNumberV1(override.rotate, "unit", operation, modifierIndex, "parameters.rotate");
      validateOptionalModifierNumberV1(override.scaleX, "unit", operation, modifierIndex, "parameters.scaleX");
      validateOptionalModifierNumberV1(override.shearX, "unit", operation, modifierIndex, "parameters.shearX");
      validateOptionalModifierNumberV1(override.limit, "nonNegative", operation, modifierIndex, "parameters.limit");
      validateOptionalModifierNumberV1(override.inertia, "unit", operation, modifierIndex, "parameters.inertia");
      validateOptionalModifierNumberV1(override.strength, "nonNegative", operation, modifierIndex, "parameters.strength");
      validateOptionalModifierNumberV1(override.damping, "unit", operation, modifierIndex, "parameters.damping");
      validateOptionalModifierNumberV1(override.mass, "positive", operation, modifierIndex, "parameters.mass");
      validateOptionalModifierNumberV1(override.wind, "finite", operation, modifierIndex, "parameters.wind");
      validateOptionalModifierNumberV1(override.gravity, "finite", operation, modifierIndex, "parameters.gravity");
      validateOptionalModifierNumberV1(override.mix, "unit", operation, modifierIndex, "parameters.mix");
      if (override.fps !== undefined && override.fps !== null
        && (!Number.isInteger(override.fps) || override.fps <= 0 || override.fps > 0xffff_ffff)) {
        const field = poseModifierFieldV1(modifierIndex, "parameters.fps");
        throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be a positive u32.`, { field });
      }
      return;
    case "slider":
      validateOptionalModifierNumberV1(override.sourceOffset, "finite", operation, modifierIndex, "parameters.sourceOffset");
      validateOptionalModifierNumberV1(override.timeOffset, "finite", operation, modifierIndex, "parameters.timeOffset");
      validateOptionalModifierNumberV1(override.timeScale, "finite", operation, modifierIndex, "parameters.timeScale");
      validateOptionalModifierNumberV1(override.rangeMax, "nonNegative", operation, modifierIndex, "parameters.rangeMax");
      validateOptionalModifierNumberV1(override.time, "finite", operation, modifierIndex, "parameters.time");
      validateOptionalModifierNumberV1(override.mix, "finite", operation, modifierIndex, "parameters.mix");
  }
}

function requirePoseTargetV1(
  id: string,
  indexById: ReadonlyMap<string, number>,
  kind: "bone" | "constraint",
  operation: string,
  field: string,
): number {
  if (typeof id !== "string" || id.length === 0) {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be non-empty.`, { field });
  }
  const index = indexById.get(id);
  if (index === undefined) {
    throw new RuntimeErrorV1("notFound", operation, `${kind} \`${id}\` does not exist.`, { entityId: id });
  }
  return index;
}

function applyPoseModifiersV1(
  data: RuntimeDataV1,
  pose: RuntimeSampledPoseV1,
  modifiers: RuntimePoseModifiersV1,
  operation: string,
): void {
  if (modifiers.operations.length === 0) return;
  const lookup = runtimePoseLookupV1(data);
  for (let index = 0; index < modifiers.operations.length; index += 1) {
    const modifier = modifiers.operations[index];
    if (modifier === undefined) continue;
    switch (modifier.operation) {
      case "replaceBoneLocal": {
        const bone = mutablePoseBoneV1(pose, lookup, modifier.boneId, operation);
        bone.x = f32(modifier.local.x);
        bone.y = f32(modifier.local.y);
        bone.rotation = f32(modifier.local.rotationDegrees);
        bone.shearX = f32(modifier.local.shearXDegrees);
        bone.shearY = f32(modifier.local.shearYDegrees);
        bone.scaleX = f32(modifier.local.scaleX);
        bone.scaleY = f32(modifier.local.scaleY);
        break;
      }
      case "patchBoneLocal": {
        const bone = mutablePoseBoneV1(pose, lookup, modifier.boneId, operation);
        for (const [input, output] of BONE_PATCH_FIELDS_V1) {
          const value = modifier.patch[input];
          if (value !== undefined && value !== null) bone[output] = f32(value);
        }
        break;
      }
      case "addBoneLocal": {
        const bone = mutablePoseBoneV1(pose, lookup, modifier.boneId, operation);
        for (const [input, output] of BONE_ADDITIVE_FIELDS_V1) {
          const value = modifier.delta[input];
          if (value === undefined || value === null) continue;
          const result = f32Add(bone[output], value);
          if (!Number.isFinite(result)) {
            throw new RuntimeErrorV1("nonFinite", operation, `${input} produced a non-finite binary32 result.`, {
              field: `modifiers.operations[${index}].delta.${input}`,
              entityId: modifier.boneId,
            });
          }
          bone[output] = result;
        }
        break;
      }
      case "patchConstraint": {
        const constraintIndex = lookup.constraintIndexById.get(modifier.constraintId);
        const constraint = constraintIndex === undefined ? undefined : pose.constraints[constraintIndex];
        if (constraint === undefined) {
          throw new RuntimeErrorV1("notFound", operation, `constraint \`${modifier.constraintId}\` does not exist.`, {
            entityId: modifier.constraintId,
          });
        }
        applyConstraintOverrideInPlaceV1(constraint, modifier.parameters);
        break;
      }
    }
  }
}

function mutablePoseBoneV1(
  pose: RuntimeSampledPoseV1,
  lookup: RuntimePoseLookupV1,
  boneId: string,
  operation: string,
): MutableRuntimeBoneV1 {
  const index = lookup.boneIndexById.get(boneId);
  const bone = index === undefined ? undefined : pose.bones[index];
  if (bone === undefined) {
    throw new RuntimeErrorV1("notFound", operation, `bone \`${boneId}\` does not exist.`, { entityId: boneId });
  }
  return bone as MutableRuntimeBoneV1;
}

function emptyHostOverridesV1(): RuntimeHostOverridesV1 {
  return {
    boneLocals: new Map(),
    regionPoses: new Map(),
    drawOrder: null,
    vertexDeforms: new Map(),
    slotAttachments: new Map(),
    slotTints: new Map(),
    constraints: new Map(),
  };
}

function cloneHostOverridesV1(source: RuntimeHostOverridesV1): MutableRuntimeHostOverridesV1 {
  return {
    boneLocals: new Map(source.boneLocals),
    regionPoses: new Map(source.regionPoses),
    drawOrder: source.drawOrder === null ? null : [...source.drawOrder],
    vertexDeforms: new Map(source.vertexDeforms),
    slotAttachments: new Map(source.slotAttachments),
    slotTints: new Map(source.slotTints),
    constraints: new Map(source.constraints),
  };
}

function freezeHostOverridesV1(source: MutableRuntimeHostOverridesV1): RuntimeHostOverridesV1 {
  return {
    boneLocals: new Map(source.boneLocals),
    regionPoses: new Map(source.regionPoses),
    drawOrder: source.drawOrder === null ? null : [...source.drawOrder],
    vertexDeforms: new Map(source.vertexDeforms),
    slotAttachments: new Map(source.slotAttachments),
    slotTints: new Map(source.slotTints),
    constraints: new Map(source.constraints),
  };
}

function retainKnownSkinIdsV1(data: RuntimeDataV1, skinIds: readonly string[]): string[] {
  const known = new Set(data.document.skins.map((skin) => skin.id));
  return skinIds.filter((skinId, index) => known.has(skinId) && skinIds.indexOf(skinId) === index);
}

function retainCompatibleHostOverridesV1(
  data: RuntimeDataV1,
  source: RuntimeHostOverridesV1,
): RuntimeHostOverridesV1 {
  const next = cloneHostOverridesV1(emptyHostOverridesV1());
  const boneIds = new Set(data.document.bones.map((bone) => bone.id));
  const slotIds = new Set(data.document.slots.map((slot) => slot.id));
  for (const [boneId, local] of source.boneLocals) {
    if (boneIds.has(boneId)) next.boneLocals.set(boneId, local);
  }
  for (const [attachmentId, pose] of source.regionPoses) {
    const attachment = data.document.attachments.find((candidate) => candidate.id === attachmentId);
    if (attachment?.type === "region") next.regionPoses.set(attachmentId, pose);
  }
  if (source.drawOrder !== null) {
    try {
      next.drawOrder = normalizeDrawOrderOverride(data, source.drawOrder, "replaceProject", "drawOrderOverride");
    } catch {
      next.drawOrder = null;
    }
  }
  for (const [attachmentId, deform] of source.vertexDeforms) {
    const attachment = data.document.attachments.find((candidate) => candidate.id === attachmentId);
    if (attachment === undefined || attachment.type === "region" || attachment.type === "point") continue;
    try {
      next.vertexDeforms.set(
        attachmentId,
        normalizeVertexDeformOverride(data, attachment, deform, "replaceProject", "vertexDeformOverride"),
      );
    } catch {
      // Changed source topology makes the old deform buffer incompatible.
    }
  }
  for (const [slotId, attachmentId] of source.slotAttachments) {
    if (!slotIds.has(slotId)) continue;
    const attachment = attachmentId === null
      ? null
      : data.document.attachments.find((candidate) => candidate.id === attachmentId) ?? null;
    if (attachmentId === null || attachment?.slotId === slotId) next.slotAttachments.set(slotId, attachmentId);
  }
  for (const [slotId, tint] of source.slotTints) {
    if (slotIds.has(slotId)) next.slotTints.set(slotId, tint);
  }
  for (const [constraintId, override] of source.constraints) {
    const constraint = data.document.constraints.find((candidate) => candidate.id === constraintId);
    if (constraint === undefined || constraint.type !== override.type) continue;
    try {
      next.constraints.set(
        constraintId,
        normalizeConstraintOverride(constraint, override, "replaceProject", "constraintOverride"),
      );
    } catch {
      // Changed constraint kind or range semantics makes this override incompatible.
    }
  }
  return freezeHostOverridesV1(next);
}

function applyHostOverridesV1(
  data: RuntimeDataV1,
  pose: RuntimeSampledPoseV1,
  overrides: RuntimeHostOverridesV1,
  hostDeformPool: Map<string, MutableRuntimeSampledDeformV1> | null = null,
): RuntimeSampledPoseV1 {
  if (overrides.boneLocals.size === 0
    && overrides.regionPoses.size === 0
    && overrides.drawOrder === null
    && overrides.vertexDeforms.size === 0
    && overrides.slotAttachments.size === 0
    && overrides.slotTints.size === 0
    && overrides.constraints.size === 0) return pose;

  const bones = pose.bones as MutableRuntimeBoneV1[];
  for (const bone of bones) {
    const local = overrides.boneLocals.get(bone.id);
    if (local === undefined) continue;
    bone.x = local.x;
    bone.y = local.y;
    bone.rotation = local.rotationDegrees;
    bone.shearX = local.shearXDegrees;
    bone.shearY = local.shearYDegrees;
    bone.scaleX = local.scaleX;
    bone.scaleY = local.scaleY;
  }

  const regions = pose.regions as Map<string, MutableDistributiveV1<RuntimeSampledPoseV1["regions"] extends ReadonlyMap<string, infer Region> ? Region : never>>;
  for (const attachment of data.document.attachments) {
    if (attachment.type !== "region") continue;
    const override = overrides.regionPoses.get(attachment.id);
    const current = regions.get(attachment.id);
    if (override === undefined || current === undefined) continue;
    current.x = override.x;
    current.y = override.y;
    current.rotation = override.rotationDegrees;
    current.scaleX = override.scaleX;
    current.scaleY = override.scaleY;
  }

  const mutablePose = pose as MutableDistributiveV1<RuntimeSampledPoseV1>;
  const drawOrderSlotIds = pose.drawOrderSlotIds as string[];
  if (overrides.drawOrder !== null) copyRetainedArrayV1(drawOrderSlotIds, overrides.drawOrder);
  const slotAttachmentKeys = pose.slotAttachmentKeys as Map<string, string | null>;
  const slots = pose.slots as MutableDistributiveV1<RuntimeSlotV1>[];
  for (const slot of slots) {
    if (overrides.slotAttachments.has(slot.id)) {
      const attachmentId = overrides.slotAttachments.get(slot.id) ?? null;
      slotAttachmentKeys.set(slot.id, attachmentId);
      slot.attachmentId = attachmentId;
    }
    const tint = overrides.slotTints.get(slot.id);
    if (tint !== undefined) {
      const encoded = encodedHostSlotTintV1(tint);
      slot.color = encoded.light;
      slot.alpha = tint.alpha;
      slot.darkColor = encoded.dark;
      setRuntimeSlotTintBytesV1(slot, tint.lightRgb, tint.darkRgb);
    }
  }

  const deforms = pose.deforms as Map<string, RuntimeSampledPoseV1["deforms"] extends ReadonlyMap<string, infer Deform> ? Deform : never>;
  const deformOverrides = orderedHostVertexDeformsV1(overrides.vertexDeforms);
  for (const [attachmentId, override] of deformOverrides) {
    const attachment = data.attachment(attachmentId);
    if (attachment.type === "region" || attachment.type === "point") continue;
    const source = resolveVertexAttachmentSourceV1(attachment, data);
    const ownerId = resolveVertexAttachmentDeformOwnerIdV1(attachment, data);
    let reusable = hostDeformPool?.get(ownerId);
    if (reusable === undefined && hostDeformPool !== null) {
      reusable = { weighted: false, values: [] };
      hostDeformPool.set(ownerId, reusable);
    }
    if (override.space === "weightedInfluenceOffsets") {
      const result = reusable ?? { weighted: true, values: [] };
      result.weighted = true;
      copyNumberArrayV1(result.values, override.values);
      deforms.set(ownerId, result);
    } else if (source.weights.length === 0) {
      const result = reusable ?? { weighted: false, values: [] };
      result.weighted = false;
      copyNumberArrayV1(result.values, override.values);
      deforms.set(ownerId, result);
    } else {
      const offsets = vertexPositionsToWeightedOffsetsV1(source, override.values, reusable?.values ?? null);
      if (offsets === null) {
        throw new RuntimeErrorV1("invalidState", "apply", "Vertex-position override cannot be converted to weighted offsets.", {
          entityId: attachmentId,
        });
      }
      const result = reusable ?? { weighted: true, values: offsets };
      result.weighted = true;
      deforms.set(ownerId, result);
    }
  }

  const constraints = pose.constraints as MutableRuntimeConstraintV1[];
  for (const constraint of constraints) {
    const override = overrides.constraints.get(constraint.id);
    if (override !== undefined) applyConstraintOverrideInPlaceV1(constraint, override);
  }
  if (overrides.drawOrder !== null) mutablePose.drawOrderSampled = true;
  (pose.sampledSliderTimes as Map<string, number>).clear();
  (pose.constraintDiagnostics as Map<string, unknown>).clear();
  return pose;
}

function orderedHostVertexDeformsV1(
  overrides: ReadonlyMap<string, RuntimeVertexDeformOverrideV1>,
): readonly (readonly [string, RuntimeVertexDeformOverrideV1])[] {
  const cached = HOST_VERTEX_DEFORM_ORDER_CACHE.get(overrides);
  if (cached !== undefined) return cached;
  const ordered = Array.from(overrides);
  ordered.sort(([left], [right]) => left.localeCompare(right));
  HOST_VERTEX_DEFORM_ORDER_CACHE.set(overrides, ordered);
  return ordered;
}

function copyNumberArrayV1(target: number[], source: readonly number[]): void {
  target.length = source.length;
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index];
    if (value !== undefined) target[index] = value;
  }
}

function encodedHostSlotTintV1(
  tint: RuntimeSlotTintOverrideV1,
): { readonly light: string; readonly dark: string | null } {
  const cached = HOST_SLOT_TINT_ENCODING_CACHE.get(tint);
  if (cached !== undefined) return cached;
  const encoded = {
    light: encodeRgb(tint.lightRgb),
    dark: tint.darkRgb === null ? null : encodeRgb(tint.darkRgb),
  };
  HOST_SLOT_TINT_ENCODING_CACHE.set(tint, encoded);
  return encoded;
}

function copyRetainedArrayV1<Value>(target: Value[], source: readonly Value[]): void {
  target.length = source.length;
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index];
    if (value !== undefined) target[index] = value;
  }
}

function applyConstraintOverrideV1(
  constraint: RuntimeConstraintV1,
  override: RuntimeConstraintOverrideV1,
): RuntimeConstraintV1 {
  if (constraint.type !== override.type) return constraint;
  const result = constraint.type === "ik"
    ? { ...constraint, target: { ...constraint.target } }
    : { ...constraint };
  applyConstraintOverrideInPlaceV1(result, override);
  return result;
}

function applyConstraintOverrideInPlaceV1(
  constraint: RuntimeConstraintV1,
  override: RuntimeConstraintOverrideV1,
): void {
  if (constraint.type !== override.type) return;
  switch (constraint.type) {
    case "ik": {
      if (override.type !== "ik") return;
      const mutable = constraint as MutableDistributiveV1<typeof constraint>;
      if (override.target !== undefined && override.target !== null) {
        const target = mutable.target as { x: number; y: number };
        target.x = f32(override.target.x);
        target.y = f32(override.target.y);
        mutable.targetBoneId = null;
      }
      if (override.mix !== undefined && override.mix !== null) mutable.mix = f32(override.mix);
      if (override.bendPositive !== undefined && override.bendPositive !== null) mutable.bendPositive = override.bendPositive;
      if (override.compress !== undefined && override.compress !== null) mutable.compress = override.compress;
      if (override.stretch !== undefined && override.stretch !== null) mutable.stretch = override.stretch;
      if (override.softness !== undefined && override.softness !== null) mutable.softness = f32(override.softness);
      return;
    }
    case "transform": {
      if (override.type !== "transform") return;
      const mutable = constraint as MutableDistributiveV1<typeof constraint>;
      assignOptionalF32V1(mutable, "rotation", override.rotationDegrees);
      assignOptionalF32V1(mutable, "x", override.x);
      assignOptionalF32V1(mutable, "y", override.y);
      assignOptionalF32V1(mutable, "scaleX", override.scaleX);
      assignOptionalF32V1(mutable, "scaleY", override.scaleY);
      assignOptionalF32V1(mutable, "shearY", override.shearYDegrees);
      assignOptionalF32V1(mutable, "mixRotate", override.mixRotate);
      assignOptionalF32V1(mutable, "mixX", override.mixX);
      assignOptionalF32V1(mutable, "mixY", override.mixY);
      assignOptionalF32V1(mutable, "mixScaleX", override.mixScaleX);
      assignOptionalF32V1(mutable, "mixScaleY", override.mixScaleY);
      assignOptionalF32V1(mutable, "mixShearY", override.mixShearY);
      return;
    }
    case "path": {
      if (override.type !== "path") return;
      const mutable = constraint as MutableDistributiveV1<typeof constraint>;
      assignOptionalF32V1(mutable, "rotation", override.rotationDegrees);
      assignOptionalF32V1(mutable, "position", override.position);
      assignOptionalF32V1(mutable, "spacing", override.spacing);
      assignOptionalF32V1(mutable, "mixRotate", override.mixRotate);
      assignOptionalF32V1(mutable, "mixX", override.mixX);
      assignOptionalF32V1(mutable, "mixY", override.mixY);
      return;
    }
    case "physics": {
      if (override.type !== "physics") return;
      const mutable = constraint as MutableDistributiveV1<typeof constraint>;
      assignOptionalF32V1(mutable, "x", override.x);
      assignOptionalF32V1(mutable, "y", override.y);
      assignOptionalF32V1(mutable, "rotate", override.rotate);
      assignOptionalF32V1(mutable, "scaleX", override.scaleX);
      assignOptionalF32V1(mutable, "shearX", override.shearX);
      assignOptionalF32V1(mutable, "limit", override.limit);
      if (override.fps !== undefined && override.fps !== null) mutable.fps = override.fps;
      assignOptionalF32V1(mutable, "inertia", override.inertia);
      assignOptionalF32V1(mutable, "strength", override.strength);
      assignOptionalF32V1(mutable, "damping", override.damping);
      assignOptionalF32V1(mutable, "mass", override.mass);
      assignOptionalF32V1(mutable, "wind", override.wind);
      assignOptionalF32V1(mutable, "gravity", override.gravity);
      assignOptionalF32V1(mutable, "mix", override.mix);
      return;
    }
    case "slider": {
      if (override.type !== "slider") return;
      const mutable = constraint as MutableDistributiveV1<typeof constraint>;
      assignOptionalF32V1(mutable, "sourceOffset", override.sourceOffset);
      assignOptionalF32V1(mutable, "timeOffset", override.timeOffset);
      assignOptionalF32V1(mutable, "timeScale", override.timeScale);
      assignOptionalF32V1(mutable, "rangeMax", override.rangeMax);
      assignOptionalF32V1(mutable, "time", override.time);
      assignOptionalF32V1(mutable, "mix", override.mix);
      return;
    }
  }
}

function assignOptionalF32V1<Target extends object, Key extends keyof Target>(
  target: Target,
  key: Key,
  value: number | null | undefined,
): void {
  if (value !== undefined && value !== null) target[key] = f32(value) as Target[Key];
}

function selectedSequenceImageId(
  fallbackImageId: string,
  sequence: { readonly imageIds: readonly string[]; readonly setupIndex: number } | null,
  sampledIndex: number | undefined,
): string {
  if (sequence === null) return fallbackImageId;
  const index = sampledIndex ?? sequence.setupIndex;
  return sequence.imageIds[index] ?? fallbackImageId;
}

function slotMapShapeMatchesV1(
  target: ReadonlyMap<string, RuntimeSlotV1>,
  slots: readonly RuntimeSlotV1[],
): boolean {
  if (target.size !== slots.length) return false;
  for (const slot of slots) {
    if (!target.has(slot.id)) return false;
  }
  return true;
}

function primaryPhysicsClock(
  animationState: RuntimeAnimationStateV1,
  detachedTime: number,
  sampling: RuntimeSamplingV1,
  output: RuntimePrimaryClockV1 | null = null,
): RuntimePrimaryClockV1 {
  const result = output ?? {
    animationId: null,
    trackTime: 0,
    duration: 0,
    looping: false,
  };
  animationState.writePrimaryClock(detachedTime, result);
  if (sampling.mode === "fixedFrame" || sampling.mode === "fixedFrameStepped") {
    result.trackTime = quantizeSampleTimeV1(result.trackTime, sampling.frameStepSeconds);
  }
  return result;
}

function applyPhysicsResetEdgesV1(
  data: RuntimeDataV1,
  pose: RuntimeSampledPoseV1,
  layers: readonly RuntimeAnimationLayerV1[],
  clock: RuntimePhysicsClockStepV1,
  physicsStates: RuntimePhysicsStateStoreV1,
): void {
  if (clock.animationId === null || clock.from === null || !(clock.trackTime > clock.from)) return;
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    if (layer === undefined) continue;
    if (layer.animation.id !== clock.animationId || layer.alpha < 0.5) continue;
    const timelines = layer.animation.constraintTimelines;
    for (let timelineIndex = 0; timelineIndex < timelines.length; timelineIndex += 1) {
      const timeline = timelines[timelineIndex];
      if (timeline === undefined) continue;
      if (timeline.type !== "physics"
        || !physicsResetTimelineCrossed(timeline.keys, clock.from, clock.trackTime, clock.duration, clock.looping)) {
        continue;
      }
      if (timeline.constraintId === "*") {
        for (let constraintIndex = 0; constraintIndex < pose.constraints.length; constraintIndex += 1) {
          const constraint = pose.constraints[constraintIndex];
          if (constraint === undefined) continue;
          if (constraint.type !== "physics"
            || !runtimeMemberIsActive(data, pose.sampledSkinIds, constraint.id, "constraint")
            || !runtimeMemberIsActive(data, pose.sampledSkinIds, constraint.boneId, "bone")) {
            continue;
          }
          physicsStates.reset(constraint.id);
        }
      } else {
        physicsStates.reset(timeline.constraintId);
      }
    }
  }
}

function physicsResetTimelineCrossed(
  keys: readonly { readonly time: number; readonly reset: boolean | null }[],
  from: number,
  to: number,
  duration: number,
  looping: boolean,
): boolean {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return false;
  const resetTimes = physicsResetTimesV1(keys);
  if (resetTimes.length === 0) return false;
  if (!looping || !(duration > 0) || !Number.isFinite(duration)) {
    let low = 0;
    let high = resetTimes.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((resetTimes[middle] ?? Number.POSITIVE_INFINITY) <= from) low = middle + 1;
      else high = middle;
    }
    return low < resetTimes.length && (resetTimes[low] ?? Number.POSITIVE_INFINITY) <= to;
  }
  for (let index = 0; index < resetTimes.length; index += 1) {
    const keyTime = resetTimes[index];
    if (keyTime === undefined) continue;
    const firstCycleAfterFrom = Math.floor((from - keyTime) / duration) + 1;
    if (keyTime + firstCycleAfterFrom * duration <= to) return true;
  }
  return false;
}

function physicsResetTimesV1(
  keys: readonly { readonly time: number; readonly reset: boolean | null }[],
): readonly number[] {
  const cached = PHYSICS_RESET_TIMES_CACHE.get(keys);
  if (cached !== undefined) return cached;
  const created: number[] = [];
  for (const key of keys) {
    if (key.reset === true && Number.isFinite(key.time)) created.push(key.time);
  }
  PHYSICS_RESET_TIMES_CACHE.set(keys, created);
  return created;
}

function runtimeMemberIsActive(
  data: RuntimeDataV1,
  sampledSkinIds: readonly string[],
  memberId: string,
  kind: "bone" | "constraint",
): boolean {
  let listed = false;
  for (const skin of data.document.skins) {
    const members = kind === "bone" ? skin.boneIds : skin.constraintIds;
    if (!members.includes(memberId)) continue;
    listed = true;
    if (sampledSkinIds.includes(skin.id)) return true;
  }
  return !listed;
}

function batchNotFound(
  operation: string,
  field: string,
  kind: string,
  id: string,
): RuntimeErrorV1 {
  if (typeof id !== "string" || id.length === 0) {
    return new RuntimeErrorV1("invalidArgument", operation, `${field} must be a non-empty string.`, { field });
  }
  return new RuntimeErrorV1("notFound", operation, `Unknown ${kind} '${id}'.`, {
    field,
    entityId: id,
  });
}

function batchAttachmentKind(
  operation: string,
  field: string,
  attachmentId: string,
  expected: string,
): RuntimeErrorV1 {
  return new RuntimeErrorV1("invalidArgument", operation, `Attachment is not a ${expected}.`, {
    field: `${field}.attachmentId`,
    entityId: attachmentId,
  });
}

function queryNotFound(
  operation: string,
  field: string,
  kind: string,
  id: string,
): RuntimeErrorV1 {
  if (typeof id !== "string" || id.length === 0) {
    return new RuntimeErrorV1("invalidArgument", operation, `${field} must be a non-empty string.`, { field });
  }
  return new RuntimeErrorV1("notFound", operation, `Unknown ${kind} '${id}'.`, {
    entityId: id,
  });
}

function animationUpdateErrorV1(error: unknown, operation: string, field: string): RuntimeErrorV1 {
  if (error instanceof RuntimeErrorV1) {
    const shouldAttachField = error.operation === "update"
      && (error.runtimeName === "resourceLimit" || error.runtimeName === "nonFinite");
    return new RuntimeErrorV1(error.runtimeName, operation, error.message, {
      field: error.field ?? (shouldAttachField ? field : null),
      entityId: error.entityId,
      cause: error,
    });
  }
  return asRuntimeError(error, operation, "Animation update failed.");
}

function appendEventsV1(target: RuntimeEventV1[], source: readonly RuntimeEventV1[]): void {
  for (let index = 0; index < source.length; index += 1) {
    const event = source[index];
    if (event !== undefined) target.push(event);
  }
}

function remapRuntimeErrorV1(error: unknown, operation: string, fallback: string): RuntimeErrorV1 {
  if (error instanceof RuntimeErrorV1) {
    return new RuntimeErrorV1(error.runtimeName, operation, error.message, {
      field: error.field,
      entityId: error.entityId,
      cause: error,
    });
  }
  return asRuntimeError(error, operation, fallback);
}

function constraintParametersV1(constraint: RuntimeConstraintV1): RuntimeConstraintParametersV1 {
  switch (constraint.type) {
    case "ik":
      return {
        type: "ik",
        target: { ...constraint.target },
        mix: constraint.mix,
        bendPositive: constraint.bendPositive,
        compress: constraint.compress,
        stretch: constraint.stretch,
        softness: constraint.softness,
      };
    case "transform":
      return {
        type: "transform",
        rotationDegrees: constraint.rotation,
        x: constraint.x,
        y: constraint.y,
        scaleX: constraint.scaleX,
        scaleY: constraint.scaleY,
        shearYDegrees: constraint.shearY,
        mixRotate: constraint.mixRotate,
        mixX: constraint.mixX,
        mixY: constraint.mixY,
        mixScaleX: constraint.mixScaleX,
        mixScaleY: constraint.mixScaleY,
        mixShearY: constraint.mixShearY,
      };
    case "path":
      return {
        type: "path",
        rotationDegrees: constraint.rotation,
        position: constraint.position,
        spacing: constraint.spacing,
        mixRotate: constraint.mixRotate,
        mixX: constraint.mixX,
        mixY: constraint.mixY,
      };
    case "physics":
      return {
        type: "physics",
        x: constraint.x,
        y: constraint.y,
        rotate: constraint.rotate,
        scaleX: constraint.scaleX,
        shearX: constraint.shearX,
        limit: constraint.limit,
        fps: constraint.fps,
        inertia: constraint.inertia,
        strength: constraint.strength,
        damping: constraint.damping,
        mass: constraint.mass,
        wind: constraint.wind,
        gravity: constraint.gravity,
        mix: constraint.mix,
      };
    case "slider":
      return {
        type: "slider",
        sourceOffset: constraint.sourceOffset,
        timeOffset: constraint.timeOffset,
        timeScale: constraint.timeScale,
        rangeMax: constraint.rangeMax,
        time: constraint.time,
        mix: constraint.mix,
      };
  }
}

function normalizeSourceVertexIndex(value: number, operation: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RuntimeErrorV1("invalidArgument", operation, "sourceVertexIndex must be a u32.", {
      field: "sourceVertexIndex",
    });
  }
  return value;
}

function normalizePointV1(value: RuntimePointV1, operation: string, field: string): RuntimePointV1 {
  if (value === null || typeof value !== "object") {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be an object.`, { field });
  }
  return {
    x: overrideFinite(value.x, operation, `${field}.x`),
    y: overrideFinite(value.y, operation, `${field}.y`),
  };
}

function normalizeVertexDeformInputV1(
  value: RuntimeVertexDeformInputV1,
  operation: string,
): RuntimeVertexDeformInputV1 {
  const field = "currentDeform";
  if (value === null || typeof value !== "object") {
    throw new RuntimeErrorV1("invalidArgument", operation, "currentDeform must be an object.", { field });
  }
  if (value.space !== "vertexPositions" && value.space !== "weightedInfluenceOffsets") {
    throw new RuntimeErrorV1("invalidArgument", operation, "Unknown deform space.", { field: `${field}.space` });
  }
  if (value.source === "playerCurrent") return { source: "playerCurrent", space: value.space };
  if (value.source === "values") {
    if (!Array.isArray(value.values)) {
      throw new RuntimeErrorV1("invalidArgument", operation, "currentDeform.values must be an array.", {
        field: `${field}.values`,
      });
    }
    return { source: "values", space: value.space, values: [...value.values] };
  }
  throw new RuntimeErrorV1("invalidArgument", operation, "Unknown currentDeform source.", {
    field: `${field}.source`,
  });
}

function normalizeDeformValuesV1(
  values: readonly number[],
  expected: number,
  operation: string,
  field: string,
  entityId: string,
): number[] {
  if (!Array.isArray(values)) {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be an array.`, { field, entityId });
  }
  if (values.length !== expected) {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must contain ${expected} values.`, {
      field,
      entityId,
    });
  }
  return values.map((value, index) => overrideFinite(value, operation, `${field}[${index}]`));
}

function normalizeBoneLocalOverride(
  value: RuntimeBoneLocalV1,
  operation: string,
  field = "local",
): RuntimeBoneLocalV1 {
  if (value === null || typeof value !== "object") {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be an object.`, { field });
  }
  return {
    x: overrideFinite(value.x, operation, `${field}.x`),
    y: overrideFinite(value.y, operation, `${field}.y`),
    rotationDegrees: overrideFinite(value.rotationDegrees, operation, `${field}.rotationDegrees`),
    shearXDegrees: overrideFinite(value.shearXDegrees, operation, `${field}.shearXDegrees`),
    shearYDegrees: overrideFinite(value.shearYDegrees, operation, `${field}.shearYDegrees`),
    scaleX: overrideFinite(value.scaleX, operation, `${field}.scaleX`),
    scaleY: overrideFinite(value.scaleY, operation, `${field}.scaleY`),
  };
}

function normalizeRegionPoseOverride(
  attachmentId: string,
  value: RuntimeRegionAttachmentPoseV1,
  operation = "setRegionAttachmentPoseOverride",
  field = "pose",
): RuntimeRegionAttachmentPoseV1 {
  if (value === null || typeof value !== "object") {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be an object.`, { field });
  }
  if (value.attachmentId !== attachmentId) {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field}.attachmentId must match the target attachment.`, {
      field: `${field}.attachmentId`,
      entityId: attachmentId,
    });
  }
  return {
    attachmentId,
    x: overrideFinite(value.x, operation, `${field}.x`),
    y: overrideFinite(value.y, operation, `${field}.y`),
    rotationDegrees: overrideFinite(value.rotationDegrees, operation, `${field}.rotationDegrees`),
    scaleX: overrideFinite(value.scaleX, operation, `${field}.scaleX`),
    scaleY: overrideFinite(value.scaleY, operation, `${field}.scaleY`),
  };
}

function normalizeDrawOrderOverride(
  data: RuntimeDataV1,
  slotIds: readonly string[],
  operation = "setDrawOrderOverride",
  field = "slotIds",
): string[] {
  if (!Array.isArray(slotIds) || slotIds.length !== data.document.slots.length) {
    throw new RuntimeErrorV1("invalidArgument", operation, "slotIds must contain every slot exactly once.", {
      field,
    });
  }
  const expected = new Set(data.document.slots.map((slot) => slot.id));
  const seen = new Set<string>();
  for (let index = 0; index < slotIds.length; index += 1) {
    const slotId = slotIds[index];
    if (typeof slotId !== "string" || !expected.has(slotId) || seen.has(slotId)) {
      throw new RuntimeErrorV1("invalidArgument", operation, "slotIds must be an exact slot permutation.", {
        field: `${field}[${index}]`,
        entityId: typeof slotId === "string" ? slotId : null,
      });
    }
    seen.add(slotId);
  }
  return [...slotIds];
}

function normalizeVertexDeformOverride(
  data: RuntimeDataV1,
  attachment: Exclude<RuntimeAttachmentV1, { readonly type: "region" | "point" }>,
  override: RuntimeVertexDeformOverrideV1,
  operation = "setVertexDeformOverride",
  field = "override",
): RuntimeVertexDeformOverrideV1 {
  if (override === null || typeof override !== "object") {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be an object.`, { field });
  }
  if (override.space !== "vertexPositions" && override.space !== "weightedInfluenceOffsets") {
    throw new RuntimeErrorV1("invalidArgument", operation, "Unknown deform space.", { field: `${field}.space` });
  }
  if (!Array.isArray(override.values)) {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field}.values must be an array.`, { field: `${field}.values` });
  }
  const source = resolveVertexAttachmentSourceV1(attachment, data);
  const expected = override.space === "vertexPositions"
    ? source.vertices.length
    : source.weights.reduce((count, influences) => count + influences.length * 2, 0);
  if (override.space === "weightedInfluenceOffsets" && source.weights.length === 0) {
      throw new RuntimeErrorV1("invalidArgument", operation, "Unweighted attachment does not support weighted offsets.", {
      field: `${field}.space`,
      entityId: attachment.id,
    });
  }
  if (override.values.length !== expected) {
    throw new RuntimeErrorV1("invalidArgument", operation, `Expected ${expected} deform components.`, {
      field: `${field}.values`,
      entityId: attachment.id,
    });
  }
  return {
    space: override.space,
    values: override.values.map((value, index) => overrideFinite(value, operation, `${field}.values[${index}]`)),
  };
}

function normalizeSlotTintOverride(
  value: RuntimeSlotTintOverrideV1,
  operation = "setSlotTintOverride",
  field = "tint",
): RuntimeSlotTintOverrideV1 {
  if (value === null || typeof value !== "object") {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be an object.`, { field });
  }
  return {
    lightRgb: normalizeRgb(value.lightRgb, operation, `${field}.lightRgb`),
    alpha: overrideUnit(value.alpha, operation, `${field}.alpha`),
    darkRgb: value.darkRgb === null ? null : normalizeRgb(value.darkRgb, operation, `${field}.darkRgb`),
  };
}

function normalizeRgb(value: readonly number[], operation: string, field: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must contain three bytes.`, { field });
  }
  const result = value.map((component, index) => {
    if (!Number.isInteger(component) || component < 0 || component > 255) {
      throw new RuntimeErrorV1("invalidArgument", operation, `${field} components must be bytes.`, {
        field: `${field}[${index}]`,
      });
    }
    return component;
  });
  return [result[0] ?? 0, result[1] ?? 0, result[2] ?? 0];
}

function encodeRgb(value: readonly [number, number, number]): string {
  return `#${byteHexV1(value[0])}${byteHexV1(value[1])}${byteHexV1(value[2])}`;
}

function byteHexV1(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function normalizeConstraintOverride(
  constraint: RuntimeConstraintV1,
  override: RuntimeConstraintOverrideV1,
  operation = "setConstraintOverride",
  fieldPrefix = "override",
): RuntimeConstraintOverrideV1 {
  if (override === null || typeof override !== "object") {
    throw new RuntimeErrorV1("invalidArgument", operation, `${fieldPrefix} must be an object.`, { field: fieldPrefix });
  }
  if (override.type !== constraint.type) {
    throw new RuntimeErrorV1("invalidArgument", operation, "Constraint override kind does not match the target.", {
      field: `${fieldPrefix}.type`,
      entityId: constraint.id,
    });
  }
  const result: Record<string, unknown> = { ...override };
  const normalizeNumbers = (
    fields: readonly string[],
    validation: (value: number, field: string) => number = (value, field) => overrideFinite(value, operation, field),
  ): void => {
    for (const property of fields) {
      const value = result[property];
      if (value !== undefined && value !== null) {
        result[property] = validation(value as number, `${fieldPrefix}.${property}`);
      }
    }
  };
  switch (override.type) {
    case "ik":
      normalizeNumbers(["mix"], (value, field) => overrideUnit(value, operation, field));
      normalizeNumbers(["softness"], (value, field) => overrideNonNegative(value, operation, field));
      if (override.target !== undefined && override.target !== null) {
        result.target = {
          x: overrideFinite(override.target.x, operation, `${fieldPrefix}.target.x`),
          y: overrideFinite(override.target.y, operation, `${fieldPrefix}.target.y`),
        };
      }
      for (const property of ["bendPositive", "compress", "stretch"] as const) {
        const value = override[property];
        if (value !== undefined && value !== null && typeof value !== "boolean") {
          throw new RuntimeErrorV1("invalidArgument", operation, `${fieldPrefix}.${property} must be boolean.`, {
            field: `${fieldPrefix}.${property}`,
          });
        }
      }
      break;
    case "transform":
      normalizeNumbers([
        "rotationDegrees", "x", "y", "scaleX", "scaleY", "shearYDegrees",
        "mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY",
      ]);
      break;
    case "path":
      normalizeNumbers(["rotationDegrees", "position", "spacing"]);
      normalizeNumbers(["mixRotate", "mixX", "mixY"], (value, field) => overrideUnit(value, operation, field));
      break;
    case "physics":
      normalizeNumbers(["x", "y", "rotate", "scaleX", "shearX", "inertia", "damping", "mix"],
        (value, field) => overrideUnit(value, operation, field));
      normalizeNumbers(["limit", "strength"], (value, field) => overrideNonNegative(value, operation, field));
      normalizeNumbers(["wind", "gravity"]);
      normalizeNumbers(["mass"], (value, field) => overridePositive(value, operation, field));
      if (override.fps !== undefined && override.fps !== null) {
        if (!Number.isInteger(override.fps) || override.fps <= 0 || override.fps > 0xffff_ffff) {
          throw new RuntimeErrorV1("invalidArgument", operation, `${fieldPrefix}.fps must be a positive u32.`, {
            field: `${fieldPrefix}.fps`,
          });
        }
        result.fps = override.fps;
      }
      break;
    case "slider":
      normalizeNumbers(["sourceOffset", "timeOffset", "timeScale", "time", "mix"]);
      normalizeNumbers(["rangeMax"], (value, field) => overrideNonNegative(value, operation, field));
      break;
  }
  return result as unknown as RuntimeConstraintOverrideV1;
}

function overrideFinite(value: number, operation: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RuntimeErrorV1("nonFinite", operation, `${field} must be finite.`, { field });
  }
  try {
    return finiteF32(value);
  } catch (error) {
    throw new RuntimeErrorV1("nonFinite", operation, `${field} is outside binary32 range.`, { field, cause: error });
  }
}

function overrideUnit(value: number, operation: string, field: string): number {
  const result = overrideFinite(value, operation, field);
  if (result < 0 || result > 1) {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be in [0,1].`, { field });
  }
  return result;
}

function overrideNonNegative(value: number, operation: string, field: string): number {
  const result = overrideFinite(value, operation, field);
  if (result < 0) throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be non-negative.`, { field });
  return result;
}

function overridePositive(value: number, operation: string, field: string): number {
  const result = overrideFinite(value, operation, field);
  if (!(result > 0)) throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be positive.`, { field });
  return result;
}

function validateNonNegativeF32(value: number, operation: string, field: string): number {
  if (!Number.isFinite(value)) {
    throw new RuntimeErrorV1("nonFinite", operation, `${field} must be finite.`, {
      field,
    });
  }
  if (value < 0) {
    throw new RuntimeErrorV1("invalidArgument", operation, `${field} must be non-negative.`, {
      field,
    });
  }
  try {
    return finiteF32(value);
  } catch (error) {
    throw new RuntimeErrorV1("nonFinite", operation, `${field} is outside binary32 range.`, {
      field,
      cause: error,
    });
  }
}

function validateDelta(value: number, operation: string): number {
  return validateNonNegativeF32(value, operation, "deltaSeconds");
}

function validateAbsoluteTime(value: number): number {
  return validateNonNegativeF32(value, "seek", "timeSeconds");
}

function validateFixedStep(value: number): number {
  const result = validateNonNegativeF32(value, "seek", "fixedStepSeconds");
  if (result <= 0) {
    throw new RuntimeErrorV1("invalidArgument", "seek", "fixedStepSeconds must be positive.", {
      field: "fixedStepSeconds",
    });
  }
  return result;
}

function normalizeRootTransform(root: RootTransformV1): RootTransformV1 {
  if (root === null || typeof root !== "object") {
    throw new RuntimeErrorV1("invalidArgument", "setRootTransform", "root must be an object.", {
      field: "root",
    });
  }
  return {
    x: rootScalar(root.x, "x"),
    y: rootScalar(root.y, "y"),
    rotationDegrees: rootScalar(root.rotationDegrees, "rotationDegrees"),
    scaleX: rootScalar(root.scaleX, "scaleX"),
    scaleY: rootScalar(root.scaleY, "scaleY"),
  };
}

interface NormalizedRuntimeRootTransformOptionsV1 {
  readonly physicsMode: RuntimePhysicsHostMotionModeV1;
  readonly constraintId: string | null;
}

function normalizeRootTransformOptionsV1(
  data: RuntimeDataV1,
  options: RuntimeRootTransformOptionsV1,
): NormalizedRuntimeRootTransformOptionsV1 {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new RuntimeErrorV1("invalidArgument", "setRootTransform", "options must be an object.", {
      field: "options",
    });
  }
  const physicsMode = options.physicsMode ?? "move";
  if (physicsMode !== "move" && physicsMode !== "teleport"
    && physicsMode !== "preserveInertia" && physicsMode !== "clearInertia") {
    throw new RuntimeErrorV1("invalidArgument", "setRootTransform", "Unknown Physics host motion mode.", {
      field: "physicsMode",
    });
  }
  const constraintId = options.constraintId ?? null;
  if (constraintId !== null) {
    if (typeof constraintId !== "string" || constraintId.length === 0 || constraintId.includes("\0")) {
      throw new RuntimeErrorV1("invalidArgument", "setRootTransform", "constraintId must be a non-empty NUL-free string.", {
        field: "constraintId",
      });
    }
    let constraint: RuntimeConstraintV1;
    try {
      constraint = data.constraint(constraintId);
    } catch (error) {
      throw remapRuntimeErrorV1(error, "setRootTransform", "Physics constraint lookup failed.");
    }
    if (constraint.type !== "physics") {
      throw new RuntimeErrorV1("invalidArgument", "setRootTransform", "constraintId must identify a Physics constraint.", {
        field: "constraintId",
        entityId: constraintId,
      });
    }
  }
  return { physicsMode, constraintId };
}

function rootScalar(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new RuntimeErrorV1("nonFinite", "setRootTransform", `Root field '${field}' must be finite.`, { field });
  }
  try {
    return finiteF32(value);
  } catch (error) {
    throw new RuntimeErrorV1("nonFinite", "setRootTransform", `Root field '${field}' is outside binary32 range.`, {
      field,
      cause: error,
    });
  }
}

function physicsBudget(): RuntimePhysicsBudgetV1 {
  return { remaining: MAX_PHYSICS_SUBSTEPS_PER_OPERATION_V1 };
}

function normalizePhysicsEnvironment(environment: RuntimePhysicsEnvironmentV1): RuntimePhysicsEnvironmentV1 {
  if (environment === null || typeof environment !== "object") {
    throw new RuntimeErrorV1("invalidArgument", "setPhysicsEnvironment", "environment must be an object.", {
      field: "environment",
    });
  }
  return {
    windX: physicsEnvironmentScalar(environment.windX, "windX"),
    windY: physicsEnvironmentScalar(environment.windY, "windY"),
    gravityX: physicsEnvironmentScalar(environment.gravityX, "gravityX"),
    gravityY: physicsEnvironmentScalar(environment.gravityY, "gravityY"),
  };
}

function physicsEnvironmentScalar(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new RuntimeErrorV1("nonFinite", "setPhysicsEnvironment", `${field} must be finite.`, { field });
  }
  try {
    return finiteF32(value);
  } catch (error) {
    throw new RuntimeErrorV1("nonFinite", "setPhysicsEnvironment", `${field} is outside binary32 range.`, {
      field,
      cause: error,
    });
  }
}
