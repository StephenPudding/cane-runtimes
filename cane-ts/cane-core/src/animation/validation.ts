import type {
  BoneTransformModeV1,
  RuntimeAnimationV1,
  RuntimeAttachmentV1,
  RuntimeAttachmentTimelineV1,
  RuntimeBoneTimelineV1,
  RuntimeCurvePropertyNameV1,
  RuntimeCurveV1,
  RuntimeConstraintTimelineV1,
  RuntimeConstraintV1,
  RuntimeDrawOrderFolderV1,
  RuntimeDrawOrderKeyV1,
  RuntimeEventDefinitionV1,
  RuntimeEventKeyV1,
  RuntimeSimpleCurveV1,
  RuntimeSkinKeyV1,
  RuntimeSlotTimelineV1,
  RuntimeSlotV1,
} from "../contracts.js";
import { RuntimeErrorV1 } from "../errors.js";
import { finiteF32 } from "../math/f32.js";
import { isRuntimeColorV1 } from "../render/tint.js";

const OPERATION = "loadJson";
const TRANSFORM_MODES = [
  "normal",
  "onlyTranslation",
  "noRotationOrReflection",
  "noScale",
  "noScaleOrReflection",
] as const;
const CURVE_PROPERTIES: readonly RuntimeCurvePropertyNameV1[] = [
  "x", "y", "rotation", "scale_x", "scale_y",
  "color_r", "color_g", "color_b", "dark_r", "dark_g", "dark_b", "alpha",
  "target_x", "target_y", "mix", "softness",
  "mix_rotate", "mix_x", "mix_y", "mix_scale_x", "mix_scale_y", "mix_shear_y",
  "position", "spacing", "inertia", "strength", "damping", "mass", "wind", "gravity",
  "slider_time",
];
const CURVE_PROPERTY_SET = new Set<string>(CURVE_PROPERTIES);

export interface RuntimeAnimationParseContextV1 {
  readonly boneIds: ReadonlySet<string>;
  readonly slots: readonly RuntimeSlotV1[];
  readonly attachments: readonly RuntimeAttachmentV1[];
  readonly events: readonly RuntimeEventDefinitionV1[];
  readonly audioIds: ReadonlySet<string>;
  readonly skinIds: ReadonlySet<string>;
  readonly skinPlaceholdersBySlot: ReadonlyMap<string, ReadonlySet<string>>;
  readonly constraints: readonly RuntimeConstraintV1[];
}

export function parseRuntimeEventDefinitionsV1(
  input: unknown,
  audioIds: ReadonlySet<string>,
): RuntimeEventDefinitionV1[] {
  const values = array(input, "events");
  return values.map((value, index) => {
    const field = `events[${index}]`;
    const object = record(value, field);
    rejectUnknown(object, new Set([
      "id", "name", "integerValue", "stringValue", "numberValue", "audioId", "volume", "balance",
    ]), field);
    const audioId = nullableId(object.audioId, `${field}.audioId`);
    if (audioId !== null && !audioIds.has(audioId)) {
      fail("missingReference", `${field}.audioId`, `Unknown audio '${audioId}'.`, audioId);
    }
    return {
      id: nonEmptyString(object.id, `${field}.id`),
      name: nonEmptyString(object.name, `${field}.name`),
      integerValue: optionalInteger(object.integerValue, `${field}.integerValue`),
      stringValue: optionalString(object.stringValue, `${field}.stringValue`),
      numberValue: optionalFinite(object.numberValue, `${field}.numberValue`),
      audioId,
      volume: object.volume === undefined ? 1 : unit(object.volume, `${field}.volume`),
      balance: object.balance === undefined ? 0 : ranged(object.balance, `${field}.balance`, -1, 1),
    };
  });
}

export function parseRuntimeAnimationsV1(
  input: unknown,
  context: RuntimeAnimationParseContextV1,
): RuntimeAnimationV1[] {
  const slotById = new Map(context.slots.map((slot) => [slot.id, slot]));
  const attachmentById = new Map(context.attachments.map((attachment) => [attachment.id, attachment]));
  const eventById = new Map(context.events.map((event) => [event.id, event]));
  const values = array(input, "animations");
  return values.map((value, index) => parseAnimation(value, `animations[${index}]`, {
    ...context,
    slotById,
    attachmentById,
    eventById,
  }));
}

interface ResolvedContextV1 extends RuntimeAnimationParseContextV1 {
  readonly slotById: ReadonlyMap<string, RuntimeSlotV1>;
  readonly attachmentById: ReadonlyMap<string, RuntimeAttachmentV1>;
  readonly eventById: ReadonlyMap<string, RuntimeEventDefinitionV1>;
}

