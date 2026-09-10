import type {
  RuntimeBoneV1,
  RuntimeConstraintV1,
  RuntimeIkConstraintV1,
  RuntimePathConstraintV1,
  RuntimePhysicsConstraintV1,
  RuntimeSliderConstraintV1,
  RuntimeSlotV1,
  RuntimeTransformConstraintV1,
  RuntimeTransformMappingV1,
  RuntimeTransformPropertyV1,
} from "../contracts.js";
import { RuntimeErrorV1 } from "../errors.js";
import { finiteF32 } from "../math/f32.js";

const OPERATION = "loadJson";
const TRANSFORM_PROPERTIES = ["rotate", "x", "y", "scaleX", "scaleY", "shearY"] as const;

export interface RuntimeConstraintParseContextV1 {
  readonly bones: readonly RuntimeBoneV1[];
  readonly slots: readonly RuntimeSlotV1[];
}

export function parseRuntimeConstraintsV1(
  input: unknown,
  context: RuntimeConstraintParseContextV1,
): RuntimeConstraintV1[] {
  const boneById = new Map(context.bones.map((bone) => [bone.id, bone]));
  const slotIds = new Set(context.slots.map((slot) => slot.id));
  return array(input, "constraints").map((value, index) => {
    const field = `constraints[${index}]`;
    const object = record(value, field);
    const type = enumValue(object.type, ["ik", "transform", "path", "physics", "slider"] as const, `${field}.type`);
    switch (type) {
      case "ik": return parseIk(object, field, boneById);
      case "transform": return parseTransform(object, field, boneById);
      case "path": return parsePath(object, field, boneById, slotIds);
      case "physics": return parsePhysics(object, field, boneById);
      case "slider": return parseSlider(object, field, boneById);
    }
  });
}

function parseIk(
  object: Record<string, unknown>,
  field: string,
  boneById: ReadonlyMap<string, RuntimeBoneV1>,
): RuntimeIkConstraintV1 {
  rejectUnknown(object, new Set([
    "type", "id", "name", "chainBoneIds", "targetBoneId", "target", "mix", "bendPositive",
    "compress", "stretch", "uniform", "softness", "iterations", "threshold",
  ]), field);
  const chainBoneIds = idArray(object.chainBoneIds, `${field}.chainBoneIds`);
  if (chainBoneIds.length === 0) fail("validationFailed", `${field}.chainBoneIds`, "IK chain must not be empty.");
  unique(chainBoneIds, `${field}.chainBoneIds`);
  resolveBones(chainBoneIds, `${field}.chainBoneIds`, boneById);
  for (let index = 1; index < chainBoneIds.length; index += 1) {
    const parentId = chainBoneIds[index - 1];
    const childId = chainBoneIds[index];
    if (childId === undefined || boneById.get(childId)?.parentId !== parentId) {
      fail("validationFailed", `${field}.chainBoneIds[${index}]`, "IK chain must be direct parent-to-child order.");
    }
  }
  const targetBoneId = nullableId(object.targetBoneId, `${field}.targetBoneId`);
  if (targetBoneId !== null && !boneById.has(targetBoneId)) {
    fail("missingReference", `${field}.targetBoneId`, `Unknown bone '${targetBoneId}'.`, targetBoneId);
  }
  const target = record(object.target, `${field}.target`);
  rejectUnknown(target, new Set(["x", "y"]), `${field}.target`);
  const uniform = object.uniform;
  if (uniform !== false && uniform !== true && uniform !== "volume") {
    fail("validationFailed", `${field}.uniform`, "IK uniform must be false, true, or 'volume'.");
  }
  return {
    type: "ik",
    id: nonEmptyString(object.id, `${field}.id`),
    name: nonEmptyString(object.name, `${field}.name`),
    chainBoneIds,
    targetBoneId,
    target: { x: finite(objectValue(target, "x", `${field}.target.x`), `${field}.target.x`), y: finite(objectValue(target, "y", `${field}.target.y`), `${field}.target.y`) },
    mix: unit(object.mix, `${field}.mix`),
    bendPositive: boolean(object.bendPositive, `${field}.bendPositive`),
    compress: boolean(object.compress, `${field}.compress`),
    stretch: boolean(object.stretch, `${field}.stretch`),
    uniform,
    softness: nonNegative(object.softness, `${field}.softness`),
    iterations: unsignedInteger(object.iterations, `${field}.iterations`, 1, 0xffffffff),
    threshold: nonNegative(object.threshold, `${field}.threshold`),
  };
}

