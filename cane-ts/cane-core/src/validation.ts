import type {
  AtlasDocumentV1,
  AtlasPageV1,
  AtlasRegionV1,
  BoneTransformModeV1,
  RuntimeAnimationV1,
  RuntimeAttachmentV1,
  RuntimeAtlasReferenceV1,
  RuntimeAudioV1,
  RuntimeBlendModeV1,
  RuntimeBoneV1,
  RuntimeConstraintV1,
  RuntimeDocumentV1,
  RuntimeEventDefinitionV1,
  RuntimeFontV1,
  RuntimeGeneratorV1,
  RuntimeImageV1,
  RuntimeLoadOptionsV1,
  RuntimeSkeletonMetadataV1,
  RuntimeSkinV1,
  RuntimeSlotV1,
  RuntimeVersionV1,
} from "./contracts.js";
import {
  parseRuntimeAnimationsV1,
  parseRuntimeEventDefinitionsV1,
} from "./animation/validation.js";
import { parseRuntimeAttachmentsV1 } from "./geometry/validation.js";
import { parseRuntimeConstraintsV1 } from "./constraints/validation.js";
import { RuntimeErrorV1 } from "./errors.js";
import { deepFreeze } from "./internal.js";
import { finiteF32 } from "./math/f32.js";
import { isRuntimeColorV1 } from "./render/tint.js";

const OPERATION = "loadJson";

export const SUPPORTED_RUNTIME_FEATURES_V1 = Object.freeze([
  "attachment.bounding-box",
  "attachment.clipping",
  "attachment.mesh",
  "attachment.path",
  "attachment.point",
  "attachment.region",
  "attachment.sequence",
  "blend.add",
  "blend.multiply",
  "blend.screen",
  "constraint.ik",
  "constraint.path",
  "constraint.physics",
  "constraint.slider",
  "constraint.transform",
  "event",
  "mesh.deform",
  "mesh.weighted",
  "skin",
  "tint.two-color",
  "timeline.draw-order",
  "timeline.skin",
] as const);

export const UNVERIFIED_RUNTIME_FEATURES_V1 = Object.freeze([] as const);

const SUPPORTED_FEATURE_SET = new Set<string>(SUPPORTED_RUNTIME_FEATURES_V1);
const IMPLEMENTED_FEATURE_SET = new Set<string>([
  ...SUPPORTED_RUNTIME_FEATURES_V1,
  ...UNVERIFIED_RUNTIME_FEATURES_V1,
]);
const ROOT_KEYS = new Set([
  "format",
  "formatVersion",
  "runtimeApiVersion",
  "generator",
  "requiredFeatures",
  "skeleton",
  "atlases",
  "images",
  "audios",
  "fonts",
  "bones",
  "slots",
  "attachments",
  "constraints",
  "skins",
  "events",
  "animations",
]);

export interface ParsedRuntimeProjectV1 {
  readonly document: RuntimeDocumentV1;
  readonly atlases: readonly AtlasDocumentV1[];
}

export function parseRuntimeProjectV1(
  input: unknown,
  options: RuntimeLoadOptionsV1 = {},
): ParsedRuntimeProjectV1 {
  const raw = parseInputJson(input);
  const root = expectObject(raw, "$", OPERATION);
  rejectUnknownKeys(root, ROOT_KEYS, "$", OPERATION);

  if (expectString(root.format, "format", OPERATION) !== "cane-runtime") {
    fail("malformedInput", "format", "Expected Runtime JSON format 'cane-runtime'.");
  }

  const formatVersion = parseVersion(root.formatVersion, "formatVersion", OPERATION);
  if (formatVersion.major !== 1 || formatVersion.minor !== 0) {
    fail(
      "unsupportedVersion",
      "formatVersion",
      `Runtime JSON ${formatVersion.major}.${formatVersion.minor} is unsupported.`,
    );
  }

  const runtimeApiVersion = parseVersion(root.runtimeApiVersion, "runtimeApiVersion", OPERATION);
  if (runtimeApiVersion.major !== 1 || runtimeApiVersion.minor > 3) {
    fail(
      "unsupportedVersion",
      "runtimeApiVersion",
      `Runtime API ${runtimeApiVersion.major}.${runtimeApiVersion.minor} is unsupported.`,
    );
  }

  const generator = parseGenerator(root.generator);
  const skeleton = parseSkeleton(root.skeleton);
  const requiredFeatures = parseStringArray(root.requiredFeatures, "requiredFeatures");
  ensureStrictlySortedUnique(requiredFeatures, "requiredFeatures");
  const unknownRequiredFeatures = requiredFeatures.filter((feature) => !IMPLEMENTED_FEATURE_SET.has(feature));
  if (unknownRequiredFeatures.length > 0) {
    fail(
      "unsupportedFeature",
      "requiredFeatures",
      `unsupported required runtime features: ${unknownRequiredFeatures.join(", ")}`,
    );
  }
  for (let index = 0; index < requiredFeatures.length; index += 1) {
    const feature = requiredFeatures[index];
    if (feature !== undefined && options.allowUnverifiedFeatures !== true && !SUPPORTED_FEATURE_SET.has(feature)) {
      fail(
        "unsupportedFeature",
        `requiredFeatures[${index}]`,
        `Required feature '${feature}' has not passed the pinned conformance gate.`,
        feature,
      );
    }
  }

  const atlasReferences = parseArray(root.atlases, "atlases").map((value, index) =>
    parseAtlasReference(value, `atlases[${index}]`),
  );
  const images = parseArray(root.images, "images").map((value, index) =>
    parseImage(value, `images[${index}]`),
  );
  const audios = parseArray(root.audios, "audios").map((value, index) =>
    parseAudio(value, `audios[${index}]`),
  );
  const fonts = parseArray(root.fonts, "fonts").map((value, index) =>
    parseFont(value, `fonts[${index}]`),
  );
  const bones = parseArray(root.bones, "bones").map((value, index) =>
    parseBone(value, `bones[${index}]`),
  );
  const slots = parseArray(root.slots, "slots").map((value, index) =>
    parseSlot(value, `slots[${index}]`),
  );
  // Bone identity/reference validation must happen before constraints build a
  // bone-id map and walk target ancestry.  Besides matching the Rust reference
  // projection's aggregate setup diagnostic, this prevents duplicate IDs from
  // turning a malformed parent relationship into an unbounded ancestry walk.
  validateRuntimeSetupIdentityReferencesV1(bones, slots);
  validateHierarchy(bones);
  validateRuntimeGeometryCompatibilityV1(root.attachments);
  const attachments = parseRuntimeAttachmentsV1(root.attachments, {
    imageIds: new Set(images.map((image) => image.imageId)),
    boneIds: new Set(bones.map((bone) => bone.id)),
    slots,
  });
  const constraints = parseRuntimeConstraintsV1(root.constraints, { bones, slots });
  const skins = parseRuntimeSkinsV1(
    root.skins,
    bones,
    slots,
    attachments,
    new Set(constraints.map((constraint) => constraint.id)),
  );
  const skinPlaceholdersBySlot = collectSkinPlaceholdersBySlotV1(skins);

  const events = parseRuntimeEventDefinitionsV1(
    root.events,
    new Set(audios.map((audio) => audio.audioId)),
  );
  const animations = parseRuntimeAnimationsV1(root.animations, {
    boneIds: new Set(bones.map((bone) => bone.id)),
    slots,
    attachments,
    events,
    audioIds: new Set(audios.map((audio) => audio.audioId)),
    skinIds: new Set(skins.map((skin) => skin.id)),
    skinPlaceholdersBySlot,
    constraints,
  });


  ensureUniqueIds(atlasReferences, "atlasId", "atlases");
  ensureUniqueIds(images, "imageId", "images");
  ensureUniqueIds(audios, "audioId", "audios");
  ensureUniqueIds(fonts, "fontId", "fonts");
  ensureUniqueIds(bones, "id", "bones");
  ensureUniqueIds(slots, "id", "slots");
  ensureUniqueIds(attachments, "id", "attachments");
  ensureUniqueIds(constraints, "id", "constraints");
  ensureUniqueIds(skins, "id", "skins");
  ensureUniqueIds(events, "id", "events");
  ensureUniqueIds(animations, "id", "animations");
  validateSliderAnimationReferences(constraints, animations);
  validateModelReferences(images, bones, slots, attachments, skinPlaceholdersBySlot);

  const inferredFeatures = inferRuntimeRequiredFeaturesV1(
    slots,
    attachments,
    constraints,
    skins,
    events,
    animations,
  );
  if (!arraysEqual(requiredFeatures, inferredFeatures)) {
    fail(
      "validationFailed",
      "requiredFeatures",
      `requiredFeatures must exactly equal inferred features: ${JSON.stringify(inferredFeatures)}.`,
    );
  }

  const atlases = (options.atlases ?? []).map((value, index) =>
    parseAtlasDocumentV1(value, `atlases[${index}]`),
  );
  ensureUniqueAttachedAtlases(atlases);
  validateAtlasCatalog(atlasReferences, images, atlases);

  return deepFreeze<ParsedRuntimeProjectV1>({
    document: {
      format: "cane-runtime",
      formatVersion,
      runtimeApiVersion,
      generator,
      requiredFeatures,
      skeleton,
      atlases: atlasReferences,
      images,
      audios,
      fonts,
      bones,
      slots,
      attachments,
      constraints,
      skins,
      events,
      animations,
    },
    atlases,
  });
}

