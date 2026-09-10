import type {
  RuntimeCustomGeometryModifierV1,
  RuntimeFinalTintV1,
  RuntimeGeometryEditorV1,
  RuntimeGeometryModifierContextV1,
  RuntimeGeometryModifierOperationV1,
  RuntimeGeometryModifiersV1,
  RuntimeGeometryModifierStatsV1,
  RuntimeRenderAttachmentV1,
} from "./contracts.js";
import type { RuntimeDataV1 } from "./data.js";
import { RuntimeErrorV1 } from "./errors.js";
import { f32 } from "./math/f32.js";

export const EMPTY_GEOMETRY_MODIFIERS_V1: RuntimeGeometryModifiersV1 = Object.freeze({
  operations: Object.freeze([] as RuntimeGeometryModifierOperationV1[]),
});

const MAX_GEOMETRY_MODIFIER_OPERATIONS_V1 = 1_000_000;
const TWO_PI_V1 = Math.PI * 2;
const DEGREES_TO_RADIANS_V1 = Math.PI / 180;

type MutableRuntimeGeometryModifierStatsV1 = {
  -readonly [Key in keyof RuntimeGeometryModifierStatsV1]: RuntimeGeometryModifierStatsV1[Key]
};

type MutableRuntimeRenderAttachmentV1 = {
  -readonly [Key in keyof RuntimeRenderAttachmentV1]: RuntimeRenderAttachmentV1[Key]
};

interface MutableRuntimeFinalTintV1 {
  readonly lightRgb: [number, number, number];
  alpha: number;
  darkRgb: [number, number, number] | null;
}

interface RuntimeGeometryAttachmentStorageV1 {
  readonly worldVerticesXy: number[];
  readonly uvs: number[];
  readonly lightRgb: [number, number, number];
  readonly darkRgb: [number, number, number];
  readonly tint: MutableRuntimeFinalTintV1;
  readonly baselineTriangleAreas: number[];
}

export interface RuntimeGeometryModifierWorkspaceV1 {
  readonly attachmentStorage: Map<string, RuntimeGeometryAttachmentStorageV1>;
  readonly stats: MutableRuntimeGeometryModifierStatsV1;
}

interface RuntimeGeometryModifierPerformanceWorkspaceV1 extends RuntimeGeometryModifierWorkspaceV1 {
  readonly editor: RuntimeGeometryEditorImplV1;
  readonly context: MutableRuntimeGeometryModifierContextV1;
}

export function createRuntimeGeometryModifierWorkspaceV1(): RuntimeGeometryModifierWorkspaceV1 {
  const stats = emptyGeometryModifierStatsV1();
  const workspace: RuntimeGeometryModifierPerformanceWorkspaceV1 = {
    attachmentStorage: new Map(),
    stats,
    editor: new RuntimeGeometryEditorImplV1(stats),
    context: {
      sequence: 0,
      timeSeconds: 0,
      persistent: true,
      operationIndex: 0,
    },
  };
  return workspace;
}

export function cloneRuntimeGeometryModifiersV1(
  modifiers: RuntimeGeometryModifiersV1,
): RuntimeGeometryModifiersV1 {
  return Object.freeze({
    operations: Object.freeze(modifiers.operations.map((operation) => Object.freeze({
      ...operation,
      ...(operation.attachmentIds === undefined
        ? {}
        : { attachmentIds: Object.freeze([...operation.attachmentIds]) }),
      ...(operation.slotIds === undefined ? {} : { slotIds: Object.freeze([...operation.slotIds]) }),
    }))),
  });
}

