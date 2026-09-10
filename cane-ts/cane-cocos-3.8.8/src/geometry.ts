import type {
  AffineV1,
  RuntimeBlendModeV1,
  RuntimeRenderAttachmentV1,
  RuntimeRenderPacketV1,
  RuntimeTextureV1,
} from "@cane-runtime/core";
import { caneCocosColorFlagsV1 } from "./color-pipeline.js";
import { CaneCocosErrorV1 } from "./errors.js";

/** xyz + uv + packed RGBA light + packed RGBA dark. */
export const CANE_COCOS_VERTEX_WORD_STRIDE_V1 = 7;
export const CANE_COCOS_VERTEX_STRIDE_BYTES_V1 = CANE_COCOS_VERTEX_WORD_STRIDE_V1 * 4;
export const CANE_COCOS_MAX_UINT16_VERTICES_V1 = 0xffff;

export type CaneCocosValidationModeV1 = "always" | "once" | "none";

export interface CaneCocosColorModulationV1 {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

export const WHITE_COCOS_MODULATION_V1: CaneCocosColorModulationV1 = Object.freeze({
  r: 255,
  g: 255,
  b: 255,
  alpha: 1,
});

export interface CaneCocosBatchRangeV1 {
  start: number;
  end: number;
  key: string;
  textureKey: string;
  blendMode: RuntimeBlendModeV1;
  alphaMode: RuntimeTextureV1["alphaMode"];
  vertexCount: number;
  indexCount: number;
}

export interface CaneCocosGeometryUploadV1 {
  vertexData: Float32Array;
  vertexBytes: Uint8Array;
  indices: Uint16Array | Uint32Array;
  vertexCount: number;
  indexCount: number;
  indexUploadCount: number;
  vertexCapacity: number;
  indexCapacity: number;
  indexFormat: "uint16" | "uint32";
  vertexUploadBytes: number;
  indexUploadBytes: number;
  grew: boolean;
}

export function textureKeyV1(texture: RuntimeTextureV1): string {
  return texture.kind === "direct"
    ? `direct:${texture.imageId}:${texture.path}`
    : `atlas:${texture.atlasId}:${texture.pageId}:${texture.pagePath}`;
}

export function texturePathV1(texture: RuntimeTextureV1): string {
  return texture.kind === "direct" ? texture.path : texture.pagePath;
}

export function caneCocosBatchKeyV1(attachment: RuntimeRenderAttachmentV1): string {
  return `${textureKeyV1(attachment.texture)}|${attachment.texture.alphaMode}|${attachment.texture.colorSpace}|${attachment.blendMode}`;
}

export function resolveAssetUrlV1(baseUrl: string, portablePath: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(portablePath)) return portablePath;
  if (baseUrl.length === 0) return portablePath;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(baseUrl)) {
    return new URL(portablePath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  }
  return `${baseUrl.replace(/\/$/u, "")}/${portablePath}`;
}

/** Retained planner; it splits state changes and 16-bit vertex domains without allocating per stable frame. */
export class CaneCocosBatchPlannerV1 {
  readonly ranges: CaneCocosBatchRangeV1[] = [];

  write(packet: RuntimeRenderPacketV1, start = 0, end = packet.attachments.length): number {
    requireRangeV1(packet, start, end, "cocosPlanBatches");
    let rangeCount = 0;
    let cursor = start;
    while (cursor < end) {
      const first = packet.attachments[cursor];
      if (first === undefined) break;
      const key = caneCocosBatchKeyV1(first);
      let rangeEnd = cursor;
      let vertexCount = 0;
      let indexCount = 0;
      while (rangeEnd < end) {
        const next = packet.attachments[rangeEnd];
        if (next === undefined || caneCocosBatchKeyV1(next) !== key) break;
        const nextVertices = next.worldVerticesXy.length / 2;
        if (rangeEnd > cursor && vertexCount + nextVertices > CANE_COCOS_MAX_UINT16_VERTICES_V1) break;
        vertexCount += nextVertices;
        indexCount += next.indices.length;
        rangeEnd += 1;
        if (nextVertices > CANE_COCOS_MAX_UINT16_VERTICES_V1) break;
      }
      let range = this.ranges[rangeCount];
      if (range === undefined) {
        range = {
          start: cursor,
          end: rangeEnd,
          key,
          textureKey: textureKeyV1(first.texture),
          blendMode: first.blendMode,
          alphaMode: first.texture.alphaMode,
          vertexCount,
          indexCount,
        };
        this.ranges[rangeCount] = range;
      } else {
        range.start = cursor;
        range.end = rangeEnd;
        range.key = key;
        range.textureKey = textureKeyV1(first.texture);
        range.blendMode = first.blendMode;
        range.alphaMode = first.texture.alphaMode;
        range.vertexCount = vertexCount;
        range.indexCount = indexCount;
      }
      rangeCount += 1;
      cursor = rangeEnd;
    }
    this.ranges.length = rangeCount;
    return rangeCount;
  }
}