function validateRuntimeSetupIdentityReferencesV1(
  bones: readonly RuntimeBoneV1[],
  slots: readonly RuntimeSlotV1[],
): void {
  const errors: string[] = [];
  const boneIds = new Set<string>();
  for (const bone of bones) {
    if (boneIds.has(bone.id)) errors.push(`Duplicate bone id: ${bone.id}.`);
    boneIds.add(bone.id);
  }
  for (const bone of bones) {
    if (bone.parentId !== null && !boneIds.has(bone.parentId)) {
      errors.push(`Bone ${bone.id} references missing parent ${bone.parentId}.`);
    }
  }

  const slotIds = new Set<string>();
  for (const slot of slots) {
    if (slotIds.has(slot.id)) errors.push(`Duplicate slot id: ${slot.id}.`);
    slotIds.add(slot.id);
    if (!boneIds.has(slot.boneId)) {
      errors.push(`Slot ${slot.id} references missing bone ${slot.boneId}.`);
    }
  }

  if (errors.length > 0) {
    throw new RuntimeErrorV1(
      "validationFailed",
      OPERATION,
      `runtime setup or animation data is invalid: [${errors.map((error) => JSON.stringify(error)).join(", ")}]`,
      { field: "$" },
    );
  }
}

function validateRuntimeGeometryCompatibilityV1(input: unknown): void {
  // Runtime Format v1 reports format-level geometry diagnostics as one Cane
  // model validation error.  Run the checks that require no normalized model
  // before the stricter field parser so every language projection observes the
  // same aggregate outcome (and the same ordering) as the Rust reference.
  if (!Array.isArray(input)) return;
  const errors: string[] = [];
  for (const value of input) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const attachment = value as Record<string, unknown>;
    if (attachment.type !== "mesh" || attachment.link !== null) continue;
    const id = typeof attachment.id === "string" ? attachment.id : null;
    const vertices = Array.isArray(attachment.vertices) ? attachment.vertices : null;
    const uvs = Array.isArray(attachment.uvs) ? attachment.uvs : null;
    const indices = Array.isArray(attachment.indices) ? attachment.indices : null;
    if (id === null || vertices === null) continue;

    if (vertices.length % 2 !== 0) {
      errors.push(`Mesh attachment ${id} vertices must contain x/y pairs.`);
    }
    if (uvs !== null && uvs.length !== vertices.length) {
      errors.push(`Mesh attachment ${id} uvs length must match vertices length.`);
    }
    const vertexCount = Math.floor(vertices.length / 2);
    if (vertices.length % 2 === 0 && indices !== null) {
      for (const index of indices) {
        if (typeof index === "number" && Number.isInteger(index) && index >= vertexCount) {
          errors.push(`Mesh attachment ${id} index ${index} is out of bounds for ${vertexCount} vertices.`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new RuntimeErrorV1(
      "validationFailed",
      OPERATION,
      `runtime setup or animation data is invalid: [${errors.map((error) => JSON.stringify(error)).join(", ")}]`,
      { field: "$" },
    );
  }
}

function parseRuntimeSkinsV1(
  input: unknown,
  bones: readonly RuntimeBoneV1[],
  slots: readonly RuntimeSlotV1[],
  attachments: readonly RuntimeAttachmentV1[],
  constraintIds: ReadonlySet<string>,
): RuntimeSkinV1[] {
  const boneIds = new Set(bones.map((bone) => bone.id));
  const slotIds = new Set(slots.map((slot) => slot.id));
  const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  return parseArray(input, "skins").map((value, index) => {
    const field = `skins[${index}]`;
    const object = expectObject(value, field, OPERATION);
    rejectUnknownKeys(
      object,
      new Set(["id", "name", "attachments", "boneIds", "constraintIds", "export"]),
      field,
      OPERATION,
    );
    const skinAttachments = parseArray(object.attachments, `${field}.attachments`).map((item, attachmentIndex) => {
      const attachmentField = `${field}.attachments[${attachmentIndex}]`;
      const record = expectObject(item, attachmentField, OPERATION);
      rejectUnknownKeys(record, new Set(["slotId", "attachmentId", "name"]), attachmentField, OPERATION);
      const slotId = expectNonEmptyString(record.slotId, `${attachmentField}.slotId`, OPERATION);
      if (!slotIds.has(slotId)) {
        fail("missingReference", `${attachmentField}.slotId`, `Unknown slot '${slotId}'.`, slotId);
      }
      const attachmentId = parseNullableId(record.attachmentId, `${attachmentField}.attachmentId`);
      if (attachmentId !== null) {
        const attachment = attachmentById.get(attachmentId);
        if (attachment === undefined) {
          fail("missingReference", `${attachmentField}.attachmentId`, `Unknown attachment '${attachmentId}'.`, attachmentId);
        }
        if (attachment.slotId !== slotId) {
          fail("validationFailed", `${attachmentField}.attachmentId`, "Skin attachment must belong to its slot.", attachmentId);
        }
      }
      const name = record.name === null
        ? null
        : expectString(record.name, `${attachmentField}.name`, OPERATION);
      if (name !== null && name.includes("\0")) {
        fail("validationFailed", `${attachmentField}.name`, "Skin placeholder names must not contain NUL.");
      }
      return { slotId, attachmentId, name };
    });
    const seenPlaceholders = new Set<string>();
    for (let attachmentIndex = 0; attachmentIndex < skinAttachments.length; attachmentIndex += 1) {
      const attachment = skinAttachments[attachmentIndex];
      if (attachment === undefined) continue;
      const key = `${attachment.slotId}\0${attachment.name === null ? "<default>" : attachment.name}`;
      if (seenPlaceholders.has(key)) {
        fail("validationFailed", `${field}.attachments[${attachmentIndex}]`, "Skin repeats a slot/placeholder mapping.");
      }
      seenPlaceholders.add(key);
    }
    const skinBoneIds = parseStringArray(object.boneIds, `${field}.boneIds`);
    ensureUniqueStrings(skinBoneIds, `${field}.boneIds`);
    for (let boneIndex = 0; boneIndex < skinBoneIds.length; boneIndex += 1) {
      const boneId = skinBoneIds[boneIndex];
      if (boneId !== undefined && !boneIds.has(boneId)) {
        fail("missingReference", `${field}.boneIds[${boneIndex}]`, `Unknown bone '${boneId}'.`, boneId);
      }
    }
    const skinConstraintIds = parseStringArray(object.constraintIds, `${field}.constraintIds`);
    ensureUniqueStrings(skinConstraintIds, `${field}.constraintIds`);
    for (let constraintIndex = 0; constraintIndex < skinConstraintIds.length; constraintIndex += 1) {
      const constraintId = skinConstraintIds[constraintIndex];
      if (constraintId !== undefined && !constraintIds.has(constraintId)) {
        fail("missingReference", `${field}.constraintIds[${constraintIndex}]`, `Unknown constraint '${constraintId}'.`, constraintId);
      }
    }
    if (typeof object.export !== "boolean") {
      fail("validationFailed", `${field}.export`, "Skin export must be a boolean.");
    }
    return {
      id: expectNonEmptyString(object.id, `${field}.id`, OPERATION),
      name: expectNonEmptyString(object.name, `${field}.name`, OPERATION),
      attachments: skinAttachments,
      boneIds: skinBoneIds,
      constraintIds: skinConstraintIds,
      export: object.export,
    };
  });
}

export function parseAtlasDocumentV1(input: unknown, field = "atlas"): AtlasDocumentV1 {
  const value = typeof input === "string" ? parseJsonString(input, "loadAtlasJson") : input;
  const root = expectObject(value, field, "loadAtlasJson");
  rejectUnknownKeys(
    root,
    new Set(["format", "formatVersion", "atlasId", "name", "colorSpace", "alphaMode", "pages", "regions"]),
    field,
    "loadAtlasJson",
  );

  if (expectString(root.format, `${field}.format`, "loadAtlasJson") !== "cane-atlas") {
    atlasFail("malformedInput", `${field}.format`, "Expected Atlas format 'cane-atlas'.");
  }
  const formatVersion = parseVersion(root.formatVersion, `${field}.formatVersion`, "loadAtlasJson");
  if (formatVersion.major !== 1 || formatVersion.minor !== 0) {
    atlasFail(
      "unsupportedVersion",
      `${field}.formatVersion`,
      `Atlas ${formatVersion.major}.${formatVersion.minor} is unsupported.`,
    );
  }

  const atlasId = expectNonEmptyString(root.atlasId, `${field}.atlasId`, "loadAtlasJson");
  const name = expectNonEmptyString(root.name, `${field}.name`, "loadAtlasJson");
  const colorSpace = expectEnum(root.colorSpace, ["srgb", "linear"] as const, `${field}.colorSpace`, "loadAtlasJson");
  const alphaMode = expectEnum(
    root.alphaMode,
    ["straight", "premultiplied"] as const,
    `${field}.alphaMode`,
    "loadAtlasJson",
  );
  const pages = parseArray(root.pages, `${field}.pages`, "loadAtlasJson").map((page, index) =>
    parseAtlasPage(page, `${field}.pages[${index}]`),
  );
  const regions = parseArray(root.regions, `${field}.regions`, "loadAtlasJson").map((region, index) =>
    parseAtlasRegion(region, `${field}.regions[${index}]`),
  );
  ensureUniqueIds(pages, "pageId", `${field}.pages`, "loadAtlasJson");
  ensureUniqueIds(pages, "image", `${field}.pages.image`, "loadAtlasJson");
  ensureUniqueIds(regions, "regionId", `${field}.regions`, "loadAtlasJson");
  ensureUniqueIds(regions, "imageId", `${field}.regions.imageId`, "loadAtlasJson");

  const pageIds = new Set(pages.map((page) => page.pageId));
  const pageMap = new Map(pages.map((page) => [page.pageId, page]));
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    if (region === undefined) continue;
    if (!pageIds.has(region.pageId)) {
      atlasFail(
        "missingReference",
        `${field}.regions[${index}].pageId`,
        `Atlas region references unknown page '${region.pageId}'.`,
        region.regionId,
      );
    }
    const page = pageMap.get(region.pageId);
    if (page !== undefined) {
      validateAtlasRegionBounds(region, page, `${field}.regions[${index}]`);
    }
  }

  return deepFreeze<AtlasDocumentV1>({
    format: "cane-atlas",
    formatVersion,
    atlasId,
    name,
    colorSpace,
    alphaMode,
    pages,
    regions,
  });
}

function parseInputJson(input: unknown): unknown {
  return typeof input === "string" ? parseJsonString(input, OPERATION) : input;
}

function parseJsonString(input: string, operation: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch (error) {
    throw new RuntimeErrorV1("invalidJson", operation, "JSON tokenization failed.", { cause: error });
  }
}

function parseVersion(value: unknown, field: string, operation: string): RuntimeVersionV1 {
  const object = expectObject(value, field, operation);
  rejectUnknownKeys(object, new Set(["major", "minor"]), field, operation);
  return {
    major: expectInteger(object.major, `${field}.major`, operation, 0, 65535),
    minor: expectInteger(object.minor, `${field}.minor`, operation, 0, 65535),
  };
}

function parseGenerator(value: unknown): RuntimeGeneratorV1 {
  const object = expectObject(value, "generator", OPERATION);
  rejectUnknownKeys(object, new Set(["name", "version"]), "generator", OPERATION);
  return {
    name: expectNonEmptyString(object.name, "generator.name", OPERATION),
    version: expectNonEmptyString(object.version, "generator.version", OPERATION),
  };
}

function parseSkeleton(value: unknown): RuntimeSkeletonMetadataV1 {
  const object = expectObject(value, "skeleton", OPERATION);
  rejectUnknownKeys(
    object,
    new Set(["skeletonId", "name", "unit", "angleUnit", "referenceScale"]),
    "skeleton",
    OPERATION,
  );
  const unit = expectString(object.unit, "skeleton.unit", OPERATION);
  const angleUnit = expectString(object.angleUnit, "skeleton.angleUnit", OPERATION);
  if (unit !== "px") fail("unsupportedFeature", "skeleton.unit", `Unsupported unit '${unit}'.`);
  if (angleUnit !== "deg") {
    fail("unsupportedFeature", "skeleton.angleUnit", `Unsupported angle unit '${angleUnit}'.`);
  }
  const referenceScale = expectPositiveFinite(object.referenceScale, "skeleton.referenceScale");
  return {
    skeletonId: expectNonEmptyString(object.skeletonId, "skeleton.skeletonId", OPERATION),
    name: expectNonEmptyString(object.name, "skeleton.name", OPERATION),
    unit,
    angleUnit,
    referenceScale,
  };
}

function parseAtlasReference(value: unknown, field: string): RuntimeAtlasReferenceV1 {
  const object = expectObject(value, field, OPERATION);
  rejectUnknownKeys(object, new Set(["atlasId", "path"]), field, OPERATION);
  return {
    atlasId: expectNonEmptyString(object.atlasId, `${field}.atlasId`, OPERATION),
    path: expectPortablePath(object.path, `${field}.path`, OPERATION),
  };
}

function parseImage(value: unknown, field: string): RuntimeImageV1 {
  const object = expectObject(value, field, OPERATION);
  rejectUnknownKeys(
    object,
    new Set(["imageId", "name", "path", "atlasId", "mimeType", "width", "height"]),
    field,
    OPERATION,
  );
  const path = object.path === undefined || object.path === null
    ? null
    : expectPortablePath(object.path, `${field}.path`, OPERATION);
  const atlasId = object.atlasId === undefined || object.atlasId === null
    ? null
    : expectNonEmptyString(object.atlasId, `${field}.atlasId`, OPERATION);
  if ((path === null) === (atlasId === null)) {
    fail(
      "validationFailed",
      field,
      "A Runtime image must declare exactly one of path or atlasId.",
    );
  }
  return {
    imageId: expectNonEmptyString(object.imageId, `${field}.imageId`, OPERATION),
    name: expectNonEmptyString(object.name, `${field}.name`, OPERATION),
    mimeType: expectNonEmptyString(object.mimeType, `${field}.mimeType`, OPERATION),
    path,
    atlasId,
    width: parseOptionalPositiveInteger(object.width, `${field}.width`, OPERATION),
    height: parseOptionalPositiveInteger(object.height, `${field}.height`, OPERATION),
  };
}

function parseAudio(value: unknown, field: string): RuntimeAudioV1 {
  const object = expectObject(value, field, OPERATION);
  rejectUnknownKeys(object, new Set(["audioId", "name", "path", "mimeType"]), field, OPERATION);
  return {
    audioId: expectNonEmptyString(object.audioId, `${field}.audioId`, OPERATION),
    name: expectNonEmptyString(object.name, `${field}.name`, OPERATION),
    path: expectPortablePath(object.path, `${field}.path`, OPERATION),
    mimeType: expectNonEmptyString(object.mimeType, `${field}.mimeType`, OPERATION),
  };
}

function parseFont(value: unknown, field: string): RuntimeFontV1 {
  const object = expectObject(value, field, OPERATION);
  rejectUnknownKeys(object, new Set(["fontId", "name", "path", "mimeType"]), field, OPERATION);
  return {
    fontId: expectNonEmptyString(object.fontId, `${field}.fontId`, OPERATION),
    name: expectNonEmptyString(object.name, `${field}.name`, OPERATION),
    path: expectPortablePath(object.path, `${field}.path`, OPERATION),
    mimeType: expectNonEmptyString(object.mimeType, `${field}.mimeType`, OPERATION),
  };
}

function parseBone(value: unknown, field: string): RuntimeBoneV1 {
  const object = expectObject(value, field, OPERATION);
  rejectUnknownKeys(
    object,
    new Set([
      "id",
      "name",
      "parentId",
      "x",
      "y",
      "rotation",
      "shearX",
      "shearY",
      "scaleX",
      "scaleY",
      "length",
      "transformMode",
    ]),
    field,
    OPERATION,
  );
  const scaleX = expectFiniteF32(object.scaleX, `${field}.scaleX`);
  const scaleY = expectFiniteF32(object.scaleY, `${field}.scaleY`);
  if (scaleX === 0 || scaleY === 0) {
    fail("validationFailed", field, "Setup bone scales must be non-zero.");
  }
  return {
    id: expectNonEmptyString(object.id, `${field}.id`, OPERATION),
    name: expectNonEmptyString(object.name, `${field}.name`, OPERATION),
    parentId: parseNullableId(object.parentId, `${field}.parentId`),
    x: expectFiniteF32(object.x, `${field}.x`),
    y: expectFiniteF32(object.y, `${field}.y`),
    rotation: expectFiniteF32(object.rotation, `${field}.rotation`),
    shearX: expectFiniteF32(object.shearX, `${field}.shearX`),
    shearY: expectFiniteF32(object.shearY, `${field}.shearY`),
    scaleX,
    scaleY,
    length: expectNonNegativeFinite(object.length, `${field}.length`),
    transformMode: expectEnum(
      object.transformMode,
      ["normal", "onlyTranslation", "noRotationOrReflection", "noScale", "noScaleOrReflection"] as const,
      `${field}.transformMode`,
      OPERATION,
    ) satisfies BoneTransformModeV1,
  };
}

function parseSlot(value: unknown, field: string): RuntimeSlotV1 {
  const object = expectObject(value, field, OPERATION);
  rejectUnknownKeys(
    object,
    new Set(["id", "name", "boneId", "attachmentId", "zIndex", "blendMode", "color", "alpha", "darkColor"]),
    field,
    OPERATION,
  );
  return {
    id: expectNonEmptyString(object.id, `${field}.id`, OPERATION),
    name: expectNonEmptyString(object.name, `${field}.name`, OPERATION),
    boneId: expectNonEmptyString(object.boneId, `${field}.boneId`, OPERATION),
    attachmentId: parseNullableId(object.attachmentId, `${field}.attachmentId`),
    zIndex: expectInteger(object.zIndex, `${field}.zIndex`, OPERATION, -2147483648, 2147483647),
    blendMode: expectEnum(
      object.blendMode,
      ["normal", "add", "multiply", "screen"] as const,
      `${field}.blendMode`,
      OPERATION,
    ) satisfies RuntimeBlendModeV1,
    color: object.color === undefined ? "#ffffff" : expectColor(object.color, `${field}.color`),
    alpha: object.alpha === undefined ? 1 : expectUnitFinite(object.alpha, `${field}.alpha`),
    darkColor: object.darkColor === undefined || object.darkColor === null
      ? null
      : expectColor(object.darkColor, `${field}.darkColor`),
  };
}

function parseAtlasPage(value: unknown, field: string): AtlasPageV1 {
  const operation = "loadAtlasJson";
  const object = expectObject(value, field, operation);
  rejectUnknownKeys(
    object,
    new Set(["pageId", "image", "width", "height", "pixelFormat", "minFilter", "magFilter", "wrapU", "wrapV"]),
    field,
    operation,
  );
  return {
    pageId: expectNonEmptyString(object.pageId, `${field}.pageId`, operation),
    image: expectPortablePath(object.image, `${field}.image`, operation),
    width: expectInteger(object.width, `${field}.width`, operation, 1, 4294967295),
    height: expectInteger(object.height, `${field}.height`, operation, 1, 4294967295),
    pixelFormat: expectEnum(object.pixelFormat, ["rgba8"] as const, `${field}.pixelFormat`, operation),
    minFilter: expectEnum(object.minFilter, ["nearest", "linear"] as const, `${field}.minFilter`, operation),
    magFilter: expectEnum(object.magFilter, ["nearest", "linear"] as const, `${field}.magFilter`, operation),
    wrapU: expectEnum(object.wrapU, ["clamp", "repeat", "mirror"] as const, `${field}.wrapU`, operation),
    wrapV: expectEnum(object.wrapV, ["clamp", "repeat", "mirror"] as const, `${field}.wrapV`, operation),
  };
}

function parseAtlasRegion(value: unknown, field: string): AtlasRegionV1 {
  const operation = "loadAtlasJson";
  const object = expectObject(value, field, operation);
  rejectUnknownKeys(
    object,
    new Set([
      "regionId",
      "imageId",
      "pageId",
      "x",
      "y",
      "width",
      "height",
      "sourceWidth",
      "sourceHeight",
      "sourceX",
      "sourceY",
      "rotation",
      "edgeExtension",
      "uvs",
    ]),
    field,
    operation,
  );
  const uvs = parseArray(object.uvs, `${field}.uvs`, operation);
  if (uvs.length !== 4) {
    atlasFail("validationFailed", `${field}.uvs`, "Atlas region must declare exactly four UV pairs.");
  }
  const normalizedUvs = uvs.map((pair, index): [number, number] => {
    const values = parseArray(pair, `${field}.uvs[${index}]`, operation);
    if (values.length !== 2) {
      atlasFail("validationFailed", `${field}.uvs[${index}]`, "Atlas UV pair must contain two values.");
    }
    return [
      expectUnitNumber(values[0], `${field}.uvs[${index}][0]`, operation),
      expectUnitNumber(values[1], `${field}.uvs[${index}][1]`, operation),
    ];
  });
  return {
    regionId: expectNonEmptyString(object.regionId, `${field}.regionId`, operation),
    imageId: expectNonEmptyString(object.imageId, `${field}.imageId`, operation),
    pageId: expectNonEmptyString(object.pageId, `${field}.pageId`, operation),
    x: expectInteger(object.x, `${field}.x`, operation, 0, 4294967295),
    y: expectInteger(object.y, `${field}.y`, operation, 0, 4294967295),
    width: expectInteger(object.width, `${field}.width`, operation, 1, 4294967295),
    height: expectInteger(object.height, `${field}.height`, operation, 1, 4294967295),
    sourceWidth: expectInteger(object.sourceWidth, `${field}.sourceWidth`, operation, 1, 4294967295),
    sourceHeight: expectInteger(object.sourceHeight, `${field}.sourceHeight`, operation, 1, 4294967295),
    sourceX: expectInteger(object.sourceX, `${field}.sourceX`, operation, 0, 4294967295),
    sourceY: expectInteger(object.sourceY, `${field}.sourceY`, operation, 0, 4294967295),
    rotation: expectEnum(object.rotation, ["none", "clockwise90"] as const, `${field}.rotation`, operation),
    edgeExtension: expectInteger(object.edgeExtension, `${field}.edgeExtension`, operation, 0, 4294967295),
    uvs: normalizedUvs,
  };
}

function validateAtlasRegionBounds(region: AtlasRegionV1, page: AtlasPageV1, field: string): void {
  if (region.x + region.width > page.width || region.y + region.height > page.height) {
    atlasFail("validationFailed", field, "Atlas region exceeds its page bounds.", region.regionId);
  }
  const logicalWidth = region.rotation === "none" ? region.width : region.height;
  const logicalHeight = region.rotation === "none" ? region.height : region.width;
  if (region.sourceX + logicalWidth > region.sourceWidth || region.sourceY + logicalHeight > region.sourceHeight) {
    atlasFail("validationFailed", field, "Atlas source trim exceeds the full source extent.", region.regionId);
  }

  const left = region.x / page.width;
  const right = (region.x + region.width) / page.width;
  const top = region.y / page.height;
  const bottom = (region.y + region.height) / page.height;
  const expected: readonly (readonly [number, number])[] = region.rotation === "none"
    ? [[left, top], [right, top], [right, bottom], [left, bottom]]
    : [[right, top], [right, bottom], [left, bottom], [left, top]];
  for (let index = 0; index < expected.length; index += 1) {
    const actual = region.uvs[index];
    const target = expected[index];
    if (
      actual === undefined ||
      target === undefined ||
      Math.abs(actual[0] - target[0]) > 1e-7 ||
      Math.abs(actual[1] - target[1]) > 1e-7
    ) {
      atlasFail("validationFailed", `${field}.uvs[${index}]`, "Atlas UV does not match page rectangle and rotation.", region.regionId);
    }
  }
}

function validateHierarchy(bones: readonly RuntimeBoneV1[]): void {
  const seen = new Set<string>();
  for (let index = 0; index < bones.length; index += 1) {
    const bone = bones[index];
    if (bone === undefined) continue;
    if (bone.parentId !== null && !seen.has(bone.parentId)) {
      fail(
        "missingReference",
        `bones[${index}].parentId`,
        `Bone parent '${bone.parentId}' must exist earlier in declaration order.`,
        bone.id,
      );
    }
    seen.add(bone.id);
  }
}

function validateModelReferences(
  images: readonly RuntimeImageV1[],
  bones: readonly RuntimeBoneV1[],
  slots: readonly RuntimeSlotV1[],
  attachments: readonly RuntimeAttachmentV1[],
  skinPlaceholdersBySlot: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const imageIds = new Set(images.map((image) => image.imageId));
  const boneIds = new Set(bones.map((bone) => bone.id));
  const slotIds = new Set(slots.map((slot) => slot.id));
  const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (slot === undefined) continue;
    if (!boneIds.has(slot.boneId)) {
      fail("missingReference", `slots[${index}].boneId`, `Unknown bone '${slot.boneId}'.`, slot.id);
    }
    if (slot.attachmentId !== null) {
      const attachment = attachmentById.get(slot.attachmentId);
      if (attachment === undefined) {
        if (skinPlaceholdersBySlot.get(slot.id)?.has(slot.attachmentId) !== true) {
          fail(
            "missingReference",
            `slots[${index}].attachmentId`,
            `Unknown attachment or skin placeholder '${slot.attachmentId}'.`,
            slot.id,
          );
        }
      } else if (attachment.slotId !== slot.id) {
        fail(
          "validationFailed",
          `slots[${index}].attachmentId`,
          "A setup attachment must belong to the selecting slot.",
          slot.id,
        );
      }
    }
  }

  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    if (attachment === undefined) continue;
    if (!slotIds.has(attachment.slotId)) {
      fail(
        "missingReference",
        `attachments[${index}].slotId`,
        `Unknown slot '${attachment.slotId}'.`,
        attachment.id,
      );
    }
    if ((attachment.type === "region" || attachment.type === "mesh") && !imageIds.has(attachment.imageId)) {
      fail(
        "missingReference",
        `attachments[${index}].imageId`,
        `Unknown image '${attachment.imageId}'.`,
        attachment.id,
      );
    }
  }
}