function parseTransform(
  object: Record<string, unknown>,
  field: string,
  boneById: ReadonlyMap<string, RuntimeBoneV1>,
): RuntimeTransformConstraintV1 {
  rejectUnknown(object, new Set([
    "type", "id", "name", "boneIds", "targetBoneId", "local", "relative", "rotation", "x", "y",
    "scaleX", "scaleY", "shearY", "mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY",
    "mixShearY", "mapping",
  ]), field);
  const boneIds = idArray(object.boneIds, `${field}.boneIds`);
  if (boneIds.length === 0) fail("validationFailed", `${field}.boneIds`, "Transform constraint boneIds must not be empty.");
  unique(boneIds, `${field}.boneIds`);
  resolveBones(boneIds, `${field}.boneIds`, boneById);
  const targetBoneId = nonEmptyString(object.targetBoneId, `${field}.targetBoneId`);
  if (!boneById.has(targetBoneId)) fail("missingReference", `${field}.targetBoneId`, `Unknown bone '${targetBoneId}'.`, targetBoneId);
  for (const drivenId of boneIds) {
    let cursor: string | null = targetBoneId;
    while (cursor !== null) {
      if (cursor === drivenId) {
        fail("validationFailed", `${field}.targetBoneId`, "Transform target cannot be a driven bone or its descendant.", targetBoneId);
      }
      cursor = boneById.get(cursor)?.parentId ?? null;
    }
  }
  return {
    type: "transform",
    id: nonEmptyString(object.id, `${field}.id`),
    name: nonEmptyString(object.name, `${field}.name`),
    boneIds,
    targetBoneId,
    local: optionalBoolean(object.local, false, `${field}.local`),
    relative: optionalBoolean(object.relative, false, `${field}.relative`),
    rotation: optionalFinite(object.rotation, 0, `${field}.rotation`),
    x: optionalFinite(object.x, 0, `${field}.x`),
    y: optionalFinite(object.y, 0, `${field}.y`),
    scaleX: optionalFinite(object.scaleX, 0, `${field}.scaleX`),
    scaleY: optionalFinite(object.scaleY, 0, `${field}.scaleY`),
    shearY: optionalFinite(object.shearY, 0, `${field}.shearY`),
    mixRotate: optionalFinite(object.mixRotate, 1, `${field}.mixRotate`),
    mixX: optionalFinite(object.mixX, 1, `${field}.mixX`),
    mixY: optionalFinite(object.mixY, 1, `${field}.mixY`),
    mixScaleX: optionalFinite(object.mixScaleX, 1, `${field}.mixScaleX`),
    mixScaleY: optionalFinite(object.mixScaleY, 1, `${field}.mixScaleY`),
    mixShearY: optionalFinite(object.mixShearY, 1, `${field}.mixShearY`),
    mapping: object.mapping === undefined || object.mapping === null ? null : parseMapping(object.mapping, `${field}.mapping`),
  };
}