function parseAnimation(value: unknown, field: string, context: ResolvedContextV1): RuntimeAnimationV1 {
  const object = record(value, field);
  rejectUnknown(object, new Set([
    "id", "name", "fps", "duration", "boneTimelines", "slotTimelines", "attachmentTimelines",
    "constraintTimelines", "events", "drawOrder", "drawOrderFolders", "skins",
  ]), field);
  const duration = nonNegative(object.duration, `${field}.duration`);
  const boneTimelines = array(object.boneTimelines, `${field}.boneTimelines`).map((item, index) =>
    parseBoneTimeline(item, `${field}.boneTimelines[${index}]`, context.boneIds),
  );
  const slotTimelines = array(object.slotTimelines, `${field}.slotTimelines`).map((item, index) =>
    parseSlotTimeline(item, `${field}.slotTimelines[${index}]`, context),
  );
  const attachmentTimelines = array(object.attachmentTimelines, `${field}.attachmentTimelines`).map(
    (item, index) => parseAttachmentTimeline(item, `${field}.attachmentTimelines[${index}]`, context),
  );
  const constraintTimelines = array(object.constraintTimelines, `${field}.constraintTimelines`).map(
    (item, index) => parseConstraintTimeline(item, `${field}.constraintTimelines[${index}]`, context.constraints),
  );
  const skins = parseSkinKeys(object.skins, `${field}.skins`, context.skinIds);
  const events = array(object.events, `${field}.events`).map((item, index) =>
    parseEventKey(item, `${field}.events[${index}]`, context),
  );
  const drawOrder = parseDrawOrderKeys(object.drawOrder, `${field}.drawOrder`, context.slots);
  const drawOrderFolders = array(object.drawOrderFolders, `${field}.drawOrderFolders`).map((item, index) =>
    parseDrawOrderFolder(item, `${field}.drawOrderFolders[${index}]`, context.slots),
  );

  validateTimelineUniqueness(boneTimelines, slotTimelines, attachmentTimelines, constraintTimelines, field);
  let latestTime = 0;
  for (const timeline of boneTimelines) latestTime = Math.max(latestTime, latestBoneTime(timeline));
  for (const timeline of slotTimelines) latestTime = Math.max(latestTime, latestSlotTime(timeline));
  for (const timeline of attachmentTimelines) {
    latestTime = Math.max(
      latestTime,
      lastTime(timeline.region),
      lastTime(timeline.deform),
      lastTime(timeline.sequence),
    );
  }
  for (const timeline of constraintTimelines) latestTime = Math.max(latestTime, lastTime(timeline.keys));
  latestTime = Math.max(latestTime, lastTime(events), lastTime(drawOrder), lastTime(skins));
  for (const folder of drawOrderFolders) latestTime = Math.max(latestTime, lastTime(folder.keys));
  if (duration < latestTime) {
    fail("validationFailed", `${field}.duration`, "Animation duration must be at least its latest key time.");
  }
  return {
    id: nonEmptyString(object.id, `${field}.id`),
    name: nonEmptyString(object.name, `${field}.name`),
    fps: positive(object.fps, `${field}.fps`),
    duration,
    boneTimelines,
    slotTimelines,
    attachmentTimelines,
    constraintTimelines,
    events,
    drawOrder,
    drawOrderFolders,
    skins,
  };
}