function collectSkinPlaceholdersBySlotV1(
  skins: readonly RuntimeSkinV1[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const placeholders = new Map<string, Set<string>>();
  for (const skin of skins) {
    for (const mapping of skin.attachments) {
      if (mapping.name === null || mapping.name.trim().length === 0) continue;
      let names = placeholders.get(mapping.slotId);
      if (names === undefined) {
        names = new Set<string>();
        placeholders.set(mapping.slotId, names);
      }
      names.add(mapping.name);
    }
  }
  return placeholders;
}

function validateAtlasCatalog(
  references: readonly RuntimeAtlasReferenceV1[],
  images: readonly RuntimeImageV1[],
  atlases: readonly AtlasDocumentV1[],
): void {
  const referenceIds = new Set(references.map((reference) => reference.atlasId));
  const atlasById = new Map(atlases.map((atlas) => [atlas.atlasId, atlas]));
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    if (reference !== undefined && !atlasById.has(reference.atlasId)) {
      attachAtlasFail(
        "missingResource",
        null,
        `runtime document requires atlas \`${reference.atlasId}\` at \`${reference.path}\``,
        reference.atlasId,
      );
    }
  }
  for (const atlas of atlases) {
    if (!referenceIds.has(atlas.atlasId)) {
      attachAtlasFail(
        "validationFailed",
        null,
        `atlas \`${atlas.atlasId}\` is not declared by the runtime document`,
        atlas.atlasId,
      );
    }
    const assignedImageIds = new Set(
      images
        .filter((image) => image.atlasId === atlas.atlasId)
        .map((image) => image.imageId),
    );
    const foreignRegion = atlas.regions.find((region) => !assignedImageIds.has(region.imageId));
    if (foreignRegion !== undefined) {
      attachAtlasFail(
        "validationFailed",
        null,
        `atlas \`${atlas.atlasId}\` region \`${foreignRegion.regionId}\` references runtime image \`${foreignRegion.imageId}\` that is not assigned to this atlas`,
        atlas.atlasId,
      );
    }
  }

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    if (image === undefined) continue;
    if (image.atlasId === null) {
      continue;
    }

    const atlas = atlasById.get(image.atlasId);
    if (atlas === undefined) {
      attachAtlasFail("missingResource", null, `runtime document requires atlas \`${image.atlasId}\``, image.atlasId);
    }
    const region = atlas.regions.find((candidate) => candidate.imageId === image.imageId);
    if (region === undefined) {
      attachAtlasFail(
        "missingResource",
        null,
        `atlas \`${image.atlasId}\` has no region for image \`${image.imageId}\``,
        image.imageId,
      );
    }
    if ((image.width !== null && image.width !== region.sourceWidth)
      || (image.height !== null && image.height !== region.sourceHeight)) {
      const width = image.width === null ? "None" : `Some(${image.width})`;
      const height = image.height === null ? "None" : `Some(${image.height})`;
      attachAtlasFail(
        "validationFailed",
        `images.${image.imageId}`,
        `runtime image \`${image.imageId}\` declares ${width}x${height}, but atlas \`${image.atlasId}\` region \`${region.regionId}\` has source extent ${region.sourceWidth}x${region.sourceHeight}`,
        image.imageId,
      );
    }
  }
}