function parseMapping(value: unknown, field: string): RuntimeTransformMappingV1 {
  const object = record(value, field);
  rejectUnknown(object, new Set(["localSource", "localTarget", "clamp", "properties"]), field);
  const properties = array(object.properties ?? [], `${field}.properties`).map((item, index) => {
    const sourceField = `${field}.properties[${index}]`;
    const source = record(item, sourceField);
    rejectUnknown(source, new Set(["property", "offset", "targets"]), sourceField);
    const targets = array(source.targets, `${sourceField}.targets`).map((targetItem, targetIndex) => {
      const targetField = `${sourceField}.targets[${targetIndex}]`;
      const target = record(targetItem, targetField);
      rejectUnknown(target, new Set(["property", "offset", "max", "scale"]), targetField);
      return {
        property: enumValue(target.property, TRANSFORM_PROPERTIES, `${targetField}.property`) satisfies RuntimeTransformPropertyV1,
        offset: optionalFinite(target.offset, 0, `${targetField}.offset`),
        max: optionalFinite(target.max, 1, `${targetField}.max`),
        scale: optionalFinite(target.scale, 1, `${targetField}.scale`),
      };
    });
    if (targets.length === 0) fail("validationFailed", `${sourceField}.targets`, "Transform source mapping needs at least one target.");
    unique(targets.map((target) => target.property), `${sourceField}.targets`);
    return {
      property: enumValue(source.property, TRANSFORM_PROPERTIES, `${sourceField}.property`) satisfies RuntimeTransformPropertyV1,
      offset: optionalFinite(source.offset, 0, `${sourceField}.offset`),
      targets,
    };
  });
  unique(properties.map((property) => property.property), `${field}.properties`);
  return {
    localSource: optionalBoolean(object.localSource, false, `${field}.localSource`),
    localTarget: optionalBoolean(object.localTarget, false, `${field}.localTarget`),
    clamp: optionalBoolean(object.clamp, false, `${field}.clamp`),
    properties,
  };
}

function parsePath(
  object: Record<string, unknown>,
  field: string,
  boneById: ReadonlyMap<string, RuntimeBoneV1>,
  slotIds: ReadonlySet<string>,
): RuntimePathConstraintV1 {
  rejectUnknown(object, new Set([
    "type", "id", "name", "boneIds", "targetSlotId", "positionMode", "spacingMode", "rotateMode",
    "rotation", "position", "spacing", "mixRotate", "mixX", "mixY",
  ]), field);
  const boneIds = idArray(object.boneIds, `${field}.boneIds`);
  if (boneIds.length === 0) fail("validationFailed", `${field}.boneIds`, "Path constraint boneIds must not be empty.");
  unique(boneIds, `${field}.boneIds`);
  resolveBones(boneIds, `${field}.boneIds`, boneById);
  const targetSlotId = nonEmptyString(object.targetSlotId, `${field}.targetSlotId`);
  if (!slotIds.has(targetSlotId)) fail("missingReference", `${field}.targetSlotId`, `Unknown slot '${targetSlotId}'.`, targetSlotId);
  return {
    type: "path",
    id: nonEmptyString(object.id, `${field}.id`),
    name: nonEmptyString(object.name, `${field}.name`),
    boneIds,
    targetSlotId,
    positionMode: enumValue(object.positionMode, ["fixed", "percent"] as const, `${field}.positionMode`),
    spacingMode: enumValue(object.spacingMode, ["length", "fixed", "percent", "proportional"] as const, `${field}.spacingMode`),
    rotateMode: enumValue(object.rotateMode, ["tangent", "chain", "chainScale"] as const, `${field}.rotateMode`),
    rotation: finite(object.rotation, `${field}.rotation`),
    position: finite(object.position, `${field}.position`),
    spacing: finite(object.spacing, `${field}.spacing`),
    mixRotate: unit(object.mixRotate, `${field}.mixRotate`),
    mixX: unit(object.mixX, `${field}.mixX`),
    mixY: unit(object.mixY, `${field}.mixY`),
  };
}

