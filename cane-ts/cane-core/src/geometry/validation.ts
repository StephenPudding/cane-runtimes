import type {
  AffineV1,
  RuntimeAttachmentSequenceV1,
  RuntimeAttachmentV1,
  RuntimeBindInverseMapV1,
  RuntimeBoundingBoxAttachmentV1,
  RuntimeClippingAttachmentV1,
  RuntimeMeshAttachmentV1,
  RuntimePathAttachmentV1,
  RuntimePointAttachmentV1,
  RuntimeRegionAttachmentV1,
  RuntimeSlotV1,
  RuntimeWeightV1,
} from "../contracts.js";
import { RuntimeErrorV1 } from "../errors.js";
import { finiteF32 } from "../math/f32.js";
import { isRuntimeColorV1 } from "../render/tint.js";

const OPERATION = "loadJson";
export const MAX_SOURCE_VERTICES_V1 = 65_536;
export const MAX_INFLUENCES_PER_VERTEX_V1 = 16;
export const WEIGHT_SUM_TOLERANCE_V1 = 0.001;
const CLIP_EPSILON = 0.00001;

export interface RuntimeAttachmentParseContextV1 {
  readonly imageIds: ReadonlySet<string>;
  readonly boneIds: ReadonlySet<string>;
  readonly slots: readonly RuntimeSlotV1[];
}

export function parseRuntimeAttachmentsV1(
  input: unknown,
  context: RuntimeAttachmentParseContextV1,
): RuntimeAttachmentV1[] {
  const slotById = new Map(context.slots.map((slot) => [slot.id, slot]));
  const attachments = array(input, "attachments").map((value, index) =>
    parseAttachment(value, `attachments[${index}]`, context.imageIds, context.boneIds, slotById),
  );
  validateLinks(attachments);
  validateClippingEnds(attachments, context.slots);
  return attachments;
}

function parseAttachment(
  value: unknown,
  field: string,
  imageIds: ReadonlySet<string>,
  boneIds: ReadonlySet<string>,
  slotById: ReadonlyMap<string, RuntimeSlotV1>,
): RuntimeAttachmentV1 {
  const object = record(value, field);
  const type = string(object.type, `${field}.type`);
  const id = nonEmptyString(object.id, `${field}.id`);
  const name = nonEmptyString(object.name, `${field}.name`);
  const slotId = nonEmptyString(object.slotId, `${field}.slotId`);
  if (!slotById.has(slotId)) fail("missingReference", `${field}.slotId`, `Unknown slot '${slotId}'.`, id);
  switch (type) {
    case "region":
      return parseRegion(object, field, id, name, slotId, imageIds);
    case "mesh":
      return parseMesh(object, field, id, name, slotId, imageIds, boneIds);
    case "path":
      return parsePath(object, field, id, name, slotId, boneIds);
    case "point":
      return parsePoint(object, field, id, name, slotId);
    case "boundingbox":
      return parseBoundingBox(object, field, id, name, slotId, boneIds);
    case "clipping":
      return parseClipping(object, field, id, name, slotId, boneIds);
    default:
      fail("malformedInput", `${field}.type`, `Unknown attachment type '${type}'.`, id);
  }
}

function parseRegion(
  object: Record<string, unknown>,
  field: string,
  id: string,
  name: string,
  slotId: string,
  imageIds: ReadonlySet<string>,
): RuntimeRegionAttachmentV1 {
  rejectUnknown(object, new Set([
    "type", "id", "name", "slotId", "imageId", "color", "alpha", "sequence",
    "x", "y", "rotation", "scaleX", "scaleY",
  ]), field);
  const imageId = referencedId(object.imageId, `${field}.imageId`, imageIds, "image", id);
  const scaleX = finite(object.scaleX, `${field}.scaleX`);
  const scaleY = finite(object.scaleY, `${field}.scaleY`);
  if (scaleX === 0 || scaleY === 0) fail("validationFailed", field, "Region scales must be non-zero.", id);
  return {
    type: "region",
    id,
    name,
    slotId,
    imageId,
    color: optionalColor(object.color, `${field}.color`, "#ffffff"),
    alpha: optionalUnit(object.alpha, `${field}.alpha`, 1),
    sequence: parseSequence(object.sequence, `${field}.sequence`, imageIds, id),
    x: finite(object.x, `${field}.x`),
    y: finite(object.y, `${field}.y`),
    rotation: finite(object.rotation, `${field}.rotation`),
    scaleX,
    scaleY,
  };
}

