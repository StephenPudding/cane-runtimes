import type {
  AffineV1,
  RuntimeBoneV1,
  RuntimeConstraintV1,
  RuntimeConstraintDiagnosticV1,
  RuntimeIkConstraintV1,
  RuntimePathAttachmentV1,
  RuntimePathConstraintV1,
  RuntimePathConstraintPositionV1,
  RuntimePhysicsEnvironmentV1,
  RuntimeSamplingV1,
  RuntimeSkinV1,
  RuntimeSliderConstraintV1,
  RuntimeSlotV1,
  RuntimeTransformConstraintV1,
  RuntimeTransformConstraintOffsetsV1,
  RuntimeTransformPropertyV1,
} from "../contracts.js";
import {
  childWorldAffineV1,
  determinantV1,
  localBoneAffineV1,
  multiplyAffineV1,
  transformPointV1,
} from "../math/affine.js";
import {
  F32_DEGREES_TO_RADIANS,
  F32_RADIANS_TO_DEGREES,
  f32,
  f32Add,
  f32MatrixAxisLength,
  f32Mul,
} from "../math/f32.js";
import type { RuntimeDataV1 } from "../data.js";
import {
  applyAnimationLayerToSampledPoseV1,
  type RuntimeSampledDeformV1,
  type RuntimeSampledPoseV1,
} from "../animation/sampling.js";
import { quantizeSampleTimeV1 } from "../animation/curves.js";
import { evaluateVertexAttachmentWorldV1 } from "../geometry/vertices.js";
import {
  applyPhysicsConstraintV1,
  createRuntimePhysicsApplyScratchV1,
  type RuntimePhysicsApplyScratchV1,
  type RuntimePhysicsBudgetV1,
  RuntimePhysicsStateStoreV1,
} from "./physics.js";

const MATRIX_EPSILON = 1.1920928955078125e-7;
const IK_MIN_VECTOR_SQUARED = 0.000001;
const IK_MIN_VECTOR_LENGTH = Math.sqrt(IK_MIN_VECTOR_SQUARED);
const IK_ROTATION_DELTA_EPSILON = 0.00001;
const IK_UNIFORM_SCALE_EPSILON = 0.000001;
const IK_SOFTNESS_EPSILON = 0.000001;
const IK_REACH_EPSILON = 0.000001;
const IK_MIN_POSITIVE_SCALE = 0.000001;
const ITERATIVE_LOCAL_FIELDS = ["rotation", "scaleX", "scaleY", "shearY"] as const;

interface SkinMembershipCacheV1 {
  readonly bones: ReadonlyMap<string, readonly string[]>;
  readonly constraints: ReadonlyMap<string, readonly string[]>;
}

const SKIN_MEMBERSHIP_CACHE = new WeakMap<object, SkinMembershipCacheV1>();

type Mutable<T> = { -readonly [Property in keyof T]: T[Property] };
type MutableConstraintSolveResultV1 = {
  -readonly [Property in keyof RuntimeConstraintSolveResultV1]: RuntimeConstraintSolveResultV1[Property]
};

export interface RuntimeConstraintSolveScratchV1 {
  readonly runtimeConstraintSolveScratchV1: true;
}

interface ConstraintSolveScratchStorageV1 {
  readonly boneById: Map<string, Mutable<RuntimeBoneV1>>;
  readonly boneIndexById: Map<string, number>;
  readonly slotById: Map<string, RuntimeSlotV1>;
  readonly worlds: Map<string, AffineV1>;
  readonly transformSolve: Map<string, RuntimeTransformSolveScratchV1>;
  readonly ikSolve: Map<string, RuntimeIkSolveScratchV1>;
  readonly physicsApply: Map<string, RuntimePhysicsApplyScratchV1>;
  readonly pathSolve: Map<string, RuntimePathSolveScratchV1>;
  readonly diagnostics: Map<string, RuntimeConstraintDiagnosticV1>;
  readonly diagnosticEpochById: Map<string, number>;
  readonly reconstruction: RuntimeLocalReconstructionScratchV1;
  diagnosticEpoch: number;
  result: MutableConstraintSolveResultV1 | null;
}

interface RuntimeIkSolveScratchV1 {
  readonly chain: Mutable<RuntimeBoneV1>[];
  readonly beforeRotations: number[];
  readonly inverse: AffineV1;
}

interface RuntimeLocalReconstructionScratchV1 {
  readonly inverse: AffineV1;
  readonly local: AffineV1;
  readonly position: [number, number];
  candidate: Mutable<RuntimeBoneV1> | null;
  readonly matrix: AffineV1;
  readonly nextMatrix: AffineV1;
  readonly residual: number[];
  readonly jacobian: number[];
  readonly augmented: number[];
  readonly correction: number[];
}

interface RuntimeTransformSolveScratchV1 {
  readonly target: AffineV1;
  readonly sourceValues: number[];
  readonly position: [number, number];
}

interface RuntimePathSolveScratchV1 {
  readonly flatPoints: number[];
  readonly driven: Array<Mutable<RuntimeBoneV1> | undefined>;
  readonly boneIndices: number[];
  readonly worldLengths: Array<number | null>;
  readonly desiredWorlds: Array<AffineV1 | undefined>;
  readonly desiredValid: boolean[];
  readonly affectedBones: boolean[];
  readonly sampler: RuntimePathSamplerWorkspaceV1;
  readonly currentSample: MutablePathSampleV1;
  readonly nextSample: MutablePathSampleV1;
  readonly carriedSample: MutablePathSampleV1;
}

const CONSTRAINT_SOLVE_SCRATCH = new WeakMap<
  RuntimeConstraintSolveScratchV1,
  ConstraintSolveScratchStorageV1
>();

export function createRuntimeConstraintSolveScratchV1(): RuntimeConstraintSolveScratchV1 {
  const scratch = Object.freeze({ runtimeConstraintSolveScratchV1: true as const });
  CONSTRAINT_SOLVE_SCRATCH.set(scratch, {
    boneById: new Map(),
    boneIndexById: new Map(),
    slotById: new Map(),
    worlds: new Map(),
    transformSolve: new Map(),
    ikSolve: new Map(),
    physicsApply: new Map(),
    pathSolve: new Map(),
    diagnostics: new Map(),
    diagnosticEpochById: new Map(),
    reconstruction: createLocalReconstructionScratchV1(),
    diagnosticEpoch: 0,
    result: null,
  });
  return scratch;
}

export interface RuntimeConstraintSolveResultV1 extends RuntimeSampledPoseV1 {
  readonly worldByBoneId: ReadonlyMap<string, AffineV1>;
}

export interface RuntimeConstraintSolveContextV1 {
  readonly data: RuntimeDataV1;
  readonly slots: readonly RuntimeSlotV1[];
  readonly deforms: ReadonlyMap<string, RuntimeSampledDeformV1>;
  readonly physicsStates: RuntimePhysicsStateStoreV1;
  readonly physicsDeltaSeconds: number;
  readonly physicsEnvironment: RuntimePhysicsEnvironmentV1;
  readonly physicsBudget: RuntimePhysicsBudgetV1;
  readonly referenceScale: number;
  readonly rootScaleX: number;
  readonly rootScaleY: number;
  readonly sampling: RuntimeSamplingV1;
  /** Internal trusted workspace used by RuntimePlayer performance mode. */
  readonly scratch?: RuntimeConstraintSolveScratchV1 | null;
}

export function solveRuntimeConstraintsV1(
  sampledPose: RuntimeSampledPoseV1,
  skins: readonly RuntimeSkinV1[],
  root: AffineV1,
  rootRotationDegrees = 0,
  context: RuntimeConstraintSolveContextV1 | null = null,
): RuntimeConstraintSolveResultV1 {
  const scratch = context?.scratch === undefined || context.scratch === null
    ? null
    : constraintSolveScratchStorageV1(context.scratch);
  let pose = sampledPose;
  let bones = scratch === null
    ? cloneBonesV1(pose.bones)
    : pose.bones as Mutable<RuntimeBoneV1>[];
  let boneById = indexBonesV1(bones, scratch?.boneById ?? null);
  let boneIndexById = indexBoneIndicesV1(bones, scratch?.boneIndexById ?? null);
  let slotById = indexSlotsV1(pose.slots, scratch?.slotById ?? null);
  let constraints = pose.constraints;
  let sampledSliderTimes: ReadonlyMap<string, number> = pose.sampledSliderTimes;
  const diagnosticEpoch = scratch === null ? 0 : beginConstraintDiagnosticsV1(scratch);
  let constraintDiagnostics: ReadonlyMap<string, RuntimeConstraintDiagnosticV1> = scratch === null
    ? pose.constraintDiagnostics
    : scratch.diagnostics;
  if (scratch !== null) retainConstraintDiagnosticsV1(scratch, pose.constraintDiagnostics, diagnosticEpoch);
  let constraintDiagnosticsMutable = scratch !== null;
  let worlds = buildWorlds(bones, root, scratch?.worlds ?? null);
  const declarations = context?.data.document.constraints ?? constraints;
  for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
    const declaration = declarations[declarationIndex];
    if (declaration === undefined) continue;
    const orderedConstraint = constraints[declarationIndex];
    const constraint = orderedConstraint?.id === declaration.id
      ? orderedConstraint
      : constraintByIdV1(constraints, declaration.id);
    if (constraint === undefined) continue;
    if (!memberIsActive(constraint.id, "constraint", skins, pose.sampledSkinIds)) continue;
    if (constraint.type === "ik") {
      if (constraint.targetBoneId !== null
        && !memberIsActive(constraint.targetBoneId, "bone", skins, pose.sampledSkinIds)) continue;
      worlds = solveIk(
        constraint,
        bones,
        boneById,
        root,
        rootRotationDegrees,
        worlds,
        scratch === null ? null : reusableIkSolveV1(scratch, constraint.id),
        boneIndexById,
      );
    } else if (constraint.type === "transform") {
      if (!memberIsActive(constraint.targetBoneId, "bone", skins, pose.sampledSkinIds)) continue;
      const transformScratch = scratch === null ? null : reusableTransformSolveV1(scratch, constraint.id);
      worlds = solveTransform(
        constraint,
        bones,
        boneById,
        root,
        worlds,
        transformScratch,
        boneIndexById,
        scratch?.reconstruction ?? null,
      );
    } else if (constraint.type === "path" && context !== null) {
      const slot = slotById.get(constraint.targetSlotId);
      if (slot === undefined || !memberIsActive(slot.boneId, "bone", skins, pose.sampledSkinIds)) continue;
      worlds = solvePath(
        constraint,
        bones,
        boneById,
        root,
        worlds,
        context,
        slot,
        pose.deforms,
        boneIndexById,
        scratch === null ? null : reusablePathSolveV1(scratch, constraint.id),
        scratch?.reconstruction ?? null,
      );
    } else if (constraint.type === "physics" && context !== null) {
      if (!memberIsActive(constraint.boneId, "bone", skins, pose.sampledSkinIds)) continue;
      const bone = boneById.get(constraint.boneId);
      const current = worlds.get(constraint.boneId);
      if (bone === undefined || current === undefined) continue;
      const applied = applyPhysicsConstraintV1(
        constraint,
        context.physicsDeltaSeconds,
        context.referenceScale,
        context.physicsEnvironment,
        context.physicsStates.state(constraint.id),
        bone,
        current,
        context.rootScaleX,
        context.rootScaleY,
        context.physicsBudget,
        scratch === null ? null : reusablePhysicsApplyV1(scratch, constraint.id),
      );
      if (applied === null) continue;
      const nextWorld = applied.matrix;
      if (!constraintDiagnosticsMutable) {
        constraintDiagnostics = new Map(constraintDiagnostics);
        constraintDiagnosticsMutable = true;
      }
      (constraintDiagnostics as Map<string, RuntimeConstraintDiagnosticV1>).set(constraint.id, applied.diagnostic);
      if (scratch !== null) scratch.diagnosticEpochById.set(constraint.id, diagnosticEpoch);
      const index = boneIndexById.get(bone.id) ?? -1;
      reconstructLocalPose(bone, nextWorld, root, worlds, scratch?.reconstruction ?? null);
      worlds.set(bone.id, nextWorld);
      if (index >= 0) worlds = propagateDescendants(index, bones, worlds, boneIndexById);
    } else if (constraint.type === "slider" && context !== null) {
      const currentPose: RuntimeSampledPoseV1 = {
        ...pose,
        bones,
        constraints,
        sampledSliderTimes,
        constraintDiagnostics,
      };
      const applied = solveSlider(
        constraint,
        currentPose,
        worlds,
        root,
        skins,
        context,
      );
      if (applied === null) continue;
      pose = applied.pose;
      bones = scratch === null
        ? cloneBonesV1(pose.bones)
        : pose.bones as Mutable<RuntimeBoneV1>[];
      boneById = indexBonesV1(bones, scratch?.boneById ?? null);
      boneIndexById = indexBoneIndicesV1(bones, scratch?.boneIndexById ?? null);
      slotById = indexSlotsV1(pose.slots, scratch?.slotById ?? null);
      constraints = pose.constraints;
      sampledSliderTimes = scratch === null
        ? new Map(pose.sampledSliderTimes)
        : pose.sampledSliderTimes;
      (sampledSliderTimes as Map<string, number>).set(constraint.id, applied.resolvedTime);
      if (scratch === null) {
        constraintDiagnostics = new Map(pose.constraintDiagnostics);
      } else {
        retainConstraintDiagnosticsV1(scratch, pose.constraintDiagnostics, diagnosticEpoch);
        constraintDiagnostics = scratch.diagnostics;
      }
      constraintDiagnosticsMutable = true;
      (constraintDiagnostics as Map<string, RuntimeConstraintDiagnosticV1>).set(constraint.id, applied.diagnostic);
      if (scratch !== null) scratch.diagnosticEpochById.set(constraint.id, diagnosticEpoch);
      if (context.data.animation(constraint.animationId).boneTimelines.length > 0) {
        worlds = buildWorlds(bones, root, scratch?.worlds ?? worlds);
      }
    }
  }
  if (scratch !== null) {
    finishConstraintDiagnosticsV1(scratch, diagnosticEpoch);
    let result = scratch.result;
    if (result === null) {
      result = { ...pose, worldByBoneId: worlds };
      scratch.result = result;
    } else {
      result.bones = pose.bones;
      result.slots = pose.slots;
      result.regions = pose.regions;
      result.deforms = pose.deforms;
      result.sequenceIndices = pose.sequenceIndices;
      result.slotAttachmentKeys = pose.slotAttachmentKeys;
      result.sampledSkinIds = pose.sampledSkinIds;
      result.constraints = pose.constraints;
      result.drawOrderSlotIds = pose.drawOrderSlotIds;
      result.drawOrderSampled = pose.drawOrderSampled;
      result.sampledSliderTimes = pose.sampledSliderTimes;
      result.constraintDiagnostics = pose.constraintDiagnostics;
    }
    result.bones = bones;
    result.constraints = constraints;
    result.sampledSliderTimes = sampledSliderTimes;
    result.constraintDiagnostics = constraintDiagnostics;
    result.worldByBoneId = worlds;
    return result;
  }
  return { ...pose, bones, constraints, sampledSliderTimes, constraintDiagnostics, worldByBoneId: worlds };
}