function ensureUniqueAttachedAtlases(atlases: readonly AtlasDocumentV1[]): void {
  const seen = new Set<string>();
  for (const atlas of atlases) {
    if (seen.has(atlas.atlasId)) {
      attachAtlasFail(
        "validationFailed",
        null,
        `atlas \`${atlas.atlasId}\` was attached more than once`,
        atlas.atlasId,
      );
    }
    seen.add(atlas.atlasId);
  }
}

/** Computes the exact sorted Format feature set for a normalized Runtime document candidate. */
export function inferRuntimeRequiredFeaturesV1(
  slots: readonly RuntimeSlotV1[],
  attachments: readonly RuntimeAttachmentV1[],
  constraints: readonly RuntimeConstraintV1[],
  skins: readonly RuntimeSkinV1[],
  events: readonly RuntimeEventDefinitionV1[],
  animations: readonly RuntimeAnimationV1[],
): string[] {
  const features = new Set<string>();
  for (const attachment of attachments) {
    switch (attachment.type) {
      case "region":
        features.add("attachment.region");
        if (attachment.sequence !== null) features.add("attachment.sequence");
        break;
      case "mesh":
        features.add("attachment.mesh");
        if (attachment.weights.some((influences) => influences.length > 0)) features.add("mesh.weighted");
        if (attachment.sequence !== null) features.add("attachment.sequence");
        break;
      case "path":
        features.add("attachment.path");
        if (attachment.weights.some((influences) => influences.length > 0)) features.add("mesh.weighted");
        break;
      case "point":
        features.add("attachment.point");
        break;
      case "boundingbox":
        features.add("attachment.bounding-box");
        if (attachment.weights.some((influences) => influences.length > 0)) features.add("mesh.weighted");
        break;
      case "clipping":
        features.add("attachment.clipping");
        if (attachment.weights.some((influences) => influences.length > 0)) features.add("mesh.weighted");
        break;
    }
  }
  for (const slot of slots) {
    if (slot.blendMode !== "normal") features.add(`blend.${slot.blendMode}`);
    if (slot.darkColor !== null) features.add("tint.two-color");
  }
  if (events.length > 0 || animations.some((animation) => animation.events.length > 0)) {
    features.add("event");
  }
  if (animations.some((animation) => animation.drawOrder.length > 0 || animation.drawOrderFolders.length > 0)) {
    features.add("timeline.draw-order");
  }
  if (animations.some((animation) => animation.slotTimelines.some((timeline) =>
    timeline.color?.some((key) => key.darkColor !== null) === true))) {
    features.add("tint.two-color");
  }
  if (animations.some((animation) => animation.attachmentTimelines.some((timeline) =>
    timeline.deform !== null && timeline.deform.length > 0))) {
    features.add("mesh.deform");
  }
  if (skins.length > 0) features.add("skin");
  if (animations.some((animation) => animation.skins.length > 0)) features.add("timeline.skin");
  for (const constraint of constraints) features.add(`constraint.${constraint.type}`);
  // Array.from is intentional: Creator 3.8.8's legacy-target transform lowers
  // iterable spread as Array#concat, which does not expand Set values.
  return Array.from(features).sort();
}