function parseConstraintTimeline(
  value: unknown,
  field: string,
  constraints: readonly RuntimeConstraintV1[],
): RuntimeConstraintTimelineV1 {
  const object = record(value, field);
  rejectUnknown(object, new Set(["type", "constraintId", "keys"]), field);
  const type = enumeration(object.type, ["ik", "transform", "path", "physics", "slider"] as const, `${field}.type`);
  const constraintId = nonEmptyString(object.constraintId, `${field}.constraintId`);
  if (constraintId === "*") {
    if (type !== "physics") fail("validationFailed", `${field}.constraintId`, "Only Physics timelines may use wildcard constraintId '*'.");
  } else {
    const constraint = constraints.find((candidate) => candidate.id === constraintId);
    if (constraint === undefined) fail("missingReference", `${field}.constraintId`, `Unknown constraint '${constraintId}'.`, constraintId);
    if (constraint.type !== type) fail("validationFailed", `${field}.type`, "Constraint timeline type does not match its setup constraint.", constraintId);
  }
  const keysValue = object.keys;
  switch (type) {
    case "ik": return {
      type,
      constraintId,
      keys: keyArray(keysValue, `${field}.keys`, (item, keyField) => {
        const key = timedCurveRecord(item, keyField, new Set([
          "time", "curve", "targetX", "targetY", "mix", "bendPositive", "compress", "stretch", "softness",
        ]));
        return {
          time: key.time,
          curve: key.curve,
          targetX: optionalFinite(key.object.targetX, `${keyField}.targetX`),
          targetY: optionalFinite(key.object.targetY, `${keyField}.targetY`),
          mix: optionalUnit(key.object.mix, `${keyField}.mix`),
          bendPositive: optionalBooleanValue(key.object.bendPositive, `${keyField}.bendPositive`),
          compress: optionalBooleanValue(key.object.compress, `${keyField}.compress`),
          stretch: optionalBooleanValue(key.object.stretch, `${keyField}.stretch`),
          softness: optionalNonNegative(key.object.softness, `${keyField}.softness`),
        };
      }),
    };
    case "transform": return {
      type,
      constraintId,
      keys: keyArray(keysValue, `${field}.keys`, (item, keyField) => {
        const key = timedCurveRecord(item, keyField, new Set([
          "time", "curve", "mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY",
        ]));
        return {
          time: key.time,
          curve: key.curve,
          mixRotate: optionalFinite(key.object.mixRotate, `${keyField}.mixRotate`),
          mixX: optionalFinite(key.object.mixX, `${keyField}.mixX`),
          mixY: optionalFinite(key.object.mixY, `${keyField}.mixY`),
          mixScaleX: optionalFinite(key.object.mixScaleX, `${keyField}.mixScaleX`),
          mixScaleY: optionalFinite(key.object.mixScaleY, `${keyField}.mixScaleY`),
          mixShearY: optionalFinite(key.object.mixShearY, `${keyField}.mixShearY`),
        };
      }),
    };
    case "path": return {
      type,
      constraintId,
      keys: keyArray(keysValue, `${field}.keys`, (item, keyField) => {
        const key = timedCurveRecord(item, keyField, new Set([
          "time", "curve", "position", "spacing", "mixRotate", "mixX", "mixY",
        ]));
        return {
          time: key.time,
          curve: key.curve,
          position: optionalFinite(key.object.position, `${keyField}.position`),
          spacing: optionalFinite(key.object.spacing, `${keyField}.spacing`),
          mixRotate: optionalUnit(key.object.mixRotate, `${keyField}.mixRotate`),
          mixX: optionalUnit(key.object.mixX, `${keyField}.mixX`),
          mixY: optionalUnit(key.object.mixY, `${keyField}.mixY`),
        };
      }),
    };
    case "physics": return {
      type,
      constraintId,
      keys: keyArray(keysValue, `${field}.keys`, (item, keyField) => {
        const key = timedCurveRecord(item, keyField, new Set([
          "time", "curve", "mix", "inertia", "strength", "damping", "mass", "wind", "gravity", "reset",
        ]));
        return {
          time: key.time,
          curve: key.curve,
          mix: optionalUnit(key.object.mix, `${keyField}.mix`),
          inertia: optionalUnit(key.object.inertia, `${keyField}.inertia`),
          strength: optionalNonNegative(key.object.strength, `${keyField}.strength`),
          damping: optionalUnit(key.object.damping, `${keyField}.damping`),
          mass: optionalPositive(key.object.mass, `${keyField}.mass`),
          wind: optionalFinite(key.object.wind, `${keyField}.wind`),
          gravity: optionalFinite(key.object.gravity, `${keyField}.gravity`),
          reset: optionalBooleanValue(key.object.reset, `${keyField}.reset`),
        };
      }),
    };
    case "slider": return {
      type,
      constraintId,
      keys: keyArray(keysValue, `${field}.keys`, (item, keyField) => {
        const key = timedCurveRecord(item, keyField, new Set(["time", "curve", "sliderTime", "mix"]));
        return {
          time: key.time,
          curve: key.curve,
          sliderTime: optionalFinite(key.object.sliderTime, `${keyField}.sliderTime`),
          mix: optionalFinite(key.object.mix, `${keyField}.mix`),
        };
      }),
    };
  }
}

function parseSkinKeys(
  value: unknown,
  field: string,
  skinIds: ReadonlySet<string>,
): RuntimeSkinKeyV1[] {
  return keyArray(value, field, (item, keyField) => {
    const key = timedCurveRecord(item, keyField, new Set(["time", "curve", "skinId"]));
    const skinId = nullableId(key.object.skinId, `${keyField}.skinId`);
    if (skinId !== null && !skinIds.has(skinId)) {
      fail("missingReference", `${keyField}.skinId`, `Unknown skin '${skinId}'.`, skinId);
    }
    return { time: key.time, curve: key.curve, skinId };
  });
}