function cloneBonesV1(source: readonly RuntimeBoneV1[]): Mutable<RuntimeBoneV1>[] {
  const result = new Array<Mutable<RuntimeBoneV1>>(source.length);
  for (let index = 0; index < source.length; index += 1) {
    const bone = source[index];
    if (bone !== undefined) result[index] = { ...bone };
  }
  return result;
}

function indexBonesV1(
  bones: readonly Mutable<RuntimeBoneV1>[],
  output: Map<string, Mutable<RuntimeBoneV1>> | null = null,
): Map<string, Mutable<RuntimeBoneV1>> {
  const result = output ?? new Map<string, Mutable<RuntimeBoneV1>>();
  if (!indexedMapShapeMatchesV1(result, bones)) result.clear();
  for (let index = 0; index < bones.length; index += 1) {
    const bone = bones[index];
    if (bone !== undefined) result.set(bone.id, bone);
  }
  return result;
}

function indexBoneIndicesV1(
  bones: readonly RuntimeBoneV1[],
  output: Map<string, number> | null = null,
): Map<string, number> {
  const result = output ?? new Map<string, number>();
  if (!indexedMapShapeMatchesV1(result, bones)) result.clear();
  for (let index = 0; index < bones.length; index += 1) {
    const bone = bones[index];
    if (bone !== undefined) result.set(bone.id, index);
  }
  return result;
}

function indexSlotsV1(
  slots: readonly RuntimeSlotV1[],
  output: Map<string, RuntimeSlotV1> | null = null,
): Map<string, RuntimeSlotV1> {
  const result = output ?? new Map<string, RuntimeSlotV1>();
  if (!indexedMapShapeMatchesV1(result, slots)) result.clear();
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (slot !== undefined) result.set(slot.id, slot);
  }
  return result;
}

function indexedMapShapeMatchesV1(
  target: ReadonlyMap<string, unknown>,
  values: readonly { readonly id: string }[],
): boolean {
  if (target.size !== values.length) return false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) return false;
    if (!target.has(value.id)) return false;
  }
  return true;
}

function constraintByIdV1(
  constraints: readonly RuntimeConstraintV1[],
  id: string,
): RuntimeConstraintV1 | undefined {
  for (let index = 0; index < constraints.length; index += 1) {
    const constraint = constraints[index];
    if (constraint === undefined) continue;
    if (constraint.id === id) return constraint;
  }
  return undefined;
}

function constraintSolveScratchStorageV1(
  scratch: RuntimeConstraintSolveScratchV1,
): ConstraintSolveScratchStorageV1 {
  let storage = CONSTRAINT_SOLVE_SCRATCH.get(scratch);
  if (storage === undefined) {
    storage = {
      boneById: new Map(),
      boneIndexById: new Map(),
      slotById: new Map(),
      worlds: new Map(),
      transformSolve: new Map(),
      ikSolve: new Map(),
      physicsApply: new Map(),
      pathSolve: new Map(),
      diagnostics: new Map(),
      diagnosticEpochById: new Map(),
      reconstruction: createLocalReconstructionScratchV1(),
      diagnosticEpoch: 0,
      result: null,
    };
    CONSTRAINT_SOLVE_SCRATCH.set(scratch, storage);
  }
  return storage;
}

interface RuntimeSliderSolveResultV1 {
  readonly pose: RuntimeSampledPoseV1;
  readonly resolvedTime: number;
  readonly diagnostic: Extract<RuntimeConstraintDiagnosticV1, { readonly type: "slider" }>;
}

function solveSlider(
  constraint: RuntimeSliderConstraintV1,
  pose: RuntimeSampledPoseV1,
  worlds: ReadonlyMap<string, AffineV1>,
  root: AffineV1,
  skins: readonly RuntimeSkinV1[],
  context: RuntimeConstraintSolveContextV1,
): RuntimeSliderSolveResultV1 | null {
  if (!Number.isFinite(constraint.mix) || constraint.mix === 0) return null;
  const animation = context.data.animation(constraint.animationId);
  let mappedTime = constraint.time;
  let sourceValue: number | null = null;
  if (constraint.sourceBoneId !== null) {
    if (!memberIsActive(constraint.sourceBoneId, "bone", skins, pose.sampledSkinIds)) return null;
    const sourceBone = pose.bones.find((bone) => bone.id === constraint.sourceBoneId);
    const sourceWorld = worlds.get(constraint.sourceBoneId);
    if (sourceBone === undefined || sourceWorld === undefined) return null;
    sourceValue = constraint.local
      ? sliderLocalSource(sourceBone, constraint.sourceProperty)
      : sliderWorldSource(sourceWorld, root, constraint.sourceProperty);
    if (sourceValue === null) return null;
    mappedTime = f32(constraint.timeOffset + f32((sourceValue - constraint.sourceOffset) * constraint.timeScale));
    if (!Number.isFinite(mappedTime)) return null;
  }

  const duration = animation.duration;
  let resolvedTime = mappedTime;
  let wrapped = false;
  let clamped = false;
  if (constraint.looping && duration > 0) {
    resolvedTime = f32(((mappedTime % duration) + duration) % duration);
    wrapped = resolvedTime !== mappedTime;
  } else if (constraint.sourceBoneId !== null) {
    resolvedTime = f32(Math.min(Math.max(mappedTime, 0), Math.max(duration, 0)));
    clamped = resolvedTime !== mappedTime;
  }
  if (!Number.isFinite(resolvedTime)) return null;

  let sampleTime = resolvedTime;
  if (context.sampling.mode === "fixedFrame" || context.sampling.mode === "fixedFrameStepped") {
    sampleTime = quantizeSampleTimeV1(resolvedTime, context.sampling.frameStepSeconds);
  }
  const appliedPose = applyAnimationLayerToSampledPoseV1(context.data, pose, {
    animation,
    sampleTime,
    alpha: constraint.mix,
    blend: constraint.additive ? "additive" : "replace",
    forceStepped: context.sampling.mode === "forceStepped" || context.sampling.mode === "fixedFrameStepped",
    attachmentsAllowed: true,
    drawOrderAllowed: true,
    unboundedAlpha: true,
  });
  return {
    pose: appliedPose,
    resolvedTime,
    diagnostic: {
      type: "slider",
      sourceValue,
      mappedTimeSeconds: mappedTime,
      resolvedTimeSeconds: resolvedTime,
      targetDurationSeconds: duration,
      wrapped,
      clamped,
    },
  };
}

function sliderLocalSource(bone: RuntimeBoneV1, property: RuntimeTransformPropertyV1): number {
  switch (property) {
    case "rotate": return bone.rotation;
    case "x": return bone.x;
    case "y": return bone.y;
    case "scaleX": return bone.scaleX;
    case "scaleY": return bone.scaleY;
    case "shearY": return bone.shearY;
  }
}

function sliderWorldSource(
  world: AffineV1,
  root: AffineV1,
  property: RuntimeTransformPropertyV1,
): number | null {
  const inverseRoot = inverseAffine(root);
  if (inverseRoot === null) return null;
  const matrix = multiplyAffineV1(inverseRoot, world);
  let value: number;
  switch (property) {
    case "rotate": {
      value = radiansToDegreesV1(Math.atan2(matrix.b, matrix.a));
      if (value < 0) value += 360;
      break;
    }
    case "x": value = matrix.tx; break;
    case "y": value = matrix.ty; break;
    case "scaleX": value = f32MatrixAxisLength(matrix.a, matrix.b); break;
    case "scaleY": value = f32MatrixAxisLength(matrix.c, matrix.d); break;
    case "shearY": {
      value = radiansToDegreesV1(Math.atan2(matrix.d, matrix.c))
        - radiansToDegreesV1(Math.atan2(matrix.b, matrix.a))
        - 90;
      break;
    }
  }
  const rounded = f32(value);
  return Number.isFinite(rounded) ? rounded : null;
}

interface PathPointV1 {
  readonly x: number;
  readonly y: number;
}

interface PathSampleV1 extends PathPointV1 {
  readonly tangentDegrees: number;
}

type MutablePathPointV1 = Mutable<PathPointV1>;
type MutablePathSampleV1 = Mutable<PathSampleV1>;

interface PathCurveV1 {
  readonly p0: PathPointV1;
  readonly p1: PathPointV1;
  readonly p2: PathPointV1;
  readonly p3: PathPointV1;
}

interface PathSamplerV1 {
  readonly totalLength: number;
  readonly closed: boolean;
  sample(distance: number, output?: MutablePathSampleV1 | null): PathSampleV1 | null;
  projectDistance(target: PathPointV1): number | null;
}

export function queryRuntimePathConstraintPositionV1(
  constraint: RuntimePathConstraintV1,
  pose: RuntimeSampledPoseV1,
  worlds: ReadonlyMap<string, AffineV1>,
  data: RuntimeDataV1,
): RuntimePathConstraintPositionV1 | null {
  const sampler = resolvedPathSampler(constraint, pose, worlds, data);
  if (sampler === null) return null;
  const distance = constraint.positionMode === "fixed"
    ? constraint.position
    : constraint.position * sampler.totalLength;
  const sample = sampler.sample(distance);
  const start = sampler.sample(0);
  const end = sampler.sample(sampler.totalLength);
  if (sample === null || start === null || end === null) return null;
  const values = [sample.x, sample.y, sample.tangentDegrees, distance, sampler.totalLength, start.x, start.y, end.x, end.y];
  if (!values.every(Number.isFinite)) return null;
  return {
    constraintId: constraint.id,
    point: { x: f32(sample.x), y: f32(sample.y) },
    tangentDegrees: f32(sample.tangentDegrees),
    distance: f32(distance),
    pathLength: f32(sampler.totalLength),
    pathStart: { x: f32(start.x), y: f32(start.y) },
    pathEnd: { x: f32(end.x), y: f32(end.y) },
    closed: sampler.closed,
  };
}

export function queryRuntimePathConstraintPositionForWorldTargetV1(
  constraint: RuntimePathConstraintV1,
  pose: RuntimeSampledPoseV1,
  worlds: ReadonlyMap<string, AffineV1>,
  data: RuntimeDataV1,
  target: PathPointV1,
): number | null {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
  const sampler = resolvedPathSampler(constraint, pose, worlds, data);
  if (sampler === null) return null;
  const distance = sampler.projectDistance(target);
  if (distance === null || !Number.isFinite(distance)) return null;
  const position = constraint.positionMode === "fixed" ? distance : distance / sampler.totalLength;
  return Number.isFinite(position) ? f32(position) : null;
}

function resolvedPathSampler(
  constraint: RuntimePathConstraintV1,
  pose: RuntimeSampledPoseV1,
  worlds: ReadonlyMap<string, AffineV1>,
  data: RuntimeDataV1,
): PathSamplerV1 | null {
  const slot = pose.slots.find((candidate) => candidate.id === constraint.targetSlotId);
  if (slot === undefined || slot.attachmentId === null) return null;
  const attachment = data.attachment(slot.attachmentId);
  if (attachment.type !== "path") return null;
  const slotWorld = worlds.get(slot.boneId);
  if (slotWorld === undefined) return null;
  const flat = evaluateVertexAttachmentWorldV1(
    attachment,
    slotWorld,
    worlds,
    pose.deforms.get(attachment.id) ?? null,
  );
  return createPathSampler(attachment, flat);
}