export function validateRuntimeGeometryModifiersV1(
  data: RuntimeDataV1,
  modifiers: RuntimeGeometryModifiersV1,
  operation: string,
): void {
  if (modifiers === null || typeof modifiers !== "object" || !Array.isArray(modifiers.operations)) {
    throw invalidGeometryModifierV1(operation, "geometryModifiers.operations", "operations must be an array.");
  }
  if (modifiers.operations.length > MAX_GEOMETRY_MODIFIER_OPERATIONS_V1) {
    throw invalidGeometryModifierV1(
      operation,
      "geometryModifiers.operations",
      `operations exceeds ${MAX_GEOMETRY_MODIFIER_OPERATIONS_V1}.`,
    );
  }
  for (let index = 0; index < modifiers.operations.length; index += 1) {
    const modifier = modifiers.operations[index];
    const field = `geometryModifiers.operations[${index}]`;
    if (modifier === undefined || modifier === null || typeof modifier !== "object") {
      throw invalidGeometryModifierV1(operation, field, "Geometry modifier must be an object.");
    }
    validateFilterV1(data, modifier, operation, field);
    switch (modifier.type) {
      case "deterministicJitter":
        requireUint32V1(modifier.seed, operation, `${field}.seed`);
        requireFiniteV1(modifier.amplitudeX, operation, `${field}.amplitudeX`);
        requireFiniteV1(modifier.amplitudeY, operation, `${field}.amplitudeY`);
        requireNonNegativeV1(modifier.frequencyHz ?? 0, operation, `${field}.frequencyHz`);
        break;
      case "radialWave":
        requireFiniteV1(modifier.centerX, operation, `${field}.centerX`);
        requireFiniteV1(modifier.centerY, operation, `${field}.centerY`);
        requireFiniteV1(modifier.radialAmplitude, operation, `${field}.radialAmplitude`);
        requireFiniteV1(modifier.angularAmplitudeDegrees, operation, `${field}.angularAmplitudeDegrees`);
        requirePositiveV1(modifier.wavelength, operation, `${field}.wavelength`);
        requireFiniteV1(modifier.phaseDegrees ?? 0, operation, `${field}.phaseDegrees`);
        requireFiniteV1(modifier.speedHz ?? 0, operation, `${field}.speedHz`);
        requireNonNegativeV1(modifier.radius ?? 0, operation, `${field}.radius`);
        break;
      case "custom":
        if (typeof modifier.apply !== "function") {
          throw invalidGeometryModifierV1(operation, `${field}.apply`, "Custom modifier apply must be a function.");
        }
        break;
      default:
        throw invalidGeometryModifierV1(operation, `${field}.type`, "Unknown geometry modifier type.");
    }
  }
}

/**
 * Applies ordered persistent then transient effects to candidate Core output.
 * The caller must discard the complete candidate frame if this function throws.
 */
export function applyRuntimeGeometryModifiersV1(
  attachments: readonly RuntimeRenderAttachmentV1[],
  persistent: RuntimeGeometryModifiersV1,
  transient: RuntimeGeometryModifiersV1,
  sequence: number,
  timeSeconds: number,
  workspace: RuntimeGeometryModifierWorkspaceV1 | null,
): RuntimeGeometryModifierStatsV1 {
  const stats = workspace?.stats ?? emptyGeometryModifierStatsV1();
  resetGeometryModifierStatsV1(stats, persistent.operations.length, transient.operations.length);
  if (persistent.operations.length === 0 && transient.operations.length === 0) return stats;

  const performanceWorkspace = workspace as RuntimeGeometryModifierPerformanceWorkspaceV1 | null;
  const storageByAttachment = workspace?.attachmentStorage ?? new Map<string, RuntimeGeometryAttachmentStorageV1>();
  prepareCandidateAttachmentsV1(attachments, storageByAttachment, persistent, transient);
  const editor = performanceWorkspace?.editor ?? new RuntimeGeometryEditorImplV1(stats);
  const context = performanceWorkspace?.context ?? {
    sequence: 0,
    timeSeconds: 0,
    persistent: true,
    operationIndex: 0,
  };
  context.sequence = sequence;
  context.timeSeconds = timeSeconds;

  applyModifierListV1(attachments, persistent, true, timeSeconds, editor, context, stats);
  applyModifierListV1(attachments, transient, false, timeSeconds, editor, context, stats);
  editor.deactivate();
  validateCandidateAttachmentsV1(attachments, storageByAttachment, persistent, transient);
  return stats;
}

type MutableRuntimeGeometryModifierContextV1 = {
  -readonly [Key in keyof RuntimeGeometryModifierContextV1]: RuntimeGeometryModifierContextV1[Key]
};

class RuntimeGeometryEditorImplV1 implements RuntimeGeometryEditorV1 {
  readonly #stats: MutableRuntimeGeometryModifierStatsV1;
  #attachment: MutableRuntimeRenderAttachmentV1 | null = null;

