import type {
  BoneTransformModeV1,
  RuntimeAnimationV1,
  RuntimeAttachmentTimelineV1,
  RuntimeAttachmentV1,
  RuntimeBoneTimelineV1,
  RuntimeBoneV1,
  RuntimeCurvePropertyNameV1,
  RuntimeCurveV1,
  RuntimeConstraintTimelineV1,
  RuntimeConstraintDiagnosticV1,
  RuntimeConstraintV1,
  RuntimeRegionAttachmentV1,
  RuntimeSlotColorKeyV1,
  RuntimeSkinV1,
  RuntimeSlotTimelineV1,
  RuntimeSlotV1,
  RuntimeTrackBlendV1,
} from "../contracts.js";
import type { RuntimeDataV1 } from "../data.js";
import { f32, f32Add, f32Mul, f32Sub } from "../math/f32.js";
import {
  copyRuntimeSlotTintBytesV1,
  mutableRuntimeSlotTintBytesV1,
  resetRuntimeSlotTintBytesV1,
} from "../render/tint.js";
import {
  NO_CONTRIBUTION_V1,
  sampleContinuousArrayKeysV1,
  sampleContinuousComponentArrayKeysV1,
  sampleContinuousKeysV1,
  sampleDiscreteKeysV1,
  selectPropertyCurveV1,
  wrapDegreesV1,
} from "./curves.js";

export interface RuntimeAnimationLayerV1 {
  readonly animation: RuntimeAnimationV1;
  readonly sampleTime: number;
  readonly alpha: number;
  readonly blend: RuntimeTrackBlendV1;
  readonly forceStepped: boolean;
  readonly attachmentsAllowed: boolean;
  readonly drawOrderAllowed: boolean;
  readonly unboundedAlpha?: boolean | undefined;
  readonly propertyAlpha?: ((propertyId: string, baseAlpha: number) => number) | undefined;
}

export interface RuntimeSampledPoseV1 {
  readonly bones: readonly RuntimeBoneV1[];
  readonly slots: readonly RuntimeSlotV1[];
  readonly regions: ReadonlyMap<string, RuntimeRegionAttachmentV1>;
  readonly deforms: ReadonlyMap<string, RuntimeSampledDeformV1>;
  readonly sequenceIndices: ReadonlyMap<string, number>;
  readonly slotAttachmentKeys: ReadonlyMap<string, string | null>;
  readonly sampledSkinIds: readonly string[];
  readonly constraints: readonly RuntimeConstraintV1[];
  readonly drawOrderSlotIds: readonly string[];
  readonly drawOrderSampled: boolean;
  readonly sampledSliderTimes: ReadonlyMap<string, number>;
  readonly constraintDiagnostics: ReadonlyMap<string, RuntimeConstraintDiagnosticV1>;
}

export interface RuntimeSampledDeformV1 {
  readonly weighted: boolean;
  readonly values: readonly number[];
}

type Mutable<T> = { -readonly [Property in keyof T]: T[Property] };
type MutableConstraintV1 = Mutable<RuntimeConstraintV1>;
type MutableSampledPoseV1 = { -readonly [Property in keyof RuntimeSampledPoseV1]: RuntimeSampledPoseV1[Property] };

interface MutableSamplingStateV1 {
  readonly setupBones: ReadonlyMap<string, RuntimeBoneV1>;
  readonly bones: Map<string, Mutable<RuntimeBoneV1>>;
  readonly setupSlots: ReadonlyMap<string, RuntimeSlotV1>;
  readonly slots: Map<string, Mutable<RuntimeSlotV1>>;
  readonly setupRegions: ReadonlyMap<string, RuntimeRegionAttachmentV1>;
  readonly regions: Map<string, Mutable<RuntimeRegionAttachmentV1>>;
  readonly attachmentById: ReadonlyMap<string, RuntimeAttachmentV1>;
  readonly deforms: Map<string, RuntimeSampledDeformV1>;
  readonly deformPool: Map<string, MutableSampledDeformV1>;
  readonly deformScratchByTimeline: WeakMap<object, RuntimeDeformSamplingScratchV1>;
  readonly deformEpochByOwner: Map<string, number>;
  deformEpoch: number;
  readonly sequenceIndices: Map<string, number>;
  readonly setupConstraints: ReadonlyMap<string, RuntimeConstraintV1>;
  readonly constraints: Map<string, MutableConstraintV1>;
  readonly setupOrder: readonly string[];
  drawOrder: string[];
  drawOrderSampled: boolean;
  sampledSkinIds: string[];
  readonly sampledSliderTimes: Map<string, number>;
  readonly constraintDiagnostics: Map<string, RuntimeConstraintDiagnosticV1>;
}

interface SamplingDataCacheV1 {
  readonly setupBones: ReadonlyMap<string, RuntimeBoneV1>;
  readonly setupSlots: ReadonlyMap<string, RuntimeSlotV1>;
  readonly regionAttachments: readonly RuntimeRegionAttachmentV1[];
  readonly setupRegions: ReadonlyMap<string, RuntimeRegionAttachmentV1>;
  readonly setupConstraints: ReadonlyMap<string, RuntimeConstraintV1>;
  readonly setupOrder: readonly string[];
  readonly setupSequenceIndices: ReadonlyMap<string, number>;
  readonly setupSequenceIds: readonly string[];
  readonly setupSequenceValues: readonly number[];
  readonly attachmentById: ReadonlyMap<string, RuntimeAttachmentV1>;
}

interface MutableSampledDeformV1 {
  weighted: boolean;
  readonly values: number[];
}

interface RuntimeDeformSamplingScratchV1 {
  readonly sampledValues: number[];
  readonly canonicalValues: number[];
}

export interface RuntimeSamplingScratchV1 {
  readonly runtimeSamplingScratchV1: true;
}

interface SamplingScratchStorageV1 {
  state: MutableSamplingStateV1 | null;
  pose: MutableSampledPoseV1 | null;
  readonly skinAttachmentResolution: SkinAttachmentResolutionScratchV1;
}

interface SkinAttachmentResolutionScratchV1 {
  readonly skinIds: string[];
  readonly bySlotId: Map<string, Map<string, string | null>>;
}

const SAMPLING_DATA_CACHE = new WeakMap<RuntimeDataV1, SamplingDataCacheV1>();
const PRESENT_NUMBER_KEY_CACHE = new WeakMap<object, Map<PropertyKey, readonly unknown[]>>();
const PRESENT_BOOLEAN_KEY_CACHE = new WeakMap<object, Map<PropertyKey, readonly unknown[]>>();
const SAMPLING_SCRATCH_STORAGE = new WeakMap<RuntimeSamplingScratchV1, SamplingScratchStorageV1>();
const FOLDER_CONTROLLED_SET_CACHE = new WeakMap<object, ReadonlySet<string>>();
const CONTINUOUS_OPTIONS = Object.freeze({});
const CONTINUOUS_STEPPED_OPTIONS = Object.freeze({ forceStepped: true });
const ANGULAR_OPTIONS = Object.freeze({ angular: true });
const ANGULAR_STEPPED_OPTIONS = Object.freeze({ angular: true, forceStepped: true });
const EMPTY_TIMELINE_KEYS_V1 = Object.freeze([] as const);
const PHYSICS_TIMELINE_FIELDS = Object.freeze([
  "mix",
  "inertia",
  "strength",
  "damping",
  "mass",
  "wind",
  "gravity",
] as const);
const TRANSFORM_TIMELINE_FIELDS = Object.freeze([
  ["mixRotate", "mix_rotate"],
  ["mixX", "mix_x"],
  ["mixY", "mix_y"],
  ["mixScaleX", "mix_scale_x"],
  ["mixScaleY", "mix_scale_y"],
  ["mixShearY", "mix_shear_y"],
] as const);
const FIELD_VALUE_GETTERS = new Map<PropertyKey, unknown>();
const SLOT_COLOR_COMPONENT_CACHE = new WeakMap<object, readonly number[]>();
const SLOT_COLOR_SAMPLE_SCRATCH = new WeakMap<object, number[]>();
const SLOT_COLOR_PROPERTIES = Object.freeze([
  "color_r",
  "color_g",
  "color_b",
  "alpha",
  "dark_r",
  "dark_g",
  "dark_b",
] as const);
type RegionTimelineSampleKeyV1 = {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
};

const REGION_CHANNELS_V1: ReadonlyArray<readonly [
  keyof Pick<RuntimeRegionAttachmentV1, "x" | "y" | "rotation" | "scaleX" | "scaleY">,
  RuntimeCurvePropertyNameV1,
  boolean,
  (key: RegionTimelineSampleKeyV1) => number,
]> = [
  ["x", "x", false, (key) => key.x],
  ["y", "y", false, (key) => key.y],
  ["rotation", "rotation", true, (key) => key.rotation],
  ["scaleX", "scale_x", false, (key) => key.scaleX],
  ["scaleY", "scale_y", false, (key) => key.scaleY],
];