function parseMesh(
  object: Record<string, unknown>,
  field: string,
  id: string,
  name: string,
  slotId: string,
  imageIds: ReadonlySet<string>,
  boneIds: ReadonlySet<string>,
): RuntimeMeshAttachmentV1 {
  rejectUnknown(object, new Set([
    "type", "id", "name", "slotId", "imageId", "color", "alpha", "sequence",
    "rows", "cols", "vertices", "uvs", "indices", "weights", "bindInverses", "edges", "hull", "link",
  ]), field);
  const link = parseMeshLink(object.link, `${field}.link`);
  const rows = integer(object.rows, `${field}.rows`, 0, 0xffffffff);
  const cols = integer(object.cols, `${field}.cols`, 0, 0xffffffff);
  const vertices = finiteArray(object.vertices, `${field}.vertices`);
  const uvs = finiteArray(object.uvs, `${field}.uvs`);
  const indices = integerArray(object.indices, `${field}.indices`, 0, 0xffff);
  const bindInverses = parseBindInverses(object.bindInverses, `${field}.bindInverses`, boneIds);
  const weights = parseWeights(object.weights, `${field}.weights`, boneIds, bindInverses);
  const edges = optionalIntegerArray(object.edges, `${field}.edges`, 0, 0xffff);
  const hull = optionalFiniteArray(object.hull, `${field}.hull`);
  const imageId = referencedId(object.imageId, `${field}.imageId`, imageIds, "image", id);

  if (link === null) {
    const vertexCount = validateVertexArray(vertices, `${field}.vertices`, id);
    if (rows === 0 || cols === 0) fail("validationFailed", field, "Non-linked Mesh rows and cols must be positive.", id);
    if (vertexCount !== rows * cols && vertexCount !== (rows + 1) * (cols + 1)) {
      fail("validationFailed", field, "Mesh vertex count does not match rows and cols.", id);
    }
    if (uvs.length !== vertices.length) fail("validationFailed", `${field}.uvs`, "Mesh UV count must equal vertex component count.", id);
    validateWeights(weights, vertexCount, `${field}.weights`, id);
    validateIndices(indices, vertexCount, `${field}.indices`, true, id);
    if (edges !== null) validateIndices(edges, vertexCount, `${field}.edges`, false, id);
    if (hull !== null && hull.length % 2 !== 0) fail("validationFailed", `${field}.hull`, "Mesh hull must contain XY pairs.", id);
  } else if (
    rows !== 0 || cols !== 0 || vertices.length !== 0 || uvs.length !== 0 || indices.length !== 0
    || weights.length !== 0 || bindInverses !== null || edges !== null || hull !== null
  ) {
    fail("validationFailed", field, "Linked Mesh geometry must be inherited rather than redeclared.", id);
  }
  return {
    type: "mesh",
    id,
    name,
    slotId,
    imageId,
    color: optionalColor(object.color, `${field}.color`, "#ffffff"),
    alpha: optionalUnit(object.alpha, `${field}.alpha`, 1),
    sequence: parseSequence(object.sequence, `${field}.sequence`, imageIds, id),
    rows,
    cols,
    vertices,
    uvs,
    indices,
    weights,
    bindInverses,
    edges,
    hull,
    link,
  };
}

