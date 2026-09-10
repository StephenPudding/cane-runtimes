import type {
  RuntimeBlendModeV1,
  RuntimeRenderAttachmentV1,
  RuntimeRenderPacketV1,
  RuntimeTextureV1,
} from "@cane-runtime/core";
import { CaneLayaErrorV1 } from "./errors.js";

export const CANE_LAYA_VERTEX_FLOAT_STRIDE_V1 = 13;
export const CANE_LAYA_VERTEX_STRIDE_BYTES_V1 = CANE_LAYA_VERTEX_FLOAT_STRIDE_V1 * 4;

export const CANE_LAYA_FLAG_TWO_COLOR_V1 = 1;
export const CANE_LAYA_FLAG_TEXTURE_LINEAR_V1 = 2;
export const CANE_LAYA_FLAG_TEXTURE_PREMULTIPLIED_V1 = 4;

export type CaneLayaValidationModeV1 = "always" | "once" | "none";

export interface CaneLayaBatchRangeV1 {
  start: number;
  end: number;
  key: string;
  textureKey: string;
  blendMode: RuntimeBlendModeV1;
}

export interface CaneLayaGeometryUploadV1 {
  vertexData: Float32Array;
  indices: Uint16Array | Uint32Array;
  vertexCount: number;
  indexCount: number;
  /** Uploaded indices including a possible unused WebGPU Uint16 pad value. */
  indexUploadCount: number;
  vertexCapacity: number;
  indexCapacity: number;
  indexFormat: "uint16" | "uint32";
  vertexUploadBytes: number;
  indexUploadBytes: number;
  grew: boolean;
}

/** Returns one stable key for the GPU state a Laya Mesh2D node cannot vary mid-draw. */
export function caneLayaBatchKeyV1(attachment: RuntimeRenderAttachmentV1): string {
  return `${textureKeyV1(attachment.texture)}|${attachment.blendMode}`;
}

export function textureKeyV1(texture: RuntimeTextureV1): string {
  return texture.kind === "direct"
    ? `direct:${texture.imageId}:${texture.path}`
    : `atlas:${texture.atlasId}:${texture.pageId}:${texture.pagePath}`;
}

export function texturePathV1(texture: RuntimeTextureV1): string {
  return texture.kind === "direct" ? texture.path : texture.pagePath;
}

export function resolveAssetUrlV1(baseUrl: string, portablePath: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(portablePath)) return portablePath;
  if (baseUrl.length === 0) return portablePath;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(baseUrl)) {
    return new URL(portablePath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  }
  return `${baseUrl.replace(/\/$/u, "")}/${portablePath}`;
}

/** Retained planner; stable draw structure reuses the same range objects and array. */
export class CaneLayaBatchPlannerV1 {
  readonly ranges: CaneLayaBatchRangeV1[] = [];

  write(packet: RuntimeRenderPacketV1, start = 0, end = packet.attachments.length): number {
    requireRangeV1(packet, start, end, "layaPlanBatches");
    let rangeCount = 0;
    let cursor = start;
    while (cursor < end) {
      const first = packet.attachments[cursor];
      if (first === undefined) break;
      const key = caneLayaBatchKeyV1(first);
      let rangeEnd = cursor + 1;
      while (rangeEnd < end) {
        const next = packet.attachments[rangeEnd];
        if (next === undefined || caneLayaBatchKeyV1(next) !== key) break;
        rangeEnd += 1;
      }
      let range = this.ranges[rangeCount];
      if (range === undefined) {
        range = { start: cursor, end: rangeEnd, key, textureKey: textureKeyV1(first.texture), blendMode: first.blendMode };
        this.ranges[rangeCount] = range;
      } else {
        range.start = cursor;
        range.end = rangeEnd;
        range.key = key;
        range.textureKey = textureKeyV1(first.texture);
        range.blendMode = first.blendMode;
      }
      rangeCount += 1;
      cursor = rangeEnd;
    }
    this.ranges.length = rangeCount;
    return rangeCount;
  }
}