  constructor(stats: MutableRuntimeGeometryModifierStatsV1) {
    this.#stats = stats;
  }

  activate(attachment: RuntimeRenderAttachmentV1): void {
    this.#attachment = attachment as MutableRuntimeRenderAttachmentV1;
  }

  deactivate(): void {
    this.#attachment = null;
  }

  get slotId(): string {
    return this.#requireActive().slotId;
  }

  get attachmentId(): string {
    return this.#requireActive().attachmentId;
  }

  get drawIndex(): number {
    return this.#requireActive().drawIndex;
  }

  get vertexCount(): number {
    return this.#requireActive().worldVerticesXy.length / 2;
  }

  writePosition(vertexIndex: number, output: { x: number; y: number }): boolean {
    const attachment = this.#requireActive();
    if (output === null || typeof output !== "object") {
      throw invalidGeometryModifierV1("geometryModifier", "output", "output must be an object.");
    }
    if (!validVertexIndexV1(attachment, vertexIndex)) return false;
    output.x = attachment.worldVerticesXy[vertexIndex * 2] as number;
    output.y = attachment.worldVerticesXy[vertexIndex * 2 + 1] as number;
    return true;
  }

  setPosition(vertexIndex: number, x: number, y: number): void {
    const attachment = this.#requireVertex(vertexIndex);
    requireFiniteV1(x, "geometryModifier", "x");
    requireFiniteV1(y, "geometryModifier", "y");
    const vertices = attachment.worldVerticesXy as number[];
    vertices[vertexIndex * 2] = f32(x);
    vertices[vertexIndex * 2 + 1] = f32(y);
    this.#stats.vertexWrites += 1;
  }

  addPosition(vertexIndex: number, deltaX: number, deltaY: number): void {
    const attachment = this.#requireVertex(vertexIndex);
    requireFiniteV1(deltaX, "geometryModifier", "deltaX");
    requireFiniteV1(deltaY, "geometryModifier", "deltaY");
    const vertices = attachment.worldVerticesXy as number[];
    const offset = vertexIndex * 2;
    vertices[offset] = f32((vertices[offset] as number) + deltaX);
    vertices[offset + 1] = f32((vertices[offset + 1] as number) + deltaY);
    this.#stats.vertexWrites += 1;
  }

  writeUv(vertexIndex: number, output: { u: number; v: number }): boolean {
    const attachment = this.#requireActive();
    if (output === null || typeof output !== "object") {
      throw invalidGeometryModifierV1("geometryModifier", "output", "output must be an object.");
    }
    if (!validVertexIndexV1(attachment, vertexIndex)) return false;
    output.u = attachment.uvs[vertexIndex * 2] as number;
    output.v = attachment.uvs[vertexIndex * 2 + 1] as number;
    return true;
  }

  setUv(vertexIndex: number, u: number, v: number): void {
    const attachment = this.#requireVertex(vertexIndex);
    requireFiniteV1(u, "geometryModifier", "u");
    requireFiniteV1(v, "geometryModifier", "v");
    const uvs = attachment.uvs as number[];
    uvs[vertexIndex * 2] = f32(u);
    uvs[vertexIndex * 2 + 1] = f32(v);
    this.#stats.uvWrites += 1;
  }

  setLightTint(red: number, green: number, blue: number, alpha: number): void {
    const attachment = this.#requireActive();
    requireByteV1(red, "redByte");
    requireByteV1(green, "greenByte");
    requireByteV1(blue, "blueByte");
    requireUnitV1(alpha, "alpha");
    const tint = attachment.tint as MutableRuntimeFinalTintV1;
    tint.lightRgb[0] = red;
    tint.lightRgb[1] = green;
    tint.lightRgb[2] = blue;
    tint.alpha = f32(alpha);
    this.#stats.tintWrites += 1;
  }

  setDarkTint(red: number, green: number, blue: number): void {
    const attachment = this.#requireActive();
    requireByteV1(red, "redByte");
    requireByteV1(green, "greenByte");
    requireByteV1(blue, "blueByte");
    const tint = attachment.tint as MutableRuntimeFinalTintV1;
    const dark = tint.darkRgb ?? [0, 0, 0];
    dark[0] = red;
    dark[1] = green;
    dark[2] = blue;
    tint.darkRgb = dark;
    attachment.twoColor = true;
    this.#stats.tintWrites += 1;
  }