function validateSliderAnimationReferences(
  constraints: readonly RuntimeConstraintV1[],
  animations: readonly RuntimeAnimationV1[],
): void {
  const animationIds = new Set(animations.map((animation) => animation.id));
  for (let index = 0; index < constraints.length; index += 1) {
    const constraint = constraints[index];
    if (constraint?.type === "slider" && !animationIds.has(constraint.animationId)) {
      fail(
        "missingReference",
        `constraints[${index}].animationId`,
        `Unknown animation '${constraint.animationId}'.`,
        constraint.id,
      );
    }
  }
}

function parseNullableId(value: unknown, field: string): string | null {
  return value === null ? null : expectNonEmptyString(value, field, OPERATION);
}

function parseOptionalPositiveInteger(value: unknown, field: string, operation: string): number | null {
  return value === undefined || value === null ? null : expectInteger(value, field, operation, 1, 4294967295);
}

function parseStringArray(value: unknown, field: string): string[] {
  return parseArray(value, field).map((item, index) =>
    expectNonEmptyString(item, `${field}[${index}]`, OPERATION),
  );
}

function ensureStrictlySortedUnique(values: readonly string[], field: string): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous !== undefined && current !== undefined && previous >= current) {
      fail("validationFailed", field, `${field} must be sorted and contain no duplicates.`);
    }
  }
}