export function createRuntimeSamplingScratchV1(): RuntimeSamplingScratchV1 {
  const scratch = Object.freeze({ runtimeSamplingScratchV1: true as const });
  SAMPLING_SCRATCH_STORAGE.set(scratch, {
    state: null,
    pose: null,
    skinAttachmentResolution: { skinIds: [], bySlotId: new Map() },
  });
  return scratch;
}

export function sampleAnimationLayersV1(
  data: RuntimeDataV1,
  layers: readonly RuntimeAnimationLayerV1[],
  configuredSkinIds: readonly string[] = data.document.skins[0] === undefined ? [] : [data.document.skins[0].id],
  scratch: RuntimeSamplingScratchV1 | null = null,
): RuntimeSampledPoseV1 {
  const storage = scratch === null ? null : samplingScratchStorageV1(scratch);
  const state = createSamplingState(data, configuredSkinIds, null, storage);
  for (const layer of layers) applyAnimationLayerToState(data, state, layer);
  finalizeSamplingStateV1(state);
  return snapshotSamplingState(data, state, storage);
}

/**
 * Applies one non-recursive animation layer over an already sampled pose.
 * Slider constraints use this entry point while walking declaration order.
 */
export function applyAnimationLayerToSampledPoseV1(
  data: RuntimeDataV1,
  pose: RuntimeSampledPoseV1,
  layer: RuntimeAnimationLayerV1,
): RuntimeSampledPoseV1 {
  const state = createSamplingState(data, pose.sampledSkinIds, pose);
  applyAnimationLayerToState(data, state, layer);
  finalizeSamplingStateV1(state);
  return snapshotSamplingState(data, state);
}

function createSamplingState(
  data: RuntimeDataV1,
  configuredSkinIds: readonly string[],
  base: RuntimeSampledPoseV1 | null = null,
  scratch: SamplingScratchStorageV1 | null = null,
): MutableSamplingStateV1 {
  const cached = samplingDataCacheV1(data);
  if (base === null && scratch?.state?.setupBones === cached.setupBones) {
    resetSamplingStateV1(scratch.state, data, configuredSkinIds, cached);
    return scratch.state;
  }
  const sourceBones = base?.bones ?? data.document.bones;
  const bones = new Map<string, Mutable<RuntimeBoneV1>>();
  for (const bone of sourceBones) bones.set(bone.id, { ...bone });

  const sourceSlots = base?.slots ?? data.document.slots;
  const slots = new Map<string, Mutable<RuntimeSlotV1>>();
  for (const slot of sourceSlots) {
    const logicalAttachment = base?.slotAttachmentKeys.has(slot.id)
      ? base.slotAttachmentKeys.get(slot.id) ?? null
      : slot.attachmentId;
    const created = { ...slot, attachmentId: logicalAttachment };
    copyRuntimeSlotTintBytesV1(slot, created);
    slots.set(slot.id, created);
  }

  const regions = new Map<string, Mutable<RuntimeRegionAttachmentV1>>();
  for (const attachment of cached.regionAttachments) {
    const sampled = base?.regions.get(attachment.id);
    regions.set(attachment.id, sampled === undefined
      ? { ...attachment }
      : { ...attachment, ...sampled });
  }

  const deforms = new Map<string, RuntimeSampledDeformV1>(base?.deforms ?? []);
  const deformEpoch = 1;
  const deformEpochByOwner = new Map<string, number>();
  for (const ownerId of deforms.keys()) deformEpochByOwner.set(ownerId, deformEpoch);
  const sequenceIndices = new Map<string, number>(base?.sequenceIndices ?? cached.setupSequenceIndices);
  const sourceConstraints = base?.constraints ?? data.document.constraints;
  const constraints = new Map<string, MutableConstraintV1>();
  for (const constraint of sourceConstraints) constraints.set(constraint.id, cloneConstraint(constraint));

  const created: MutableSamplingStateV1 = {
    setupBones: cached.setupBones,
    bones,
    setupSlots: cached.setupSlots,
    slots,
    setupRegions: cached.setupRegions,
    regions,
    attachmentById: cached.attachmentById,
    deforms,
    deformPool: new Map(),
    deformScratchByTimeline: new WeakMap(),
    deformEpochByOwner,
    deformEpoch,
    sequenceIndices,
    setupConstraints: cached.setupConstraints,
    constraints,
    setupOrder: cached.setupOrder,
    drawOrder: [...(base?.drawOrderSlotIds ?? cached.setupOrder)],
    drawOrderSampled: base?.drawOrderSampled ?? false,
    sampledSkinIds: [...configuredSkinIds],
    sampledSliderTimes: new Map(base?.sampledSliderTimes ?? []),
    constraintDiagnostics: new Map(base?.constraintDiagnostics ?? []),
  };
  if (base === null && scratch !== null) scratch.state = created;
  return created;
}

function applyAnimationLayerToState(
  data: RuntimeDataV1,
  state: MutableSamplingStateV1,
  layer: RuntimeAnimationLayerV1,
): void {
  if (layer.alpha === 0) return;
  if (layer.attachmentsAllowed && animationSkinAlpha(layer) >= 0.5) {
    const sampledSkin = sampleDiscreteKeysV1(layer.animation.skins, layer.sampleTime, skinIdV1);
    if (sampledSkin !== NO_CONTRIBUTION_V1) {
      if (sampledSkin === null) {
        state.sampledSkinIds.length = 0;
      } else {
        state.sampledSkinIds[0] = sampledSkin;
        state.sampledSkinIds.length = 1;
      }
    }
  }
  for (let index = 0; index < layer.animation.boneTimelines.length; index += 1) {
    const timeline = layer.animation.boneTimelines[index];
    if (timeline === undefined) continue;
    const setup = state.setupBones.get(timeline.boneId);
    const current = state.bones.get(timeline.boneId);
    if (setup !== undefined && current !== undefined) applyBoneTimeline(layer, timeline, setup, current);
  }
  for (let index = 0; index < layer.animation.slotTimelines.length; index += 1) {
    const timeline = layer.animation.slotTimelines[index];
    if (timeline === undefined) continue;
    const setup = state.setupSlots.get(timeline.slotId);
    const current = state.slots.get(timeline.slotId);
    if (setup !== undefined && current !== undefined) applySlotTimeline(layer, timeline, setup, current);
  }
  for (let index = 0; index < layer.animation.attachmentTimelines.length; index += 1) {
    const timeline = layer.animation.attachmentTimelines[index];
    if (timeline === undefined) continue;
    const setup = state.setupRegions.get(timeline.attachmentId);
    const current = state.regions.get(timeline.attachmentId);
    if (setup !== undefined && current !== undefined && timeline.region !== null) {
      applyRegionTimeline(layer, timeline.attachmentId, timeline.region, setup, current);
    }
    const attachment = data.attachment(timeline.attachmentId);
    if (timeline.deform !== null) {
      applyDeformTimeline(layer, timeline, attachment, state);
    }
    if (timeline.sequence !== null && layer.attachmentsAllowed) {
      applySequenceTimeline(layer, timeline, attachment, state.sequenceIndices);
    }
  }
  for (let index = 0; index < layer.animation.constraintTimelines.length; index += 1) {
    const timeline = layer.animation.constraintTimelines[index];
    if (timeline === undefined) continue;
    applyConstraintTimeline(layer, timeline, state.setupConstraints, state.constraints);
  }
  if (layer.drawOrderAllowed && alphaFor(layer, "draw-order") >= 0.5) {
    const sampled = sampleDiscreteKeysV1(layer.animation.drawOrder, layer.sampleTime, slotIdsV1);
    if (sampled !== NO_CONTRIBUTION_V1) {
      copyArrayV1(state.drawOrder, sampled);
      state.drawOrderSampled = true;
    }
    for (let index = 0; index < layer.animation.drawOrderFolders.length; index += 1) {
      const folder = layer.animation.drawOrderFolders[index];
      if (folder === undefined) continue;
      const folderOrder = sampleDiscreteKeysV1(folder.keys, layer.sampleTime, slotIdsV1);
      if (folderOrder !== NO_CONTRIBUTION_V1) {
        state.drawOrder = applyFolderOrder(state.drawOrder, folder.slotIds, folderOrder);
        state.drawOrderSampled = true;
      }
    }
  }
}