function solvePath(
  constraint: RuntimePathConstraintV1,
  bones: Mutable<RuntimeBoneV1>[],
  boneById: ReadonlyMap<string, Mutable<RuntimeBoneV1>>,
  root: AffineV1,
  initialWorlds: Map<string, AffineV1>,
  context: RuntimeConstraintSolveContextV1,
  slot: RuntimeSlotV1,
  deforms: ReadonlyMap<string, RuntimeSampledDeformV1>,
  boneIndexById: ReadonlyMap<string, number>,
  scratch: RuntimePathSolveScratchV1 | null,
  reconstructionScratch: RuntimeLocalReconstructionScratchV1 | null,
): Map<string, AffineV1> {
  let worlds = initialWorlds;
  if (slot.attachmentId === null) return worlds;
  const attachment = context.data.attachment(slot.attachmentId);
  if (attachment.type !== "path") return worlds;
  const slotWorld = worlds.get(slot.boneId);
  if (slotWorld === undefined) return worlds;
  const flatPoints = evaluateVertexAttachmentWorldV1(
    attachment,
    slotWorld,
    worlds,
    deforms.get(attachment.id) ?? null,
    scratch?.flatPoints ?? null,
  );
  const sampler = createPathSampler(attachment, flatPoints, scratch?.sampler ?? null);
  if (sampler === null) return worlds;
  let pathDistance = constraint.positionMode === "fixed"
    ? constraint.position
    : constraint.position * sampler.totalLength;
  const driven = scratch?.driven ?? new Array<Mutable<RuntimeBoneV1> | undefined>(constraint.boneIds.length);
  const boneIndices = scratch?.boneIndices ?? new Array<number>(constraint.boneIds.length);
  const worldLengths = scratch?.worldLengths ?? new Array<number | null>(constraint.boneIds.length);
  const desiredWorlds = scratch?.desiredWorlds ?? new Array<AffineV1 | undefined>(constraint.boneIds.length);
  const desiredValid = scratch?.desiredValid ?? new Array<boolean>(constraint.boneIds.length);
  driven.length = constraint.boneIds.length;
  boneIndices.length = constraint.boneIds.length;
  worldLengths.length = constraint.boneIds.length;
  desiredWorlds.length = constraint.boneIds.length;
  desiredValid.length = constraint.boneIds.length;
  for (let index = 0; index < constraint.boneIds.length; index += 1) {
    const boneId = constraint.boneIds[index];
    const bone = boneId === undefined ? undefined : boneById.get(boneId);
    driven[index] = bone;
    boneIndices[index] = boneId === undefined ? -1 : boneIndexById.get(boneId) ?? -1;
    const world = bone === undefined ? undefined : worlds.get(bone.id);
    worldLengths[index] = bone === undefined || world === undefined
      ? null
      : Math.max(bone.length, 0) * xScale(world);
    desiredValid[index] = false;
  }
  const spacingCount = constraint.rotateMode === "tangent"
    ? Math.max(driven.length - 1, 0)
    : driven.length;
  let proportionalLength = 0;
  for (let index = 0; index < spacingCount; index += 1) proportionalLength += worldLengths[index] ?? 0;
  const spacesCount = constraint.rotateMode === "tangent" ? driven.length : driven.length + 1;
  const signedRotation = constraint.rotation !== 0 && determinantV1(slotWorld) < 0
    ? -constraint.rotation
    : constraint.rotation;
  const chainTipTranslation = constraint.rotateMode === "chain" && constraint.rotation === 0;
  let carriedPosition: PathSampleV1 | null = null;

  for (let drivenIndex = 0; drivenIndex < driven.length; drivenIndex += 1) {
    const bone = driven[drivenIndex];
    if (bone === undefined) continue;
    const boneIndex = boneIndices[drivenIndex] ?? -1;
    if (boneIndex < 0) continue;
    if (drivenIndex > 0) {
      const previous = driven[drivenIndex - 1] ?? null;
      pathDistance += pathSpacing(
        constraint,
        previous,
        worldLengths[drivenIndex - 1] ?? null,
        sampler.totalLength,
        proportionalLength,
        spacesCount,
      );
    }
    const sampled = sampler.sample(pathDistance, scratch?.currentSample ?? null);
    if (sampled === null) continue;
    const sample = carriedPosition ?? sampled;
    carriedPosition = null;
    const current = worlds.get(bone.id);
    if (current === undefined) continue;
    const currentA = current.a;
    const currentB = current.b;
    const currentAngle = xAngle(current);
    const currentScaleX = xScale(current);
    const currentScaleY = yScale(current);
    const currentShearY = worldShearY(current);
    const nextDistance = pathDistance + pathSpacing(
      constraint,
      bone,
      worldLengths[drivenIndex] ?? Math.max(bone.length, 0) * xScale(current),
      sampler.totalLength,
      proportionalLength,
      spacesCount,
    );
    const next = sampler.sample(nextDistance, scratch?.nextSample ?? null) ?? sample;
    const chainAngle = radiansToDegreesV1(Math.atan2(next.y - sample.y, next.x - sample.x));
    const desiredRotation = (constraint.rotateMode === "tangent" ? sample.tangentDegrees : chainAngle) + signedRotation;
    const mixRotate = clamp(constraint.mixRotate, 0, 1);
    const mixedRotation = currentAngle + wrapDegrees(desiredRotation - currentAngle) * mixRotate;
    const mixedX = current.tx + (sample.x - current.tx) * clamp(constraint.mixX, 0, 1);
    const mixedY = current.ty + (sample.y - current.ty) * clamp(constraint.mixY, 0, 1);
    const mixedScaleX = constraint.rotateMode === "chainScale" && bone.length !== 0
      ? currentScaleX + (Math.hypot(next.x - sample.x, next.y - sample.y) / Math.abs(bone.length) - currentScaleX) * mixRotate
      : currentScaleX;
    const nextWorld = affineFromWorldTransform(
      mixedX,
      mixedY,
      mixedRotation,
      currentShearY,
      mixedScaleX,
      currentScaleY,
      scratch === null ? null : desiredWorlds[drivenIndex] ?? null,
    );
    if (nextWorld === null) continue;
    desiredWorlds[drivenIndex] = nextWorld;
    desiredValid[drivenIndex] = true;
    if (chainTipTranslation && constraint.mixRotate !== 0) {
      const fullDelta = wrapDegrees(chainAngle - currentAngle);
      const radians = degreesToRadiansV1(fullDelta);
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      const rotatedX = cosine * currentA - sine * currentB;
      const rotatedY = sine * currentA + cosine * currentB;
      const fullTipX = sample.x + bone.length * rotatedX;
      const fullTipY = sample.y + bone.length * rotatedY;
      const carried = scratch?.carriedSample ?? { x: 0, y: 0, tangentDegrees: 0 };
      carried.x = next.x + (fullTipX - next.x) * mixRotate;
      carried.y = next.y + (fullTipY - next.y) * mixRotate;
      carried.tangentDegrees = next.tangentDegrees;
      carriedPosition = carried;
    }
  }
  worlds = commitPathConstraintWorlds(
    bones,
    root,
    worlds,
    boneIndexById,
    boneIndices,
    desiredWorlds,
    desiredValid,
    scratch?.affectedBones ?? new Array<boolean>(bones.length),
    reconstructionScratch,
  );
  return worlds;
}

function commitPathConstraintWorlds(
  bones: readonly Mutable<RuntimeBoneV1>[],
  root: AffineV1,
  initialWorlds: Map<string, AffineV1>,
  boneIndexById: ReadonlyMap<string, number>,
  boneIndices: readonly number[],
  desiredWorlds: readonly (AffineV1 | undefined)[],
  desiredValid: readonly boolean[],
  affectedBones: boolean[],
  reconstructionScratch: RuntimeLocalReconstructionScratchV1 | null,
): Map<string, AffineV1> {
  const worlds = initialWorlds;
  affectedBones.length = bones.length;
  for (let boneIndex = 0; boneIndex < bones.length; boneIndex += 1) {
    const bone = bones[boneIndex];
    if (bone === undefined) continue;
    let desired: AffineV1 | undefined;
    for (let drivenIndex = 0; drivenIndex < boneIndices.length; drivenIndex += 1) {
      if (desiredValid[drivenIndex] === true && boneIndices[drivenIndex] === boneIndex) {
        desired = desiredWorlds[drivenIndex];
        break;
      }
    }
    const parentIndex = bone.parentId === null ? -1 : boneIndexById.get(bone.parentId) ?? -1;
    const parentIsAffected = parentIndex >= 0
      && parentIndex < boneIndex
      && affectedBones[parentIndex] === true;
    const affected = desired !== undefined || parentIsAffected;
    affectedBones[boneIndex] = affected;
    if (!affected) continue;
    const reusable = worlds.get(bone.id) ?? null;
    if (desired !== undefined) {
      reconstructLocalPose(bone, desired, root, worlds, reconstructionScratch);
      worlds.set(bone.id, copyAffineV1(desired, reusable));
      continue;
    }
    const world = bone.parentId === null
      ? multiplyAffineV1(root, localBoneAffineV1(bone, reusable), reusable)
      : childWorldAffineV1(worlds.get(bone.parentId) ?? root, bone, bone.transformMode, reusable);
    worlds.set(bone.id, world);
  }
  return worlds;
}

function createPathSampler(
  path: RuntimePathAttachmentV1,
  flat: readonly number[],
  workspace: RuntimePathSamplerWorkspaceV1 | null = null,
): PathSamplerV1 | null {
  return (workspace ?? new RuntimePathSamplerWorkspaceV1()).reset(path, flat);
}

type MutablePathCurveV1 = Mutable<PathCurveV1>;
type PathSamplerModeV1 = "constant" | "setup";

const CONSTANT_PATH_LENGTH_STEPS_V1 = 4;
const CONSTANT_PATH_SEGMENTS_V1 = 10;
const PATH_PROJECTION_STEPS_V1 = 24;

class RuntimePathSamplerWorkspaceV1 implements PathSamplerV1 {
  totalLength = 0;
  closed = false;

  private mode: PathSamplerModeV1 = "constant";
  private readonly sourcePoints: MutablePathPointV1[] = [];
  private readonly curves: MutablePathCurveV1[] = [];
  private readonly polylinePoints: MutablePathPointV1[] = [];
  private readonly distances: number[] = [];
  private readonly lengths: number[] = [];
  private readonly constantSegments: number[] = [];
  private readonly cubicScratch: MutablePathPointV1 = { x: 0, y: 0 };
  private readonly startForward: MutablePathPointV1 = { x: 0, y: 0 };
  private readonly endPrevious: MutablePathPointV1 = { x: 0, y: 0 };
  private hasStartForward = false;
  private hasEndPrevious = false;