function parsePath(
  object: Record<string, unknown>,
  field: string,
  id: string,
  name: string,
  slotId: string,
  boneIds: ReadonlySet<string>,
): RuntimePathAttachmentV1 {
  rejectUnknown(object, new Set([
    "type", "id", "name", "slotId", "closed", "constantSpeed", "lengths", "vertices", "weights", "bindInverses",
  ]), field);
  const vertices = optionalFiniteArray(object.vertices, `${field}.vertices`) ?? [];
  const vertexCount = validateVertexArray(vertices, `${field}.vertices`, id);
  if (vertices.length % 6 !== 0 || vertexCount < 6) {
    fail("validationFailed", `${field}.vertices`, "Path requires at least two knots with three XY pairs per knot.", id);
  }
  const bindInverses = parseBindInverses(object.bindInverses, `${field}.bindInverses`, boneIds);
  const weights = parseWeights(object.weights ?? [], `${field}.weights`, boneIds, bindInverses);
  validateWeights(weights, vertexCount, `${field}.weights`, id);
  const lengths = optionalFiniteArray(object.lengths, `${field}.lengths`) ?? [];
  if (lengths.length !== 0 && lengths.length !== vertices.length / 6) {
    fail("validationFailed", `${field}.lengths`, "Path lengths must contain one cumulative value per knot.", id);
  }
  for (let index = 0; index < lengths.length; index += 1) {
    const current = lengths[index];
    const previous = lengths[index - 1];
    if (current === undefined || current < 0 || (previous !== undefined && current < previous)) {
      fail("validationFailed", `${field}.lengths[${index}]`, "Path lengths must be non-negative and non-decreasing.", id);
    }
  }
  return {
    type: "path",
    id,
    name,
    slotId,
    closed: optionalBoolean(object.closed, `${field}.closed`, false),
    constantSpeed: optionalBoolean(object.constantSpeed, `${field}.constantSpeed`, true),
    lengths,
    vertices,
    weights,
    bindInverses,
  };
}

function parsePoint(
  object: Record<string, unknown>,
  field: string,
  id: string,
  name: string,
  slotId: string,
): RuntimePointAttachmentV1 {
  rejectUnknown(object, new Set(["type", "id", "name", "slotId", "x", "y", "rotation"]), field);
  return {
    type: "point",
    id,
    name,
    slotId,
    x: optionalFinite(object.x, `${field}.x`, 0),
    y: optionalFinite(object.y, `${field}.y`, 0),
    rotation: optionalFinite(object.rotation, `${field}.rotation`, 0),
  };
}

function parseBoundingBox(
  object: Record<string, unknown>,
  field: string,
  id: string,
  name: string,
  slotId: string,
  boneIds: ReadonlySet<string>,
): RuntimeBoundingBoxAttachmentV1 {
  rejectUnknown(object, new Set(["type", "id", "name", "slotId", "vertices", "weights", "bindInverses"]), field);
  const vertices = optionalFiniteArray(object.vertices, `${field}.vertices`) ?? [];
  const vertexCount = validateVertexArray(vertices, `${field}.vertices`, id);
  const bindInverses = parseBindInverses(object.bindInverses, `${field}.bindInverses`, boneIds);
  const weights = parseWeights(object.weights ?? [], `${field}.weights`, boneIds, bindInverses);
  validateWeights(weights, vertexCount, `${field}.weights`, id);
  return { type: "boundingbox", id, name, slotId, vertices, weights, bindInverses };
}