function snapshotSamplingState(
  data: RuntimeDataV1,
  state: MutableSamplingStateV1,
  scratch: SamplingScratchStorageV1 | null = null,
): RuntimeSampledPoseV1 {
  const reusable = scratch?.pose ?? null;
  const skinAttachmentResolution = scratch?.skinAttachmentResolution ?? null;
  if (skinAttachmentResolution !== null) {
    prepareSkinAttachmentResolutionScratchV1(skinAttachmentResolution, state.sampledSkinIds);
  }
  const slotAttachmentKeys = reusable?.slotAttachmentKeys as Map<string, string | null> | undefined
    ?? new Map<string, string | null>();
  let slotKeyShapeMatches = slotAttachmentKeys.size === data.document.slots.length;
  if (slotKeyShapeMatches) {
    for (let index = 0; index < data.document.slots.length; index += 1) {
      const slot = data.document.slots[index];
      if (slot === undefined) continue;
      if (!slotAttachmentKeys.has(slot.id)) {
        slotKeyShapeMatches = false;
        break;
      }
    }
  }
  if (!slotKeyShapeMatches) slotAttachmentKeys.clear();
  const resolvedSlots = reusable?.slots as Mutable<RuntimeSlotV1>[] | undefined
    ?? new Array<Mutable<RuntimeSlotV1>>(data.document.slots.length);
  resolvedSlots.length = data.document.slots.length;
  for (let index = 0; index < data.document.slots.length; index += 1) {
    const setupSlot = data.document.slots[index];
    if (setupSlot === undefined) continue;
    const sampledSlot = state.slots.get(setupSlot.id) ?? setupSlot;
    slotAttachmentKeys.set(sampledSlot.id, sampledSlot.attachmentId);
    let resolved = resolvedSlots[index];
    if (resolved === undefined) {
      resolved = { ...sampledSlot };
      resolvedSlots[index] = resolved;
    } else {
      copySlotV1(resolved, sampledSlot);
    }
    copyRuntimeSlotTintBytesV1(sampledSlot, resolved);
    resolved.attachmentId = resolveSkinAttachmentV1(
      data,
      state.sampledSkinIds,
      sampledSlot.id,
      sampledSlot.attachmentId,
      skinAttachmentResolution,
    );
  }

  const bones = reusable?.bones as RuntimeBoneV1[] | undefined
    ?? new Array<RuntimeBoneV1>(data.document.bones.length);
  bones.length = data.document.bones.length;
  for (let index = 0; index < data.document.bones.length; index += 1) {
    const bone = data.document.bones[index];
    if (bone !== undefined) bones[index] = state.bones.get(bone.id) ?? bone;
  }
  const constraints = reusable?.constraints as RuntimeConstraintV1[] | undefined
    ?? new Array<RuntimeConstraintV1>(data.document.constraints.length);
  constraints.length = data.document.constraints.length;
  for (let index = 0; index < data.document.constraints.length; index += 1) {
    const constraint = data.document.constraints[index];
    if (constraint !== undefined) constraints[index] = state.constraints.get(constraint.id) ?? constraint;
  }

  if (reusable !== null) {
    reusable.bones = bones;
    reusable.slots = resolvedSlots;
    reusable.regions = state.regions;
    reusable.deforms = state.deforms;
    reusable.sequenceIndices = state.sequenceIndices;
    reusable.slotAttachmentKeys = slotAttachmentKeys;
    reusable.sampledSkinIds = state.sampledSkinIds;
    reusable.constraints = constraints;
    reusable.drawOrderSlotIds = state.drawOrder;
    reusable.drawOrderSampled = state.drawOrderSampled;
    reusable.sampledSliderTimes = state.sampledSliderTimes;
    reusable.constraintDiagnostics = state.constraintDiagnostics;
    return reusable;
  }
  const created: MutableSampledPoseV1 = {
    bones,
    slots: resolvedSlots,
    regions: state.regions,
    deforms: state.deforms,
    sequenceIndices: state.sequenceIndices,
    slotAttachmentKeys,
    sampledSkinIds: state.sampledSkinIds,
    constraints,
    drawOrderSlotIds: state.drawOrder,
    drawOrderSampled: state.drawOrderSampled,
    sampledSliderTimes: state.sampledSliderTimes,
    constraintDiagnostics: state.constraintDiagnostics,
  };
  if (scratch !== null) scratch.pose = created;
  return created;
}

function resetSamplingStateV1(
  state: MutableSamplingStateV1,
  data: RuntimeDataV1,
  configuredSkinIds: readonly string[],
  cached: SamplingDataCacheV1,
): void {
  for (let index = 0; index < data.document.bones.length; index += 1) {
    const bone = data.document.bones[index];
    if (bone === undefined) continue;
    const current = state.bones.get(bone.id);
    if (current !== undefined) copyBoneV1(current, bone);
  }
  for (let index = 0; index < data.document.slots.length; index += 1) {
    const slot = data.document.slots[index];
    if (slot === undefined) continue;
    const current = state.slots.get(slot.id);
    if (current !== undefined) {
      copySlotV1(current, slot);
      resetRuntimeSlotTintBytesV1(current);
    }
  }
  for (let index = 0; index < cached.regionAttachments.length; index += 1) {
    const attachment = cached.regionAttachments[index];
    if (attachment === undefined) continue;
    const current = state.regions.get(attachment.id);
    if (current !== undefined) copyRegionV1(current, attachment);
  }
  state.deformEpoch += 1;
  if (!Number.isSafeInteger(state.deformEpoch)) {
    state.deformEpoch = 1;
    state.deformEpochByOwner.clear();
  }
  syncSequenceIndicesV1(state.sequenceIndices, cached.setupSequenceIds, cached.setupSequenceValues);
  for (let index = 0; index < data.document.constraints.length; index += 1) {
    const constraint = data.document.constraints[index];
    if (constraint === undefined) continue;
    const current = state.constraints.get(constraint.id);
    if (current === undefined) continue;
    copyConstraintV1(current, constraint);
  }
  copyArrayV1(state.drawOrder, cached.setupOrder);
  state.drawOrderSampled = false;
  copyArrayV1(state.sampledSkinIds, configuredSkinIds);
  state.sampledSliderTimes.clear();
  state.constraintDiagnostics.clear();
}

function copyBoneV1(target: Mutable<RuntimeBoneV1>, source: RuntimeBoneV1): void {
  target.id = source.id;
  target.name = source.name;
  target.parentId = source.parentId;
  target.x = source.x;
  target.y = source.y;
  target.rotation = source.rotation;
  target.shearX = source.shearX;
  target.shearY = source.shearY;
  target.scaleX = source.scaleX;
  target.scaleY = source.scaleY;
  target.length = source.length;
  target.transformMode = source.transformMode;
}

function copySlotV1(target: Mutable<RuntimeSlotV1>, source: RuntimeSlotV1): void {
  target.id = source.id;
  target.name = source.name;
  target.boneId = source.boneId;
  target.attachmentId = source.attachmentId;
  target.zIndex = source.zIndex;
  target.blendMode = source.blendMode;
  target.color = source.color;
  target.alpha = source.alpha;
  target.darkColor = source.darkColor;
}

function copyRegionV1(
  target: Mutable<RuntimeRegionAttachmentV1>,
  source: RuntimeRegionAttachmentV1,
): void {
  target.type = source.type;
  target.id = source.id;
  target.name = source.name;
  target.slotId = source.slotId;
  target.imageId = source.imageId;
  target.color = source.color;
  target.alpha = source.alpha;
  target.sequence = source.sequence;
  target.x = source.x;
  target.y = source.y;
  target.rotation = source.rotation;
  target.scaleX = source.scaleX;
  target.scaleY = source.scaleY;
}

function copyConstraintV1(target: MutableConstraintV1, source: RuntimeConstraintV1): void {
  if (target.type !== source.type) {
    throw new Error(`Constraint '${source.id}' changed type inside immutable Runtime data.`);
  }
  target.id = source.id;
  target.name = source.name;
  switch (source.type) {
    case "ik": {
      if (target.type !== "ik") return;
      target.chainBoneIds = source.chainBoneIds;
      target.targetBoneId = source.targetBoneId;
      const mutableTarget = target.target as Mutable<typeof target.target>;
      mutableTarget.x = source.target.x;
      mutableTarget.y = source.target.y;
      target.mix = source.mix;
      target.bendPositive = source.bendPositive;
      target.compress = source.compress;
      target.stretch = source.stretch;
      target.uniform = source.uniform;
      target.softness = source.softness;
      target.iterations = source.iterations;
      target.threshold = source.threshold;
      return;
    }
    case "transform":
      if (target.type !== "transform") return;
      target.boneIds = source.boneIds;
      target.targetBoneId = source.targetBoneId;
      target.local = source.local;
      target.relative = source.relative;
      target.rotation = source.rotation;
      target.x = source.x;
      target.y = source.y;
      target.scaleX = source.scaleX;
      target.scaleY = source.scaleY;
      target.shearY = source.shearY;
      target.mixRotate = source.mixRotate;
      target.mixX = source.mixX;
      target.mixY = source.mixY;
      target.mixScaleX = source.mixScaleX;
      target.mixScaleY = source.mixScaleY;
      target.mixShearY = source.mixShearY;
      target.mapping = source.mapping;
      return;
    case "path":
      if (target.type !== "path") return;
      target.boneIds = source.boneIds;
      target.targetSlotId = source.targetSlotId;
      target.positionMode = source.positionMode;
      target.spacingMode = source.spacingMode;
      target.rotateMode = source.rotateMode;
      target.rotation = source.rotation;
      target.position = source.position;
      target.spacing = source.spacing;
      target.mixRotate = source.mixRotate;
      target.mixX = source.mixX;
      target.mixY = source.mixY;
      return;
    case "physics":
      if (target.type !== "physics") return;
      target.boneId = source.boneId;
      target.x = source.x;
      target.y = source.y;
      target.rotate = source.rotate;
      target.scaleX = source.scaleX;
      target.scaleYMode = source.scaleYMode;
      target.shearX = source.shearX;
      target.limit = source.limit;
      target.fps = source.fps;
      target.inertia = source.inertia;
      target.strength = source.strength;
      target.damping = source.damping;
      target.mass = source.mass;
      target.wind = source.wind;
      target.gravity = source.gravity;
      target.mix = source.mix;
      target.inertiaGlobal = source.inertiaGlobal;
      target.strengthGlobal = source.strengthGlobal;
      target.dampingGlobal = source.dampingGlobal;
      target.massGlobal = source.massGlobal;
      target.windGlobal = source.windGlobal;
      target.gravityGlobal = source.gravityGlobal;
      target.mixGlobal = source.mixGlobal;
      return;
    case "slider":
      if (target.type !== "slider") return;
      target.animationId = source.animationId;
      target.looping = source.looping;
      target.additive = source.additive;
      target.sourceBoneId = source.sourceBoneId;
      target.sourceProperty = source.sourceProperty;
      target.sourceOffset = source.sourceOffset;
      target.timeOffset = source.timeOffset;
      target.timeScale = source.timeScale;
      target.rangeMax = source.rangeMax;
      target.local = source.local;
      target.time = source.time;
      target.mix = source.mix;
      return;
  }
}