/** CPU packer for final Core geometry; it never evaluates attachment transforms. */
export class CaneLayaGeometryAssemblerV1 {
  #vertexData = new Float32Array(CANE_LAYA_VERTEX_FLOAT_STRIDE_V1 * 4);
  #indices: Uint16Array | Uint32Array = new Uint16Array(6);
  #activeIndices: Uint16Array | Uint32Array = this.#indices;
  #activeIndexCount = -1;
  readonly #upload: CaneLayaGeometryUploadV1 = {
    vertexData: this.#vertexData,
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

  applyRange(packet: RuntimeRenderPacketV1, start: number, end: number): CaneLayaGeometryUploadV1 {
    requireRangeV1(packet, start, end, "layaPackGeometry");
    let vertexCount = 0;
    let indexCount = 0;
    for (let index = start; index < end; index += 1) {
      const attachment = packet.attachments[index];
      if (attachment === undefined) continue;
      vertexCount += attachment.worldVerticesXy.length / 2;
      indexCount += attachment.indices.length;
    }
    const grew = this.#ensureCapacity(vertexCount, indexCount);
    let vertexCursor = 0;
    let indexCursor = 0;
    for (let attachmentIndex = start; attachmentIndex < end; attachmentIndex += 1) {
      const attachment = packet.attachments[attachmentIndex];
      if (attachment === undefined) continue;
      const baseVertex = vertexCursor;
      const dark = attachment.tint.darkRgb;
      let flags = attachment.twoColor ? CANE_LAYA_FLAG_TWO_COLOR_V1 : 0;
      if (attachment.texture.colorSpace === "linear") flags |= CANE_LAYA_FLAG_TEXTURE_LINEAR_V1;
      if (attachment.texture.alphaMode === "premultiplied") flags |= CANE_LAYA_FLAG_TEXTURE_PREMULTIPLIED_V1;
      for (let source = 0; source < attachment.worldVerticesXy.length; source += 2) {
        const output = vertexCursor * CANE_LAYA_VERTEX_FLOAT_STRIDE_V1;
        this.#vertexData[output] = attachment.worldVerticesXy[source] ?? 0;
        this.#vertexData[output + 1] = -(attachment.worldVerticesXy[source + 1] ?? 0);
        this.#vertexData[output + 2] = 0;
        this.#vertexData[output + 3] = attachment.uvs[source] ?? 0;
        this.#vertexData[output + 4] = attachment.uvs[source + 1] ?? 0;
        this.#vertexData[output + 5] = (attachment.tint.lightRgb[0] ?? 0) / 255;
        this.#vertexData[output + 6] = (attachment.tint.lightRgb[1] ?? 0) / 255;
        this.#vertexData[output + 7] = (attachment.tint.lightRgb[2] ?? 0) / 255;
        this.#vertexData[output + 8] = attachment.tint.alpha;
        this.#vertexData[output + 9] = (dark?.[0] ?? 0) / 255;
        this.#vertexData[output + 10] = (dark?.[1] ?? 0) / 255;
        this.#vertexData[output + 11] = (dark?.[2] ?? 0) / 255;
        this.#vertexData[output + 12] = flags;
        vertexCursor += 1;
      }
      // One Y reflection reverses orientation. Swap i1/i2 to retain CCW in Laya space.
      for (let source = 0; source < attachment.indices.length; source += 3) {
        this.#indices[indexCursor] = baseVertex + (attachment.indices[source] ?? 0);
        this.#indices[indexCursor + 1] = baseVertex + (attachment.indices[source + 2] ?? 0);
        this.#indices[indexCursor + 2] = baseVertex + (attachment.indices[source + 1] ?? 0);
        indexCursor += 3;
      }
    }
    // Match LayaAir's official Spine WebGPU path: GPUQueue.writeBuffer sizes
    // must be divisible by four, so an odd Uint16 draw count uploads one
    // unused zero index while retaining the original draw count.
    const indexUploadCount = this.#indices instanceof Uint16Array
      ? Math.ceil(indexCount / 2) * 2
      : indexCount;
    if (indexUploadCount > indexCount) this.#indices[indexCount] = 0;
    if (this.#activeIndexCount !== indexUploadCount || this.#activeIndices.buffer !== this.#indices.buffer) {
      this.#activeIndices = this.#indices.subarray(0, indexUploadCount) as Uint16Array | Uint32Array;
      this.#activeIndexCount = indexUploadCount;
    }
    const upload = this.#upload;
    upload.vertexData = this.#vertexData;
    upload.indices = this.#activeIndices;
    upload.vertexCount = vertexCount;
    upload.indexCount = indexCount;
    upload.indexUploadCount = indexUploadCount;
    upload.vertexCapacity = this.#vertexData.length / CANE_LAYA_VERTEX_FLOAT_STRIDE_V1;
    upload.indexCapacity = this.#indices.length;
    upload.indexFormat = this.#indices instanceof Uint32Array ? "uint32" : "uint16";
    upload.vertexUploadBytes = vertexCount * CANE_LAYA_VERTEX_STRIDE_BYTES_V1;
    upload.indexUploadBytes = indexUploadCount * this.#indices.BYTES_PER_ELEMENT;
    upload.grew = grew;
    return upload;
  }