  clearDarkTint(): void {
    const attachment = this.#requireActive();
    (attachment.tint as MutableRuntimeFinalTintV1).darkRgb = null;
    attachment.twoColor = false;
    this.#stats.tintWrites += 1;
  }

  #requireVertex(vertexIndex: number): MutableRuntimeRenderAttachmentV1 {
    const attachment = this.#requireActive();
    if (!validVertexIndexV1(attachment, vertexIndex)) {
      throw invalidGeometryModifierV1(
        "geometryModifier",
        "vertexIndex",
        "vertexIndex is outside the candidate attachment.",
        attachment.attachmentId,
      );
    }
    return attachment;
  }

  #requireActive(): MutableRuntimeRenderAttachmentV1 {
    if (this.#attachment === null) {
      throw new RuntimeErrorV1(
        "invalidState",
        "geometryModifier",
        "Geometry editor is valid only while its custom modifier callback is running.",
      );
    }
    return this.#attachment;
  }
}

function prepareCandidateAttachmentsV1(
  attachments: readonly RuntimeRenderAttachmentV1[],
  storageByAttachment: Map<string, RuntimeGeometryAttachmentStorageV1>,
  persistent: RuntimeGeometryModifiersV1,
  transient: RuntimeGeometryModifiersV1,
): void {
  for (let index = 0; index < attachments.length; index += 1) {
    const source = attachments[index];
    if (source === undefined
      || !modifierListsTargetAttachmentV1(persistent, transient, source)) continue;
    let storage = storageByAttachment.get(source.attachmentId);
    if (storage === undefined) {
      const lightRgb: [number, number, number] = [0, 0, 0];
      const darkRgb: [number, number, number] = [0, 0, 0];
      storage = {
        worldVerticesXy: [],
        uvs: [],
        lightRgb,
        darkRgb,
        tint: { lightRgb, alpha: 1, darkRgb: null },
        baselineTriangleAreas: [],
      };
      storageByAttachment.set(source.attachmentId, storage);
    }
    copyNumbersV1(storage.worldVerticesXy, source.worldVerticesXy);
    copyNumbersV1(storage.uvs, source.uvs);
    storage.lightRgb[0] = source.tint.lightRgb[0];
    storage.lightRgb[1] = source.tint.lightRgb[1];
    storage.lightRgb[2] = source.tint.lightRgb[2];
    storage.tint.alpha = source.tint.alpha;
    if (source.tint.darkRgb === null) {
      storage.tint.darkRgb = null;
    } else {
      storage.darkRgb[0] = source.tint.darkRgb[0];
      storage.darkRgb[1] = source.tint.darkRgb[1];
      storage.darkRgb[2] = source.tint.darkRgb[2];
      storage.tint.darkRgb = storage.darkRgb;
    }
    writeTriangleAreasV1(storage.baselineTriangleAreas, source.worldVerticesXy, source.indices);
    const candidate = source as MutableRuntimeRenderAttachmentV1;
    candidate.worldVerticesXy = storage.worldVerticesXy;
    candidate.uvs = storage.uvs;
    candidate.tint = storage.tint as RuntimeFinalTintV1;
    candidate.twoColor = storage.tint.darkRgb !== null;
  }
}

function applyModifierListV1(
  attachments: readonly RuntimeRenderAttachmentV1[],
  modifiers: RuntimeGeometryModifiersV1,
  persistent: boolean,
  timeSeconds: number,
  editor: RuntimeGeometryEditorImplV1,
  context: MutableRuntimeGeometryModifierContextV1,
  stats: MutableRuntimeGeometryModifierStatsV1,
): void {
  context.persistent = persistent;
  for (let operationIndex = 0; operationIndex < modifiers.operations.length; operationIndex += 1) {
    const modifier = modifiers.operations[operationIndex];
    if (modifier === undefined) continue;
    context.operationIndex = operationIndex;
    for (let attachmentIndex = 0; attachmentIndex < attachments.length; attachmentIndex += 1) {
      const attachment = attachments[attachmentIndex];
      if (attachment === undefined || !modifierTargetsAttachmentV1(modifier, attachment)) continue;
      stats.attachmentVisits += 1;
      switch (modifier.type) {
        case "deterministicJitter":
          applyJitterV1(attachment, modifier, timeSeconds, stats);
          break;
        case "radialWave":
          applyRadialWaveV1(attachment, modifier, timeSeconds, stats);
          break;
        case "custom":
          applyCustomV1(attachment, modifier, editor, context);
          break;
      }
    }
  }
}