  reset(path: RuntimePathAttachmentV1, flat: readonly number[]): PathSamplerV1 | null {
    this.totalLength = 0;
    this.closed = path.closed;
    if (flat.length % 2 !== 0) return null;
    const pointCount = flat.length / 2;
    for (let index = 0; index < pointCount; index += 1) {
      const x = flat[index * 2];
      const y = flat[index * 2 + 1];
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      const point = mutablePathPointAtV1(this.sourcePoints, index);
      point.x = x;
      point.y = y;
    }
    this.sourcePoints.length = pointCount;

    const knotCount = pointCount / 3;
    if (!Number.isInteger(knotCount) || knotCount < 2) return null;
    const curveCount = path.closed ? knotCount : knotCount - 1;
    for (let index = 0; index < curveCount; index += 1) {
      const next = (index + 1) % knotCount;
      const p0 = this.sourcePoints[index * 3 + 1];
      const p1 = this.sourcePoints[index * 3 + 2];
      const p2 = this.sourcePoints[next * 3];
      const p3 = this.sourcePoints[next * 3 + 1];
      if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) return null;
      const curve = this.curves[index];
      if (curve === undefined) this.curves[index] = { p0, p1, p2, p3 };
      else {
        curve.p0 = p0;
        curve.p1 = p1;
        curve.p2 = p2;
        curve.p3 = p3;
      }
    }
    this.curves.length = curveCount;
    return path.constantSpeed
      ? this.resetConstant()
      : this.resetSetup(path.lengths, knotCount);
  }

  sample(distance: number, output: MutablePathSampleV1 | null = null): PathSampleV1 | null {
    let value = distance;
    if (this.closed) value = ((value % this.totalLength) + this.totalLength) % this.totalLength;
    else if (value < 0 || value > this.totalLength) {
      const atStart = value < 0;
      const extra = atStart ? -value : value - this.totalLength;
      if (this.mode === "constant") {
        const curve = atStart ? this.curves[0] : this.curves[this.curves.length - 1];
        const endpoint = atStart ? curve?.p0 : curve?.p3;
        const adjacent = atStart ? curve?.p1 : curve?.p2;
        return endpoint === undefined || adjacent === undefined
          ? null
          : extrapolate(endpoint, adjacent, extra, atStart, output);
      }
      const curve = atStart ? this.curves[0] : this.curves[this.curves.length - 1];
      return curve === undefined
        ? null
        : extrapolate(atStart ? curve.p0 : curve.p3, atStart ? curve.p1 : curve.p2, extra, atStart, output);
    }

    if (this.mode === "constant") {
      const curveIndex = firstPathDistanceAtLeastV1(this.lengths, value, 0);
      const curve = this.curves[curveIndex];
      if (curve === undefined) return null;
      const curveStart = curveIndex === 0 ? 0 : this.lengths[curveIndex - 1] ?? 0;
      const curveLength = (this.lengths[curveIndex] ?? 0) - curveStart;
      const curveProgress = curveLength === 0 ? 0 : clamp((value - curveStart) / curveLength, 0, 1);
      const segmentOffset = curveIndex * CONSTANT_PATH_SEGMENTS_V1;
      const detailedLength = this.constantSegments[segmentOffset + CONSTANT_PATH_SEGMENTS_V1 - 1] ?? 0;
      const target = curveProgress * detailedLength;
      let segmentIndex = 0;
      while (segmentIndex < CONSTANT_PATH_SEGMENTS_V1 - 1
        && (this.constantSegments[segmentOffset + segmentIndex] ?? 0) < target) {
        segmentIndex += 1;
      }
      const segmentStart = segmentIndex === 0
        ? 0
        : this.constantSegments[segmentOffset + segmentIndex - 1] ?? 0;
      const segmentLength = (this.constantSegments[segmentOffset + segmentIndex] ?? 0) - segmentStart;
      const segmentProgress = segmentLength === 0 ? 0 : clamp((target - segmentStart) / segmentLength, 0, 1);
      const progress = (segmentIndex + segmentProgress) / CONSTANT_PATH_SEGMENTS_V1;
      const point = cubicPoint(curve, progress, this.cubicScratch);
      return writePathSampleV1(output, point.x, point.y, cubicTangent(curve, progress));
    }

    const curveIndex = firstPathDistanceAtLeastV1(this.lengths, value, 0);
    const curve = this.curves[curveIndex];
    if (curve === undefined) return null;
    const previousLength = curveIndex === 0 ? 0 : this.lengths[curveIndex - 1] ?? 0;
    const curveLength = (this.lengths[curveIndex] ?? 0) - previousLength;
    const progress = curveLength === 0 ? 0 : clamp((value - previousLength) / curveLength, 0, 1);
    const point = cubicPoint(curve, progress, this.cubicScratch);
    return writePathSampleV1(output, point.x, point.y, cubicTangent(curve, progress));
  }

  projectDistance(target: PathPointV1): number | null {
    if (this.mode === "constant") {
      const firstCurve = this.curves[0];
      const lastCurve = this.curves[this.curves.length - 1];
      return projectPolylineDistance(
        target,
        this.polylinePoints,
        this.distances,
        this.totalLength,
        this.closed,
        firstCurve?.p0 ?? null,
        firstCurve?.p1 ?? null,
        lastCurve?.p2 ?? null,
        lastCurve?.p3 ?? null,
      );
    }
    const firstCurve = this.curves[0];
    const lastCurve = this.curves[this.curves.length - 1];
    return projectPolylineDistance(
      target,
      this.polylinePoints,
      this.distances,
      this.totalLength,
      this.closed,
      firstCurve?.p0 ?? null,
      this.hasStartForward ? this.startForward : null,
      this.hasEndPrevious ? this.endPrevious : null,
      lastCurve?.p3 ?? null,
    );
  }

  private resetConstant(): PathSamplerV1 | null {
    this.mode = "constant";
    this.lengths.length = this.curves.length;
    this.constantSegments.length = this.curves.length * CONSTANT_PATH_SEGMENTS_V1;
    let totalLength = 0;
    for (let curveIndex = 0; curveIndex < this.curves.length; curveIndex += 1) {
      const curve = this.curves[curveIndex];
      if (curve === undefined) return null;
      let previousX = curve.p0.x;
      let previousY = curve.p0.y;
      for (let step = 1; step <= CONSTANT_PATH_LENGTH_STEPS_V1; step += 1) {
        const current = cubicPoint(curve, step / CONSTANT_PATH_LENGTH_STEPS_V1, this.cubicScratch);
        totalLength = f32(totalLength + Math.hypot(current.x - previousX, current.y - previousY));
        previousX = current.x;
        previousY = current.y;
      }
      this.lengths[curveIndex] = totalLength;

      let segmentLength = 0;
      previousX = curve.p0.x;
      previousY = curve.p0.y;
      const segmentOffset = curveIndex * CONSTANT_PATH_SEGMENTS_V1;
      for (let step = 1; step <= CONSTANT_PATH_SEGMENTS_V1; step += 1) {
        const current = cubicPoint(curve, step / CONSTANT_PATH_SEGMENTS_V1, this.cubicScratch);
        segmentLength = f32(segmentLength + Math.hypot(current.x - previousX, current.y - previousY));
        this.constantSegments[segmentOffset + step - 1] = segmentLength;
        previousX = current.x;
        previousY = current.y;
      }
    }
    this.totalLength = totalLength;
    if (!(this.totalLength > 0)) return null;

    let pointIndex = 0;
    for (let curveIndex = 0; curveIndex < this.curves.length; curveIndex += 1) {
      const curve = this.curves[curveIndex];
      if (curve === undefined) continue;
      const curveStart = curveIndex === 0 ? 0 : this.lengths[curveIndex - 1] ?? 0;
      const curveLength = (this.lengths[curveIndex] ?? 0) - curveStart;
      const firstPointIndex = pointIndex;
      if (curveIndex === 0) {
        const start = mutablePathPointAtV1(this.polylinePoints, pointIndex);
        start.x = curve.p0.x;
        start.y = curve.p0.y;
        this.distances[pointIndex] = 0;
        pointIndex += 1;
      }
      let localLength = 0;
      let previousX = curve.p0.x;
      let previousY = curve.p0.y;
      for (let step = 1; step <= PATH_PROJECTION_STEPS_V1; step += 1) {
        const current = cubicPoint(
          curve,
          step / PATH_PROJECTION_STEPS_V1,
          mutablePathPointAtV1(this.polylinePoints, pointIndex),
        );
        localLength = f32(localLength + Math.hypot(current.x - previousX, current.y - previousY));
        this.distances[pointIndex] = localLength;
        previousX = current.x;
        previousY = current.y;
        pointIndex += 1;
      }
      for (let index = firstPointIndex; index < pointIndex; index += 1) {
        const local = this.distances[index] ?? 0;
        this.distances[index] = f32(curveStart + curveLength * (localLength === 0 ? 0 : local / localLength));
      }
    }
    this.polylinePoints.length = pointIndex;
    this.distances.length = pointIndex;
    return pointIndex > 0 ? this : null;
  }

  private resetSetup(declaredLengths: readonly number[], knotCount: number): PathSamplerV1 | null {
    this.mode = "setup";
    let declaredValid = declaredLengths.length === knotCount;
    for (let index = 0; declaredValid && index < declaredLengths.length; index += 1) {
      const value = declaredLengths[index];
      declaredValid = value !== undefined
        && Number.isFinite(value)
        && value >= 0
        && (index === 0 || value >= (declaredLengths[index - 1] ?? 0));
    }
    this.lengths.length = this.curves.length;
    if (declaredValid) {
      for (let index = 0; index < this.curves.length; index += 1) this.lengths[index] = declaredLengths[index] ?? 0;
    } else {
      let cumulative = 0;
      for (let curveIndex = 0; curveIndex < this.curves.length; curveIndex += 1) {
        const curve = this.curves[curveIndex];
        if (curve === undefined) return null;
        let previousX = curve.p0.x;
        let previousY = curve.p0.y;
        for (let step = 1; step <= 24; step += 1) {
          const current = cubicPoint(curve, step / 24, this.cubicScratch);
          cumulative = f32(cumulative + Math.hypot(current.x - previousX, current.y - previousY));
          previousX = current.x;
          previousY = current.y;
        }
        this.lengths[curveIndex] = cumulative;
      }
    }
    this.totalLength = this.lengths[this.lengths.length - 1] ?? 0;
    if (!(this.totalLength > 0)) return null;

    let pointIndex = 0;
    for (let curveIndex = 0; curveIndex < this.curves.length; curveIndex += 1) {
      const curve = this.curves[curveIndex];
      if (curve === undefined) continue;
      const fromDistance = curveIndex === 0 ? 0 : this.lengths[curveIndex - 1] ?? 0;
      const toDistance = this.lengths[curveIndex] ?? fromDistance;
      for (let step = curveIndex === 0 ? 0 : 1; step <= 24; step += 1) {
        cubicPoint(curve, step / 24, mutablePathPointAtV1(this.polylinePoints, pointIndex));
        this.distances[pointIndex] = f32(fromDistance + (toDistance - fromDistance) * (step / 24));
        pointIndex += 1;
      }
    }
    this.polylinePoints.length = pointIndex;
    this.distances.length = pointIndex;
    const firstCurve = this.curves[0];
    const lastCurve = this.curves[this.curves.length - 1];
    const startDirection = firstCurve === undefined
      ? null
      : cubicEndpointDirection(firstCurve, true, this.cubicScratch);
    this.hasStartForward = startDirection !== null && firstCurve !== undefined;
    if (this.hasStartForward && firstCurve !== undefined && startDirection !== null) {
      this.startForward.x = firstCurve.p0.x + startDirection.x;
      this.startForward.y = firstCurve.p0.y + startDirection.y;
    }
    const endDirection = lastCurve === undefined
      ? null
      : cubicEndpointDirection(lastCurve, false, this.cubicScratch);
    this.hasEndPrevious = endDirection !== null && lastCurve !== undefined;
    if (this.hasEndPrevious && lastCurve !== undefined && endDirection !== null) {
      this.endPrevious.x = lastCurve.p3.x - endDirection.x;
      this.endPrevious.y = lastCurve.p3.y - endDirection.y;
    }
    return this;
  }
}

function mutablePathPointAtV1(points: MutablePathPointV1[], index: number): MutablePathPointV1 {
  let point = points[index];
  if (point === undefined) {
    point = { x: 0, y: 0 };
    points[index] = point;
  }
  return point;
}

function firstPathDistanceAtLeastV1(values: readonly number[], target: number, minimum: number): number {
  let low = minimum;
  let high = Math.max(values.length - 1, minimum);
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if ((values[middle] ?? 0) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function writePathSampleV1(
  output: MutablePathSampleV1 | null,
  x: number,
  y: number,
  tangentDegrees: number,
): PathSampleV1 {
  if (output === null) return { x, y, tangentDegrees };
  output.x = x;
  output.y = y;
  output.tangentDegrees = tangentDegrees;
  return output;
}

function projectPolylineDistance(
  target: PathPointV1,
  points: readonly PathPointV1[],
  distances: readonly number[],
  totalLength: number,
  closed: boolean,
  start: PathPointV1 | null,
  startForward: PathPointV1 | null,
  endPrevious: PathPointV1 | null,
  end: PathPointV1 | null,
): number | null {
  let bestSpatialSquared = Number.POSITIVE_INFINITY;
  let bestDistance: number | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const distanceFrom = distances[index - 1];
    const distanceTo = distances[index];
    if (from === undefined || to === undefined || distanceFrom === undefined || distanceTo === undefined) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!(lengthSquared > 0) || !Number.isFinite(lengthSquared)) continue;
    const ratio = clamp(((target.x - from.x) * dx + (target.y - from.y) * dy) / lengthSquared, 0, 1);
    const projectedX = from.x + dx * ratio;
    const projectedY = from.y + dy * ratio;
    const spatialSquared = (target.x - projectedX) ** 2 + (target.y - projectedY) ** 2;
    const candidateDistance = distanceFrom + (distanceTo - distanceFrom) * ratio;
    if (Number.isFinite(spatialSquared) && Number.isFinite(candidateDistance) && spatialSquared < bestSpatialSquared) {
      bestSpatialSquared = spatialSquared;
      bestDistance = candidateDistance;
    }
  }
  if (!closed && start !== null && startForward !== null) {
    const candidate = projectEndpointRay(target, start, startForward, 0, true);
    if (candidate !== null && candidate.spatialSquared < bestSpatialSquared) {
      bestSpatialSquared = candidate.spatialSquared;
      bestDistance = candidate.distance;
    }
  }
  if (!closed && endPrevious !== null && end !== null) {
    const candidate = projectEndpointRay(target, end, endPrevious, totalLength, false);
    if (candidate !== null && candidate.spatialSquared < bestSpatialSquared) bestDistance = candidate.distance;
  }
  return bestDistance === null ? null : f32(bestDistance);
}

function projectEndpointRay(
  target: PathPointV1,
  endpoint: PathPointV1,
  adjacent: PathPointV1,
  endpointDistance: number,
  start: boolean,
): { readonly distance: number; readonly spatialSquared: number } | null {
  const directionX = start ? adjacent.x - endpoint.x : endpoint.x - adjacent.x;
  const directionY = start ? adjacent.y - endpoint.y : endpoint.y - adjacent.y;
  const length = Math.hypot(directionX, directionY);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  const unitX = directionX / length;
  const unitY = directionY / length;
  const scalar = (target.x - endpoint.x) * unitX + (target.y - endpoint.y) * unitY;
  if ((start && !(scalar < 0)) || (!start && !(scalar > 0))) return null;
  const projectedX = endpoint.x + unitX * scalar;
  const projectedY = endpoint.y + unitY * scalar;
  const spatialSquared = (target.x - projectedX) ** 2 + (target.y - projectedY) ** 2;
  const distance = start ? scalar : endpointDistance + scalar;
  return Number.isFinite(spatialSquared) && Number.isFinite(distance) ? { distance, spatialSquared } : null;
}

function cubicEndpointDirection(
  curve: PathCurveV1,
  start: boolean,
  output: MutablePathPointV1 | null = null,
): PathPointV1 | null {
  let dx = start ? curve.p1.x - curve.p0.x : curve.p3.x - curve.p2.x;
  let dy = start ? curve.p1.y - curve.p0.y : curve.p3.y - curve.p2.y;
  if (dx === 0 && dy === 0) {
    dx = curve.p3.x - curve.p0.x;
    dy = curve.p3.y - curve.p0.y;
  }
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  const point = output ?? { x: 0, y: 0 };
  point.x = dx / length;
  point.y = dy / length;
  return point;
}

function extrapolate(
  endpoint: PathPointV1,
  adjacent: PathPointV1,
  amount: number,
  start: boolean,
  output: MutablePathSampleV1 | null = null,
): PathSampleV1 | null {
  const dx = start ? endpoint.x - adjacent.x : endpoint.x - adjacent.x;
  const dy = start ? endpoint.y - adjacent.y : endpoint.y - adjacent.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const directionX = dx / length;
  const directionY = dy / length;
  return writePathSampleV1(
    output,
    endpoint.x + directionX * amount,
    endpoint.y + directionY * amount,
    radiansToDegreesV1(Math.atan2(directionY, directionX)),
  );
}

function cubicPoint(
  curve: PathCurveV1,
  progress: number,
  output: MutablePathPointV1 | null = null,
): PathPointV1 {
  const inverse = 1 - progress;
  const a = inverse * inverse * inverse;
  const b = 3 * inverse * inverse * progress;
  const c = 3 * inverse * progress * progress;
  const d = progress * progress * progress;
  const point = output ?? { x: 0, y: 0 };
  point.x = f32(a * curve.p0.x + b * curve.p1.x + c * curve.p2.x + d * curve.p3.x);
  point.y = f32(a * curve.p0.y + b * curve.p1.y + c * curve.p2.y + d * curve.p3.y);
  return point;
}

function cubicTangent(curve: PathCurveV1, progress: number): number {
  const inverse = 1 - progress;
  const dx = 3 * inverse * inverse * (curve.p1.x - curve.p0.x)
    + 6 * inverse * progress * (curve.p2.x - curve.p1.x)
    + 3 * progress * progress * (curve.p3.x - curve.p2.x);
  const dy = 3 * inverse * inverse * (curve.p1.y - curve.p0.y)
    + 6 * inverse * progress * (curve.p2.y - curve.p1.y)
    + 3 * progress * progress * (curve.p3.y - curve.p2.y);
  return dx !== 0 || dy !== 0
    ? radiansToDegreesV1(Math.atan2(dy, dx))
    : radiansToDegreesV1(Math.atan2(curve.p3.y - curve.p0.y, curve.p3.x - curve.p0.x));
}

function pathSpacing(
  constraint: RuntimePathConstraintV1,
  bone: RuntimeBoneV1 | null,
  worldLength: number | null,
  pathLength: number,
  proportionalWorldLength: number,
  spacesCount: number,
): number {
  const setupLength = Math.max(bone?.length ?? 0, 0);
  const length = worldLength ?? setupLength;
  switch (constraint.spacingMode) {
    case "length": return setupLength > 0
      ? Math.max(setupLength + constraint.spacing, 0) * length / setupLength
      : constraint.spacing;
    case "fixed": return setupLength > 0 ? constraint.spacing * length / setupLength : constraint.spacing;
    case "percent": return constraint.spacing * pathLength;
    case "proportional": return proportionalWorldLength > 0
      ? (setupLength > 0 ? length : constraint.spacing) / proportionalWorldLength * constraint.spacing * pathLength
      : constraint.spacing * pathLength / Math.max(spacesCount, 1);
  }
}