function ensureUniqueIds<T extends object, K extends keyof T>(
  values: readonly T[],
  key: K,
  field: string,
  operation = OPERATION,
): void {
  const seen = new Set<unknown>();
  for (let index = 0; index < values.length; index += 1) {
    const id = values[index]?.[key];
    if (seen.has(id)) {
      throw new RuntimeErrorV1("validationFailed", operation, `Duplicate stable ID '${String(id)}'.`, {
        field: `${field}[${index}].${String(key)}`,
        entityId: typeof id === "string" ? id : null,
      });
    }
    seen.add(id);
  }
}

function ensureUniqueStrings(values: readonly string[], field: string): void {
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    if (seen.has(value)) {
      fail("validationFailed", `${field}[${index}]`, `Duplicate value '${value}'.`, value);
    }
    seen.add(value);
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function expectObject(value: unknown, field: string, operation: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeErrorV1("validationFailed", operation, `Expected object at '${field}'.`, { field });
  }
  return value as Record<string, unknown>;
}

function parseArray(value: unknown, field: string, operation = OPERATION): unknown[] {
  if (!Array.isArray(value)) {
    throw new RuntimeErrorV1("validationFailed", operation, `Expected array at '${field}'.`, { field });
  }
  return value;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
  operation: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new RuntimeErrorV1("malformedInput", operation, `Unknown field '${key}' at '${field}'.`, {
        field: field === "$" ? key : `${field}.${key}`,
      });
    }
  }
}