function applyCustomV1(
  attachment: RuntimeRenderAttachmentV1,
  modifier: RuntimeCustomGeometryModifierV1,
  editor: RuntimeGeometryEditorImplV1,
  context: RuntimeGeometryModifierContextV1,
): void {
  editor.activate(attachment);
  try {
    modifier.apply(editor, context);
  } finally {
    editor.deactivate();
  }
}

function applyJitterV1(
  attachment: RuntimeRenderAttachmentV1,
  modifier: Extract<RuntimeGeometryModifierOperationV1, { type: "deterministicJitter" }>,
  timeSeconds: number,
  stats: MutableRuntimeGeometryModifierStatsV1,
): void {
  const vertices = attachment.worldVerticesXy as number[];
  const frequency = modifier.frequencyHz ?? 0;
  const tick = frequency === 0 ? 0 : (Math.trunc(Math.floor(timeSeconds * frequency)) >>> 0);
  for (let offset = 0, vertexIndex = 0; offset < vertices.length; offset += 2, vertexIndex += 1) {
    const randomX = signedHashV1(modifier.seed, attachment.drawIndex, vertexIndex, tick, 0x68bc21eb);
    const randomY = signedHashV1(modifier.seed, attachment.drawIndex, vertexIndex, tick, 0x02e5be93);
    vertices[offset] = f32((vertices[offset] as number) + randomX * modifier.amplitudeX);
    vertices[offset + 1] = f32((vertices[offset + 1] as number) + randomY * modifier.amplitudeY);
    stats.vertexWrites += 1;
  }
}

function applyRadialWaveV1(
  attachment: RuntimeRenderAttachmentV1,
  modifier: Extract<RuntimeGeometryModifierOperationV1, { type: "radialWave" }>,
  timeSeconds: number,
  stats: MutableRuntimeGeometryModifierStatsV1,
): void {
  const vertices = attachment.worldVerticesXy as number[];
  const radius = modifier.radius ?? 0;
  const phase = (modifier.phaseDegrees ?? 0) * DEGREES_TO_RADIANS_V1
    + timeSeconds * (modifier.speedHz ?? 0) * TWO_PI_V1;
  for (let offset = 0; offset < vertices.length; offset += 2) {
    const dx = (vertices[offset] as number) - modifier.centerX;
    const dy = (vertices[offset + 1] as number) - modifier.centerY;
    const distance = Math.hypot(dx, dy);
    const falloff = radius === 0 ? 1 : Math.max(0, 1 - distance / radius);
    if (falloff <= 0) continue;
    const wave = Math.sin(phase + distance / modifier.wavelength * TWO_PI_V1);
    const nextDistance = distance + modifier.radialAmplitude * wave * falloff;
    const nextAngle = Math.atan2(dy, dx)
      + modifier.angularAmplitudeDegrees * DEGREES_TO_RADIANS_V1 * wave * falloff;
    vertices[offset] = f32(modifier.centerX + Math.cos(nextAngle) * nextDistance);
    vertices[offset + 1] = f32(modifier.centerY + Math.sin(nextAngle) * nextDistance);
    stats.vertexWrites += 1;
  }
}