function samplingScratchStorageV1(scratch: RuntimeSamplingScratchV1): SamplingScratchStorageV1 {
  let storage = SAMPLING_SCRATCH_STORAGE.get(scratch);
  if (storage === undefined) {
    storage = {
      state: null,
      pose: null,
      skinAttachmentResolution: { skinIds: [], bySlotId: new Map() },
    };
    SAMPLING_SCRATCH_STORAGE.set(scratch, storage);
  }
  return storage;
}

function copyArrayV1<T>(target: T[], source: readonly T[]): void {
  target.length = source.length;
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index];
    if (value !== undefined) target[index] = value;
  }
}

function syncSequenceIndicesV1(
  target: Map<string, number>,
  sourceIds: readonly string[],
  sourceValues: readonly number[],
): void {
  let shapeMatches = target.size === sourceIds.length;
  if (shapeMatches) {
    for (let index = 0; index < sourceIds.length; index += 1) {
      const id = sourceIds[index];
      if (id === undefined || !target.has(id)) {
        shapeMatches = false;
        break;
      }
    }
  }
  if (!shapeMatches) target.clear();
  for (let index = 0; index < sourceIds.length; index += 1) {
    const id = sourceIds[index];
    const value = sourceValues[index];
    if (id !== undefined && value !== undefined) target.set(id, value);
  }
}

function finalizeSamplingStateV1(state: MutableSamplingStateV1): void {
  for (const ownerId of state.deforms.keys()) {
    if (state.deformEpochByOwner.get(ownerId) !== state.deformEpoch) state.deforms.delete(ownerId);
  }
}

function samplingDataCacheV1(data: RuntimeDataV1): SamplingDataCacheV1 {
  const existing = SAMPLING_DATA_CACHE.get(data);
  if (existing !== undefined) return existing;

  const setupBones = new Map<string, RuntimeBoneV1>();
  for (const bone of data.document.bones) setupBones.set(bone.id, bone);
  const setupSlots = new Map<string, RuntimeSlotV1>();
  for (const slot of data.document.slots) setupSlots.set(slot.id, slot);
  const regionAttachments: RuntimeRegionAttachmentV1[] = [];
  const setupRegions = new Map<string, RuntimeRegionAttachmentV1>();
  const setupSequenceIndices = new Map<string, number>();
  const setupSequenceIds: string[] = [];
  const setupSequenceValues: number[] = [];
  const attachmentById = new Map<string, RuntimeAttachmentV1>();
  for (const attachment of data.document.attachments) {
    attachmentById.set(attachment.id, attachment);
    if (attachment.type === "region") {
      regionAttachments.push(attachment);
      setupRegions.set(attachment.id, attachment);
    }
    if ((attachment.type === "region" || attachment.type === "mesh") && attachment.sequence !== null) {
      setupSequenceIndices.set(attachment.id, attachment.sequence.setupIndex);
      setupSequenceIds.push(attachment.id);
      setupSequenceValues.push(attachment.sequence.setupIndex);
    }
  }
  const setupConstraints = new Map<string, RuntimeConstraintV1>();
  for (const constraint of data.document.constraints) setupConstraints.set(constraint.id, constraint);

  const sortedSlots = [...data.document.slots];
  // ECMAScript requires stable Array sorting; equal zIndex values retain declaration order.
  sortedSlots.sort((left, right) => left.zIndex - right.zIndex);
  const setupOrder = new Array<string>(sortedSlots.length);
  for (let index = 0; index < sortedSlots.length; index += 1) {
    const slot = sortedSlots[index];
    if (slot !== undefined) setupOrder[index] = slot.id;
  }

  const created: SamplingDataCacheV1 = {
    setupBones,
    setupSlots,
    regionAttachments,
    setupRegions,
    setupConstraints,
    setupOrder,
    setupSequenceIndices,
    setupSequenceIds,
    setupSequenceValues,
    attachmentById,
  };
  SAMPLING_DATA_CACHE.set(data, created);
  return created;
}

function cloneConstraint(constraint: RuntimeConstraintV1): MutableConstraintV1 {
  if (constraint.type === "ik") return { ...constraint, target: { ...constraint.target } };
  return { ...constraint };
}

function applyConstraintTimeline(
  layer: RuntimeAnimationLayerV1,
  timeline: RuntimeConstraintTimelineV1,
  setups: ReadonlyMap<string, RuntimeConstraintV1>,
  currents: Map<string, MutableConstraintV1>,
): void {
  if (timeline.type === "physics" && timeline.constraintId === "*") {
    for (const [constraintId, current] of currents) {
      const setup = setups.get(constraintId);
      if (current.type === "physics" && setup?.type === "physics") {
        applyPhysicsTimeline(layer, timeline, setup, current, true);
      }
    }
    return;
  }
  const setup = setups.get(timeline.constraintId);
  const current = currents.get(timeline.constraintId);
  if (setup === undefined || current === undefined || setup.type !== timeline.type || current.type !== timeline.type) return;
  switch (timeline.type) {
    case "ik":
      if (setup.type === "ik" && current.type === "ik") applyIkTimeline(layer, timeline, setup, current);
      return;
    case "transform":
      if (setup.type === "transform" && current.type === "transform") applyTransformTimeline(layer, timeline, setup, current);
      return;
    case "path":
      if (setup.type === "path" && current.type === "path") applyPathConstraintTimeline(layer, timeline, setup, current);
      return;
    case "physics":
      if (setup.type === "physics" && current.type === "physics") applyPhysicsTimeline(layer, timeline, setup, current, false);
      return;
    case "slider":
      if (setup.type === "slider" && current.type === "slider") applySliderTimeline(layer, timeline, setup, current);
  }
}

function applyIkTimeline(
  layer: RuntimeAnimationLayerV1,
  timeline: Extract<RuntimeConstraintTimelineV1, { readonly type: "ik" }>,
  setup: Extract<RuntimeConstraintV1, { readonly type: "ik" }>,
  current: Mutable<Extract<RuntimeConstraintV1, { readonly type: "ik" }>>,
): void {
  const target = current.target as Mutable<typeof current.target>;
  target.x = sampleConstraintScalar(layer, timeline.keys, "targetX", "target_x", setup.target.x, target.x, timeline.constraintId);
  target.y = sampleConstraintScalar(layer, timeline.keys, "targetY", "target_y", setup.target.y, target.y, timeline.constraintId);
  current.mix = clampUnit(sampleConstraintScalar(layer, timeline.keys, "mix", "mix", setup.mix, current.mix, timeline.constraintId));
  current.softness = Math.max(0, sampleConstraintScalar(layer, timeline.keys, "softness", "softness", setup.softness, current.softness, timeline.constraintId));
  current.bendPositive = sampleConstraintBoolean(layer, timeline.keys, "bendPositive", setup.bendPositive, current.bendPositive, timeline.constraintId);
  current.compress = sampleConstraintBoolean(layer, timeline.keys, "compress", setup.compress, current.compress, timeline.constraintId);
  current.stretch = sampleConstraintBoolean(layer, timeline.keys, "stretch", setup.stretch, current.stretch, timeline.constraintId);
}