/** CPU packer for final Core geometry. It only copies final XY/UV/tint/index data. */
export class CaneCocosGeometryAssemblerV1 {
  #vertexData = new Float32Array(CANE_COCOS_VERTEX_WORD_STRIDE_V1 * 4);
  #vertexBytes = new Uint8Array(this.#vertexData.buffer);
  #activeVertexBytes = this.#vertexBytes;
  #activeVertexByteCount = -1;
  #indices: Uint16Array | Uint32Array = new Uint16Array(6);
  #activeIndices: Uint16Array | Uint32Array = this.#indices;
  #activeIndexCount = -1;
  readonly #upload: CaneCocosGeometryUploadV1 = {
    vertexData: this.#vertexData,
    vertexBytes: this.#vertexBytes,
    indices: this.#activeIndices,
    vertexCount: 0,
    indexCount: 0,
    indexUploadCount: 0,
    vertexCapacity: 4,
    indexCapacity: 6,
    indexFormat: "uint16",
    vertexUploadBytes: 0,
    indexUploadBytes: 0,
    grew: false,
  };

  applyRange(
    packet: RuntimeRenderPacketV1,
    start: number,
    end: number,
    modulation: CaneCocosColorModulationV1 = WHITE_COCOS_MODULATION_V1,
    worldTransform: AffineV1 | null = null,
  ): CaneCocosGeometryUploadV1 {
    requireRangeV1(packet, start, end, "cocosPackGeometry");
    validateModulationV1(modulation);
    let vertexCount = 0;
    let indexCount = 0;
    for (let index = start; index < end; index += 1) {
      const attachment = packet.attachments[index];
      if (attachment === undefined) continue;
      vertexCount += attachment.worldVerticesXy.length / 2;
      indexCount += attachment.indices.length;
    }
    const grew = this.#ensureCapacity(vertexCount, indexCount);
    const nodeR = modulation.r / 255;
    const nodeG = modulation.g / 255;
    const nodeB = modulation.b / 255;
    let vertexCursor = 0;
    let indexCursor = 0;
    for (let attachmentIndex = start; attachmentIndex < end; attachmentIndex += 1) {
      const attachment = packet.attachments[attachmentIndex];
      if (attachment === undefined) continue;
      const baseVertex = vertexCursor;
      const finalAlpha = clampByteV1(attachment.tint.alpha * modulation.alpha * 255);
      // Runtime tint remains straight sRGB. PMA and color-space handling are
      // performed once in the Cane shader, never baked into these bytes.
      const lightR = clampByteV1((attachment.tint.lightRgb[0] ?? 0) * nodeR);
      const lightG = clampByteV1((attachment.tint.lightRgb[1] ?? 0) * nodeG);
      const lightB = clampByteV1((attachment.tint.lightRgb[2] ?? 0) * nodeB);
      const dark = attachment.tint.darkRgb;
      const darkR = clampByteV1((dark?.[0] ?? 0) * nodeR);
      const darkG = clampByteV1((dark?.[1] ?? 0) * nodeG);
      const darkB = clampByteV1((dark?.[2] ?? 0) * nodeB);
      const colorFlags = caneCocosColorFlagsV1(attachment.texture, attachment.twoColor);
      for (let source = 0; source < attachment.worldVerticesXy.length; source += 2) {
        const wordOffset = vertexCursor * CANE_COCOS_VERTEX_WORD_STRIDE_V1;
        const x = attachment.worldVerticesXy[source] ?? 0;
        const y = attachment.worldVerticesXy[source + 1] ?? 0;
        this.#vertexData[wordOffset] = worldTransform === null
          ? x
          : worldTransform.a * x + worldTransform.c * y + worldTransform.tx;
        this.#vertexData[wordOffset + 1] = worldTransform === null
          ? y
          : worldTransform.b * x + worldTransform.d * y + worldTransform.ty;
        this.#vertexData[wordOffset + 2] = 0;
        this.#vertexData[wordOffset + 3] = attachment.uvs[source] ?? 0;
        this.#vertexData[wordOffset + 4] = attachment.uvs[source + 1] ?? 0;
        const colorOffset = (wordOffset + 5) * 4;
        this.#vertexBytes[colorOffset] = lightR;
        this.#vertexBytes[colorOffset + 1] = lightG;
        this.#vertexBytes[colorOffset + 2] = lightB;
        this.#vertexBytes[colorOffset + 3] = finalAlpha;
        this.#vertexBytes[colorOffset + 4] = darkR;
        this.#vertexBytes[colorOffset + 5] = darkG;
        this.#vertexBytes[colorOffset + 6] = darkB;
        this.#vertexBytes[colorOffset + 7] = colorFlags;
        vertexCursor += 1;
      }
      for (let source = 0; source < attachment.indices.length; source += 1) {
        this.#indices[indexCursor] = baseVertex + (attachment.indices[source] ?? 0);
        indexCursor += 1;
      }
    }
    const indexUploadCount = this.#indices instanceof Uint16Array
      ? Math.ceil(indexCount / 2) * 2
      : indexCount;
    if (indexUploadCount > indexCount) this.#indices[indexCount] = 0;
    if (this.#activeIndexCount !== indexUploadCount || this.#activeIndices.buffer !== this.#indices.buffer) {
      this.#activeIndices = this.#indices.subarray(0, indexUploadCount) as Uint16Array | Uint32Array;
      this.#activeIndexCount = indexUploadCount;
    }
    const upload = this.#upload;
    const vertexUploadBytes = vertexCount * CANE_COCOS_VERTEX_STRIDE_BYTES_V1;
    if (this.#activeVertexByteCount !== vertexUploadBytes
      || this.#activeVertexBytes.buffer !== this.#vertexBytes.buffer) {
      this.#activeVertexBytes = this.#vertexBytes.subarray(0, vertexUploadBytes);
      this.#activeVertexByteCount = vertexUploadBytes;
    }
    upload.vertexData = this.#vertexData;
    upload.vertexBytes = this.#activeVertexBytes;
    upload.indices = this.#activeIndices;
    upload.vertexCount = vertexCount;
    upload.indexCount = indexCount;
    upload.indexUploadCount = indexUploadCount;
    upload.vertexCapacity = this.#vertexData.length / CANE_COCOS_VERTEX_WORD_STRIDE_V1;
    upload.indexCapacity = this.#indices.length;
    upload.indexFormat = this.#indices instanceof Uint32Array ? "uint32" : "uint16";
    upload.vertexUploadBytes = vertexUploadBytes;
    upload.indexUploadBytes = indexUploadCount * this.#indices.BYTES_PER_ELEMENT;
    upload.grew = grew;
    return upload;
  }

  #ensureCapacity(vertexCount: number, indexCount: number): boolean {
    let grew = false;
    const useUint32 = vertexCount > CANE_COCOS_MAX_UINT16_VERTICES_V1;
    const vertexCapacity = this.#vertexData.length / CANE_COCOS_VERTEX_WORD_STRIDE_V1;
    if (vertexCount > vertexCapacity) {
      this.#vertexData = new Float32Array(nextCapacityV1(vertexCount) * CANE_COCOS_VERTEX_WORD_STRIDE_V1);
      this.#vertexBytes = new Uint8Array(this.#vertexData.buffer);
      this.#activeVertexByteCount = -1;
      grew = true;
    }
    if (indexCount > this.#indices.length || useUint32 !== (this.#indices instanceof Uint32Array)) {
      const capacity = nextCapacityV1(Math.max(indexCount, 6));
      this.#indices = useUint32 ? new Uint32Array(capacity) : new Uint16Array(capacity);
      this.#activeIndexCount = -1;
      grew = true;
    }
    return grew;
  }
}