function parseBoneTimeline(
  value: unknown,
  field: string,
  boneIds: ReadonlySet<string>,
): RuntimeBoneTimelineV1 {
  const object = record(value, field);
  rejectUnknown(object, new Set([
    "boneId", "translate", "translateX", "translateY", "rotate", "scale", "scaleX", "scaleY",
    "shear", "shearX", "shearY", "inherit",
  ]), field);
  const boneId = nonEmptyString(object.boneId, `${field}.boneId`);
  if (!boneIds.has(boneId)) fail("missingReference", `${field}.boneId`, `Unknown bone '${boneId}'.`, boneId);
  return {
    boneId,
    translate: optionalKeyArray(object.translate, `${field}.translate`, (item, keyField) => {
      const key = timedCurveRecord(item, keyField, new Set(["time", "curve", "x", "y"]));
      return { time: key.time, curve: key.curve, x: finite(key.object.x, `${keyField}.x`), y: finite(key.object.y, `${keyField}.y`) };
    }),
    translateX: parseScalarKeys(object.translateX, `${field}.translateX`),
    translateY: parseScalarKeys(object.translateY, `${field}.translateY`),
    rotate: optionalKeyArray(object.rotate, `${field}.rotate`, (item, keyField) => {
      const key = timedCurveRecord(item, keyField, new Set(["time", "curve", "angle"]));
      return { time: key.time, curve: key.curve, angle: finite(key.object.angle, `${keyField}.angle`) };
    }),
    scale: parsePairKeys(object.scale, `${field}.scale`),
    scaleX: parseScalarKeys(object.scaleX, `${field}.scaleX`),
    scaleY: parseScalarKeys(object.scaleY, `${field}.scaleY`),
    shear: parsePairKeys(object.shear, `${field}.shear`),
    shearX: parseScalarKeys(object.shearX, `${field}.shearX`),
    shearY: parseScalarKeys(object.shearY, `${field}.shearY`),
    inherit: optionalKeyArray(object.inherit, `${field}.inherit`, (item, keyField) => {
      const key = record(item, keyField);
      rejectUnknown(key, new Set(["time", "inherit"]), keyField);
      return {
        time: nonNegative(key.time, `${keyField}.time`),
        inherit: enumeration(key.inherit, TRANSFORM_MODES, `${keyField}.inherit`) satisfies BoneTransformModeV1,
      };
    }),
  };
}

function parseSlotTimeline(value: unknown, field: string, context: ResolvedContextV1): RuntimeSlotTimelineV1 {
  const object = record(value, field);
  rejectUnknown(object, new Set(["slotId", "attachment", "color", "alpha"]), field);
  const slotId = nonEmptyString(object.slotId, `${field}.slotId`);
  if (!context.slotById.has(slotId)) fail("missingReference", `${field}.slotId`, `Unknown slot '${slotId}'.`, slotId);
  return {
    slotId,
    attachment: optionalKeyArray(object.attachment, `${field}.attachment`, (item, keyField) => {
      const key = timedCurveRecord(item, keyField, new Set(["time", "curve", "attachmentId"]));
      const attachmentId = nullableId(key.object.attachmentId, `${keyField}.attachmentId`);
      if (attachmentId !== null) {
        const attachment = context.attachmentById.get(attachmentId);
        if (attachment === undefined) {
          if (context.skinPlaceholdersBySlot.get(slotId)?.has(attachmentId) !== true) {
            fail(
              "missingReference",
              `${keyField}.attachmentId`,
              `Unknown attachment or skin placeholder '${attachmentId}'.`,
              attachmentId,
            );
          }
        } else if (attachment.slotId !== slotId) {
          fail("validationFailed", `${keyField}.attachmentId`, "Timeline attachment belongs to a different slot.", attachmentId);
        }
      }
      return { time: key.time, curve: key.curve, attachmentId };
    }),
    color: optionalKeyArray(object.color, `${field}.color`, (item, keyField) => {
      const key = timedCurveRecord(item, keyField, new Set(["time", "curve", "color", "alpha", "darkColor"]));
      return {
        time: key.time,
        curve: key.curve,
        color: color(key.object.color, `${keyField}.color`),
        alpha: unit(key.object.alpha, `${keyField}.alpha`),
        darkColor: key.object.darkColor === null ? null : color(key.object.darkColor, `${keyField}.darkColor`),
      };
    }),
    alpha: optionalKeyArray(object.alpha, `${field}.alpha`, (item, keyField) => {
      const key = timedCurveRecord(item, keyField, new Set(["time", "curve", "alpha"]));
      return { time: key.time, curve: key.curve, alpha: unit(key.object.alpha, `${keyField}.alpha`) };
    }),
  };
}

