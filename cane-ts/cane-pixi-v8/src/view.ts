import type {
  RuntimeRenderAttachmentV1,
  RuntimeRenderPacketV1,
  RuntimeTextureV1,
} from "@cane-runtime/core";
import { RuntimeErrorV1 } from "@cane-runtime/core";
import { Container, MeshGeometry, type Texture } from "pixi.js";
import {
  type CanePixiValidationModeV1,
  toPixiGeometryBuffersV1,
  updatePixiIndicesV1,
  updatePixiUvsV1,
  validateRenderAttachmentForPixiV1,
  validateRenderPacketForPixiV1,
  writePixiPositionsV1,
} from "./geometry.js";
import {
  BasicPixiMeshFactory,
  type CanePixiMeshContextV1,
  type CanePixiMeshFactoryV1,
} from "./mesh-factory.js";
import { PixiTextureStore } from "./texture-store.js";

const DEFAULT_INACTIVE_CACHE_FRAMES = 120;

export interface CanePixiViewOptionsV1 {
  readonly textures: PixiTextureStore;
  readonly meshFactory?: CanePixiMeshFactoryV1;
  /** `once` avoids a complete O(vertices + indices) validation pass every frame. */
  readonly validationMode?: CanePixiValidationModeV1;
  /** Number of applies to retain temporarily inactive meshes for skin/attachment reuse. */
  readonly inactiveCacheFrames?: number;
}

export interface CanePixiApplyStatsV1 {
  readonly applySequence: number;
  readonly activeRenderables: number;
  readonly cachedRenderables: number;
  readonly createdRenderables: number;
  readonly reusedRenderables: number;
  readonly destroyedRenderables: number;
  readonly positionUploadBytes: number;
  readonly staticUploadBytes: number;
}

interface MutableMeshContextV1 {
  attachment: RuntimeRenderAttachmentV1;
  geometry: MeshGeometry;
  texture: Texture;
}

interface MeshRecordV1 {
  readonly attachmentId: string;
  readonly slotId: string;
  readonly geometryKind: RuntimeRenderAttachmentV1["geometryKind"];
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly geometry: MeshGeometry;
  readonly mesh: Container;
  readonly context: MutableMeshContextV1;
  textureDescriptor: RuntimeTextureV1;
  lastSeenApply: number;
}

interface MutableApplyStatsV1 {
  applySequence: number;
  activeRenderables: number;
  cachedRenderables: number;
  createdRenderables: number;
  reusedRenderables: number;
  destroyedRenderables: number;
  positionUploadBytes: number;
  staticUploadBytes: number;
}

/**
 * Persistent Pixi projection of a Core render packet.
 *
 * Steady-state applies reuse Container, Mesh, MeshGeometry and all staging
 * arrays. Only the position buffer is uploaded unconditionally; UV and index
 * buffers are uploaded when their Float32/Uint32 contents actually change.
 */