function affineFromWorldTransform(
  x: number,
  y: number,
  rotation: number,
  shearY: number,
  scaleXValue: number,
  scaleYValue: number,
  output: AffineV1 | null = null,
): AffineV1 | null {
  const xRadians = degreesToRadiansV1(rotation);
  const yRadians = degreesToRadiansV1(f32(rotation + 90 + shearY));
  const a = f32(Math.cos(xRadians) * scaleXValue);
  const b = f32(Math.sin(xRadians) * scaleXValue);
  const c = f32(Math.cos(yRadians) * scaleYValue);
  const d = f32(Math.sin(yRadians) * scaleYValue);
  const tx = f32(x);
  const ty = f32(y);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)
    || !Number.isFinite(d) || !Number.isFinite(tx) || !Number.isFinite(ty)) return null;
  const matrix = output ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const mutable = matrix as Mutable<AffineV1>;
  mutable.a = a;
  mutable.b = b;
  mutable.c = c;
  mutable.d = d;
  mutable.tx = tx;
  mutable.ty = ty;
  return matrix;
}

function worldShearY(matrix: AffineV1): number {
  return constraintDegrees(radiansToDegreesV1(Math.atan2(-matrix.c, matrix.d)) - xAngle(matrix));
}

function wrapDegrees(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function solveTransform(
  constraint: RuntimeTransformConstraintV1,
  bones: Mutable<RuntimeBoneV1>[],
  boneById: ReadonlyMap<string, Mutable<RuntimeBoneV1>>,
  root: AffineV1,
  initialWorlds: Map<string, AffineV1>,
  scratch: RuntimeTransformSolveScratchV1 | null,
  boneIndexById: ReadonlyMap<string, number>,
  reconstructionScratch: RuntimeLocalReconstructionScratchV1 | null,
): Map<string, AffineV1> {
  let worlds = initialWorlds;
  const target = boneById.get(constraint.targetBoneId);
  const liveTargetWorld = worlds.get(constraint.targetBoneId);
  if (target === undefined || liveTargetWorld === undefined) return worlds;
  // Descendant propagation mutates cached world matrices in performance mode.
  // Preserve the target value for the complete declaration, matching the
  // immutable-map semantics used by strict mode.
  const targetWorld = copyAffineV1(liveTargetWorld, scratch?.target ?? null);
  const sourceValues = constraint.mapping === null
    ? null
    : transformSourceValues(
      constraint,
      target,
      targetWorld,
      scratch?.sourceValues ?? null,
      scratch?.position ?? null,
    );
  for (let boneIndex = 0; boneIndex < constraint.boneIds.length; boneIndex += 1) {
    const boneId = constraint.boneIds[boneIndex];
    if (boneId === undefined) continue;
    if (boneId === constraint.targetBoneId) continue;
    const bone = boneById.get(boneId);
    const currentWorld = worlds.get(boneId);
    if (bone === undefined || currentWorld === undefined) continue;
    const index = boneIndexById.get(boneId) ?? -1;
    if (index < 0) continue;
    if (constraint.mapping !== null && sourceValues !== null) {
      if (constraint.mapping.localTarget) {
        applyMappedLocal(constraint, sourceValues, bone);
        worlds = applyLocalBoneAndDescendants(index, bones, root, worlds, boneIndexById);
      } else {
        const nextWorld = applyMappedWorld(
          constraint,
          sourceValues,
          currentWorld,
          scratch === null ? null : currentWorld,
        );
        if (nextWorld === null) continue;
        reconstructLocalPose(bone, nextWorld, root, worlds, reconstructionScratch);
        worlds.set(bone.id, nextWorld);
        worlds = propagateDescendants(index, bones, worlds, boneIndexById);
      }
    } else if (constraint.local) {
      applyLegacyLocal(constraint, target, bone);
      worlds = applyLocalBoneAndDescendants(index, bones, root, worlds, boneIndexById);
    } else {
      const nextWorld = applyLegacyWorld(
        constraint,
        currentWorld,
        targetWorld,
        scratch?.position ?? null,
        scratch === null ? null : currentWorld,
      );
      if (nextWorld === null) continue;
      reconstructLocalPose(bone, nextWorld, root, worlds, reconstructionScratch);
      worlds.set(bone.id, nextWorld);
      worlds = propagateDescendants(index, bones, worlds, boneIndexById);
    }
  }
  return worlds;
}

function applyLegacyLocal(
  constraint: RuntimeTransformConstraintV1,
  target: RuntimeBoneV1,
  current: Mutable<RuntimeBoneV1>,
): void {
  if (constraint.relative) {
    current.x = f32(current.x + (target.x + constraint.x) * constraint.mixX);
    current.y = f32(current.y + (target.y + constraint.y) * constraint.mixY);
    current.rotation = f32(constraintDegrees(current.rotation + (target.rotation + constraint.rotation) * constraint.mixRotate));
    current.shearY = f32(constraintDegrees(current.shearY + (target.shearY + constraint.shearY) * constraint.mixShearY));
    current.scaleX = f32(current.scaleX * ((target.scaleX - 1 + constraint.scaleX) * constraint.mixScaleX + 1));
    current.scaleY = f32(current.scaleY * ((target.scaleY - 1 + constraint.scaleY) * constraint.mixScaleY + 1));
    return;
  }
  current.x = f32(current.x + (target.x + constraint.x - current.x) * constraint.mixX);
  current.y = f32(current.y + (target.y + constraint.y - current.y) * constraint.mixY);
  current.rotation = f32(constraintDegrees(
    current.rotation + constraintAngleDelta(current.rotation, target.rotation + constraint.rotation) * constraint.mixRotate,
  ));
  current.shearY = f32(constraintDegrees(
    current.shearY + constraintAngleDelta(current.shearY, target.shearY + constraint.shearY) * constraint.mixShearY,
  ));
  if (constraint.mixScaleX !== 0 && current.scaleX !== 0) {
    current.scaleX = f32(current.scaleX + (target.scaleX - current.scaleX + constraint.scaleX) * constraint.mixScaleX);
  }
  if (constraint.mixScaleY !== 0 && current.scaleY !== 0) {
    current.scaleY = f32(current.scaleY + (target.scaleY - current.scaleY + constraint.scaleY) * constraint.mixScaleY);
  }
}

function applyLegacyWorld(
  constraint: RuntimeTransformConstraintV1,
  current: AffineV1,
  target: AffineV1,
  positionOutput: [number, number] | null = null,
  output: AffineV1 | null = null,
): AffineV1 | null {
  const originalA = current.a;
  const originalB = current.b;
  const originalC = current.c;
  const originalD = current.d;
  const originalTx = current.tx;
  const originalTy = current.ty;
  let result = copyAffineV1(current, output);
  const reflection = determinantV1(target) >= 0 ? 1 : -1;
  if (constraint.mixRotate !== 0) {
    const delta = constraint.relative
      ? constraintDegrees(xAngle(target) + constraint.rotation * reflection)
      : constraintDegrees(xAngle(target) - xAngle(result) + constraint.rotation * reflection);
    result = rotateWorldAxes(result, delta * constraint.mixRotate, result);
  }
  if (constraint.mixX !== 0 || constraint.mixY !== 0) {
    const offset = transformPointV1(target, constraint.x, constraint.y, positionOutput);
    const mutable = result as Mutable<AffineV1>;
    mutable.tx = constraint.relative
      ? f32(result.tx + offset[0] * constraint.mixX)
      : f32(result.tx + (offset[0] - result.tx) * constraint.mixX);
    mutable.ty = constraint.relative
      ? f32(result.ty + offset[1] * constraint.mixY)
      : f32(result.ty + (offset[1] - result.ty) * constraint.mixY);
  }
  result = scaleWorldAxis(result, "x", target, constraint.scaleX, constraint.mixScaleX, constraint.relative);
  result = scaleWorldAxis(result, "y", target, constraint.scaleY, constraint.mixScaleY, constraint.relative);
  if (constraint.mixShearY !== 0) {
    const targetAxisDelta = constraintDegrees(yAngle(target) - xAngle(target));
    const currentYAngle = yAngle(result);
    const delta = constraint.relative
      ? targetAxisDelta - 90 + constraint.shearY * reflection
      : targetAxisDelta - constraintDegrees(currentYAngle - xAngle(result)) + constraint.shearY * reflection;
    const nextAngle = degreesToRadiansV1(currentYAngle + constraintDegrees(delta) * constraint.mixShearY);
    const length = yScale(result);
    const mutable = result as Mutable<AffineV1>;
    mutable.c = f32(Math.cos(nextAngle) * length);
    mutable.d = f32(Math.sin(nextAngle) * length);
  }
  if (finiteAffine(result)) return result;
  if (output === current) restoreAffineValuesV1(current, originalA, originalB, originalC, originalD, originalTx, originalTy);
  return null;
}

function transformSourceValues(
  constraint: RuntimeTransformConstraintV1,
  targetLocal: RuntimeBoneV1,
  targetWorld: AffineV1,
  output: number[] | null = null,
  positionOutput: [number, number] | null = null,
): readonly number[] {
  const result = output ?? new Array<number>(6);
  result.length = 6;
  const mapping = constraint.mapping;
  if (mapping?.localSource === true) {
    result[0] = targetLocal.rotation + constraint.rotation;
    result[1] = targetLocal.x + constraint.x;
    result[2] = targetLocal.y + constraint.y;
    result[3] = targetLocal.scaleX + constraint.scaleX;
    result[4] = targetLocal.scaleY + constraint.scaleY;
    result[5] = targetLocal.shearY + constraint.shearY;
    return result;
  }
  const reflection = determinantV1(targetWorld) >= 0 ? 1 : -1;
  const position = transformPointV1(targetWorld, constraint.x, constraint.y, positionOutput);
  const targetXAngle = xAngle(targetWorld);
  result[0] = positiveDegrees(targetXAngle + constraint.rotation * reflection);
  result[1] = position[0];
  result[2] = position[1];
  result[3] = xScale(targetWorld) + constraint.scaleX;
  result[4] = yScale(targetWorld) + constraint.scaleY;
  result[5] = constraintDegrees(yAngle(targetWorld) - targetXAngle - 90 + constraint.shearY);
  return result;
}

function applyMappedLocal(
  constraint: RuntimeTransformConstraintV1,
  sourceValues: readonly number[],
  current: Mutable<RuntimeBoneV1>,
): void {
  const mapping = constraint.mapping;
  if (mapping === null) return;
  for (let sourceIndex = 0; sourceIndex < mapping.properties.length; sourceIndex += 1) {
    const source = mapping.properties[sourceIndex];
    if (source === undefined) continue;
    const sourceValue = (sourceValues[propertyIndex(source.property)] ?? 0) - source.offset;
    for (let targetIndex = 0; targetIndex < source.targets.length; targetIndex += 1) {
      const target = source.targets[targetIndex];
      if (target === undefined) continue;
      const value = mappedValue(sourceValue, target.offset, target.max, target.scale, mapping.clamp);
      const amount = propertyMix(constraint, target.property);
      if (amount === 0) continue;
      const field = target.property === "rotate" ? "rotation" : target.property;
      const old = current[field];
      if ((field === "scaleX" || field === "scaleY") && !constraint.relative && old === 0) continue;
      const next = constraint.relative
        ? field === "scaleX" || field === "scaleY"
          ? old * (1 + (value - 1) * amount)
          : old + value * amount
        : old + (value - old) * amount;
      current[field] = f32(next);
    }
  }
}

function applyMappedWorld(
  constraint: RuntimeTransformConstraintV1,
  sourceValues: readonly number[],
  current: AffineV1,
  output: AffineV1 | null = null,
): AffineV1 | null {
  const mapping = constraint.mapping;
  if (mapping === null) return current;
  const originalA = current.a;
  const originalB = current.b;
  const originalC = current.c;
  const originalD = current.d;
  const originalTx = current.tx;
  const originalTy = current.ty;
  let result = copyAffineV1(current, output);
  for (let sourceIndex = 0; sourceIndex < mapping.properties.length; sourceIndex += 1) {
    const source = mapping.properties[sourceIndex];
    if (source === undefined) continue;
    const sourceValue = (sourceValues[propertyIndex(source.property)] ?? 0) - source.offset;
    for (let targetIndex = 0; targetIndex < source.targets.length; targetIndex += 1) {
      const target = source.targets[targetIndex];
      if (target === undefined) continue;
      const value = mappedValue(sourceValue, target.offset, target.max, target.scale, mapping.clamp);
      const amount = propertyMix(constraint, target.property);
      if (amount === 0) continue;
      switch (target.property) {
        case "rotate": {
          const delta = constraint.relative ? value : value - xAngle(result);
          result = rotateWorldAxes(result, constraintDegrees(delta) * amount, result);
          break;
        }
        case "x":
          (result as Mutable<AffineV1>).tx = f32(
            result.tx + (constraint.relative ? value : value - result.tx) * amount,
          );
          break;
        case "y":
          (result as Mutable<AffineV1>).ty = f32(
            result.ty + (constraint.relative ? value : value - result.ty) * amount,
          );
          break;
        case "scaleX": {
          const length = xScale(result);
          if (length > MATRIX_EPSILON) {
            const factor = constraint.relative
              ? 1 + (value - 1) * amount
              : 1 + (value - length) * amount / length;
            const mutable = result as Mutable<AffineV1>;
            mutable.a = f32(result.a * factor);
            mutable.b = f32(result.b * factor);
          }
          break;
        }
        case "scaleY": {
          const length = yScale(result);
          if (length > MATRIX_EPSILON) {
            const factor = constraint.relative
              ? 1 + (value - 1) * amount
              : 1 + (value - length) * amount / length;
            const mutable = result as Mutable<AffineV1>;
            mutable.c = f32(result.c * factor);
            mutable.d = f32(result.d * factor);
          }
          break;
        }
        case "shearY": {
          const x = xAngle(result);
          const y = yAngle(result);
          const delta = constraint.relative ? value : value + 90 - constraintDegrees(y - x);
          const next = degreesToRadiansV1(y + constraintDegrees(delta) * amount);
          const length = yScale(result);
          const mutable = result as Mutable<AffineV1>;
          mutable.c = f32(Math.cos(next) * length);
          mutable.d = f32(Math.sin(next) * length);
          break;
        }
      }
    }
  }
  if (finiteAffine(result)) return result;
  if (output === current) restoreAffineValuesV1(current, originalA, originalB, originalC, originalD, originalTx, originalTy);
  return null;
}

function scaleWorldAxis(
  current: AffineV1,
  axis: "x" | "y",
  target: AffineV1,
  offset: number,
  amount: number,
  relative: boolean,
): AffineV1 {
  if (amount === 0) return current;
  const currentLength = axis === "x" ? xScale(current) : yScale(current);
  if (!(currentLength > MATRIX_EPSILON)) return current;
  const targetLength = axis === "x" ? xScale(target) : yScale(target);
  const factor = relative
    ? (targetLength - 1 + offset) * amount + 1
    : (currentLength + (targetLength - currentLength + offset) * amount) / currentLength;
  const mutable = current as Mutable<AffineV1>;
  if (axis === "x") {
    mutable.a = f32(current.a * factor);
    mutable.b = f32(current.b * factor);
  } else {
    mutable.c = f32(current.c * factor);
    mutable.d = f32(current.d * factor);
  }
  return current;
}

function applyLocalBoneAndDescendants(
  index: number,
  bones: readonly RuntimeBoneV1[],
  root: AffineV1,
  worlds: ReadonlyMap<string, AffineV1>,
  boneIndexById: ReadonlyMap<string, number>,
): Map<string, AffineV1> {
  const result = worlds as Map<string, AffineV1>;
  const bone = bones[index];
  if (bone === undefined) return result;
  const reusable = result.get(bone.id) ?? null;
  const world = bone.parentId === null
    ? multiplyAffineV1(root, localBoneAffineV1(bone, reusable), reusable)
    : childWorldAffineV1(result.get(bone.parentId) ?? root, bone, bone.transformMode, reusable);
  result.set(bone.id, world);
  return propagateDescendants(index, bones, result, boneIndexById);
}

function propagateDescendants(
  constrainedIndex: number,
  bones: readonly RuntimeBoneV1[],
  worlds: ReadonlyMap<string, AffineV1>,
  boneIndexById: ReadonlyMap<string, number>,
): Map<string, AffineV1> {
  const result = worlds as Map<string, AffineV1>;
  const constrained = bones[constrainedIndex];
  if (constrained === undefined) return result;
  const workspace = descendantWorkspaceV1(result, bones.length);
  workspace.epoch += 1;
  if (workspace.epoch > 0xffff_ffff) {
    workspace.marks.fill(0);
    workspace.epoch = 1;
  }
  const epoch = workspace.epoch;
  workspace.marks[constrainedIndex] = epoch;
  for (let index = constrainedIndex + 1; index < bones.length; index += 1) {
    const bone = bones[index];
    if (bone === undefined || bone.parentId === null) continue;
    const parentIndex = boneIndexById.get(bone.parentId);
    if (parentIndex === undefined || workspace.marks[parentIndex] !== epoch) continue;
    const parent = result.get(bone.parentId);
    if (parent === undefined) continue;
    const reusable = result.get(bone.id) ?? null;
    result.set(bone.id, childWorldAffineV1(parent, bone, bone.transformMode, reusable));
    workspace.marks[index] = epoch;
  }
  return result;
}

interface RuntimeDescendantWorkspaceV1 {
  marks: Uint32Array;
  epoch: number;
}

const DESCENDANT_WORKSPACE_BY_WORLDS = new WeakMap<object, RuntimeDescendantWorkspaceV1>();

function descendantWorkspaceV1(worlds: Map<string, AffineV1>, boneCount: number): RuntimeDescendantWorkspaceV1 {
  let result = DESCENDANT_WORKSPACE_BY_WORLDS.get(worlds);
  if (result === undefined) {
    result = { marks: new Uint32Array(boneCount), epoch: 0 };
    DESCENDANT_WORKSPACE_BY_WORLDS.set(worlds, result);
  } else if (result.marks.length !== boneCount) {
    result.marks = new Uint32Array(boneCount);
    result.epoch = 0;
  }
  return result;
}

function beginConstraintDiagnosticsV1(scratch: ConstraintSolveScratchStorageV1): number {
  scratch.diagnosticEpoch += 1;
  if (!Number.isSafeInteger(scratch.diagnosticEpoch)) {
    scratch.diagnosticEpoch = 1;
    scratch.diagnosticEpochById.clear();
  }
  return scratch.diagnosticEpoch;
}

function retainConstraintDiagnosticsV1(
  scratch: ConstraintSolveScratchStorageV1,
  source: ReadonlyMap<string, RuntimeConstraintDiagnosticV1>,
  epoch: number,
): void {
  for (const [constraintId, diagnostic] of source) {
    scratch.diagnostics.set(constraintId, diagnostic);
    scratch.diagnosticEpochById.set(constraintId, epoch);
  }
}

function finishConstraintDiagnosticsV1(
  scratch: ConstraintSolveScratchStorageV1,
  epoch: number,
): void {
  for (const constraintId of scratch.diagnostics.keys()) {
    if (scratch.diagnosticEpochById.get(constraintId) !== epoch) {
      scratch.diagnostics.delete(constraintId);
    }
  }
}

function reusableTransformSolveV1(
  scratch: ConstraintSolveScratchStorageV1,
  constraintId: string,
): RuntimeTransformSolveScratchV1 {
  let result = scratch.transformSolve.get(constraintId);
  if (result === undefined) {
    result = {
      target: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      sourceValues: [0, 0, 0, 0, 0, 0],
      position: [0, 0],
    };
    scratch.transformSolve.set(constraintId, result);
  }
  return result;
}

function reusableIkSolveV1(
  scratch: ConstraintSolveScratchStorageV1,
  constraintId: string,
): RuntimeIkSolveScratchV1 {
  let result = scratch.ikSolve.get(constraintId);
  if (result === undefined) {
    result = {
      chain: [],
      beforeRotations: [],
      inverse: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    };
    scratch.ikSolve.set(constraintId, result);
  }
  return result;
}

function reusablePhysicsApplyV1(
  scratch: ConstraintSolveScratchStorageV1,
  constraintId: string,
): RuntimePhysicsApplyScratchV1 {
  let result = scratch.physicsApply.get(constraintId);
  if (result === undefined) {
    result = createRuntimePhysicsApplyScratchV1();
    scratch.physicsApply.set(constraintId, result);
  }
  return result;
}

function reusablePathSolveV1(
  scratch: ConstraintSolveScratchStorageV1,
  constraintId: string,
): RuntimePathSolveScratchV1 {
  let result = scratch.pathSolve.get(constraintId);
  if (result === undefined) {
    result = {
      flatPoints: [],
      driven: [],
      boneIndices: [],
      worldLengths: [],
      desiredWorlds: [],
      desiredValid: [],
      affectedBones: [],
      sampler: new RuntimePathSamplerWorkspaceV1(),
      currentSample: { x: 0, y: 0, tangentDegrees: 0 },
      nextSample: { x: 0, y: 0, tangentDegrees: 0 },
      carriedSample: { x: 0, y: 0, tangentDegrees: 0 },
    };
    scratch.pathSolve.set(constraintId, result);
  }
  return result;
}

function copyAffineV1(source: AffineV1, output: AffineV1 | null): AffineV1 {
  if (output === null) return { ...source };
  const mutable = output as Mutable<AffineV1>;
  mutable.a = source.a;
  mutable.b = source.b;
  mutable.c = source.c;
  mutable.d = source.d;
  mutable.tx = source.tx;
  mutable.ty = source.ty;
  return output;
}

function createLocalReconstructionScratchV1(): RuntimeLocalReconstructionScratchV1 {
  return {
    inverse: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    local: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    position: [0, 0],
    candidate: null,
    matrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    nextMatrix: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    residual: new Array<number>(4),
    jacobian: new Array<number>(16),
    augmented: new Array<number>(20),
    correction: new Array<number>(4),
  };
}

function reconstructLocalPose(
  previous: Mutable<RuntimeBoneV1>,
  targetWorld: AffineV1,
  root: AffineV1,
  worlds: ReadonlyMap<string, AffineV1>,
  scratch: RuntimeLocalReconstructionScratchV1 | null = null,
): boolean {
  const parent = previous.parentId === null ? root : worlds.get(previous.parentId);
  if (parent === undefined) return false;
  const inverse = inverseAffine(parent, scratch?.inverse ?? null);
  if (inverse === null) return false;
  const position = transformPointV1(inverse, targetWorld.tx, targetWorld.ty, scratch?.position ?? null);
  if (previous.parentId === null || previous.transformMode === "normal") {
    const local = multiplyAffineV1(inverse, targetWorld, scratch?.local ?? null);
    const scaleXSign = previous.scaleX < 0 ? -1 : 1;
    const scaleYSign = previous.scaleY < 0 ? -1 : 1;
    const scaleX = f32MatrixAxisLength(local.a, local.b) * scaleXSign;
    if (Math.abs(scaleX) <= MATRIX_EPSILON) return false;
    // A Cane local matrix may contain shear, so determinant / scaleX is not
    // the Y-axis magnitude. Mirror the Rust authority's axis decomposition:
    // preserve each setup sign and measure the two affine axes independently.
    const scaleY = f32MatrixAxisLength(local.c, local.d) * scaleYSign;
    if (Math.abs(scaleY) <= MATRIX_EPSILON) return false;
    const xAngleDegrees = radiansToDegreesV1(Math.atan2(local.b * scaleXSign, local.a * scaleXSign));
    const rotation = xAngleDegrees - previous.shearX;
    const yAxis = radiansToDegreesV1(Math.atan2(-local.c * scaleYSign, local.d * scaleYSign));
    previous.x = f32(position[0]);
    previous.y = f32(position[1]);
    previous.rotation = f32(constraintDegrees(rotation));
    previous.scaleX = f32(scaleX);
    previous.scaleY = f32(scaleY);
    previous.shearY = f32(constraintDegrees(yAxis - rotation));
    return true;
  }
  return iterativeLocalReconstruction(previous, targetWorld, parent, position, scratch);
}

function iterativeLocalReconstruction(
  previous: Mutable<RuntimeBoneV1>,
  targetWorld: AffineV1,
  parent: AffineV1,
  position: readonly [number, number],
  scratch: RuntimeLocalReconstructionScratchV1 | null,
): boolean {
  let candidate = scratch?.candidate ?? null;
  if (candidate === null) {
    candidate = { ...previous };
    if (scratch !== null) scratch.candidate = candidate;
  } else {
    candidate.id = previous.id;
    candidate.name = previous.name;
    candidate.parentId = previous.parentId;
    candidate.x = previous.x;
    candidate.y = previous.y;
    candidate.rotation = previous.rotation;
    candidate.shearX = previous.shearX;
    candidate.shearY = previous.shearY;
    candidate.scaleX = previous.scaleX;
    candidate.scaleY = previous.scaleY;
    candidate.length = previous.length;
    candidate.transformMode = previous.transformMode;
  }
  candidate.x = position[0];
  candidate.y = position[1];
  const residual = scratch?.residual ?? new Array<number>(4);
  const jacobian = scratch?.jacobian ?? new Array<number>(16);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const matrix = childWorldAffineV1(parent, candidate, candidate.transformMode, scratch?.matrix ?? null);
    residual[0] = targetWorld.a - matrix.a;
    residual[1] = targetWorld.b - matrix.b;
    residual[2] = targetWorld.c - matrix.c;
    residual[3] = targetWorld.d - matrix.d;
    const maximumResidual = Math.max(
      Math.abs(residual[0] ?? 0),
      Math.abs(residual[1] ?? 0),
      Math.abs(residual[2] ?? 0),
      Math.abs(residual[3] ?? 0),
    );
    if (maximumResidual <= 0.0001) {
      previous.x = f32(candidate.x);
      previous.y = f32(candidate.y);
      previous.rotation = f32(candidate.rotation);
      previous.scaleX = f32(candidate.scaleX);
      previous.scaleY = f32(candidate.scaleY);
      previous.shearY = f32(candidate.shearY);
      return true;
    }
    for (let column = 0; column < ITERATIVE_LOCAL_FIELDS.length; column += 1) {
      const field = ITERATIVE_LOCAL_FIELDS[column];
      if (field === undefined) continue;
      const step = field === "rotation" || field === "shearY" ? 0.01 : 0.001;
      const previousValue = candidate[field];
      candidate[field] = previousValue + step;
      const next = childWorldAffineV1(parent, candidate, candidate.transformMode, scratch?.nextMatrix ?? null);
      candidate[field] = previousValue;
      jacobian[column] = (next.a - matrix.a) / step;
      jacobian[4 + column] = (next.b - matrix.b) / step;
      jacobian[8 + column] = (next.c - matrix.c) / step;
      jacobian[12 + column] = (next.d - matrix.d) / step;
    }
    const correction = solveLinear4(
      jacobian,
      residual,
      scratch?.augmented ?? null,
      scratch?.correction ?? null,
    );
    if (correction === null) return false;
    for (let index = 0; index < ITERATIVE_LOCAL_FIELDS.length; index += 1) {
      const field = ITERATIVE_LOCAL_FIELDS[index];
      const value = correction[index];
      if (field === undefined || value === undefined || !Number.isFinite(value)) return false;
      const bounded = field === "rotation" || field === "shearY" ? clamp(value, -45, 45) : value;
      candidate[field] += bounded;
    }
  }
  return false;
}