function parseAttachmentTimeline(
  value: unknown,
  field: string,
  context: ResolvedContextV1,
): RuntimeAttachmentTimelineV1 {
  const object = record(value, field);
  rejectUnknown(object, new Set(["attachmentId", "region", "deform", "deformSpace", "sequence"]), field);
  const attachmentId = nonEmptyString(object.attachmentId, `${field}.attachmentId`);
  const attachment = context.attachmentById.get(attachmentId);
  if (attachment === undefined) fail("missingReference", `${field}.attachmentId`, `Unknown attachment '${attachmentId}'.`, attachmentId);
  const deformSpace = object.deformSpace === undefined || object.deformSpace === null
    ? "vertexPositions"
    : enumeration(
        object.deformSpace,
        ["vertexPositions", "weightedInfluenceOffsets"] as const,
        `${field}.deformSpace`,
      );
  const region = optionalKeyArray(object.region, `${field}.region`, (item, keyField) => {
    const key = timedCurveRecord(item, keyField, new Set([
      "time", "curve", "x", "y", "rotation", "scaleX", "scaleY",
    ]));
    const scaleX = finite(key.object.scaleX, `${keyField}.scaleX`);
    const scaleY = finite(key.object.scaleY, `${keyField}.scaleY`);
    if (scaleX === 0 || scaleY === 0) fail("validationFailed", keyField, "Region timeline scales must be non-zero.");
    return {
      time: key.time,
      curve: key.curve,
      x: finite(key.object.x, `${keyField}.x`),
      y: finite(key.object.y, `${keyField}.y`),
      rotation: finite(key.object.rotation, `${keyField}.rotation`),
      scaleX,
      scaleY,
    };
  });
  if (region !== null && attachment.type !== "region") {
    fail("validationFailed", `${field}.region`, "Region timelines require a Region attachment.", attachmentId);
  }

  let deform: RuntimeAttachmentTimelineV1["deform"] = null;
  if (object.deform !== undefined && object.deform !== null) {
    if (attachment.type === "region" || attachment.type === "point") {
      fail("validationFailed", `${field}.deform`, "This attachment type cannot own deform timelines.", attachmentId);
    }
    const source = resolveGeometrySource(attachment, context.attachmentById);
    const weighted = source.weights.length > 0;
    if (deformSpace === "weightedInfluenceOffsets" && !weighted) {
      fail("validationFailed", `${field}.deformSpace`, "weightedInfluenceOffsets requires weighted geometry.", attachmentId);
    }
    const componentCount = deformSpace === "vertexPositions"
      ? source.vertices.length
      : 2 * source.weights.reduce((total, row) => total + row.length, 0);
    deform = optionalKeyArray(object.deform, `${field}.deform`, (item, keyField) => {
      const key = timedCurveRecord(item, keyField, new Set(["time", "curve", "vertices"]));
      const vertices = finiteArray(key.object.vertices, `${keyField}.vertices`);
      if (vertices.length !== componentCount) {
        fail("validationFailed", `${keyField}.vertices`, `Deform key requires exactly ${componentCount} components.`, attachmentId);
      }
      return { time: key.time, curve: key.curve, vertices };
    });
    if (attachment.type === "mesh" && deform !== null) {
      const owner = resolveDeformOwner(attachment, context.attachmentById);
      if (owner.id !== attachment.id) {
        fail("validationFailed", `${field}.deform`, `Inherited linked Mesh deform belongs to '${owner.id}'.`, attachmentId);
      }
    }
  }

  let sequence: RuntimeAttachmentTimelineV1["sequence"] = null;
  if (object.sequence !== undefined && object.sequence !== null) {
    const setupSequence = attachment.type === "region" || attachment.type === "mesh"
      ? attachment.sequence
      : null;
    if (setupSequence === null) {
      fail("validationFailed", `${field}.sequence`, "Sequence timeline requires a Region or Mesh setup sequence.", attachmentId);
    }
    sequence = optionalKeyArray(object.sequence, `${field}.sequence`, (item, keyField) => {
      const key = record(item, keyField);
      rejectUnknown(key, new Set(["time", "mode", "index", "delay"]), keyField);
      const index = unsignedInteger(key.index, `${keyField}.index`);
      if (index >= setupSequence.imageIds.length) {
        fail("validationFailed", `${keyField}.index`, "Sequence key index is out of range.", attachmentId);
      }
      return {
        time: nonNegative(key.time, `${keyField}.time`),
        mode: enumeration(
          key.mode,
          ["hold", "once", "loop", "pingpong", "onceReverse", "loopReverse", "pingpongReverse"] as const,
          `${keyField}.mode`,
        ),
        index,
        delay: nonNegative(key.delay, `${keyField}.delay`),
      };
    });
  }
  return {
    attachmentId,
    region,
    deform,
    deformSpace,
    sequence,
  };
}