export class CanePixiView extends Container {
  readonly #textures: PixiTextureStore;
  readonly #meshFactory: CanePixiMeshFactoryV1;
  readonly #validationMode: CanePixiValidationModeV1;
  readonly #inactiveCacheFrames: number;
  readonly #recordsByAttachmentId = new Map<string, MeshRecordV1[]>();
  readonly #stats: MutableApplyStatsV1 = {
    applySequence: 0,
    activeRenderables: 0,
    cachedRenderables: 0,
    createdRenderables: 0,
    reusedRenderables: 0,
    destroyedRenderables: 0,
    positionUploadBytes: 0,
    staticUploadBytes: 0,
  };
  #applySequence = 0;
  #validatedFirstPacket = false;

  constructor(options: CanePixiViewOptionsV1) {
    super({ label: "CanePixiView" });
    if (options.meshFactory === undefined && options.textures.pipeline !== "pixiBasic") {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "pixiCreateView",
        "The legacy BasicPixiMeshFactory requires a PixiTextureStore using the 'pixiBasic' pipeline.",
        { field: "textures.pipeline" },
      );
    }
    this.#textures = options.textures;
    this.#meshFactory = options.meshFactory ?? new BasicPixiMeshFactory();
    this.#validationMode = options.validationMode ?? "once";
    this.#inactiveCacheFrames = normalizeRetention(options.inactiveCacheFrames);
    this.eventMode = "none";
  }

  apply(packet: RuntimeRenderPacketV1): void {
    const validateWholePacket = this.#validationMode === "always"
      || this.#validationMode === "once" && !this.#validatedFirstPacket;
    if (validateWholePacket) validateRenderPacketForPixiV1(packet);

    this.#applySequence += 1;
    this.#resetStats();
    let activeCount = 0;
    for (let index = 0; index < packet.attachments.length; index += 1) {
      const attachment = packet.attachments[index];
      if (attachment === undefined) continue;
      let record = this.#findRecord(attachment);
      if (record !== undefined && record.lastSeenApply === this.#applySequence) {
        throw new RuntimeErrorV1(
          "validationFailed",
          "pixiApply",
          "The same slot attachment appears more than once in one render packet.",
          { field: `attachments[${index}]`, entityId: attachment.attachmentId },
        );
      }
      if (record === undefined) {
        if (this.#validationMode === "once" && this.#validatedFirstPacket) {
          validateRenderAttachmentForPixiV1(attachment, index);
        }
        record = this.#createRecord(attachment);
        this.#stats.createdRenderables += 1;
        this.#stats.positionUploadBytes += record.positions.byteLength;
        this.#stats.staticUploadBytes += record.uvs.byteLength + record.indices.byteLength;
      } else {
        this.#updateRecord(record, attachment);
        this.#stats.reusedRenderables += 1;
      }

      record.lastSeenApply = this.#applySequence;
      record.mesh.visible = true;
      this.#placeAt(record.mesh, activeCount);
      activeCount += 1;
    }

    while (this.children.length > activeCount) {
      const child = this.children[this.children.length - 1];
      if (child === undefined) break;
      this.removeChild(child);
      child.visible = false;
    }

    this.#pruneExpiredRecords();
    this.#validatedFirstPacket ||= this.#validationMode === "once";
    this.#stats.activeRenderables = activeCount;
    this.#stats.cachedRenderables = this.cachedRenderableCount;
  }

  /** Returns a cold-path snapshot; reading stats does not add allocations to `apply`. */
  get lastApplyStats(): CanePixiApplyStatsV1 {
    return { ...this.#stats };
  }

  get cachedRenderableCount(): number {
    let count = 0;
    for (const records of this.#recordsByAttachmentId.values()) count += records.length;
    return count;
  }

  /** Immediately destroys every inactive cache entry. */
  pruneInactive(): void {
    for (const [attachmentId, records] of this.#recordsByAttachmentId) {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const record = records[index];
        if (record !== undefined && record.lastSeenApply !== this.#applySequence) {
          records.splice(index, 1);
          this.#destroyRecord(record, false);
        }
      }
      if (records.length === 0) this.#recordsByAttachmentId.delete(attachmentId);
    }
  }

  clear(): void {
    while (this.children.length > 0) {
      const child = this.children[this.children.length - 1];
      if (child === undefined) break;
      this.removeChild(child);
    }
    for (const records of this.#recordsByAttachmentId.values()) {
      for (const record of records) this.#meshFactory.destroy(record.mesh, record.geometry);
    }
    this.#recordsByAttachmentId.clear();
    this.#validatedFirstPacket = false;
  }

  override destroy(...args: Parameters<Container["destroy"]>): void {
    this.clear();
    super.destroy(...args);
  }

  #findRecord(attachment: RuntimeRenderAttachmentV1): MeshRecordV1 | undefined {
    const records = this.#recordsByAttachmentId.get(attachment.attachmentId);
    if (records === undefined) return undefined;
    for (const record of records) {
      if (record.slotId === attachment.slotId
        && record.geometryKind === attachment.geometryKind
        && record.positions.length === attachment.worldVerticesXy.length
        && record.uvs.length === attachment.uvs.length
        && record.indices.length === attachment.indices.length) {
        return record;
      }
    }
    return undefined;
  }

  #createRecord(attachment: RuntimeRenderAttachmentV1): MeshRecordV1 {
    const texture = this.#textures.texture(attachment.texture);
    const buffers = toPixiGeometryBuffersV1(attachment);
    const geometry = new MeshGeometry({
      positions: buffers.positions,
      uvs: buffers.uvs,
      indices: buffers.indices,
      topology: "triangle-list",
    });
    const context: MutableMeshContextV1 = { attachment, geometry, texture };
    try {
      this.#meshFactory.validate(context as CanePixiMeshContextV1);
      const mesh = this.#meshFactory.create(context as CanePixiMeshContextV1);
      const record: MeshRecordV1 = {
        attachmentId: attachment.attachmentId,
        slotId: attachment.slotId,
        geometryKind: attachment.geometryKind,
        positions: buffers.positions,
        uvs: buffers.uvs,
        indices: buffers.indices,
        geometry,
        mesh,
        context,
        textureDescriptor: attachment.texture,
        lastSeenApply: this.#applySequence,
      };
      const records = this.#recordsByAttachmentId.get(attachment.attachmentId);
      if (records === undefined) this.#recordsByAttachmentId.set(attachment.attachmentId, [record]);
      else records.push(record);
      return record;
    } catch (error) {
      geometry.destroy(true);
      throw error;
    }
  }

  #updateRecord(record: MeshRecordV1, attachment: RuntimeRenderAttachmentV1): void {
    const texture = sameTextureDescriptor(record.textureDescriptor, attachment.texture)
      ? record.context.texture
      : this.#textures.texture(attachment.texture);
    record.context.attachment = attachment;
    record.context.texture = texture;
    this.#meshFactory.validate(record.context as CanePixiMeshContextV1);

    writePixiPositionsV1(attachment, record.positions);
    record.geometry.getBuffer("aPosition").update();
    this.#stats.positionUploadBytes += record.positions.byteLength;

    if (updatePixiUvsV1(attachment, record.uvs)) {
      record.geometry.getBuffer("aUV").update();
      this.#stats.staticUploadBytes += record.uvs.byteLength;
    }
    if (updatePixiIndicesV1(attachment, record.indices)) {
      record.geometry.getIndex().update();
      this.#stats.staticUploadBytes += record.indices.byteLength;
    }

    this.#meshFactory.update(record.mesh, record.context as CanePixiMeshContextV1);
    record.textureDescriptor = attachment.texture;
  }

  #placeAt(mesh: Container, index: number): void {
    if (mesh.parent !== this) {
      this.addChildAt(mesh, index);
    } else if (this.children[index] !== mesh) {
      this.setChildIndex(mesh, index);
    }
  }

  #pruneExpiredRecords(): void {
    for (const [attachmentId, records] of this.#recordsByAttachmentId) {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const record = records[index];
        if (record !== undefined
          && record.lastSeenApply !== this.#applySequence
          && this.#applySequence - record.lastSeenApply > this.#inactiveCacheFrames) {
          records.splice(index, 1);
          this.#destroyRecord(record, true);
        }
      }
      if (records.length === 0) this.#recordsByAttachmentId.delete(attachmentId);
    }
  }

  #destroyRecord(record: MeshRecordV1, countInStats: boolean): void {
    if (record.mesh.parent === this) this.removeChild(record.mesh);
    this.#meshFactory.destroy(record.mesh, record.geometry);
    if (countInStats) this.#stats.destroyedRenderables += 1;
  }

  #resetStats(): void {
    this.#stats.applySequence = this.#applySequence;
    this.#stats.activeRenderables = 0;
    this.#stats.cachedRenderables = 0;
    this.#stats.createdRenderables = 0;
    this.#stats.reusedRenderables = 0;
    this.#stats.destroyedRenderables = 0;
    this.#stats.positionUploadBytes = 0;
    this.#stats.staticUploadBytes = 0;
  }
}

function normalizeRetention(value: number | undefined): number {
  const result = value ?? DEFAULT_INACTIVE_CACHE_FRAMES;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RuntimeErrorV1(
      "invalidArgument",
      "pixiCreateView",
      "inactiveCacheFrames must be a non-negative safe integer.",
      { field: "inactiveCacheFrames" },
    );
  }
  return result;
}

function sameTextureDescriptor(left: RuntimeTextureV1, right: RuntimeTextureV1): boolean {
  if (left.kind !== right.kind
    || left.imageId !== right.imageId
    || left.colorSpace !== right.colorSpace
    || left.alphaMode !== right.alphaMode) return false;
  if (left.kind === "direct" && right.kind === "direct") return left.path === right.path;
  if (left.kind === "atlas" && right.kind === "atlas") {
    return left.atlasId === right.atlasId
      && left.pageId === right.pageId
      && left.pagePath === right.pagePath
      && left.regionId === right.regionId;
  }
  return false;
}