function solveLinear4(
  matrix: readonly number[],
  vector: readonly number[],
  augmentedOutput: number[] | null = null,
  correctionOutput: number[] | null = null,
): number[] | null {
  const augmented = augmentedOutput ?? new Array<number>(20);
  augmented.length = 20;
  for (let row = 0; row < 4; row += 1) {
    const sourceOffset = row * 4;
    const targetOffset = row * 5;
    for (let column = 0; column < 4; column += 1) {
      augmented[targetOffset + column] = matrix[sourceOffset + column] ?? 0;
    }
    augmented[targetOffset + 4] = vector[row] ?? 0;
  }
  for (let column = 0; column < 4; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 4; row += 1) {
      if (Math.abs(augmented[row * 5 + column] ?? 0) > Math.abs(augmented[pivot * 5 + column] ?? 0)) pivot = row;
    }
    const pivotOffset = pivot * 5;
    const columnOffset = column * 5;
    if (Math.abs(augmented[pivotOffset + column] ?? 0) <= 0.00001) return null;
    if (pivot !== column) {
      for (let item = column; item <= 4; item += 1) {
        const leftIndex = columnOffset + item;
        const rightIndex = pivotOffset + item;
        const value = augmented[leftIndex] ?? 0;
        augmented[leftIndex] = augmented[rightIndex] ?? 0;
        augmented[rightIndex] = value;
      }
    }
    const divisor = augmented[columnOffset + column] ?? 1;
    for (let item = column; item <= 4; item += 1) {
      const index = columnOffset + item;
      augmented[index] = (augmented[index] ?? 0) / divisor;
    }
    for (let row = 0; row < 4; row += 1) {
      if (row === column) continue;
      const rowOffset = row * 5;
      const factor = augmented[rowOffset + column] ?? 0;
      for (let item = column; item <= 4; item += 1) {
        const index = rowOffset + item;
        augmented[index] = (augmented[index] ?? 0) - factor * (augmented[columnOffset + item] ?? 0);
      }
    }
  }
  const result = correctionOutput ?? new Array<number>(4);
  result.length = 4;
  for (let row = 0; row < 4; row += 1) result[row] = augmented[row * 5 + 4] ?? 0;
  return result;
}