function parseEventKey(value: unknown, field: string, context: ResolvedContextV1): RuntimeEventKeyV1 {
  const key = timedCurveRecord(value, field, new Set([
    "time", "curve", "eventId", "name", "integerValue", "stringValue", "numberValue", "audioId", "volume", "balance",
  ]));
  const eventId = nullableId(key.object.eventId, `${field}.eventId`);
  const definition = eventId === null ? undefined : context.eventById.get(eventId);
  if (eventId !== null && definition === undefined) {
    fail("missingReference", `${field}.eventId`, `Unknown event '${eventId}'.`, eventId);
  }
  const audioId = key.object.audioId === undefined || key.object.audioId === null
    ? definition?.audioId ?? null
    : nullableId(key.object.audioId, `${field}.audioId`);
  if (audioId !== null && !context.audioIds.has(audioId)) {
    fail("missingReference", `${field}.audioId`, `Unknown audio '${audioId}'.`, audioId);
  }
  const authoredName = nonEmptyString(key.object.name, `${field}.name`);
  return {
    time: key.time,
    curve: key.curve,
    eventId,
    name: definition?.name ?? authoredName,
    integerValue: key.object.integerValue === undefined || key.object.integerValue === null
      ? definition?.integerValue ?? null
      : optionalInteger(key.object.integerValue, `${field}.integerValue`),
    stringValue: key.object.stringValue === undefined || key.object.stringValue === null
      ? definition?.stringValue ?? null
      : optionalString(key.object.stringValue, `${field}.stringValue`),
    numberValue: key.object.numberValue === undefined || key.object.numberValue === null
      ? definition?.numberValue ?? null
      : optionalFinite(key.object.numberValue, `${field}.numberValue`),
    audioId,
    volume: key.object.volume === undefined || key.object.volume === null
      ? definition?.volume ?? 1
      : unit(key.object.volume, `${field}.volume`),
    balance: key.object.balance === undefined || key.object.balance === null
      ? definition?.balance ?? 0
      : ranged(key.object.balance, `${field}.balance`, -1, 1),
  };
}

function parseDrawOrderKeys(
  value: unknown,
  field: string,
  slots: readonly RuntimeSlotV1[],
): RuntimeDrawOrderKeyV1[] {
  const expected = new Set(slots.map((slot) => slot.id));
  return keyArray(value, field, (item, keyField) => {
    const key = timedCurveRecord(item, keyField, new Set(["time", "curve", "slotIds"]));
    const slotIds = stringArray(key.object.slotIds, `${keyField}.slotIds`);
    if (slotIds.length !== expected.size || new Set(slotIds).size !== slotIds.length || slotIds.some((id) => !expected.has(id))) {
      fail("validationFailed", `${keyField}.slotIds`, "Draw-order key must contain every slot exactly once.");
    }
    return { time: key.time, curve: key.curve, slotIds };
  });
}

function parseDrawOrderFolder(
  value: unknown,
  field: string,
  slots: readonly RuntimeSlotV1[],
): RuntimeDrawOrderFolderV1 {
  const object = record(value, field);
  rejectUnknown(object, new Set(["folderPath", "slotIds", "keys"]), field);
  const slotIds = stringArray(object.slotIds, `${field}.slotIds`);
  const allSlotIds = new Set(slots.map((slot) => slot.id));
  if (new Set(slotIds).size !== slotIds.length || slotIds.some((id) => !allSlotIds.has(id))) {
    fail("validationFailed", `${field}.slotIds`, "Draw-order folder members must be unique existing slots.");
  }
  const memberIds = new Set(slotIds);
  const keys = keyArray(object.keys, `${field}.keys`, (item, keyField) => {
    const key = timedCurveRecord(item, keyField, new Set(["time", "curve", "slotIds"]));
    const ordered = stringArray(key.object.slotIds, `${keyField}.slotIds`);
    if (ordered.length !== memberIds.size || new Set(ordered).size !== ordered.length || ordered.some((id) => !memberIds.has(id))) {
      fail("validationFailed", `${keyField}.slotIds`, "Folder draw-order key must contain every member exactly once.");
    }
    return { time: key.time, curve: key.curve, slotIds: ordered };
  });
  return { folderPath: string(object.folderPath, `${field}.folderPath`), slotIds, keys };
}

function parseScalarKeys(value: unknown, field: string) {
  return optionalKeyArray(value, field, (item, keyField) => {
    const key = timedCurveRecord(item, keyField, new Set(["time", "curve", "value"]));
    const scalar = finite(key.object.value, `${keyField}.value`);
    return { time: key.time, curve: key.curve, value: scalar };
  });
}

function parsePairKeys(value: unknown, field: string) {
  return optionalKeyArray(value, field, (item, keyField) => {
    const key = timedCurveRecord(item, keyField, new Set(["time", "curve", "x", "y"]));
    const x = finite(key.object.x, `${keyField}.x`);
    const y = finite(key.object.y, `${keyField}.y`);
    return { time: key.time, curve: key.curve, x, y };
  });
}