function applyTransformTimeline(
  layer: RuntimeAnimationLayerV1,
  timeline: Extract<RuntimeConstraintTimelineV1, { readonly type: "transform" }>,
  setup: Extract<RuntimeConstraintV1, { readonly type: "transform" }>,
  current: Mutable<Extract<RuntimeConstraintV1, { readonly type: "transform" }>>,
): void {
  for (const [field, property] of TRANSFORM_TIMELINE_FIELDS) {
    current[field] = sampleConstraintScalar(layer, timeline.keys, field, property, setup[field], current[field], timeline.constraintId);
  }
}

function applyPathConstraintTimeline(
  layer: RuntimeAnimationLayerV1,
  timeline: Extract<RuntimeConstraintTimelineV1, { readonly type: "path" }>,
  setup: Extract<RuntimeConstraintV1, { readonly type: "path" }>,
  current: Mutable<Extract<RuntimeConstraintV1, { readonly type: "path" }>>,
): void {
  current.position = sampleConstraintScalar(layer, timeline.keys, "position", "position", setup.position, current.position, timeline.constraintId);
  current.spacing = sampleConstraintScalar(layer, timeline.keys, "spacing", "spacing", setup.spacing, current.spacing, timeline.constraintId);
  current.mixRotate = clampUnit(sampleConstraintScalar(layer, timeline.keys, "mixRotate", "mix_rotate", setup.mixRotate, current.mixRotate, timeline.constraintId));
  current.mixX = clampUnit(sampleConstraintScalar(layer, timeline.keys, "mixX", "mix_x", setup.mixX, current.mixX, timeline.constraintId));
  current.mixY = clampUnit(sampleConstraintScalar(layer, timeline.keys, "mixY", "mix_y", setup.mixY, current.mixY, timeline.constraintId));
}

function applyPhysicsTimeline(
  layer: RuntimeAnimationLayerV1,
  timeline: Extract<RuntimeConstraintTimelineV1, { readonly type: "physics" }>,
  setup: Extract<RuntimeConstraintV1, { readonly type: "physics" }>,
  current: Mutable<Extract<RuntimeConstraintV1, { readonly type: "physics" }>>,
  globalOnly: boolean,
): void {
  for (const field of PHYSICS_TIMELINE_FIELDS) {
    const globalField = `${field}Global` as keyof typeof setup;
    if (globalOnly && setup[globalField] !== true) continue;
    let sampled = sampleConstraintScalar(layer, timeline.keys, field, field, setup[field], current[field], timeline.constraintId);
    if (field === "mix" || field === "inertia" || field === "damping") sampled = clampUnit(sampled);
    if (field === "strength") sampled = Math.max(0, sampled);
    if (field === "mass") sampled = sampled > 0 ? sampled : 1.401298464324817e-45;
    current[field] = sampled;
  }
}

function applySliderTimeline(
  layer: RuntimeAnimationLayerV1,
  timeline: Extract<RuntimeConstraintTimelineV1, { readonly type: "slider" }>,
  setup: Extract<RuntimeConstraintV1, { readonly type: "slider" }>,
  current: Mutable<Extract<RuntimeConstraintV1, { readonly type: "slider" }>>,
): void {
  current.time = sampleConstraintScalar(
    layer,
    timeline.keys,
    "sliderTime",
    "slider_time",
    setup.time,
    current.time,
    timeline.constraintId,
    "replace",
  );
  current.mix = sampleConstraintScalar(layer, timeline.keys, "mix", "mix", setup.mix, current.mix, timeline.constraintId);
}

function sampleConstraintScalar<
  Key extends { readonly time: number; readonly curve: RuntimeCurveV1 },
  Field extends keyof Key,
>(
  layer: RuntimeAnimationLayerV1,
  keys: readonly Key[],
  field: Field,
  property: RuntimeCurvePropertyNameV1,
  setup: number,
  current: number,
  constraintId: string,
  blend: RuntimeTrackBlendV1 = layer.blend,
): number {
  const present = presentNumberKeys(keys, field);
  const sampled = sampleContinuousKeysV1(
    present,
    layer.sampleTime,
    property,
    fieldValueGetterV1<Key & Record<Field, number>, Field>(field),
    continuousOptionsV1(false, layer.forceStepped),
  );
  if (sampled === NO_CONTRIBUTION_V1) return current;
  return blendScalar(current, setup, sampled, alphaForEntity(layer, "constraint", constraintId, String(field)), blend);
}

function sampleConstraintBoolean<
  Key extends { readonly time: number; readonly curve: RuntimeCurveV1 },
  Field extends keyof Key,
>(
  layer: RuntimeAnimationLayerV1,
  keys: readonly Key[],
  field: Field,
  setup: boolean,
  current: boolean,
  constraintId: string,
): boolean {
  const present = presentBooleanKeys(keys, field);
  const sampled = sampleDiscreteKeysV1(
    present,
    layer.sampleTime,
    fieldValueGetterV1<Key & Record<Field, boolean>, Field>(field),
  );
  if (sampled === NO_CONTRIBUTION_V1
    || alphaForEntity(layer, "constraint", constraintId, String(field)) < 0.5) return current;
  return sampled;
}

function animationSkinAlpha(layer: RuntimeAnimationLayerV1): number {
  return alphaFor(layer, "skin");
}

function resolveSkinAttachmentV1(
  data: RuntimeDataV1,
  skinIds: readonly string[],
  slotId: string,
  attachmentKey: string | null,
  scratch: SkinAttachmentResolutionScratchV1 | null = null,
): string | null {
  if (attachmentKey === null) return null;
  let cachedByKey: Map<string, string | null> | null = null;
  if (scratch !== null) {
    cachedByKey = scratch.bySlotId.get(slotId) ?? null;
    if (cachedByKey?.has(attachmentKey) === true) return cachedByKey.get(attachmentKey) ?? null;
    if (cachedByKey === null) {
      cachedByKey = new Map();
      scratch.bySlotId.set(slotId, cachedByKey);
    }
  }
  const directAttachment = samplingDataCacheV1(data).attachmentById.get(attachmentKey);
  let resolved: string | null = directAttachment?.slotId === slotId ? attachmentKey : null;
  const defaultSkin = data.document.skins[0];
  if (skinIds.length > 0
    && defaultSkin !== undefined
    && !skinIds.includes(defaultSkin.id)) {
    resolved = applySkinAttachmentMappingsV1(defaultSkin, slotId, attachmentKey, resolved);
  }
  for (let skinIndex = 0; skinIndex < skinIds.length; skinIndex += 1) {
    const skinId = skinIds[skinIndex];
    if (skinId === undefined) continue;
    const skin = data.skin(skinId);
    resolved = applySkinAttachmentMappingsV1(skin, slotId, attachmentKey, resolved);
  }
  cachedByKey?.set(attachmentKey, resolved);
  return resolved;
}

function applySkinAttachmentMappingsV1(
  skin: RuntimeSkinV1,
  slotId: string,
  attachmentKey: string,
  initial: string | null,
): string | null {
  let resolved = initial;
  for (let mappingIndex = 0; mappingIndex < skin.attachments.length; mappingIndex += 1) {
    const mapping = skin.attachments[mappingIndex];
    if (mapping === undefined || mapping.slotId !== slotId) continue;
    if (mapping.name !== null && mapping.name !== attachmentKey) continue;
    resolved = mapping.attachmentId;
  }
  return resolved;
}

function prepareSkinAttachmentResolutionScratchV1(
  scratch: SkinAttachmentResolutionScratchV1,
  skinIds: readonly string[],
): void {
  let matches = scratch.skinIds.length === skinIds.length;
  if (matches) {
    for (let index = 0; index < skinIds.length; index += 1) {
      if (scratch.skinIds[index] !== skinIds[index]) {
        matches = false;
        break;
      }
    }
  }
  if (matches) return;
  copyArrayV1(scratch.skinIds, skinIds);
  scratch.bySlotId.clear();
}

function applyBoneTimeline(
  layer: RuntimeAnimationLayerV1,
  timeline: RuntimeBoneTimelineV1,
  setup: RuntimeBoneV1,
  current: Mutable<RuntimeBoneV1>,
): void {
  if (timeline.inherit !== null) {
    const sampled = sampleDiscreteKeysV1(timeline.inherit, layer.sampleTime, inheritV1);
    if (sampled !== NO_CONTRIBUTION_V1 && alphaForEntity(layer, "bone", timeline.boneId, "inherit") >= 0.5) {
      current.transformMode = sampled as BoneTransformModeV1;
    }
  }
  applyMergedBoneScalar(layer, timeline, "x", timeline.translate, timeline.translateX, setup, current, false);
  applyMergedBoneScalar(layer, timeline, "y", timeline.translate, timeline.translateY, setup, current, false);
  if (timeline.rotate !== null) {
    const sampled = sampleContinuousKeysV1(
      timeline.rotate,
      layer.sampleTime,
      "rotation",
      angleV1,
      continuousOptionsV1(true, layer.forceStepped),
    );
    if (sampled !== NO_CONTRIBUTION_V1) {
      current.rotation = blendAngular(
        current.rotation,
        setup.rotation,
        sampled,
        alphaForEntity(layer, "bone", timeline.boneId, "rotation"),
        layer.blend,
      );
    }
  }
  applyMergedBoneScalar(layer, timeline, "scaleX", timeline.scale, timeline.scaleX, setup, current, false);
  applyMergedBoneScalar(layer, timeline, "scaleY", timeline.scale, timeline.scaleY, setup, current, false);
  applyMergedBoneScalar(layer, timeline, "shearX", timeline.shear, timeline.shearX, setup, current, true);
  applyMergedBoneScalar(layer, timeline, "shearY", timeline.shear, timeline.shearY, setup, current, true);
}