function parseClipping(
  object: Record<string, unknown>,
  field: string,
  id: string,
  name: string,
  slotId: string,
  boneIds: ReadonlySet<string>,
): RuntimeClippingAttachmentV1 {
  rejectUnknown(object, new Set([
    "type", "id", "name", "slotId", "endSlotId", "convex", "inverse", "vertices", "weights", "bindInverses",
  ]), field);
  const vertices = optionalFiniteArray(object.vertices, `${field}.vertices`) ?? [];
  const vertexCount = validateVertexArray(vertices, `${field}.vertices`, id);
  if (vertexCount < 3 || Math.abs(signedArea(vertices)) <= CLIP_EPSILON) {
    fail("validationFailed", `${field}.vertices`, "Clipping attachment requires a non-degenerate polygon.", id);
  }
  const bindInverses = parseBindInverses(object.bindInverses, `${field}.bindInverses`, boneIds);
  const weights = parseWeights(object.weights ?? [], `${field}.weights`, boneIds, bindInverses);
  validateWeights(weights, vertexCount, `${field}.weights`, id);
  return {
    type: "clipping",
    id,
    name,
    slotId,
    endSlotId: nullableId(object.endSlotId, `${field}.endSlotId`),
    convex: optionalBoolean(object.convex, `${field}.convex`, false),
    inverse: optionalBoolean(object.inverse, `${field}.inverse`, false),
    vertices,
    weights,
    bindInverses,
  };
}

function parseSequence(
  value: unknown,
  field: string,
  imageIds: ReadonlySet<string>,
  entityId: string,
): RuntimeAttachmentSequenceV1 | null {
  if (value === undefined || value === null) return null;
  const object = record(value, field);
  rejectUnknown(object, new Set(["imageIds", "setupIndex"]), field);
  const ids = array(object.imageIds, `${field}.imageIds`).map((item, index) =>
    referencedId(item, `${field}.imageIds[${index}]`, imageIds, "image", entityId),
  );
  if (ids.length === 0) fail("validationFailed", `${field}.imageIds`, "Attachment sequence cannot be empty.", entityId);
  const setupIndex = object.setupIndex === undefined ? 0 : integer(object.setupIndex, `${field}.setupIndex`, 0, 0xffffffff);
  if (setupIndex >= ids.length) fail("validationFailed", `${field}.setupIndex`, "Sequence setupIndex is out of range.", entityId);
  return { imageIds: ids, setupIndex };
}

function parseMeshLink(value: unknown, field: string): RuntimeMeshAttachmentV1["link"] {
  if (value === undefined || value === null) return null;
  const object = record(value, field);
  rejectUnknown(object, new Set(["parentMeshId", "inheritDeform"]), field);
  return {
    parentMeshId: nonEmptyString(object.parentMeshId, `${field}.parentMeshId`),
    inheritDeform: optionalBoolean(object.inheritDeform, `${field}.inheritDeform`, true),
  };
}

function parseBindInverses(
  value: unknown,
  field: string,
  boneIds: ReadonlySet<string>,
): RuntimeBindInverseMapV1 | null {
  if (value === undefined || value === null) return null;
  const object = record(value, field);
  const result: Record<string, AffineV1> = {};
  for (const [boneId, matrixValue] of Object.entries(object)) {
    if (!boneIds.has(boneId)) fail("missingReference", `${field}.${boneId}`, `Unknown bone '${boneId}'.`, boneId);
    const matrix = record(matrixValue, `${field}.${boneId}`);
    rejectUnknown(matrix, new Set(["a", "b", "c", "d", "tx", "ty"]), `${field}.${boneId}`);
    result[boneId] = {
      a: finite(matrix.a, `${field}.${boneId}.a`),
      b: finite(matrix.b, `${field}.${boneId}.b`),
      c: finite(matrix.c, `${field}.${boneId}.c`),
      d: finite(matrix.d, `${field}.${boneId}.d`),
      tx: finite(matrix.tx, `${field}.${boneId}.tx`),
      ty: finite(matrix.ty, `${field}.${boneId}.ty`),
    };
  }
  return result;
}