function rotateWorldAxes(
  matrix: AffineV1,
  degrees: number,
  output: AffineV1 | null = null,
): AffineV1 {
  const radians = degreesToRadiansV1(degrees);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const a = f32(cosine * matrix.a - sine * matrix.b);
  const b = f32(sine * matrix.a + cosine * matrix.b);
  const c = f32(cosine * matrix.c - sine * matrix.d);
  const d = f32(sine * matrix.c + cosine * matrix.d);
  const result = copyAffineV1(matrix, output);
  const mutable = result as Mutable<AffineV1>;
  mutable.a = a;
  mutable.b = b;
  mutable.c = c;
  mutable.d = d;
  return result;
}

function restoreAffineValuesV1(
  target: AffineV1,
  a: number,
  b: number,
  c: number,
  d: number,
  tx: number,
  ty: number,
): void {
  const mutable = target as Mutable<AffineV1>;
  mutable.a = a;
  mutable.b = b;
  mutable.c = c;
  mutable.d = d;
  mutable.tx = tx;
  mutable.ty = ty;
}

function mappedValue(source: number, offset: number, maximum: number, scale: number, shouldClamp: boolean): number {
  const value = offset + source * scale;
  return shouldClamp ? clamp(value, Math.min(offset, maximum), Math.max(offset, maximum)) : value;
}

function propertyIndex(property: RuntimeTransformPropertyV1): number {
  switch (property) {
    case "rotate": return 0;
    case "x": return 1;
    case "y": return 2;
    case "scaleX": return 3;
    case "scaleY": return 4;
    case "shearY": return 5;
  }
}

function propertyMix(constraint: RuntimeTransformConstraintV1, property: RuntimeTransformPropertyV1): number {
  switch (property) {
    case "rotate": return constraint.mixRotate;
    case "x": return constraint.mixX;
    case "y": return constraint.mixY;
    case "scaleX": return constraint.mixScaleX;
    case "scaleY": return constraint.mixScaleY;
    case "shearY": return constraint.mixShearY;
  }
}

function yAngle(matrix: AffineV1): number {
  return radiansToDegreesV1(Math.atan2(matrix.d, matrix.c));
}

function yScale(matrix: AffineV1): number {
  return f32MatrixAxisLength(matrix.c, matrix.d);
}

function positiveDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function finiteAffine(matrix: AffineV1): boolean {
  return Number.isFinite(matrix.a) && Number.isFinite(matrix.b) && Number.isFinite(matrix.c)
    && Number.isFinite(matrix.d) && Number.isFinite(matrix.tx) && Number.isFinite(matrix.ty);
}

export function buildRuntimeBoneWorldsV1(
  bones: readonly RuntimeBoneV1[],
  root: AffineV1,
): ReadonlyMap<string, AffineV1> {
  return buildWorlds(bones, root);
}

/**
 * Computes the canonical Match offsets that leave the first driven bone at its
 * current sampled pose. Non-canonical property mappings are intentionally not
 * invertible through this convenience projection.
 */
export function queryRuntimeMatchedTransformConstraintOffsetsV1(
  constraint: RuntimeTransformConstraintV1,
  bones: readonly RuntimeBoneV1[],
  worlds: ReadonlyMap<string, AffineV1>,
): RuntimeTransformConstraintOffsetsV1 | null {
  const constrainedId = constraint.boneIds[0];
  if (constrainedId === undefined) return null;
  const sourceLocal = bones.find((bone) => bone.id === constraint.targetBoneId);
  const constrainedLocal = bones.find((bone) => bone.id === constrainedId);
  const sourceWorld = worlds.get(constraint.targetBoneId);
  const constrainedWorld = worlds.get(constrainedId);
  if (sourceLocal === undefined || constrainedLocal === undefined
    || sourceWorld === undefined || constrainedWorld === undefined) return null;

  let localSource = constraint.local;
  let localTarget = constraint.local;
  if (constraint.mapping !== null) {
    if (!isCanonicalTransformMappingV1(constraint.mapping)) return null;
    localSource = constraint.mapping.localSource;
    localTarget = constraint.mapping.localTarget;
  }

  const desired = constraint.relative
    ? [0, 0, 0, 1, 1, 0] as const
    : localTarget
      ? localTransformValuesV1(constrainedLocal)
      : worldTransformValuesV1(constrainedWorld);
  const source = localSource
    ? localTransformValuesV1(sourceLocal)
    : worldTransformValuesV1(sourceWorld);

  let x: number;
  let y: number;
  let rotationDegrees: number;
  if (localSource) {
    x = desired[1] - source[1];
    y = desired[2] - source[2];
    rotationDegrees = constraintDegrees(desired[0] - source[0]);
  } else {
    const inverse = inverseAffine(sourceWorld);
    if (inverse === null) return null;
    const localOffset = transformPointV1(inverse, desired[1], desired[2]);
    const reflection = determinantV1(sourceWorld) >= 0 ? 1 : -1;
    x = localOffset[0];
    y = localOffset[1];
    rotationDegrees = constraintDegrees(desired[0] - source[0]) * reflection;
  }

  const values = [
    rotationDegrees,
    x,
    y,
    desired[3] - source[3],
    desired[4] - source[4],
    constraintDegrees(desired[5] - source[5]),
  ];
  if (!values.every(Number.isFinite)) return null;
  return {
    rotationDegrees: f32(values[0] ?? 0),
    x: f32(values[1] ?? 0),
    y: f32(values[2] ?? 0),
    scaleX: f32(values[3] ?? 0),
    scaleY: f32(values[4] ?? 0),
    shearYDegrees: f32(values[5] ?? 0),
  };
}

function isCanonicalTransformMappingV1(mapping: RuntimeTransformConstraintV1["mapping"]): boolean {
  if (mapping === null || mapping.clamp || mapping.properties.length !== 6) return false;
  const properties: readonly RuntimeTransformPropertyV1[] = ["rotate", "x", "y", "scaleX", "scaleY", "shearY"];
  return properties.every((property) => mapping.properties.some((source) => {
    const target = source.targets[0];
    return source.property === property
      && source.offset === 0
      && source.targets.length === 1
      && target?.property === property
      && target.offset === 0
      && target.scale === 1;
  }));
}

function localTransformValuesV1(bone: RuntimeBoneV1): readonly [number, number, number, number, number, number] {
  return [bone.rotation, bone.x, bone.y, bone.scaleX, bone.scaleY, bone.shearY];
}

function worldTransformValuesV1(world: AffineV1): readonly [number, number, number, number, number, number] {
  return [positiveDegrees(xAngle(world)), world.tx, world.ty, xScale(world), yScale(world), worldShearY(world)];
}

function solveIk(
  constraint: RuntimeIkConstraintV1,
  bones: Mutable<RuntimeBoneV1>[],
  boneById: ReadonlyMap<string, Mutable<RuntimeBoneV1>>,
  root: AffineV1,
  rootRotationDegrees: number,
  initialWorlds: Map<string, AffineV1>,
  scratch: RuntimeIkSolveScratchV1 | null,
  boneIndexById: ReadonlyMap<string, number>,
): Map<string, AffineV1> {
  const mix = clamp(constraint.mix, 0, 1);
  if (mix === 0) return initialWorlds;
  let targetX = constraint.target.x;
  let targetY = constraint.target.y;
  if (constraint.targetBoneId !== null) {
    const targetWorld = initialWorlds.get(constraint.targetBoneId);
    if (targetWorld === undefined) return initialWorlds;
    targetX = targetWorld.tx;
    targetY = targetWorld.ty;
  }
  const chain = scratch?.chain ?? new Array<Mutable<RuntimeBoneV1>>(constraint.chainBoneIds.length);
  chain.length = constraint.chainBoneIds.length;
  for (let index = 0; index < constraint.chainBoneIds.length; index += 1) {
    const boneId = constraint.chainBoneIds[index];
    const bone = boneId === undefined ? undefined : boneById.get(boneId);
    if (bone === undefined) return initialWorlds;
    chain[index] = bone;
  }
  if (chain.length === 0) return initialWorlds;
  let worlds = initialWorlds;
  if (chain.length === 1 && solveOneBone(
    constraint,
    chain[0] as Mutable<RuntimeBoneV1>,
    targetX,
    targetY,
    root,
    worlds,
    scratch?.inverse ?? null,
  )) {
    const bone = chain[0];
    const index = bone === undefined ? -1 : boneIndexById.get(bone.id) ?? -1;
    return index < 0
      ? worlds
      : applyLocalBoneAndDescendants(index, bones, root, worlds, boneIndexById);
  }
  if (chain.length === 2 && solveTwoBone(
    constraint,
    chain[0] as Mutable<RuntimeBoneV1>,
    chain[1] as Mutable<RuntimeBoneV1>,
    targetX,
    targetY,
    bones,
    root,
    rootRotationDegrees,
    worlds,
    scratch?.inverse ?? null,
    boneIndexById,
  )) return worlds;

  const before = scratch?.beforeRotations ?? new Array<number>(chain.length);
  if (mix < 1) {
    before.length = chain.length;
    for (let index = 0; index < chain.length; index += 1) before[index] = chain[index]?.rotation ?? 0;
  }
  worlds = solveCcd(
    chain,
    targetX,
    targetY,
    Math.max(constraint.threshold, 0),
    constraint.iterations,
    bones,
    root,
    worlds,
    boneIndexById,
  );
  if (mix < 1) {
    for (let index = 0; index < chain.length; index += 1) {
      const bone = chain[index];
      const rotation = before[index];
      if (bone !== undefined && rotation !== undefined) {
        bone.rotation = f32(rotation + constraintAngleDelta(rotation, bone.rotation) * mix);
      }
    }
    // Validation guarantees direct parent-to-child chain order, so one update
    // from the chain root incorporates every mixed local rotation below it.
    const chainRoot = chain[0];
    const chainRootIndex = chainRoot === undefined ? -1 : boneIndexById.get(chainRoot.id) ?? -1;
    if (chainRootIndex >= 0) {
      worlds = applyLocalBoneAndDescendants(chainRootIndex, bones, root, worlds, boneIndexById);
    }
  }
  return worlds;
}

function solveOneBone(
  constraint: RuntimeIkConstraintV1,
  bone: Mutable<RuntimeBoneV1>,
  targetX: number,
  targetY: number,
  root: AffineV1,
  worlds: ReadonlyMap<string, AffineV1>,
  inverseOutput: AffineV1 | null,
): boolean {
  const parent = bone.parentId === null ? root : worlds.get(bone.parentId);
  if (parent === undefined) return false;
  const inverse = inverseAffine(parent, inverseOutput);
  if (inverse === null) return false;
  const localTargetX = f32Add(f32Add(f32Mul(inverse.a, targetX), f32Mul(inverse.c, targetY)), inverse.tx);
  const localTargetY = f32Add(f32Add(f32Mul(inverse.b, targetX), f32Mul(inverse.d, targetY)), inverse.ty);
  const dx = localTargetX - bone.x;
  const dy = localTargetY - bone.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (!(distance > IK_MIN_VECTOR_LENGTH)) return false;
  let desired = radiansToDegreesV1(Math.atan2(dy, dx)) - bone.shearX;
  if (bone.scaleX < 0) desired = constraintDegrees(desired + 180);
  const mix = clamp(constraint.mix, 0, 1);
  bone.rotation = f32(constraintDegrees(bone.rotation + constraintAngleDelta(bone.rotation, desired) * mix));
  const scaledLength = Math.abs(bone.length * bone.scaleX);
  if (scaledLength > IK_MIN_VECTOR_LENGTH
    && (constraint.compress && distance < scaledLength || constraint.stretch && distance > scaledLength)) {
    const multiplier = (distance / scaledLength - 1) * mix + 1;
    bone.scaleX = f32(bone.scaleX * multiplier);
    bone.scaleY = f32(ikScaleY(bone.scaleY, multiplier, constraint.uniform));
  }
  return true;
}