function parseCurve(value: unknown, field: string): RuntimeCurveV1 {
  if (value === undefined || value === null) return null;
  if (value === "linear" || value === "stepped") return value;
  const object = record(value, field);
  const type = string(object.type, `${field}.type`);
  if (type === "bezier") {
    rejectUnknown(object, new Set(["type", "cx1", "cy1", "cx2", "cy2"]), field);
    return {
      type,
      cx1: finite(object.cx1, `${field}.cx1`),
      cy1: finite(object.cy1, `${field}.cy1`),
      cx2: finite(object.cx2, `${field}.cx2`),
      cy2: finite(object.cy2, `${field}.cy2`),
    };
  }
  if (type === "bezier-value") {
    rejectUnknown(object, new Set(["type", "cx1", "dy1", "cx2", "dy2"]), field);
    return {
      type,
      cx1: finite(object.cx1, `${field}.cx1`),
      dy1: finite(object.dy1, `${field}.dy1`),
      cx2: finite(object.cx2, `${field}.cx2`),
      dy2: finite(object.dy2, `${field}.dy2`),
    };
  }
  if (type === "properties") {
    rejectUnknown(object, new Set(["type", "default", "properties"]), field);
    const propertiesObject = record(object.properties, `${field}.properties`);
    const propertyEntries = Object.entries(propertiesObject);
    if (propertyEntries.length === 0) fail("validationFailed", `${field}.properties`, "Property curve bundle cannot be empty.");
    const properties: Partial<Record<RuntimeCurvePropertyNameV1, ReturnType<typeof parseSimpleCurve>>> = {};
    for (const [property, curve] of propertyEntries) {
      if (!CURVE_PROPERTY_SET.has(property)) fail("malformedInput", `${field}.properties.${property}`, `Unknown curve property '${property}'.`);
      properties[property as RuntimeCurvePropertyNameV1] = parseSimpleCurve(curve, `${field}.properties.${property}`);
    }
    return {
      type,
      default: object.default === undefined ? null : parseSimpleCurve(object.default, `${field}.default`),
      properties,
    };
  }
  fail("malformedInput", `${field}.type`, `Unknown curve type '${type}'.`);
}

function parseSimpleCurve(value: unknown, field: string): RuntimeSimpleCurveV1 {
  const curve = parseCurve(value, field);
  if (curve !== null && typeof curve === "object" && curve.type === "properties") {
    fail("malformedInput", field, "Nested property curve bundles are forbidden.");
  }
  return curve;
}

function timedCurveRecord(value: unknown, field: string, keys: ReadonlySet<string>) {
  const object = record(value, field);
  rejectUnknown(object, keys, field);
  return {
    object,
    time: nonNegative(object.time, `${field}.time`),
    curve: parseCurve(object.curve, `${field}.curve`),
  };
}

function optionalKeyArray<T>(
  value: unknown,
  field: string,
  parser: (value: unknown, field: string) => T & { readonly time: number },
): (T & { readonly time: number })[] | null {
  if (value === undefined || value === null) return null;
  return keyArray(value, field, parser);
}

function keyArray<T>(
  value: unknown,
  field: string,
  parser: (value: unknown, field: string) => T & { readonly time: number },
): (T & { readonly time: number })[] {
  const result = array(value, field).map((item, index) => parser(item, `${field}[${index}]`));
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (previous !== undefined && current !== undefined && previous.time > current.time) {
      fail("validationFailed", `${field}[${index}].time`, "Timeline keys must use non-decreasing time order.");
    }
  }
  return result;
}

function validateTimelineUniqueness(
  bones: readonly RuntimeBoneTimelineV1[],
  slots: readonly RuntimeSlotTimelineV1[],
  attachments: readonly RuntimeAttachmentTimelineV1[],
  constraints: readonly RuntimeConstraintTimelineV1[],
  field: string,
): void {
  const owned = new Set<string>();
  for (const timeline of bones) {
    for (const channel of ["translate", "translateX", "translateY", "rotate", "scale", "scaleX", "scaleY", "shear", "shearX", "shearY", "inherit"] as const) {
      if (timeline[channel] !== null) uniqueChannel(owned, `bone:${timeline.boneId}:${channel}`, field);
    }
  }
  for (const timeline of slots) {
    for (const channel of ["attachment", "color", "alpha"] as const) {
      if (timeline[channel] !== null) uniqueChannel(owned, `slot:${timeline.slotId}:${channel}`, field);
    }
  }
  for (const timeline of attachments) {
    if (timeline.region !== null) uniqueChannel(owned, `attachment:${timeline.attachmentId}:region`, field);
    if (timeline.deform !== null) uniqueChannel(owned, `attachment:${timeline.attachmentId}:deform`, field);
    if (timeline.sequence !== null) uniqueChannel(owned, `attachment:${timeline.attachmentId}:sequence`, field);
  }
  for (const timeline of constraints) {
    uniqueChannel(owned, `constraint:${timeline.type}:${timeline.constraintId}`, field);
  }
}

function uniqueChannel(owned: Set<string>, id: string, field: string): void {
  if (owned.has(id)) fail("validationFailed", field, `Animation contains duplicate timeline channel '${id}'.`);
  owned.add(id);
}

function latestBoneTime(timeline: RuntimeBoneTimelineV1): number {
  return Math.max(
    lastTime(timeline.translate), lastTime(timeline.translateX), lastTime(timeline.translateY),
    lastTime(timeline.rotate), lastTime(timeline.scale), lastTime(timeline.scaleX), lastTime(timeline.scaleY),
    lastTime(timeline.shear), lastTime(timeline.shearX), lastTime(timeline.shearY), lastTime(timeline.inherit),
  );
}