function applyMergedBoneScalar(
  layer: RuntimeAnimationLayerV1,
  timeline: RuntimeBoneTimelineV1,
  target: "x" | "y" | "scaleX" | "scaleY" | "shearX" | "shearY",
  paired: readonly { readonly time: number; readonly curve: RuntimeCurveV1; readonly x: number; readonly y: number }[] | null,
  scalar: readonly { readonly time: number; readonly curve: RuntimeCurveV1; readonly value: number }[] | null,
  setup: RuntimeBoneV1,
  current: Mutable<RuntimeBoneV1>,
  angular: boolean,
): void {
  const axis = target.endsWith("Y") || target === "y" ? "y" : "x";
  const curveProperty: RuntimeCurvePropertyNameV1 = target === "scaleX"
    ? "scale_x"
    : target === "scaleY"
      ? "scale_y"
      : axis;
  const keys = mergedAxisKeys(timeline, target, paired, scalar, axis, curveProperty);
  const sampled = sampleContinuousKeysV1(
    keys,
    layer.sampleTime,
    curveProperty,
    scalarValueV1,
    continuousOptionsV1(angular, layer.forceStepped),
  );
  if (sampled === NO_CONTRIBUTION_V1) return;
  const alpha = alphaForEntity(layer, "bone", timeline.boneId, target);
  current[target] = angular
    ? blendAngular(current[target], setup[target], sampled, alpha, layer.blend)
    : blendScalar(current[target], setup[target], sampled, alpha, layer.blend);
}

interface AxisKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
  readonly value: number;
  readonly source: 0 | 1;
  readonly declaration: number;
}

type MergedAxisKeyCacheV1 = Partial<Record<
  "x" | "y" | "scaleX" | "scaleY" | "shearX" | "shearY",
  readonly AxisKeyV1[]
>>;

const MERGED_AXIS_KEY_CACHE = new WeakMap<RuntimeBoneTimelineV1, MergedAxisKeyCacheV1>();

function mergedAxisKeys(
  timeline: RuntimeBoneTimelineV1,
  target: keyof MergedAxisKeyCacheV1,
  paired: readonly { readonly time: number; readonly curve: RuntimeCurveV1; readonly x: number; readonly y: number }[] | null,
  scalar: readonly { readonly time: number; readonly curve: RuntimeCurveV1; readonly value: number }[] | null,
  axis: "x" | "y",
  property: RuntimeCurvePropertyNameV1,
): readonly AxisKeyV1[] {
  let cached = MERGED_AXIS_KEY_CACHE.get(timeline);
  if (cached === undefined) {
    cached = {};
    MERGED_AXIS_KEY_CACHE.set(timeline, cached);
  }
  const existing = cached[target];
  if (existing !== undefined) return existing;
  const created = mergeAxisKeys(paired, scalar, axis, property);
  cached[target] = created;
  return created;
}

function mergeAxisKeys(
  paired: readonly { readonly time: number; readonly curve: RuntimeCurveV1; readonly x: number; readonly y: number }[] | null,
  scalar: readonly { readonly time: number; readonly curve: RuntimeCurveV1; readonly value: number }[] | null,
  axis: "x" | "y",
  property: RuntimeCurvePropertyNameV1,
): AxisKeyV1[] {
  const pairKeys = collapseWithinSource((paired ?? []).map((key, declaration): AxisKeyV1 => ({
    time: key.time,
    curve: selectPropertyCurveV1(key.curve, property),
    value: key[axis],
    source: 0,
    declaration,
  })));
  const scalarKeys = collapseWithinSource((scalar ?? []).map((key, declaration): AxisKeyV1 => ({
    time: key.time,
    curve: selectPropertyCurveV1(key.curve, property),
    value: key.value,
    source: 1,
    declaration,
  })));
  return [...pairKeys, ...scalarKeys].sort((left, right) =>
    left.time === right.time
      ? left.source - right.source || left.declaration - right.declaration
      : left.time - right.time,
  );
}

function collapseWithinSource(keys: readonly AxisKeyV1[]): AxisKeyV1[] {
  const result: AxisKeyV1[] = [];
  for (const key of keys) {
    const previous = result[result.length - 1];
    if (previous !== undefined && previous.time === key.time) result[result.length - 1] = key;
    else result.push(key);
  }
  return result;
}

function presentNumberKeys<
  Key extends { readonly time: number; readonly curve: RuntimeCurveV1 },
  Field extends keyof Key,
>(keys: readonly Key[], field: Field): readonly (Key & Record<Field, number>)[] {
  return presentTypedKeys(PRESENT_NUMBER_KEY_CACHE, keys, field, "number") as readonly (Key & Record<Field, number>)[];
}

function presentBooleanKeys<
  Key extends { readonly time: number; readonly curve: RuntimeCurveV1 },
  Field extends keyof Key,
>(keys: readonly Key[], field: Field): readonly (Key & Record<Field, boolean>)[] {
  return presentTypedKeys(PRESENT_BOOLEAN_KEY_CACHE, keys, field, "boolean") as readonly (Key & Record<Field, boolean>)[];
}

function presentTypedKeys<Key extends object>(
  cache: WeakMap<object, Map<PropertyKey, readonly unknown[]>>,
  keys: readonly Key[],
  field: keyof Key,
  expectedType: "number" | "boolean",
): readonly Key[] {
  let byField = cache.get(keys);
  if (byField === undefined) {
    byField = new Map<PropertyKey, readonly unknown[]>();
    cache.set(keys, byField);
  }
  const cached = byField.get(field);
  if (cached !== undefined) return cached as readonly Key[];
  const present: Key[] = [];
  for (const key of keys) {
    if (typeof key[field] === expectedType) present.push(key);
  }
  byField.set(field, present);
  return present;
}

function applySlotTimeline(
  layer: RuntimeAnimationLayerV1,
  timeline: RuntimeSlotTimelineV1,
  setup: RuntimeSlotV1,
  current: Mutable<RuntimeSlotV1>,
): void {
  if (layer.attachmentsAllowed && timeline.attachment !== null) {
    const sampled = sampleDiscreteKeysV1(timeline.attachment, layer.sampleTime, attachmentIdV1);
    if (sampled !== NO_CONTRIBUTION_V1
      && alphaForEntity(layer, "slot", timeline.slotId, "attachment") >= 0.5) {
      current.attachmentId = sampled;
    }
  }
  let sampledColorAlpha: number | typeof NO_CONTRIBUTION_V1 = NO_CONTRIBUTION_V1;
  if (timeline.color !== null) sampledColorAlpha = applySlotColor(layer, timeline, setup, current, timeline.color);
  if (timeline.color !== null || timeline.alpha !== null) {
    const hasSeparateAlpha = timeline.alpha !== null && timeline.alpha.length > 0;
    const sampledSeparateAlpha = sampleContinuousKeysV1(
      timeline.alpha ?? EMPTY_TIMELINE_KEYS_V1,
      layer.sampleTime,
      "alpha",
      alphaV1,
      continuousOptionsV1(false, layer.forceStepped),
    );
    const sampled = hasSeparateAlpha && sampledColorAlpha !== NO_CONTRIBUTION_V1
      ? (sampledSeparateAlpha === NO_CONTRIBUTION_V1 ? setup.alpha : sampledSeparateAlpha)
      : (sampledSeparateAlpha === NO_CONTRIBUTION_V1 ? sampledColorAlpha : sampledSeparateAlpha);
    if (sampled !== NO_CONTRIBUTION_V1) {
      current.alpha = clampUnit(blendScalar(
        current.alpha,
        setup.alpha,
        sampled,
        alphaForEntity(layer, "slot", timeline.slotId, "alpha"),
        layer.blend,
      ));
    }
  }
}

