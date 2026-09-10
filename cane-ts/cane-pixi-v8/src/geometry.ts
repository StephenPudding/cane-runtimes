import type { RuntimeRenderAttachmentV1, RuntimeRenderPacketV1 } from "@cane-runtime/core";
import { RuntimeErrorV1 } from "@cane-runtime/core";

export interface PixiGeometryBuffersV1 {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

/**
 * Validation policy for the renderer boundary.
 *
 * `once` is the production default: packet invariants are checked on the first
 * frame and attachment invariants are checked whenever a cached geometry is
 * created. Core remains responsible for producing valid dynamic values.
 */
export type CanePixiValidationModeV1 = "once" | "always" | "none";

export function validateRenderPacketEnvelopeForPixiV1(packet: RuntimeRenderPacketV1): void {
  if (packet.coordinateSystem !== "xRightYUp") {
    packetError("coordinateSystem", "Pixi adapter expects xRightYUp Runtime geometry.");
  }
  if (packet.uvOrigin !== "topLeft") {
    packetError("uvOrigin", "Pixi adapter expects top-left Runtime UVs.");
  }
  if (packet.tintColorSpace !== "srgb" || packet.tintAlphaMode !== "straight") {
    packetError("tint", "Runtime packet tint must be straight, unpremultiplied sRGB.");
  }
}

export function validateRenderPacketForPixiV1(packet: RuntimeRenderPacketV1): void {
  validateRenderPacketEnvelopeForPixiV1(packet);

  packet.attachments.forEach((attachment, index) => {
    if (attachment.drawIndex !== index) {
      packetError(`attachments[${index}].drawIndex`, "Runtime drawIndex must equal packet order.", attachment.attachmentId);
    }
    validateRenderAttachmentForPixiV1(attachment, index);
  });
}

export function validateRenderAttachmentForPixiV1(
  attachment: RuntimeRenderAttachmentV1,
  index = attachment.drawIndex,
): void {
  validateAttachment(attachment, index);
}

export function toPixiGeometryBuffersV1(
  attachment: RuntimeRenderAttachmentV1,
): PixiGeometryBuffersV1 {
  const positions = new Float32Array(attachment.worldVerticesXy.length);
  writePixiPositionsV1(attachment, positions);
  return {
    positions,
    uvs: new Float32Array(attachment.uvs),
    indices: new Uint32Array(attachment.indices),
  };
}

/** Writes the only coordinate-system conversion into an existing GPU staging array. */
export function writePixiPositionsV1(
  attachment: RuntimeRenderAttachmentV1,
  positions: Float32Array,
): void {
  const source = attachment.worldVerticesXy;
  if (positions.length !== source.length) {
    packetError(
      "worldVerticesXy",
      `Position buffer length changed from ${positions.length} to ${source.length}.`,
      attachment.attachmentId,
    );
  }
  for (let offset = 0; offset < source.length; offset += 2) {
    const x = source[offset];
    const y = source[offset + 1];
    if (x === undefined || y === undefined) {
      packetError("worldVerticesXy", "World vertex buffer is incomplete.", attachment.attachmentId);
    }
    positions[offset] = x;
    positions[offset + 1] = -y;
  }
}

/**
 * Copies UVs only when their Float32 representation changed. The boolean is
 * suitable for deciding whether Pixi's `aUV` buffer needs an upload.
 */
export function updatePixiUvsV1(
  attachment: RuntimeRenderAttachmentV1,
  uvs: Float32Array,
): boolean {
  const source = attachment.uvs;
  if (uvs.length !== source.length) {
    packetError("uvs", `UV buffer length changed from ${uvs.length} to ${source.length}.`, attachment.attachmentId);
  }
  let changed = false;
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index];
    if (value === undefined) {
      packetError("uvs", "UV buffer is incomplete.", attachment.attachmentId);
    }
    const next = Math.fround(value);
    if (uvs[index] !== next) {
      uvs[index] = next;
      changed = true;
    }
  }
  return changed;
}

/** Copies triangle indices only when they changed. */
export function updatePixiIndicesV1(
  attachment: RuntimeRenderAttachmentV1,
  indices: Uint32Array,
): boolean {
  const source = attachment.indices;
  if (indices.length !== source.length) {
    packetError(
      "indices",
      `Index buffer length changed from ${indices.length} to ${source.length}.`,
      attachment.attachmentId,
    );
  }
  let changed = false;
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index];
    if (value === undefined) {
      packetError("indices", "Index buffer is incomplete.", attachment.attachmentId);
    }
    if (indices[index] !== value) {
      indices[index] = value;
      changed = true;
    }
  }
  return changed;
}

function validateAttachment(attachment: RuntimeRenderAttachmentV1, index: number): void {
  const field = `attachments[${index}]`;
  if (attachment.worldVerticesXy.length === 0 || attachment.worldVerticesXy.length % 2 !== 0) {
    packetError(`${field}.worldVerticesXy`, "World vertex buffer must contain complete XY pairs.", attachment.attachmentId);
  }
  if (attachment.uvs.length !== attachment.worldVerticesXy.length) {
    packetError(`${field}.uvs`, "UV count must match world vertex component count.", attachment.attachmentId);
  }
  if (attachment.indices.length === 0 || attachment.indices.length % 3 !== 0) {
    packetError(`${field}.indices`, "Index buffer must contain complete triangles.", attachment.attachmentId);
  }
  if (attachment.authoredTriangleFacing.length !== attachment.indices.length / 3) {
    packetError(
      `${field}.authoredTriangleFacing`,
      "Authored facing count must match triangle count.",
      attachment.attachmentId,
    );
  }
  if (attachment.frontFace !== "counterClockwise") {
    packetError(`${field}.frontFace`, "Runtime packet must declare counterClockwise front faces.", attachment.attachmentId);
  }
  if (attachment.twoColor !== (attachment.tint.darkRgb !== null)) {
    packetError(`${field}.twoColor`, "twoColor must exactly match darkRgb presence.", attachment.attachmentId);
  }

  for (let component = 0; component < attachment.worldVerticesXy.length; component += 1) {
    if (!Number.isFinite(attachment.worldVerticesXy[component])) {
      packetError(`${field}.worldVerticesXy[${component}]`, "World vertices must be finite.", attachment.attachmentId);
    }
  }
  for (let component = 0; component < attachment.uvs.length; component += 1) {
    const value = attachment.uvs[component];
    if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) {
      packetError(`${field}.uvs[${component}]`, "UVs must be finite and in [0,1].", attachment.attachmentId);
    }
  }
  const vertexCount = attachment.worldVerticesXy.length / 2;
  for (let component = 0; component < attachment.indices.length; component += 1) {
    const value = attachment.indices[component];
    if (value === undefined || !Number.isInteger(value) || value < 0 || value >= vertexCount) {
      packetError(`${field}.indices[${component}]`, "Triangle index is outside the vertex buffer.", attachment.attachmentId);
    }
  }
}

function packetError(field: string, message: string, entityId: string | null = null): never {
  throw new RuntimeErrorV1("validationFailed", "pixiApply", message, { field, entityId });
}