export function validateRenderPacketForCocosV1(packet: RuntimeRenderPacketV1): void {
  if (packet.coordinateSystem !== "xRightYUp"
    || packet.uvOrigin !== "topLeft"
    || packet.tintColorSpace !== "srgb"
    || packet.tintAlphaMode !== "straight") {
    throw contractErrorV1("RenderPacket coordinate/UV/tint envelope is unsupported.", "renderPacket");
  }
  for (let index = 0; index < packet.attachments.length; index += 1) {
    const attachment = packet.attachments[index];
    if (attachment === undefined) throw contractErrorV1("Attachment entry is missing.", `attachments[${index}]`);
    validateRenderAttachmentForCocosV1(attachment, index);
  }
}

export function validateRenderAttachmentForCocosV1(
  attachment: RuntimeRenderAttachmentV1,
  index = 0,
): void {
  const field = `attachments[${index}]`;
  if (attachment.drawIndex !== index) {
    throw contractErrorV1("Attachment drawIndex must match packet order.", `${field}.drawIndex`, attachment.attachmentId);
  }
  if (attachment.frontFace !== "counterClockwise") {
    throw contractErrorV1("Core attachment winding must be counter-clockwise.", `${field}.frontFace`, attachment.attachmentId);
  }
  if (attachment.worldVerticesXy.length < 6
    || attachment.worldVerticesXy.length % 2 !== 0
    || attachment.uvs.length !== attachment.worldVerticesXy.length) {
    throw contractErrorV1("Position and UV arrays must describe the same triangle vertices.", field, attachment.attachmentId);
  }
  if (attachment.indices.length < 3 || attachment.indices.length % 3 !== 0) {
    throw contractErrorV1("Index data must contain complete triangles.", `${field}.indices`, attachment.attachmentId);
  }
  const vertexCount = attachment.worldVerticesXy.length / 2;
  for (let offset = 0; offset < attachment.worldVerticesXy.length; offset += 1) {
    if (!Number.isFinite(attachment.worldVerticesXy[offset]) || !Number.isFinite(attachment.uvs[offset])) {
      throw contractErrorV1("Geometry contains a non-finite component.", field, attachment.attachmentId);
    }
  }
  for (let offset = 0; offset < attachment.indices.length; offset += 1) {
    const value = attachment.indices[offset] ?? -1;
    if (!Number.isSafeInteger(value) || value < 0 || value >= vertexCount) {
      throw contractErrorV1("Geometry index is outside its vertex range.", `${field}.indices`, attachment.attachmentId);
    }
  }
  const colors = [...attachment.tint.lightRgb, ...(attachment.tint.darkRgb ?? [])];
  if (colors.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
    || !Number.isFinite(attachment.tint.alpha)
    || attachment.tint.alpha < 0
    || attachment.tint.alpha > 1) {
    throw contractErrorV1("Final tint is outside the Runtime v1 contract.", `${field}.tint`, attachment.attachmentId);
  }
}

function validateModulationV1(value: CaneCocosColorModulationV1): void {
  if (![value.r, value.g, value.b].every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255)
    || !Number.isFinite(value.alpha) || value.alpha < 0 || value.alpha > 1) {
    throw new CaneCocosErrorV1("invalidArgument", "Cocos color modulation is outside its valid range.", {
      operation: "cocosPackGeometry",
      field: "modulation",
      actual: value,
    });
  }
}

function requireRangeV1(
  packet: RuntimeRenderPacketV1,
  start: number,
  end: number,
  operation: string,
): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end < start || end > packet.attachments.length) {
    throw new CaneCocosErrorV1("invalidArgument", "Attachment range is outside the packet.", {
      operation,
      field: "range",
      expected: `[0, ${packet.attachments.length}]`,
      actual: [start, end],
    });
  }
}

function contractErrorV1(message: string, field: string, entityId?: string): CaneCocosErrorV1 {
  return new CaneCocosErrorV1("renderContractViolation", message, {
    operation: "cocosApplyRenderPacket",
    field,
    ...(entityId === undefined ? {} : { entityId }),
  });
}

function clampByteV1(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function nextCapacityV1(required: number): number {
  let capacity = 1;
  while (capacity < required) capacity *= 2;
  return capacity;
}