function validateCandidateAttachmentsV1(
  attachments: readonly RuntimeRenderAttachmentV1[],
  storageByAttachment: ReadonlyMap<string, RuntimeGeometryAttachmentStorageV1>,
  persistent: RuntimeGeometryModifiersV1,
  transient: RuntimeGeometryModifiersV1,
): void {
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    if (attachment === undefined
      || !modifierListsTargetAttachmentV1(persistent, transient, attachment)) continue;
    if (attachment.worldVerticesXy.length !== attachment.uvs.length
      || attachment.worldVerticesXy.length % 2 !== 0
      || !allFiniteV1(attachment.worldVerticesXy)
      || !allFiniteV1(attachment.uvs)) {
      throw new RuntimeErrorV1(
        "validationFailed",
        "geometryModifier",
        "Geometry modifier produced invalid position or UV buffers.",
        { entityId: attachment.attachmentId },
      );
    }
    const tint = attachment.tint;
    const validLight = validByteColorV1(tint.lightRgb);
    const validDark = tint.darkRgb === null
      || validByteColorV1(tint.darkRgb);
    if (!validLight || !validDark || !Number.isFinite(tint.alpha) || tint.alpha < 0 || tint.alpha > 1) {
      throw new RuntimeErrorV1(
        "validationFailed",
        "geometryModifier",
        "Geometry modifier produced an invalid tint.",
        { entityId: attachment.attachmentId },
      );
    }
    const baseline = storageByAttachment.get(attachment.attachmentId)?.baselineTriangleAreas;
    if (baseline === undefined) continue;
    for (let triangle = 0; triangle < attachment.indices.length / 3; triangle += 1) {
      const area = triangleAreaForIndexV1(attachment.worldVerticesXy, attachment.indices, triangle);
      const baselineArea = baseline[triangle] ?? 0;
      if (!Number.isFinite(area) || (baselineArea > 0 && area <= 0) || (baselineArea < 0 && area >= 0)) {
        throw new RuntimeErrorV1(
          "validationFailed",
          "geometryModifier",
          "Geometry modifier inverted or collapsed a non-degenerate triangle.",
          { entityId: attachment.attachmentId },
        );
      }
    }
  }
}

function validateFilterV1(
  data: RuntimeDataV1,
  modifier: RuntimeGeometryModifierOperationV1,
  operation: string,
  field: string,
): void {
  if (modifier.attachmentIds !== undefined) {
    validateTargetIdsV1(modifier.attachmentIds, operation, `${field}.attachmentIds`, (id) => {
      data.attachment(id);
    });
  }
  if (modifier.slotIds !== undefined) {
    validateTargetIdsV1(modifier.slotIds, operation, `${field}.slotIds`, (id) => {
      data.slot(id);
    });
  }
}

function validateTargetIdsV1(
  ids: readonly string[],
  operation: string,
  field: string,
  resolve: (id: string) => void,
): void {
  if (!Array.isArray(ids)) throw invalidGeometryModifierV1(operation, field, `${field} must be an array.`);
  const seen = new Set<string>();
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (typeof id !== "string" || id.length === 0 || id.includes("\0")) {
      throw invalidGeometryModifierV1(operation, `${field}[${index}]`, "Target ID must be a non-empty NUL-free string.");
    }
    if (seen.has(id)) {
      throw invalidGeometryModifierV1(operation, `${field}[${index}]`, "Target IDs must not contain duplicates.", id);
    }
    seen.add(id);
    try {
      resolve(id);
    } catch (error) {
      if (error instanceof RuntimeErrorV1) {
        throw new RuntimeErrorV1(error.runtimeName, operation, error.message, {
          field: `${field}[${index}]`,
          entityId: id,
          cause: error,
        });
      }
      throw error;
    }
  }
}

function modifierTargetsAttachmentV1(
  modifier: RuntimeGeometryModifierOperationV1,
  attachment: RuntimeRenderAttachmentV1,
): boolean {
  return (modifier.attachmentIds === undefined
      || modifier.attachmentIds.length === 0
      || modifier.attachmentIds.includes(attachment.attachmentId))
    && (modifier.slotIds === undefined
      || modifier.slotIds.length === 0
      || modifier.slotIds.includes(attachment.slotId));
}

function modifierListsTargetAttachmentV1(
  persistent: RuntimeGeometryModifiersV1,
  transient: RuntimeGeometryModifiersV1,
  attachment: RuntimeRenderAttachmentV1,
): boolean {
  for (let index = 0; index < persistent.operations.length; index += 1) {
    const modifier = persistent.operations[index];
    if (modifier !== undefined && modifierTargetsAttachmentV1(modifier, attachment)) return true;
  }
  for (let index = 0; index < transient.operations.length; index += 1) {
    const modifier = transient.operations[index];
    if (modifier !== undefined && modifierTargetsAttachmentV1(modifier, attachment)) return true;
  }
  return false;
}