function latestSlotTime(timeline: RuntimeSlotTimelineV1): number {
  return Math.max(lastTime(timeline.attachment), lastTime(timeline.color), lastTime(timeline.alpha));
}

function lastTime(keys: readonly { readonly time: number }[] | null): number {
  return keys?.[keys.length - 1]?.time ?? 0;
}

type VertexAttachmentV1 = Extract<RuntimeAttachmentV1, { readonly vertices: readonly number[] }>;

function resolveGeometrySource(
  attachment: VertexAttachmentV1,
  attachments: ReadonlyMap<string, RuntimeAttachmentV1>,
): VertexAttachmentV1 {
  let current = attachment;
  while (current.type === "mesh" && current.link !== null) {
    const parent = attachments.get(current.link.parentMeshId);
    if (parent === undefined || parent.type !== "mesh") {
      fail("missingReference", "attachments.link.parentMeshId", "Linked Mesh source is unavailable.", attachment.id);
    }
    current = parent;
  }
  return current;
}

function resolveDeformOwner(
  attachment: Extract<RuntimeAttachmentV1, { readonly type: "mesh" }>,
  attachments: ReadonlyMap<string, RuntimeAttachmentV1>,
): Extract<RuntimeAttachmentV1, { readonly type: "mesh" }> {
  let current = attachment;
  while (current.link !== null && current.link.inheritDeform) {
    const parent = attachments.get(current.link.parentMeshId);
    if (parent === undefined || parent.type !== "mesh") {
      fail("missingReference", "attachments.link.parentMeshId", "Linked Mesh deform owner is unavailable.", attachment.id);
    }
    current = parent;
  }
  return current;
}

function finiteArray(value: unknown, field: string): number[] {
  return array(value, field).map((item, index) => finite(item, `${field}[${index}]`));
}

function unsignedInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    fail("validationFailed", field, `Expected unsigned 32-bit integer at '${field}'.`);
  }
  return value;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("validationFailed", field, `Expected object at '${field}'.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail("validationFailed", field, `Expected array at '${field}'.`);
  return value;
}

function rejectUnknown(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("malformedInput", `${field}.${key}`, `Unknown field '${key}' at '${field}'.`);
  }
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") fail("validationFailed", field, `Expected string at '${field}'.`);
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  const result = string(value, field);
  if (result.length === 0 || result.includes("\0")) fail("validationFailed", field, `Expected a non-empty NUL-free string at '${field}'.`);
  return result;
}

function optionalString(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : string(value, field);
}

function stringArray(value: unknown, field: string): string[] {
  return array(value, field).map((item, index) => nonEmptyString(item, `${field}[${index}]`));
}

function nullableId(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : nonEmptyString(value, field);
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number") fail("validationFailed", field, `Expected number at '${field}'.`);
  if (!Number.isFinite(value)) fail("nonFinite", field, `Expected finite number at '${field}'.`);
  try {
    return finiteF32(value);
  } catch (error) {
    throw new RuntimeErrorV1("nonFinite", OPERATION, `Value at '${field}' is outside binary32 range.`, { field, cause: error });
  }
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
  return ranged(value, field, 0, 1);
}

function ranged(value: unknown, field: string, minimum: number, maximum: number): number {
  const result = finite(value, field);
  if (result < minimum || result > maximum) fail("validationFailed", field, `Number at '${field}' is outside [${minimum},${maximum}].`);
  return result;
}

function optionalFinite(value: unknown, field: string): number | null {
  return value === undefined || value === null ? null : finite(value, field);
}

function optionalUnit(value: unknown, field: string): number | null {
  return value === undefined || value === null ? null : unit(value, field);
}

function optionalNonNegative(value: unknown, field: string): number | null {
  return value === undefined || value === null ? null : nonNegative(value, field);
}

function optionalPositive(value: unknown, field: string): number | null {
  return value === undefined || value === null ? null : positive(value, field);
}

function optionalBooleanValue(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") fail("validationFailed", field, `Expected boolean at '${field}'.`);
  return value;
}

function optionalInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    fail("validationFailed", field, `Expected signed 32-bit integer at '${field}'.`);
  }
  return value;
}

function color(value: unknown, field: string): string {
  const result = string(value, field);
  const normalized = result.startsWith("#") ? result : `#${result}`;
  if (!isRuntimeColorV1(normalized)) fail("validationFailed", field, "Runtime colors must use six hexadecimal RGB digits.");
  return normalized.toLowerCase();
}

function enumeration<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  const result = string(value, field);
  if (!(values as readonly string[]).includes(result)) fail("validationFailed", field, `Unsupported value '${result}' at '${field}'.`);
  return result as T[number];
}

function fail(
  name: ConstructorParameters<typeof RuntimeErrorV1>[0],
  field: string,
  message: string,
  entityId: string | null = null,
): never {
  throw new RuntimeErrorV1(name, OPERATION, message, { field, entityId });
}