function parsePhysics(
  object: Record<string, unknown>,
  field: string,
  boneById: ReadonlyMap<string, RuntimeBoneV1>,
): RuntimePhysicsConstraintV1 {
  rejectUnknown(object, new Set([
    "type", "id", "name", "boneId", "x", "y", "rotate", "scaleX", "scaleYMode", "shearX", "limit",
    "fps", "inertia", "strength", "damping", "mass", "wind", "gravity", "mix", "inertiaGlobal",
    "strengthGlobal", "dampingGlobal", "massGlobal", "windGlobal", "gravityGlobal", "mixGlobal",
  ]), field);
  const boneId = nonEmptyString(object.boneId, `${field}.boneId`);
  if (!boneById.has(boneId)) fail("missingReference", `${field}.boneId`, `Unknown bone '${boneId}'.`, boneId);
  return {
    type: "physics",
    id: nonEmptyString(object.id, `${field}.id`),
    name: nonEmptyString(object.name, `${field}.name`),
    boneId,
    x: optionalUnit(object.x, 0, `${field}.x`),
    y: optionalUnit(object.y, 0, `${field}.y`),
    rotate: optionalUnit(object.rotate, 0, `${field}.rotate`),
    scaleX: optionalUnit(object.scaleX, 0, `${field}.scaleX`),
    scaleYMode: object.scaleYMode === undefined
      ? "none"
      : enumValue(object.scaleYMode, ["none", "uniform", "volume"] as const, `${field}.scaleYMode`),
    shearX: optionalUnit(object.shearX, 0, `${field}.shearX`),
    limit: object.limit === undefined ? 5000 : nonNegative(object.limit, `${field}.limit`),
    fps: object.fps === undefined ? 60 : unsignedInteger(object.fps, `${field}.fps`, 1, 0xffffffff),
    inertia: optionalUnit(object.inertia, 1, `${field}.inertia`),
    strength: object.strength === undefined ? 100 : nonNegative(object.strength, `${field}.strength`),
    damping: optionalUnit(object.damping, 1, `${field}.damping`),
    mass: object.mass === undefined ? 1 : positive(object.mass, `${field}.mass`),
    wind: optionalFinite(object.wind, 0, `${field}.wind`),
    gravity: optionalFinite(object.gravity, 0, `${field}.gravity`),
    mix: optionalUnit(object.mix, 1, `${field}.mix`),
    inertiaGlobal: optionalBoolean(object.inertiaGlobal, false, `${field}.inertiaGlobal`),
    strengthGlobal: optionalBoolean(object.strengthGlobal, false, `${field}.strengthGlobal`),
    dampingGlobal: optionalBoolean(object.dampingGlobal, false, `${field}.dampingGlobal`),
    massGlobal: optionalBoolean(object.massGlobal, false, `${field}.massGlobal`),
    windGlobal: optionalBoolean(object.windGlobal, false, `${field}.windGlobal`),
    gravityGlobal: optionalBoolean(object.gravityGlobal, false, `${field}.gravityGlobal`),
    mixGlobal: optionalBoolean(object.mixGlobal, false, `${field}.mixGlobal`),
  };
}

function parseSlider(
  object: Record<string, unknown>,
  field: string,
  boneById: ReadonlyMap<string, RuntimeBoneV1>,
): RuntimeSliderConstraintV1 {
  rejectUnknown(object, new Set([
    "type", "id", "name", "animationId", "looping", "additive", "sourceBoneId", "sourceProperty",
    "sourceOffset", "timeOffset", "timeScale", "rangeMax", "local", "time", "mix",
  ]), field);
  const sourceBoneId = object.sourceBoneId === undefined ? null : nullableId(object.sourceBoneId, `${field}.sourceBoneId`);
  if (sourceBoneId !== null && !boneById.has(sourceBoneId)) {
    fail("missingReference", `${field}.sourceBoneId`, `Unknown bone '${sourceBoneId}'.`, sourceBoneId);
  }
  return {
    type: "slider",
    id: nonEmptyString(object.id, `${field}.id`),
    name: nonEmptyString(object.name, `${field}.name`),
    animationId: nonEmptyString(object.animationId, `${field}.animationId`),
    looping: optionalBoolean(object.looping, false, `${field}.looping`),
    additive: optionalBoolean(object.additive, false, `${field}.additive`),
    sourceBoneId,
    sourceProperty: object.sourceProperty === undefined
      ? "rotate"
      : enumValue(object.sourceProperty, TRANSFORM_PROPERTIES, `${field}.sourceProperty`),
    sourceOffset: optionalFinite(object.sourceOffset, 0, `${field}.sourceOffset`),
    timeOffset: optionalFinite(object.timeOffset, 0, `${field}.timeOffset`),
    timeScale: optionalFinite(object.timeScale, 1, `${field}.timeScale`),
    rangeMax: object.rangeMax === undefined ? 0 : nonNegative(object.rangeMax, `${field}.rangeMax`),
    local: optionalBoolean(object.local, false, `${field}.local`),
    time: optionalFinite(object.time, 0, `${field}.time`),
    mix: optionalFinite(object.mix, 1, `${field}.mix`),
  };
}