function solveTwoBone(
  constraint: RuntimeIkConstraintV1,
  parent: Mutable<RuntimeBoneV1>,
  child: Mutable<RuntimeBoneV1>,
  targetX: number,
  targetY: number,
  bones: Mutable<RuntimeBoneV1>[],
  root: AffineV1,
  rootRotationDegrees: number,
  worldsBefore: ReadonlyMap<string, AffineV1>,
  inverseOutput: AffineV1 | null,
  boneIndexById: ReadonlyMap<string, number>,
): boolean {
  if (child.parentId !== parent.id) return false;
  const uniformParent = Math.abs(Math.abs(parent.scaleX) - Math.abs(parent.scaleY)) <= IK_UNIFORM_SCALE_EPSILON;
  parent.shearX = 0;
  parent.shearY = 0;
  if (!uniformParent || constraint.stretch) child.y = 0;
  let worlds = worldsBefore;
  const parentIndex = boneIndexById.get(parent.id) ?? -1;
  const childIndex = boneIndexById.get(child.id) ?? -1;
  if (parentIndex < 0 || childIndex < 0) return false;
  worlds = applyLocalBoneAndDescendants(parentIndex, bones, root, worlds, boneIndexById);
  const parentWorld = worlds.get(parent.id);
  const childWorld = worlds.get(child.id);
  if (parentWorld === undefined || childWorld === undefined) return false;
  const p0x = parentWorld.tx;
  const p0y = parentWorld.ty;
  const p1x = childWorld.tx;
  const p1y = childWorld.ty;
  const p2x = f32Add(f32Mul(childWorld.a, child.length), childWorld.tx);
  const p2y = f32Add(f32Mul(childWorld.b, child.length), childWorld.ty);
  const v1x = p1x - p0x;
  const v1y = p1y - p0y;
  const v2x = p2x - p1x;
  const v2y = p2y - p1y;
  let length1 = Math.sqrt(v1x * v1x + v1y * v1y);
  let length2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (!(length1 > IK_MIN_VECTOR_LENGTH) || !(length2 > IK_MIN_VECTOR_LENGTH)) {
    const solved = solveOneBone(constraint, parent, targetX, targetY, root, worlds, inverseOutput);
    if (solved) applyLocalBoneAndDescendants(parentIndex, bones, root, worlds, boneIndexById);
    return solved;
  }
  const parentAxisOffset = constraintDegrees(radiansToDegreesV1(Math.atan2(v1y, v1x)) - xAngle(parentWorld));
  const childTipOffset = constraintDegrees(radiansToDegreesV1(Math.atan2(v2y, v2x)) - xAngle(childWorld));
  let qx = targetX - p0x;
  let qy = targetY - p0y;
  let distance = Math.sqrt(qx * qx + qy * qy);
  if (!(distance > IK_MIN_VECTOR_LENGTH)) return false;

  if (constraint.softness > IK_SOFTNESS_EPSILON) {
    const softScale = Math.max((xScale(parentWorld) + xScale(childWorld)) * 0.5, IK_SOFTNESS_EPSILON);
    const softness = constraint.softness * softScale;
    const softDelta = distance - length1 - length2 + softness;
    if (softDelta > 0) {
      let progress = Math.min(softDelta / (softness * 2), 1) - 1;
      progress = (softDelta - softness * (1 - progress * progress)) / distance;
      qx -= progress * qx;
      qy -= progress * qy;
      distance = Math.sqrt(qx * qx + qy * qy);
    }
  }

  const childInheritsScale = child.transformMode === "normal" || child.transformMode === "noRotationOrReflection";
  const requestedScale = targetScale(constraint, distance, length1, length2, childInheritsScale, uniformParent && constraint.softness <= 0);
  const mix = clamp(constraint.mix, 0, 1);
  if (requestedScale !== null) {
    const multiplier = (requestedScale - 1) * mix + 1;
    parent.scaleX = f32(parent.scaleX * multiplier);
    parent.scaleY = f32(ikScaleY(parent.scaleY, multiplier, constraint.uniform));
    length1 *= multiplier;
    if (childInheritsScale) length2 *= multiplier;
  }

  distance = Math.max(distance, IK_MIN_VECTOR_LENGTH);
  const cosChild = clamp(
    (distance * distance - length1 * length1 - length2 * length2) / (2 * length1 * length2),
    -1,
    1,
  );
  const childAngle = Math.acos(cosChild) * (constraint.bendPositive ? 1 : -1);
  const parentAngle = Math.atan2(qy, qx) - Math.atan2(length2 * Math.sin(childAngle), length1 + length2 * Math.cos(childAngle));
  const desiredParentWorld = constraintDegrees(radiansToDegreesV1(parentAngle) - parentAxisOffset);
  const inheritedParent = inheritedRotation(parent, worlds, rootRotationDegrees);
  const desiredParentLocal = constraintDegrees(desiredParentWorld - inheritedParent);
  parent.rotation = f32(constraintDegrees(parent.rotation + constraintAngleDelta(parent.rotation, desiredParentLocal) * mix));
  worlds = applyLocalBoneAndDescendants(parentIndex, bones, root, worlds, boneIndexById);
  const desiredChildWorld = constraintDegrees(radiansToDegreesV1(parentAngle + childAngle) - childTipOffset);
  const desiredChildLocal = constraintDegrees(desiredChildWorld - inheritedRotation(child, worlds, rootRotationDegrees));
  child.rotation = f32(constraintDegrees(child.rotation + constraintAngleDelta(child.rotation, desiredChildLocal) * mix));
  applyLocalBoneAndDescendants(childIndex, bones, root, worlds, boneIndexById);
  return true;
}

function solveCcd(
  chain: readonly Mutable<RuntimeBoneV1>[],
  targetX: number,
  targetY: number,
  threshold: number,
  iterations: number,
  bones: readonly RuntimeBoneV1[],
  root: AffineV1,
  initialWorlds: Map<string, AffineV1>,
  boneIndexById: ReadonlyMap<string, number>,
): Map<string, AffineV1> {
  let worlds = initialWorlds;
  const last = chain[chain.length - 1];
  if (last === undefined) return worlds;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startWorld = worlds.get(last.id);
    if (startWorld === undefined) return worlds;
    const startX = f32Add(f32Mul(startWorld.a, last.length), startWorld.tx);
    const startY = f32Add(f32Mul(startWorld.b, last.length), startWorld.ty);
    const startDeltaX = targetX - startX;
    const startDeltaY = targetY - startY;
    if (Math.sqrt(startDeltaX * startDeltaX + startDeltaY * startDeltaY) <= threshold) return worlds;
    let changed = false;
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const bone = chain[index];
      if (bone === undefined) continue;
      const world = worlds.get(bone.id);
      const effectorWorld = worlds.get(last.id);
      if (world === undefined || effectorWorld === undefined) continue;
      const effectorX = f32Add(f32Mul(effectorWorld.a, last.length), effectorWorld.tx);
      const effectorY = f32Add(f32Mul(effectorWorld.b, last.length), effectorWorld.ty);
      const fromX = effectorX - world.tx;
      const fromY = effectorY - world.ty;
      const toX = targetX - world.tx;
      const toY = targetY - world.ty;
      if (fromX * fromX + fromY * fromY <= IK_MIN_VECTOR_SQUARED
        || toX * toX + toY * toY <= IK_MIN_VECTOR_SQUARED) continue;
      const delta = radiansToDegreesV1(Math.atan2(fromX * toY - fromY * toX, fromX * toX + fromY * toY));
      if (Math.abs(delta) <= IK_ROTATION_DELTA_EPSILON) continue;
      bone.rotation = f32(bone.rotation + delta);
      changed = true;
      const boneIndex = boneIndexById.get(bone.id) ?? -1;
      if (boneIndex >= 0) {
        worlds = applyLocalBoneAndDescendants(boneIndex, bones, root, worlds, boneIndexById);
      }
      const updatedWorld = worlds.get(last.id);
      if (updatedWorld !== undefined) {
        const updatedX = f32Add(f32Mul(updatedWorld.a, last.length), updatedWorld.tx);
        const updatedY = f32Add(f32Mul(updatedWorld.b, last.length), updatedWorld.ty);
        const updatedDeltaX = targetX - updatedX;
        const updatedDeltaY = targetY - updatedY;
        if (Math.sqrt(updatedDeltaX * updatedDeltaX + updatedDeltaY * updatedDeltaY) <= threshold) return worlds;
      }
    }
    if (!changed) return worlds;
  }
  return worlds;
}

function targetScale(
  constraint: RuntimeIkConstraintV1,
  targetDistance: number,
  firstLength: number,
  secondLength: number,
  childInheritsScale: boolean,
  stretchAllowed: boolean,
): number | null {
  const maxReach = firstLength + secondLength;
  if (constraint.stretch && stretchAllowed && targetDistance > maxReach + IK_REACH_EPSILON) {
    return positiveScale(childInheritsScale
      ? targetDistance / maxReach
      : (targetDistance - secondLength) / firstLength);
  }
  const minReach = Math.abs(firstLength - secondLength);
  if (!constraint.compress || targetDistance >= minReach - IK_REACH_EPSILON) return null;
  return positiveScale(childInheritsScale
    ? targetDistance / minReach
    : firstLength >= secondLength
      ? (targetDistance + secondLength) / firstLength
      : (secondLength - targetDistance) / firstLength);
}

function positiveScale(value: number): number | null {
  return Number.isFinite(value) && value > IK_MIN_POSITIVE_SCALE ? value : null;
}

function ikScaleY(oldScaleY: number, multiplier: number, mode: RuntimeIkConstraintV1["uniform"]): number {
  if (mode === false) return oldScaleY;
  if (mode === true) return oldScaleY * multiplier;
  const divisor = multiplier < 0.7 ? 0.25 + 0.642857 * multiplier : multiplier;
  return oldScaleY / divisor;
}

function buildWorlds(
  bones: readonly RuntimeBoneV1[],
  root: AffineV1,
  output: Map<string, AffineV1> | null = null,
): Map<string, AffineV1> {
  const worlds = output ?? new Map<string, AffineV1>();
  let shapeMatches = worlds.size === bones.length;
  if (shapeMatches) {
    for (let index = 0; index < bones.length; index += 1) {
      const bone = bones[index];
      if (bone === undefined) {
        shapeMatches = false;
        break;
      }
      if (!worlds.has(bone.id)) {
        shapeMatches = false;
        break;
      }
    }
  }
  if (!shapeMatches) worlds.clear();
  for (let index = 0; index < bones.length; index += 1) {
    const bone = bones[index];
    if (bone === undefined) continue;
    const reusable = worlds.get(bone.id) ?? null;
    const world = bone.parentId === null
      ? multiplyAffineV1(root, localBoneAffineV1(bone, reusable), reusable)
      : childWorldAffineV1(worlds.get(bone.parentId) ?? root, bone, bone.transformMode, reusable);
    worlds.set(bone.id, world);
  }
  return worlds;
}

function inverseAffine(matrix: AffineV1, output: AffineV1 | null = null): AffineV1 | null {
  const determinant = determinantV1(matrix);
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  const a = matrix.d / determinant;
  const b = -matrix.b / determinant;
  const c = -matrix.c / determinant;
  const d = matrix.a / determinant;
  const tx = (matrix.c * matrix.ty - matrix.d * matrix.tx) / determinant;
  const ty = (matrix.b * matrix.tx - matrix.a * matrix.ty) / determinant;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)
    || !Number.isFinite(d) || !Number.isFinite(tx) || !Number.isFinite(ty)) return null;
  const result = output ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const mutable = result as Mutable<AffineV1>;
  mutable.a = f32(a);
  mutable.b = f32(b);
  mutable.c = f32(c);
  mutable.d = f32(d);
  mutable.tx = f32(tx);
  mutable.ty = f32(ty);
  return result;
}

function inheritedRotation(
  bone: RuntimeBoneV1,
  worlds: ReadonlyMap<string, AffineV1>,
  rootRotationDegrees: number,
): number {
  if (bone.parentId === null) return rootRotationDegrees;
  if (bone.transformMode === "onlyTranslation" || bone.transformMode === "noRotationOrReflection") return 0;
  const parent = worlds.get(bone.parentId);
  return parent === undefined ? 0 : xAngle(parent);
}

function memberIsActive(
  id: string,
  kind: "bone" | "constraint",
  skins: readonly RuntimeSkinV1[],
  activeSkinIds: readonly string[],
): boolean {
  const cache = skinMembershipCacheV1(skins);
  const memberships = (kind === "bone" ? cache.bones : cache.constraints).get(id);
  if (memberships === undefined) return true;
  for (let index = 0; index < memberships.length; index += 1) {
    const skinId = memberships[index];
    if (skinId === undefined) continue;
    if (activeSkinIds.includes(skinId)) return true;
  }
  return false;
}

function skinMembershipCacheV1(skins: readonly RuntimeSkinV1[]): SkinMembershipCacheV1 {
  const existing = SKIN_MEMBERSHIP_CACHE.get(skins);
  if (existing !== undefined) return existing;
  const bones = new Map<string, string[]>();
  const constraints = new Map<string, string[]>();
  for (const skin of skins) {
    for (const boneId of skin.boneIds) appendMembership(bones, boneId, skin.id);
    for (const constraintId of skin.constraintIds) appendMembership(constraints, constraintId, skin.id);
  }
  const created: SkinMembershipCacheV1 = { bones, constraints };
  SKIN_MEMBERSHIP_CACHE.set(skins, created);
  return created;
}

function appendMembership(target: Map<string, string[]>, id: string, skinId: string): void {
  const memberships = target.get(id);
  if (memberships === undefined) target.set(id, [skinId]);
  else memberships.push(skinId);
}

function xAngle(matrix: AffineV1): number {
  return radiansToDegreesV1(Math.atan2(matrix.b, matrix.a));
}

function xScale(matrix: AffineV1): number {
  return f32MatrixAxisLength(matrix.a, matrix.b);
}

function radiansToDegreesV1(radians: number): number {
  return f32Mul(radians, F32_RADIANS_TO_DEGREES);
}

function degreesToRadiansV1(degrees: number): number {
  return f32Mul(degrees, F32_DEGREES_TO_RADIANS);
}

function constraintDegrees(value: number): number {
  const remainder = ((value % 360) + 360) % 360;
  return remainder > 180 ? remainder - 360 : remainder;
}

function constraintAngleDelta(from: number, to: number): number {
  return constraintDegrees(to - from);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