  #ensureCapacity(vertexCount: number, indexCount: number): boolean {
    let grew = false;
    const useUint32 = vertexCount > 0xffff;
    const vertexCapacity = this.#vertexData.length / CANE_LAYA_VERTEX_FLOAT_STRIDE_V1;
    if (vertexCount > vertexCapacity) {
      this.#vertexData = new Float32Array(nextCapacityV1(vertexCount) * CANE_LAYA_VERTEX_FLOAT_STRIDE_V1);
      grew = true;
    }
    if (indexCount > this.#indices.length
      || useUint32 !== (this.#indices instanceof Uint32Array)) {
      const capacity = nextCapacityV1(Math.max(indexCount, 6));
      this.#indices = useUint32 ? new Uint32Array(capacity) : new Uint16Array(capacity);
      this.#activeIndexCount = -1;
      grew = true;
    }
    return grew;
  }
}

export function validateRenderPacketForLayaV1(packet: RuntimeRenderPacketV1): void {
  if (packet.coordinateSystem !== "xRightYUp"
    || packet.uvOrigin !== "topLeft"
    || packet.tintColorSpace !== "srgb"
    || packet.tintAlphaMode !== "straight") {
    throw contractErrorV1("RenderPacket coordinate/UV/tint envelope is unsupported.", "renderPacket");
  }
  for (let index = 0; index < packet.attachments.length; index += 1) {
    const attachment = packet.attachments[index];
    if (attachment === undefined) throw contractErrorV1("Attachment entry is missing.", `attachments[${index}]`);
    validateRenderAttachmentForLayaV1(attachment, index);
  }
}

export function validateRenderAttachmentForLayaV1(
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

function requireRangeV1(
  packet: RuntimeRenderPacketV1,
  start: number,
  end: number,
  operation: string,
): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end < start || end > packet.attachments.length) {
    throw new CaneLayaErrorV1("invalidArgument", "Attachment range is outside the packet.", {
      operation,
      field: "range",
      expected: `[0, ${packet.attachments.length}]`,
      actual: [start, end],
    });
  }
}

function contractErrorV1(message: string, field: string, entityId?: string): CaneLayaErrorV1 {
  return new CaneLayaErrorV1("renderContractViolation", message, {
    operation: "layaApplyRenderPacket",
    field,
    ...(entityId === undefined ? {} : { entityId }),
  });
}

function nextCapacityV1(required: number): number {
  let capacity = 1;
  while (capacity < required) capacity *= 2;
  return capacity;
}