function resolveBones(ids: readonly string[], field: string, bones: ReadonlyMap<string, RuntimeBoneV1>): void {
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (id !== undefined && !bones.has(id)) fail("missingReference", `${field}[${index}]`, `Unknown bone '${id}'.`, id);
  }
}

function objectValue(object: Record<string, unknown>, key: string, field: string): unknown {
  if (!(key in object)) fail("validationFailed", field, `Missing required field '${key}'.`);
  return object[key];
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail("validationFailed", field, `Expected array at '${field}'.`);
  return value;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("validationFailed", field, `Expected object at '${field}'.`);
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail("malformedInput", `${field}.${key}`, `Unknown field '${key}'.`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) fail("validationFailed", field, `Expected non-empty NUL-free string at '${field}'.`);
  return value;
}

function nullableId(value: unknown, field: string): string | null {
  return value === null ? null : nonEmptyString(value, field);
}

function idArray(value: unknown, field: string): string[] {
  return array(value, field).map((item, index) => nonEmptyString(item, `${field}[${index}]`));
}

function unique(values: readonly string[], field: string): void {
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value !== undefined && seen.has(value)) fail("validationFailed", `${field}[${index}]`, `Duplicate ID '${value}'.`, value);
    if (value !== undefined) seen.add(value);
  }
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail("validationFailed", field, `Expected boolean at '${field}'.`);
  return value;
}

function optionalBoolean(value: unknown, fallback: boolean, field: string): boolean {
  return value === undefined ? fallback : boolean(value, field);
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number") fail("validationFailed", field, `Expected number at '${field}'.`);
  if (!Number.isFinite(value)) fail("nonFinite", field, `Expected finite number at '${field}'.`);
  try { return finiteF32(value); } catch (error) {
    throw new RuntimeErrorV1("nonFinite", OPERATION, `Number at '${field}' is outside binary32 range.`, { field, cause: error });
  }
}

function optionalFinite(value: unknown, fallback: number, field: string): number {
  return value === undefined ? fallback : finite(value, field);
}

function nonNegative(value: unknown, field: string): number {
  const result = finite(value, field);
  if (result < 0) fail("validationFailed", field, `Expected non-negative number at '${field}'.`);
  return result;
}

function positive(value: unknown, field: string): number {
  const result = finite(value, field);
  if (result <= 0) fail("validationFailed", field, `Expected positive number at '${field}'.`);
  return result;
}

function unit(value: unknown, field: string): number {
  const result = finite(value, field);
  if (result < 0 || result > 1) fail("validationFailed", field, `Expected number in [0,1] at '${field}'.`);
  return result;
}

function optionalUnit(value: unknown, fallback: number, field: string): number {
  return value === undefined ? fallback : unit(value, field);
}

function unsignedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    fail("validationFailed", field, `Expected integer in [${minimum},${maximum}] at '${field}'.`);
  }
  return value;
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value as T[number])) {
    fail("validationFailed", field, `Expected one of ${allowed.join(", ")} at '${field}'.`);
  }
  return value as T[number];
}

function fail(
  name: "validationFailed" | "missingReference" | "malformedInput" | "nonFinite",
  field: string,
  message: string,
  entityId?: string,
): never {
  throw new RuntimeErrorV1(name, OPERATION, message, { field, entityId: entityId ?? null });
}