function expectString(value: unknown, field: string, operation: string): string {
  if (typeof value !== "string") {
    throw new RuntimeErrorV1("validationFailed", operation, `Expected string at '${field}'.`, { field });
  }
  return value;
}

function expectNonEmptyString(value: unknown, field: string, operation: string): string {
  const result = expectString(value, field, operation);
  if (result.length === 0) {
    throw new RuntimeErrorV1("validationFailed", operation, `Expected non-empty string at '${field}'.`, { field });
  }
  return result;
}

function expectPortablePath(value: unknown, field: string, operation: string): string {
  const path = expectNonEmptyString(value, field, operation);
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    path.includes("//") ||
    segments.some((segment) => segment === "." || segment === ".." || segment.length === 0)
  ) {
    throw new RuntimeErrorV1("validationFailed", operation, `Unsafe portable relative path at '${field}'.`, { field });
  }
  return path;
}

function expectInteger(
  value: unknown,
  field: string,
  operation: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number") {
    throw new RuntimeErrorV1("validationFailed", operation, `Expected integer at '${field}'.`, { field });
  }
  if (!Number.isFinite(value)) {
    throw new RuntimeErrorV1("nonFinite", operation, `Expected finite integer at '${field}'.`, { field });
  }
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RuntimeErrorV1("validationFailed", operation, `Integer at '${field}' is outside its valid range.`, { field });
  }
  return value;
}