function allFiniteV1(values: readonly number[]): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) return false;
  }
  return true;
}

function validByteColorV1(values: readonly number[]): boolean {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 255) return false;
  }
  return true;
}

function validVertexIndexV1(attachment: RuntimeRenderAttachmentV1, vertexIndex: number): boolean {
  return Number.isInteger(vertexIndex) && vertexIndex >= 0 && vertexIndex < attachment.worldVerticesXy.length / 2;
}

function signedHashV1(
  seed: number,
  drawIndex: number,
  vertexIndex: number,
  tick: number,
  salt: number,
): number {
  let hash = (seed >>> 0)
    ^ Math.imul((drawIndex + 1) >>> 0, 0x9e3779b9)
    ^ Math.imul((vertexIndex + 1) >>> 0, 0x85ebca6b)
    ^ Math.imul(tick >>> 0, 0xc2b2ae35)
    ^ salt;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4_294_967_295 * 2 - 1;
}

function writeTriangleAreasV1(
  output: number[],
  vertices: readonly number[],
  indices: readonly number[],
): void {
  const count = indices.length / 3;
  output.length = count;
  for (let triangle = 0; triangle < count; triangle += 1) {
    output[triangle] = triangleAreaForIndexV1(vertices, indices, triangle);
  }
}

function triangleAreaForIndexV1(
  vertices: readonly number[],
  indices: readonly number[],
  triangle: number,
): number {
  const a = indices[triangle * 3];
  const b = indices[triangle * 3 + 1];
  const c = indices[triangle * 3 + 2];
  if (a === undefined || b === undefined || c === undefined) return Number.NaN;
  const ax = vertices[a * 2];
  const ay = vertices[a * 2 + 1];
  const bx = vertices[b * 2];
  const by = vertices[b * 2 + 1];
  const cx = vertices[c * 2];
  const cy = vertices[c * 2 + 1];
  if (ax === undefined || ay === undefined || bx === undefined || by === undefined
    || cx === undefined || cy === undefined) return Number.NaN;
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function copyNumbersV1(target: number[], source: readonly number[]): void {
  target.length = source.length;
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index];
    if (value !== undefined) target[index] = value;
  }
}

function emptyGeometryModifierStatsV1(): MutableRuntimeGeometryModifierStatsV1 {
  return {
    persistentOperations: 0,
    transientOperations: 0,
    attachmentVisits: 0,
    vertexWrites: 0,
    uvWrites: 0,
    tintWrites: 0,
  };
}

function resetGeometryModifierStatsV1(
  stats: MutableRuntimeGeometryModifierStatsV1,
  persistentOperations: number,
  transientOperations: number,
): void {
  stats.persistentOperations = persistentOperations;
  stats.transientOperations = transientOperations;
  stats.attachmentVisits = 0;
  stats.vertexWrites = 0;
  stats.uvWrites = 0;
  stats.tintWrites = 0;
}

function requireFiniteV1(value: number, operation: string, field: string): void {
  if (!Number.isFinite(value)) throw invalidGeometryModifierV1(operation, field, `${field} must be finite.`);
}

function requireUint32V1(value: number, operation: string, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw invalidGeometryModifierV1(operation, field, `${field} must be an unsigned 32-bit integer.`);
  }
}

function requireNonNegativeV1(value: number, operation: string, field: string): void {
  requireFiniteV1(value, operation, field);
  if (value < 0) throw invalidGeometryModifierV1(operation, field, `${field} must be non-negative.`);
}

function requirePositiveV1(value: number, operation: string, field: string): void {
  requireFiniteV1(value, operation, field);
  if (!(value > 0)) throw invalidGeometryModifierV1(operation, field, `${field} must be positive.`);
}

function requireUnitV1(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidGeometryModifierV1("geometryModifier", field, `${field} must be finite and within [0, 1].`);
  }
}

function requireByteV1(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw invalidGeometryModifierV1("geometryModifier", field, `${field} must be an integer byte.`);
  }
}

function invalidGeometryModifierV1(
  operation: string,
  field: string,
  message: string,
  entityId: string | null = null,
): RuntimeErrorV1 {
  return new RuntimeErrorV1("invalidArgument", operation, message, { field, entityId });
}