function parseWeights(
  value: unknown,
  field: string,
  boneIds: ReadonlySet<string>,
  bindInverses: RuntimeBindInverseMapV1 | null,
): RuntimeWeightV1[][] {
  return array(value, field).map((rowValue, rowIndex) => {
    const rowField = `${field}[${rowIndex}]`;
    const row = array(rowValue, rowField);
    if (row.length === 0 || row.length > MAX_INFLUENCES_PER_VERTEX_V1) {
      fail("validationFailed", rowField, `Weight rows require 1..${MAX_INFLUENCES_PER_VERTEX_V1} influences.`);
    }
    return row.map((item, influenceIndex) => {
      const influenceField = `${rowField}[${influenceIndex}]`;
      const object = record(item, influenceField);
      rejectUnknown(object, new Set(["boneId", "weight", "x", "y"]), influenceField);
      const boneId = referencedId(object.boneId, `${influenceField}.boneId`, boneIds, "bone", null);
      const x = object.x === undefined || object.x === null ? null : finite(object.x, `${influenceField}.x`);
      const y = object.y === undefined || object.y === null ? null : finite(object.y, `${influenceField}.y`);
      if ((x === null) !== (y === null)) fail("validationFailed", influenceField, "Weight x and y must both be present or both null.");
      if (x === null && bindInverses?.[boneId] === undefined) {
        fail("missingReference", influenceField, `Weight without coordinates requires bind inverse for bone '${boneId}'.`, boneId);
      }
      return { boneId, weight: nonNegative(object.weight, `${influenceField}.weight`), x, y };
    });
  });
}

function validateWeights(weights: readonly (readonly RuntimeWeightV1[])[], vertexCount: number, field: string, entityId: string): void {
  if (weights.length === 0) return;
  if (weights.length !== vertexCount) fail("validationFailed", field, "Weighted geometry requires one row per source point.", entityId);
  for (let index = 0; index < weights.length; index += 1) {
    const row = weights[index];
    const sum = row?.reduce((total, influence) => total + influence.weight, 0) ?? 0;
    if (!Number.isFinite(sum) || Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE_V1) {
      fail("validationFailed", `${field}[${index}]`, "Weight row sum must be within 0.001 of 1.", entityId);
    }
  }
}

function validateLinks(attachments: readonly RuntimeAttachmentV1[]): void {
  const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  for (const attachment of attachments) {
    if (attachment.type !== "mesh" || attachment.link === null) continue;
    const seen = new Set<string>([attachment.id]);
    let current: RuntimeMeshAttachmentV1 = attachment;
    while (current.link !== null) {
      const parent = attachmentById.get(current.link.parentMeshId);
      if (parent === undefined) fail("missingReference", "attachments.link.parentMeshId", `Unknown parent Mesh '${current.link.parentMeshId}'.`, attachment.id);
      if (parent.type !== "mesh") fail("validationFailed", "attachments.link.parentMeshId", "Linked Mesh parent must be a Mesh.", attachment.id);
      if (seen.has(parent.id)) fail("validationFailed", "attachments.link", "Linked Mesh cycle detected.", attachment.id);
      seen.add(parent.id);
      current = parent;
    }
  }
}

function validateClippingEnds(attachments: readonly RuntimeAttachmentV1[], slots: readonly RuntimeSlotV1[]): void {
  const setupOrder = slots
    .map((slot, declaration) => ({ slot, declaration }))
    .sort((left, right) => left.slot.zIndex - right.slot.zIndex || left.declaration - right.declaration)
    .map(({ slot }) => slot.id);
  const order = new Map(setupOrder.map((slotId, index) => [slotId, index]));
  for (const attachment of attachments) {
    if (attachment.type !== "clipping" || attachment.endSlotId === null) continue;
    const start = order.get(attachment.slotId);
    const end = order.get(attachment.endSlotId);
    if (end === undefined) fail("missingReference", "attachments.endSlotId", `Unknown end slot '${attachment.endSlotId}'.`, attachment.id);
    if (start !== undefined && end < start) fail("validationFailed", "attachments.endSlotId", "Clipping end slot precedes its owning slot.", attachment.id);
  }
}