function applySlotColor(
  layer: RuntimeAnimationLayerV1,
  timeline: RuntimeSlotTimelineV1,
  setup: RuntimeSlotV1,
  current: Mutable<RuntimeSlotV1>,
  keys: readonly RuntimeSlotColorKeyV1[],
): number | typeof NO_CONTRIBUTION_V1 {
  const samples = slotColorSampleScratchV1(current);
  samples.length = SLOT_COLOR_PROPERTIES.length;
  if (!sampleContinuousComponentArrayKeysV1(
    keys,
    layer.sampleTime,
    slotColorComponentsV1,
    samples,
    SLOT_COLOR_PROPERTIES,
    layer.forceStepped,
  )) return NO_CONTRIBUTION_V1;
  const sampledRed = samples[0] ?? 0;
  const sampledGreen = samples[1] ?? 0;
  const sampledBlue = samples[2] ?? 0;
  const tintBytes = mutableRuntimeSlotTintBytesV1(current);
  const currentRed = tintBytes.lightRgb[0] / 255;
  const currentGreen = tintBytes.lightRgb[1] / 255;
  const currentBlue = tintBytes.lightRgb[2] / 255;
  const setupRed = colorUnitComponent(setup.color, 0);
  const setupGreen = colorUnitComponent(setup.color, 1);
  const setupBlue = colorUnitComponent(setup.color, 2);
  tintBytes.lightRgb[0] = colorUnitByteV1(blendColorComponent(currentRed, setupRed, sampledRed, alphaForEntity(layer, "slot", timeline.slotId, "color_r"), layer.blend));
  tintBytes.lightRgb[1] = colorUnitByteV1(blendColorComponent(currentGreen, setupGreen, sampledGreen, alphaForEntity(layer, "slot", timeline.slotId, "color_g"), layer.blend));
  tintBytes.lightRgb[2] = colorUnitByteV1(blendColorComponent(currentBlue, setupBlue, sampledBlue, alphaForEntity(layer, "slot", timeline.slotId, "color_b"), layer.blend));
  const anyDark = setup.darkColor !== null
    || tintBytes.darkRgb !== null
    || sampledOptionalDarkColorExistsV1(keys, layer.sampleTime);
  if (anyDark) {
    const sampledDarkRed = samples[4] ?? 0;
    const sampledDarkGreen = samples[5] ?? 0;
    const sampledDarkBlue = samples[6] ?? 0;
    const currentDarkRed = (tintBytes.darkRgb?.[0] ?? 0) / 255;
    const currentDarkGreen = (tintBytes.darkRgb?.[1] ?? 0) / 255;
    const currentDarkBlue = (tintBytes.darkRgb?.[2] ?? 0) / 255;
    const setupDarkRed = setup.darkColor === null ? 0 : colorUnitComponent(setup.darkColor, 0);
    const setupDarkGreen = setup.darkColor === null ? 0 : colorUnitComponent(setup.darkColor, 1);
    const setupDarkBlue = setup.darkColor === null ? 0 : colorUnitComponent(setup.darkColor, 2);
    const darkRgb = tintBytes.darkStorage;
    darkRgb[0] = colorUnitByteV1(blendColorComponent(currentDarkRed, setupDarkRed, sampledDarkRed, alphaForEntity(layer, "slot", timeline.slotId, "dark_r"), layer.blend));
    darkRgb[1] = colorUnitByteV1(blendColorComponent(currentDarkGreen, setupDarkGreen, sampledDarkGreen, alphaForEntity(layer, "slot", timeline.slotId, "dark_g"), layer.blend));
    darkRgb[2] = colorUnitByteV1(blendColorComponent(currentDarkBlue, setupDarkBlue, sampledDarkBlue, alphaForEntity(layer, "slot", timeline.slotId, "dark_b"), layer.blend));
    tintBytes.darkRgb = darkRgb;
  }
  return samples[3] ?? 0;
}

function slotColorSampleScratchV1(slot: RuntimeSlotV1): number[] {
  let result = SLOT_COLOR_SAMPLE_SCRATCH.get(slot);
  if (result === undefined) {
    result = new Array<number>(SLOT_COLOR_PROPERTIES.length);
    SLOT_COLOR_SAMPLE_SCRATCH.set(slot, result);
  }
  return result;
}

function slotColorComponentsV1(key: RuntimeSlotColorKeyV1): readonly number[] {
  const cached = SLOT_COLOR_COMPONENT_CACHE.get(key);
  if (cached !== undefined) return cached;
  const created = [
    colorUnitComponent(key.color, 0),
    colorUnitComponent(key.color, 1),
    colorUnitComponent(key.color, 2),
    key.alpha,
    key.darkColor === null ? 0 : colorUnitComponent(key.darkColor, 0),
    key.darkColor === null ? 0 : colorUnitComponent(key.darkColor, 1),
    key.darkColor === null ? 0 : colorUnitComponent(key.darkColor, 2),
  ];
  SLOT_COLOR_COMPONENT_CACHE.set(key, created);
  return created;
}

function sampledOptionalDarkColorExistsV1(keys: readonly RuntimeSlotColorKeyV1[], time: number): boolean {
  const sampleTime = f32(time);
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const key = keys[middle];
    if (key !== undefined && key.time <= sampleTime) low = middle + 1;
    else high = middle;
  }
  const currentIndex = low - 1;
  if (currentIndex < 0) return false;
  const current = keys[currentIndex];
  if (current === undefined) return false;
  if (sampleTime === current.time) return current.darkColor !== null;
  const next = keys[currentIndex + 1];
  return current.darkColor !== null || (next !== undefined && next.darkColor !== null);
}

function applyRegionTimeline(
  layer: RuntimeAnimationLayerV1,
  attachmentId: string,
  keys: readonly RegionTimelineSampleKeyV1[],
  setup: RuntimeRegionAttachmentV1,
  current: Mutable<RuntimeRegionAttachmentV1>,
): void {
  for (const [field, property, angular, value] of REGION_CHANNELS_V1) {
    const sampled = sampleContinuousKeysV1(
      keys,
      layer.sampleTime,
      property,
      value,
      continuousOptionsV1(angular, layer.forceStepped),
    );
    if (sampled === NO_CONTRIBUTION_V1) continue;
    const alpha = alphaForEntity(layer, "attachment", attachmentId, field);
    current[field] = angular
      ? blendAngular(current[field], setup[field], sampled, alpha, layer.blend)
      : blendScalar(current[field], setup[field], sampled, alpha, layer.blend);
  }
}

function applyDeformTimeline(
  layer: RuntimeAnimationLayerV1,
  timeline: RuntimeAttachmentTimelineV1,
  attachment: RuntimeAttachmentV1,
  state: MutableSamplingStateV1,
): void {
  if (timeline.deform === null || attachment.type === "region" || attachment.type === "point") return;
  const attachmentById = state.attachmentById;
  const source = resolveVertexSource(attachment, attachmentById);
  const ownerId = attachment.type === "mesh" ? resolveDeformOwnerId(attachment, attachmentById) : attachment.id;
  const componentCount = timeline.deform[0]?.vertices.length ?? 0;
  const scratch = deformSamplingScratchV1(state, timeline);
  const sampledValues = scratch.sampledValues;
  sampledValues.length = componentCount;
  if (!sampleContinuousArrayKeysV1(
    timeline.deform,
    layer.sampleTime,
    deformVerticesV1,
    sampledValues,
    "x",
    "y",
    layer.forceStepped,
  )) return;
  const canonicalValues = scratch.canonicalValues;
  const weighted = canonicalizeDeformV1(source, timeline.deformSpace, sampledValues, canonicalValues);
  const current = state.deformEpochByOwner.get(ownerId) === state.deformEpoch
    ? state.deforms.get(ownerId)?.values ?? null
    : null;
  const alpha = alphaForEntity(layer, "attachment", ownerId, "deform");
  let result = state.deformPool.get(ownerId);
  if (result === undefined) {
    result = { weighted, values: [] };
    state.deformPool.set(ownerId, result);
  }
  result.weighted = weighted;
  const values = result.values;
  values.length = canonicalValues.length;
  for (let index = 0; index < canonicalValues.length; index += 1) {
    const setupValue = weighted ? 0 : source.vertices[index] ?? 0;
    const currentValue = current?.[index] ?? setupValue;
    const sampled = canonicalValues[index] ?? 0;
    const base = layer.blend === "replace" ? currentValue : setupValue;
    values[index] = f32Add(currentValue, f32Mul(f32Sub(sampled, base), alpha));
  }
  state.deformEpochByOwner.set(ownerId, state.deformEpoch);
  state.deforms.set(ownerId, result);
}

function deformSamplingScratchV1(
  state: MutableSamplingStateV1,
  timeline: RuntimeAttachmentTimelineV1,
): RuntimeDeformSamplingScratchV1 {
  let result = state.deformScratchByTimeline.get(timeline);
  if (result === undefined) {
    result = { sampledValues: [], canonicalValues: [] };
    state.deformScratchByTimeline.set(timeline, result);
  }
  return result;
}