function expectFiniteF32(value: unknown, field: string, operation = OPERATION): number {
  if (typeof value !== "number") {
    throw new RuntimeErrorV1("validationFailed", operation, `Expected number at '${field}'.`, { field });
  }
  if (!Number.isFinite(value)) {
    throw new RuntimeErrorV1("nonFinite", operation, `Expected finite number at '${field}'.`, { field });
  }
  try {
    return finiteF32(value);
  } catch (error) {
    throw new RuntimeErrorV1("nonFinite", operation, `Value at '${field}' is outside binary32 range.`, {
      field,
      cause: error,
    });
  }
}

function expectNonNegativeFinite(value: unknown, field: string, operation = OPERATION): number {
  const result = expectFiniteF32(value, field, operation);
  if (result < 0) {
    throw new RuntimeErrorV1("validationFailed", operation, `Expected non-negative value at '${field}'.`, { field });
  }
  return result;
}

function expectPositiveFinite(value: unknown, field: string, operation = OPERATION): number {
  const result = expectFiniteF32(value, field, operation);
  if (result <= 0) {
    throw new RuntimeErrorV1("validationFailed", operation, `Expected positive value at '${field}'.`, { field });
  }
  return result;
}

function expectUnitFinite(value: unknown, field: string, operation = OPERATION): number {
  const result = expectFiniteF32(value, field, operation);
  if (result < 0 || result > 1) {
    throw new RuntimeErrorV1("validationFailed", operation, `Expected value in [0,1] at '${field}'.`, { field });
  }
  return result;
}

function expectUnitNumber(value: unknown, field: string, operation: string): number {
  if (typeof value !== "number") {
    throw new RuntimeErrorV1("validationFailed", operation, `Expected number at '${field}'.`, { field });
  }
  if (!Number.isFinite(value)) {
    throw new RuntimeErrorV1("nonFinite", operation, `Expected finite number at '${field}'.`, { field });
  }
  if (value < 0 || value > 1) {
    throw new RuntimeErrorV1("validationFailed", operation, `Expected value in [0,1] at '${field}'.`, { field });
  }
  return value;
}

function expectColor(value: unknown, field: string): string {
  const color = expectString(value, field, OPERATION);
  if (!isRuntimeColorV1(color)) {
    fail("validationFailed", field, "Runtime colors must use #RRGGBB syntax.");
  }
  return color.toLowerCase();
}

function expectEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
  operation: string,
): T[number] {
  const result = expectString(value, field, operation);
  if (!(allowed as readonly string[]).includes(result)) {
    throw new RuntimeErrorV1("validationFailed", operation, `Unsupported value '${result}' at '${field}'.`, { field });
  }
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

function atlasFail(
  name: ConstructorParameters<typeof RuntimeErrorV1>[0],
  field: string,
  message: string,
  entityId: string | null = null,
): never {
  throw new RuntimeErrorV1(name, "loadAtlasJson", message, { field, entityId });
}

function attachAtlasFail(
  name: ConstructorParameters<typeof RuntimeErrorV1>[0],
  field: string | null,
  message: string,
  entityId: string | null = null,
): never {
  throw new RuntimeErrorV1(name, "attachAtlas", message, { field, entityId });
}