function validateVertexArray(vertices: readonly number[], field: string, entityId: string): number {
  if (vertices.length % 2 !== 0) fail("validationFailed", field, "Vertex arrays must contain XY pairs.", entityId);
  const count = vertices.length / 2;
  if (count > MAX_SOURCE_VERTICES_V1) {
    fail(
      "resourceLimit",
      field,
      `attachment \`${entityId}\` has ${count} source vertices; Runtime Format v1 allows at most ${MAX_SOURCE_VERTICES_V1} per attachment`,
    );
  }
  return count;
}

function validateIndices(indices: readonly number[], vertexCount: number, field: string, triangles: boolean, entityId: string): void {
  if (triangles && indices.length % 3 !== 0) fail("validationFailed", field, "Triangle indices must use triples.", entityId);
  if (!triangles && indices.length % 2 !== 0) fail("validationFailed", field, "Edge indices must use pairs.", entityId);
  for (let index = 0; index < indices.length; index += 1) {
    if ((indices[index] ?? vertexCount) >= vertexCount) fail("validationFailed", `${field}[${index}]`, "Geometry index is out of range.", entityId);
  }
}

function signedArea(vertices: readonly number[]): number {
  let twiceArea = 0;
  const count = vertices.length / 2;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    twiceArea += (vertices[index * 2] ?? 0) * (vertices[next * 2 + 1] ?? 0)
      - (vertices[next * 2] ?? 0) * (vertices[index * 2 + 1] ?? 0);
  }
  return twiceArea * 0.5;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("validationFailed", field, `Expected object at '${field}'.`);
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
  if (result.length === 0 || result.includes("\0")) fail("validationFailed", field, `Expected non-empty NUL-free string at '${field}'.`);
  return result;
}

function nullableId(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : nonEmptyString(value, field);
}

function referencedId(
  value: unknown,
  field: string,
  ids: ReadonlySet<string>,
  kind: string,
  entityId: string | null,
): string {
  const id = nonEmptyString(value, field);
  if (!ids.has(id)) fail("missingReference", field, `Unknown ${kind} '${id}'.`, entityId ?? id);
  return id;
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

function optionalFinite(value: unknown, field: string, fallback: number): number {
  return value === undefined || value === null ? fallback : finite(value, field);
}

function nonNegative(value: unknown, field: string): number {
  const result = finite(value, field);
  if (result < 0) fail("validationFailed", field, `Expected non-negative number at '${field}'.`);
  return result;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum) {
    fail("validationFailed", field, `Expected integer in [${minimum},${maximum}] at '${field}'.`);
  }
  return value;
}

function finiteArray(value: unknown, field: string): number[] {
  return array(value, field).map((item, index) => finite(item, `${field}[${index}]`));
}

function optionalFiniteArray(value: unknown, field: string): number[] | null {
  return value === undefined || value === null ? null : finiteArray(value, field);
}

function integerArray(value: unknown, field: string, minimum: number, maximum: number): number[] {
  return array(value, field).map((item, index) => integer(item, `${field}[${index}]`, minimum, maximum));
}

function optionalIntegerArray(value: unknown, field: string, minimum: number, maximum: number): number[] | null {
  return value === undefined || value === null ? null : integerArray(value, field, minimum, maximum);
}

function optionalBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") fail("validationFailed", field, `Expected boolean at '${field}'.`);
  return value;
}

function optionalUnit(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const result = finite(value, field);
  if (result < 0 || result > 1) fail("validationFailed", field, `Expected value in [0,1] at '${field}'.`);
  return result;
}

function optionalColor(value: unknown, field: string, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  const raw = string(value, field);
  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  if (!isRuntimeColorV1(normalized)) fail("validationFailed", field, "Runtime colors require six hexadecimal RGB digits.");
  return normalized.toLowerCase();
}

function fail(
  name: ConstructorParameters<typeof RuntimeErrorV1>[0],
  field: string,
  message: string,
  entityId: string | null = null,
): never {
  throw new RuntimeErrorV1(name, OPERATION, message, { field, entityId });
}