function applySequenceTimeline(
  layer: RuntimeAnimationLayerV1,
  timeline: RuntimeAttachmentTimelineV1,
  attachment: RuntimeAttachmentV1,
  sequenceIndices: Map<string, number>,
): void {
  if (timeline.sequence === null || (attachment.type !== "region" && attachment.type !== "mesh") || attachment.sequence === null) return;
  if (alphaForEntity(layer, "attachment", attachment.id, "sequence") < 0.5) return;
  const keySample = sampleDiscreteKeysV1(timeline.sequence, layer.sampleTime, identityV1);
  if (keySample === NO_CONTRIBUTION_V1) return;
  const count = attachment.sequence.imageIds.length;
  let index = keySample.index;
  if (keySample.mode !== "hold" && keySample.delay > 0) {
    index += Math.floor((layer.sampleTime - keySample.time) / keySample.delay + 0.00001);
    switch (keySample.mode) {
      case "once":
        index = Math.min(index, count - 1);
        break;
      case "loop":
        index %= count;
        break;
      case "pingpong":
        index = pingpongIndex(index, count);
        break;
      case "onceReverse":
        index = Math.max(0, count - 1 - index);
        break;
      case "loopReverse":
        index = count - 1 - (index % count);
        break;
      case "pingpongReverse": {
        const cycle = Math.max(0, count * 2 - 2);
        index = cycle === 0 ? 0 : pingpongIndex((index + count - 1) % cycle, count);
        break;
      }
    }
  }
  sequenceIndices.set(attachment.id, Math.min(Math.max(index, 0), count - 1));
}

type VertexAttachmentV1 = Extract<RuntimeAttachmentV1, { readonly vertices: readonly number[] }>;

function resolveVertexSource(
  attachment: VertexAttachmentV1,
  attachments: ReadonlyMap<string, RuntimeAttachmentV1>,
): VertexAttachmentV1 {
  let current = attachment;
  while (current.type === "mesh" && current.link !== null) {
    const parent = attachments.get(current.link.parentMeshId);
    if (parent === undefined || parent.type !== "mesh") return current;
    current = parent;
  }
  return current;
}

function resolveDeformOwnerId(
  attachment: Extract<RuntimeAttachmentV1, { readonly type: "mesh" }>,
  attachments: ReadonlyMap<string, RuntimeAttachmentV1>,
): string {
  let current = attachment;
  while (current.link !== null && current.link.inheritDeform) {
    const parent = attachments.get(current.link.parentMeshId);
    if (parent === undefined || parent.type !== "mesh") break;
    current = parent;
  }
  return current.id;
}

function canonicalizeDeformV1(
  source: VertexAttachmentV1,
  space: RuntimeAttachmentTimelineV1["deformSpace"],
  values: readonly number[],
  output: number[],
): boolean {
  if (source.weights.length === 0 || space === "weightedInfluenceOffsets") {
    copyArrayV1(output, values);
    return source.weights.length > 0;
  }
  let cursor = 0;
  for (let point = 0; point < source.weights.length; point += 1) {
    const dx = f32Sub(values[point * 2] ?? 0, source.vertices[point * 2] ?? 0);
    const dy = f32Sub(values[point * 2 + 1] ?? 0, source.vertices[point * 2 + 1] ?? 0);
    const influences = source.weights[point];
    if (influences === undefined) continue;
    for (const influence of influences) {
      if (influence.x !== null) {
        output[cursor] = dx;
        output[cursor + 1] = dy;
      } else {
        const inverse = source.bindInverses?.[influence.boneId];
        output[cursor] = inverse === undefined
          ? dx
          : f32Add(f32Mul(inverse.a, dx), f32Mul(inverse.c, dy));
        output[cursor + 1] = inverse === undefined
          ? dy
          : f32Add(f32Mul(inverse.b, dx), f32Mul(inverse.d, dy));
      }
      cursor += 2;
    }
  }
  output.length = cursor;
  return true;
}

function pingpongIndex(index: number, count: number): number {
  if (count <= 1) return 0;
  const cycle = count * 2 - 2;
  const value = index % cycle;
  return value < count ? value : cycle - value;
}

function blendScalar(current: number, setup: number, sampled: number, alpha: number, blend: RuntimeTrackBlendV1): number {
  if (alpha === 0) return current;
  const normalizedCurrent = Math.fround(current);
  const base = blend === "replace" ? normalizedCurrent : Math.fround(setup);
  const delta = Math.fround(Math.fround(sampled) - base);
  return Math.fround(normalizedCurrent + Math.fround(delta * Math.fround(alpha)));
}

function blendAngular(current: number, setup: number, sampled: number, alpha: number, blend: RuntimeTrackBlendV1): number {
  if (alpha === 0) return current;
  const normalizedCurrent = Math.fround(current);
  const base = blend === "replace" ? normalizedCurrent : Math.fround(setup);
  const delta = wrapDegreesV1(Math.fround(Math.fround(sampled) - base));
  return Math.fround(normalizedCurrent + Math.fround(delta * Math.fround(alpha)));
}

function blendColorComponent(current: number, setup: number, sampled: number, alpha: number, blend: RuntimeTrackBlendV1): number {
  const normalizedCurrent = Math.fround(current);
  const base = blend === "replace" ? normalizedCurrent : Math.fround(setup);
  const delta = Math.fround(Math.fround(sampled) - base);
  return clampUnit(Math.fround(normalizedCurrent + Math.fround(delta * Math.fround(alpha))));
}

function alphaFor(layer: RuntimeAnimationLayerV1, propertyId: string): number {
  const alpha = layer.propertyAlpha?.(propertyId, layer.alpha) ?? layer.alpha;
  const normalized = f32(alpha);
  return layer.unboundedAlpha === true ? normalized : clampUnit(normalized);
}

function alphaForEntity(
  layer: RuntimeAnimationLayerV1,
  namespace: "bone" | "slot" | "attachment" | "constraint",
  entityId: string,
  property: string,
): number {
  if (layer.propertyAlpha === undefined) return normalizedLayerAlpha(layer, layer.alpha);
  return normalizedLayerAlpha(layer, layer.propertyAlpha(`${namespace}:${entityId}:${property}`, layer.alpha));
}

function normalizedLayerAlpha(layer: RuntimeAnimationLayerV1, alpha: number): number {
  const normalized = f32(alpha);
  return layer.unboundedAlpha === true ? normalized : clampUnit(normalized);
}

function continuousOptionsV1(
  angular: boolean,
  forceStepped: boolean,
): { readonly angular?: boolean; readonly forceStepped?: boolean } {
  if (angular) return forceStepped ? ANGULAR_STEPPED_OPTIONS : ANGULAR_OPTIONS;
  return forceStepped ? CONTINUOUS_STEPPED_OPTIONS : CONTINUOUS_OPTIONS;
}

function fieldValueGetterV1<Key extends object, Field extends keyof Key>(
  field: Field,
): (key: Key) => Key[Field] {
  const cached = FIELD_VALUE_GETTERS.get(field);
  if (cached !== undefined) return cached as (key: Key) => Key[Field];
  const created = (key: Key): Key[Field] => key[field];
  FIELD_VALUE_GETTERS.set(field, created);
  return created;
}

function skinIdV1(key: { readonly skinId: string | null }): string | null {
  return key.skinId;
}

function slotIdsV1(key: { readonly slotIds: readonly string[] }): readonly string[] {
  return key.slotIds;
}

function inheritV1(key: { readonly inherit: BoneTransformModeV1 }): BoneTransformModeV1 {
  return key.inherit;
}

function angleV1(key: { readonly angle: number }): number {
  return key.angle;
}

function scalarValueV1(key: { readonly value: number }): number {
  return key.value;
}

function attachmentIdV1(key: { readonly attachmentId: string | null }): string | null {
  return key.attachmentId;
}

function alphaV1(key: { readonly alpha: number }): number {
  return key.alpha;
}

function deformVerticesV1(key: { readonly vertices: readonly number[] }): readonly number[] {
  return key.vertices;
}

function identityV1<T>(value: T): T {
  return value;
}

function clampUnit(value: number): number {
  return f32(Math.min(Math.max(value, 0), 1));
}

function colorUnitByteV1(component: number): number {
  return Math.floor(clampUnit(component) * 255 + 0.5);
}

function colorUnitComponent(value: string, component: number): number {
  const offset = 1 + component * 2;
  return (hexNibble(value.charCodeAt(offset)) * 16 + hexNibble(value.charCodeAt(offset + 1))) / 255;
}

function hexNibble(code: number): number {
  return code <= 57 ? code - 48 : (code & 0xdf) - 55;
}

function applyFolderOrder(
  current: string[],
  controlled: readonly string[],
  ordered: readonly string[],
): string[] {
  let controlledSet = FOLDER_CONTROLLED_SET_CACHE.get(controlled);
  if (controlledSet === undefined) {
    controlledSet = new Set(controlled);
    FOLDER_CONTROLLED_SET_CACHE.set(controlled, controlledSet);
  }
  let positionCount = 0;
  for (let index = 0; index < current.length; index += 1) {
    const slotId = current[index];
    if (slotId !== undefined && controlledSet.has(slotId)) positionCount += 1;
  }
  if (positionCount !== ordered.length) return current;
  let orderedIndex = 0;
  for (let index = 0; index < current.length; index += 1) {
    const slotId = current[index];
    if (slotId === undefined || !controlledSet.has(slotId)) continue;
    const orderedSlotId = ordered[orderedIndex];
    if (orderedSlotId !== undefined) current[index] = orderedSlotId;
    orderedIndex += 1;
  }
  return current;
}
