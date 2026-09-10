import type {
  RuntimeBlendModeV1,
  RuntimeRenderAttachmentV1,
  RuntimeRenderPacketV1,
  RuntimeTextureV1,
} from "@cane-runtime/core";
import { RuntimeErrorV1, runtimeWindingIndexRevisionV1 } from "@cane-runtime/core";
import { ViewContainer, type ALPHA_MODES, type BLEND_MODES, type Texture } from "pixi.js";
import {
  CANE_PIXI_LIGHT_VERTEX_STRIDE_BYTES_V1,
  CANE_PIXI_VERTEX_STRIDE_BYTES_V1,
  getCanePixiMaxTexturesPerBatchV1,
  installCanePixiBatchRendererV1,
} from "./batch-renderer.js";
import {
  type CanePixiValidationModeV1,
  updatePixiIndicesV1,
  validateRenderAttachmentForPixiV1,
  validateRenderPacketForPixiV1,
} from "./geometry.js";
import { PixiTextureStore } from "./texture-store.js";

const DEFAULT_INACTIVE_CACHE_FRAMES = 120;
const FLAG_TWO_COLOR = 1;
const FLAG_TEXTURE_LINEAR = 2;
const FLAG_TEXTURE_PREMULTIPLIED = 4;
const BLACK_RGB = Object.freeze([0, 0, 0] as const);

installCanePixiBatchRendererV1();

export interface CanePixiBatchViewOptionsV1 {
  readonly textures: PixiTextureStore;
  /** `once` validates the first packet and every newly observed geometry shape. */
  readonly validationMode?: CanePixiValidationModeV1;
  /** Number of applies to retain inactive attachments for skin/sequence reuse. */
  readonly inactiveCacheFrames?: number;
  /**
   * `instance` keeps one shader family across this view whenever any active
   * attachment needs two-color tint, minimizing batch breaks. `attachment`
   * minimizes vertex bytes but may split interleaved one/two-color draws.
   */
  readonly colorBatching?: "instance" | "attachment";
}

export interface CanePixiBatchApplyStatsV1 {
  readonly applySequence: number;
  readonly activeAttachments: number;
  readonly cachedAttachments: number;
  readonly activeVertices: number;
  readonly activeIndices: number;
  /** Interleaved bytes the Pixi batcher packs/uploads when this view is dirty. */
  readonly vertexUploadBytes: number;
  /** Source index bytes that need repacking after a structural change. */
  readonly indexRepackBytes: number;
  /** Draw calls for this isolated view, before coalescing with adjacent Cane views. */
  readonly isolatedDrawCalls: number;
  readonly structureChanged: boolean;
  readonly createdAttachments: number;
  readonly reusedAttachments: number;
  readonly destroyedAttachments: number;
}

export type MutableCanePixiBatchApplyStatsV1 = {
  -readonly [Field in keyof CanePixiBatchApplyStatsV1]: CanePixiBatchApplyStatsV1[Field];
};

export interface CanePixiBatchSourceV1 {
  readonly attachmentId: string;
  readonly slotId: string;
  readonly geometryKind: RuntimeRenderAttachmentV1["geometryKind"];
  /** Borrowed Core output. The batcher converts Y while packing, avoiding a staging copy. */
  worldVerticesXy: RuntimeRenderAttachmentV1["worldVerticesXy"];
  /** Borrowed Core output; UVs are already normalized and are read-only to the adapter. */
  uvs: RuntimeRenderAttachmentV1["uvs"];
  /** Borrowed for revisioned Core output; otherwise points at ownedIndices. */
  indices: number[] | Uint32Array;
  ownedIndices: Uint32Array | null;
  indexRevision: number | null;
  texture: Texture;
  textureDescriptor: RuntimeTextureV1;
  blendMode: RuntimeBlendModeV1;
  lightRgb: readonly [number, number, number];
  darkRgb: readonly [number, number, number];
  alpha: number;
  materialFlags: number;
  lastSeenApply: number;
  /** Internal lifetime marker used by renderer-local element caches. */
  cached: boolean;
  cachePrevious: CanePixiBatchSourceV1 | null;
  cacheNext: CanePixiBatchSourceV1 | null;
}

interface MutableBatchStatsV1 {
  applySequence: number;
  activeAttachments: number;
  cachedAttachments: number;
  activeVertices: number;
  activeIndices: number;
  vertexUploadBytes: number;
  indexRepackBytes: number;
  isolatedDrawCalls: number;
  structureChanged: boolean;
  createdAttachments: number;
  reusedAttachments: number;
  destroyedAttachments: number;
}

/**
 * High-throughput PixiJS v8 projection of a RuntimeRenderPacketV1.
 *
 * One view is one scene-graph node regardless of attachment count. Attachment
 * records and foreign-index fallback arrays persist across frames. Dynamic world vertices
 * are borrowed directly from Core and converted while Pixi packs its shared GPU
 * buffer, eliminating one full CPU staging copy. Adjacent instances can share
 * draw calls when blend mode and texture capacity permit.
 */
export class CanePixiBatchView extends ViewContainer {
  override readonly renderPipeId = "cane-v1";
  readonly batched = true;
  readonly #textures: PixiTextureStore;
  readonly #validationMode: CanePixiValidationModeV1;
  readonly #inactiveCacheFrames: number;
  readonly #colorBatching: "instance" | "attachment";
  readonly #recordsByAttachmentId = new Map<string, CanePixiBatchSourceV1[]>();
  readonly #stats: MutableBatchStatsV1 = {
    applySequence: 0,
    activeAttachments: 0,
    cachedAttachments: 0,
    activeVertices: 0,
    activeIndices: 0,
    vertexUploadBytes: 0,
    indexRepackBytes: 0,
    isolatedDrawCalls: 0,
    structureChanged: false,
    createdAttachments: 0,
    reusedAttachments: 0,
    destroyedAttachments: 0,
  };
  readonly #maxTexturesPerBatch = getCanePixiMaxTexturesPerBatchV1();
  readonly #batchTextureUids = new Uint32Array(this.#maxTexturesPerBatch);
  readonly activeBatchSources: CanePixiBatchSourceV1[] = [];
  #cacheHead: CanePixiBatchSourceV1 | null = null;
  #cacheTail: CanePixiBatchSourceV1 | null = null;
  #cachedAttachmentCount = 0;
  #applySequence = 0;
  #structureVersion = 0;
  #validatedFirstPacket = false;

  constructor(options: CanePixiBatchViewOptionsV1) {
    super({ label: "CanePixiBatchView", autoGarbageCollect: false });
    if (options.textures.pipeline !== "caneBatch") {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "pixiCreateView",
        "CanePixiBatchView requires a PixiTextureStore using the 'caneBatch' pipeline.",
        { field: "textures.pipeline" },
      );
    }
    this.#textures = options.textures;
    this.#validationMode = options.validationMode ?? "once";
    this.#inactiveCacheFrames = normalizeRetention(options.inactiveCacheFrames);
    this.#colorBatching = normalizeColorBatchingV1(options.colorBatching);
    this.eventMode = "none";
  }

  get structureVersion(): number {
    return this.#structureVersion;
  }

  apply(packet: RuntimeRenderPacketV1): void {
    this.applyRange(packet, 0, packet.attachments.length);
  }

  /**
   * Applies one contiguous attachment range without copying or slicing Core
   * output. Composite runtimes use this to interleave foreign Slot objects
   * while every Cane segment still borrows the authoritative packet arrays.
   */
  applyRange(packet: RuntimeRenderPacketV1, start: number, end: number): void {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start < 0 || end < start || end > packet.attachments.length) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "pixiApplyRange",
        "Attachment range must be safe integers within the packet.",
        { field: "range" },
      );
    }
    const validateWholePacket = this.#validationMode === "always"
      || this.#validationMode === "once" && !this.#validatedFirstPacket;
    if (validateWholePacket) validateRenderPacketForPixiV1(packet);

    this.#applySequence += 1;
    this.#resetStats();
    const attachmentCount = end - start;
    let structureChanged = this.activeBatchSources.length !== attachmentCount;
    let vertexCount = 0;
    let vertexUploadBytes = 0;
    let indexCount = 0;
    const forceTwoColor = this.#colorBatching === "instance" && packetHasTwoColorV1(packet);

    for (let localIndex = 0; localIndex < attachmentCount; localIndex += 1) {
      const index = start + localIndex;
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
        record = this.#createRecord(attachment, forceTwoColor);
        this.#stats.createdAttachments += 1;
        this.#stats.indexRepackBytes += indexBytesV1(record.indices);
        structureChanged = true;
      } else {
        if (this.#updateRecord(record, attachment, forceTwoColor)) structureChanged = true;
        this.#stats.reusedAttachments += 1;
      }

      record.lastSeenApply = this.#applySequence;
      this.#touchRecord(record);
      if (this.activeBatchSources[localIndex] !== record) structureChanged = true;
      this.activeBatchSources[localIndex] = record;
      const recordVertexCount = record.worldVerticesXy.length / 2;
      vertexCount += recordVertexCount;
      vertexUploadBytes += recordVertexCount * (
        (record.materialFlags & FLAG_TWO_COLOR) !== 0
          ? CANE_PIXI_VERTEX_STRIDE_BYTES_V1
          : CANE_PIXI_LIGHT_VERTEX_STRIDE_BYTES_V1
      );
      indexCount += record.indices.length;
    }
    this.activeBatchSources.length = attachmentCount;

    if (this.#pruneExpiredRecords()) structureChanged = true;
    this.#validatedFirstPacket ||= this.#validationMode === "once";
    if (structureChanged) this.#structureVersion += 1;
    this.#stats.activeAttachments = this.activeBatchSources.length;
    this.#stats.cachedAttachments = this.cachedAttachmentCount;
    this.#stats.activeVertices = vertexCount;
    this.#stats.activeIndices = indexCount;
    this.#stats.vertexUploadBytes = vertexUploadBytes;
    this.#stats.isolatedDrawCalls = this.#estimateIsolatedDrawCalls();
    this.#stats.structureChanged = structureChanged;
    this.onViewUpdate();
  }

  /** Returns a cold-path copy; normal apply/render does not allocate this object. */
  get lastApplyStats(): CanePixiBatchApplyStatsV1 {
    return { ...this.#stats };
  }

  /** Copies counters into retained caller storage without allocating. */
  writeLastApplyStats(output: MutableCanePixiBatchApplyStatsV1): void {
    output.applySequence = this.#stats.applySequence;
    output.activeAttachments = this.#stats.activeAttachments;
    output.cachedAttachments = this.#stats.cachedAttachments;
    output.activeVertices = this.#stats.activeVertices;
    output.activeIndices = this.#stats.activeIndices;
    output.vertexUploadBytes = this.#stats.vertexUploadBytes;
    output.indexRepackBytes = this.#stats.indexRepackBytes;
    output.isolatedDrawCalls = this.#stats.isolatedDrawCalls;
    output.structureChanged = this.#stats.structureChanged;
    output.createdAttachments = this.#stats.createdAttachments;
    output.reusedAttachments = this.#stats.reusedAttachments;
    output.destroyedAttachments = this.#stats.destroyedAttachments;
  }

  get cachedAttachmentCount(): number {
    return this.#cachedAttachmentCount;
  }

  pruneInactive(): void {
    let record = this.#cacheHead;
    let removed = false;
    while (record !== null && record.lastSeenApply !== this.#applySequence) {
      const next = record.cacheNext;
      this.#removeCachedRecord(record, false);
      removed = true;
      record = next;
    }
    if (removed) {
      this.#structureVersion += 1;
      this.onViewUpdate();
    }
  }

  clear(): void {
    const hadRecords = this.activeBatchSources.length > 0 || this.#recordsByAttachmentId.size > 0;
    let record = this.#cacheHead;
    while (record !== null) {
      record.cached = false;
      record = record.cacheNext;
    }
    this.activeBatchSources.length = 0;
    this.#recordsByAttachmentId.clear();
    this.#cacheHead = null;
    this.#cacheTail = null;
    this.#cachedAttachmentCount = 0;
    this.#validatedFirstPacket = false;
    if (hadRecords) {
      this.#structureVersion += 1;
      this.onViewUpdate();
    }
  }

  override destroy(...args: Parameters<ViewContainer["destroy"]>): void {
    this.clear();
    super.destroy(...args);
  }

  protected override updateBounds(): void {
    const bounds = this._bounds;
    bounds.clear();
    for (let recordIndex = 0; recordIndex < this.activeBatchSources.length; recordIndex += 1) {
      const record = this.activeBatchSources[recordIndex];
      if (record === undefined) continue;
      const positions = record.worldVerticesXy;
      for (let offset = 0; offset < positions.length; offset += 2) {
        const x = positions[offset];
        const sourceY = positions[offset + 1];
        if (x === undefined || sourceY === undefined) continue;
        const y = -sourceY;
        if (x < bounds.minX) bounds.minX = x;
        if (x > bounds.maxX) bounds.maxX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (y > bounds.maxY) bounds.maxY = y;
      }
    }
  }

  #findRecord(attachment: RuntimeRenderAttachmentV1): CanePixiBatchSourceV1 | undefined {
    const records = this.#recordsByAttachmentId.get(attachment.attachmentId);
    if (records === undefined) return undefined;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (record === undefined) continue;
      if (record.slotId === attachment.slotId
        && record.geometryKind === attachment.geometryKind
        && record.worldVerticesXy.length === attachment.worldVerticesXy.length
        && record.uvs.length === attachment.uvs.length
        && record.indices.length === attachment.indices.length) return record;
    }
    return undefined;
  }

  #createRecord(attachment: RuntimeRenderAttachmentV1, forceTwoColor: boolean): CanePixiBatchSourceV1 {
    const texture = this.#textures.texture(attachment.texture);
    const darkRgb = attachment.tint.darkRgb ?? BLACK_RGB;
    const indexRevision = runtimeWindingIndexRevisionV1(attachment.indices);
    const ownedIndices = indexRevision === null ? new Uint32Array(attachment.indices) : null;
    const record: CanePixiBatchSourceV1 = {
      attachmentId: attachment.attachmentId,
      slotId: attachment.slotId,
      geometryKind: attachment.geometryKind,
      worldVerticesXy: attachment.worldVerticesXy,
      uvs: attachment.uvs,
      indices: ownedIndices ?? (attachment.indices as number[]),
      ownedIndices,
      indexRevision,
      texture,
      textureDescriptor: attachment.texture,
      blendMode: attachment.blendMode,
      lightRgb: attachment.tint.lightRgb,
      darkRgb,
      alpha: attachment.tint.alpha,
      materialFlags: materialFlags(attachment, texture.source.alphaMode, forceTwoColor),
      lastSeenApply: this.#applySequence,
      cached: true,
      cachePrevious: null,
      cacheNext: null,
    };
    const records = this.#recordsByAttachmentId.get(attachment.attachmentId);
    if (records === undefined) this.#recordsByAttachmentId.set(attachment.attachmentId, [record]);
    else records.push(record);
    this.#appendCachedRecord(record);
    this.#cachedAttachmentCount += 1;
    return record;
  }

  /** Returns true when index, blend, or shader-family state requires rebuilt instructions. */
  #updateRecord(
    record: CanePixiBatchSourceV1,
    attachment: RuntimeRenderAttachmentV1,
    forceTwoColor: boolean,
  ): boolean {
    let structureChanged = false;
    const texture = sameTextureDescriptor(record.textureDescriptor, attachment.texture)
      ? record.texture
      : this.#textures.texture(attachment.texture);
    record.worldVerticesXy = attachment.worldVerticesXy;
    record.uvs = attachment.uvs;
    const nextIndexRevision = runtimeWindingIndexRevisionV1(attachment.indices);
    if (nextIndexRevision !== null) {
      if (record.indices !== attachment.indices || record.indexRevision !== nextIndexRevision) {
        structureChanged = true;
        this.#stats.indexRepackBytes += indexBytesV1(attachment.indices);
      }
      record.indices = attachment.indices as number[];
      record.indexRevision = nextIndexRevision;
    } else {
      let ownedIndices = record.ownedIndices;
      if (ownedIndices === null) {
        ownedIndices = new Uint32Array(attachment.indices.length);
        record.ownedIndices = ownedIndices;
      }
      const changedFromRenderedIndices = record.indices === ownedIndices
        ? updatePixiIndicesV1(attachment, ownedIndices)
        : !sameIndexValuesV1(record.indices, attachment.indices);
      if (record.indices !== ownedIndices) updatePixiIndicesV1(attachment, ownedIndices);
      if (changedFromRenderedIndices) {
        structureChanged = true;
        this.#stats.indexRepackBytes += ownedIndices.byteLength;
      }
      record.indices = ownedIndices;
      record.indexRevision = null;
    }
    if (record.blendMode !== attachment.blendMode) structureChanged = true;
    const nextMaterialFlags = materialFlags(attachment, texture.source.alphaMode, forceTwoColor);
    if ((record.materialFlags & FLAG_TWO_COLOR) !== (nextMaterialFlags & FLAG_TWO_COLOR)) {
      structureChanged = true;
    }

    record.texture = texture;
    record.textureDescriptor = attachment.texture;
    record.blendMode = attachment.blendMode;
    record.lightRgb = attachment.tint.lightRgb;
    record.darkRgb = attachment.tint.darkRgb ?? BLACK_RGB;
    record.alpha = attachment.tint.alpha;
    record.materialFlags = nextMaterialFlags;
    return structureChanged;
  }

  #pruneExpiredRecords(): boolean {
    let record = this.#cacheHead;
    let removed = false;
    while (record !== null
      && record.lastSeenApply !== this.#applySequence
      && this.#applySequence - record.lastSeenApply > this.#inactiveCacheFrames) {
      const next = record.cacheNext;
      this.#removeCachedRecord(record, true);
      removed = true;
      record = next;
    }
    return removed;
  }

  #touchRecord(record: CanePixiBatchSourceV1): void {
    if (this.#cacheTail === record) return;
    const previous = record.cachePrevious;
    const next = record.cacheNext;
    if (previous === null) this.#cacheHead = next;
    else previous.cacheNext = next;
    if (next !== null) next.cachePrevious = previous;
    record.cachePrevious = this.#cacheTail;
    record.cacheNext = null;
    if (this.#cacheTail === null) this.#cacheHead = record;
    else this.#cacheTail.cacheNext = record;
    this.#cacheTail = record;
  }

  #appendCachedRecord(record: CanePixiBatchSourceV1): void {
    record.cachePrevious = this.#cacheTail;
    record.cacheNext = null;
    if (this.#cacheTail === null) this.#cacheHead = record;
    else this.#cacheTail.cacheNext = record;
    this.#cacheTail = record;
  }

  #removeCachedRecord(record: CanePixiBatchSourceV1, countDestroyed: boolean): void {
    const previous = record.cachePrevious;
    const next = record.cacheNext;
    if (previous === null) this.#cacheHead = next;
    else previous.cacheNext = next;
    if (next === null) this.#cacheTail = previous;
    else next.cachePrevious = previous;
    record.cachePrevious = null;
    record.cacheNext = null;
    record.cached = false;

    const records = this.#recordsByAttachmentId.get(record.attachmentId);
    if (records !== undefined) {
      const index = records.indexOf(record);
      if (index >= 0) {
        const lastIndex = records.length - 1;
        const last = records[lastIndex];
        if (index !== lastIndex && last !== undefined) records[index] = last;
        records.length = lastIndex;
        this.#cachedAttachmentCount -= 1;
      }
      if (records.length === 0) this.#recordsByAttachmentId.delete(record.attachmentId);
    }
    if (countDestroyed) this.#stats.destroyedAttachments += 1;
  }

  #estimateIsolatedDrawCalls(): number {
    let draws = 0;
    let textureCount = 0;
    let currentBlend: BLEND_MODES | null = null;
    let currentTwoColor: boolean | null = null;
    for (let sourceIndex = 0; sourceIndex < this.activeBatchSources.length; sourceIndex += 1) {
      const source = this.activeBatchSources[sourceIndex];
      if (source === undefined) continue;
      const inheritedBlend = this.groupBlendMode === "normal" ? source.blendMode : this.groupBlendMode;
      const blendMode: BLEND_MODES = inheritedBlend === "add" ? "add-npm" : inheritedBlend;
      const twoColor = (source.materialFlags & FLAG_TWO_COLOR) !== 0;
      if (currentBlend !== blendMode || currentTwoColor !== twoColor) {
        draws += 1;
        currentBlend = blendMode;
        currentTwoColor = twoColor;
        textureCount = 0;
      }
      let found = false;
      const uid = source.texture.source.uid;
      for (let index = 0; index < textureCount; index += 1) {
        if (this.#batchTextureUids[index] === uid) {
          found = true;
          break;
        }
      }
      if (found) continue;
      if (textureCount === this.#maxTexturesPerBatch) {
        draws += 1;
        textureCount = 0;
      }
      this.#batchTextureUids[textureCount] = uid;
      textureCount += 1;
    }
    return draws;
  }

  #resetStats(): void {
    this.#stats.applySequence = this.#applySequence;
    this.#stats.activeAttachments = 0;
    this.#stats.cachedAttachments = 0;
    this.#stats.activeVertices = 0;
    this.#stats.activeIndices = 0;
    this.#stats.vertexUploadBytes = 0;
    this.#stats.indexRepackBytes = 0;
    this.#stats.isolatedDrawCalls = 0;
    this.#stats.structureChanged = false;
    this.#stats.createdAttachments = 0;
    this.#stats.reusedAttachments = 0;
    this.#stats.destroyedAttachments = 0;
  }
}

function materialFlags(
  attachment: RuntimeRenderAttachmentV1,
  sourceAlphaMode: ALPHA_MODES,
  forceTwoColor: boolean,
): number {
  if (sourceAlphaMode !== "premultiplied-alpha") {
    throw new RuntimeErrorV1(
      "validationFailed",
      "pixiApply",
      "Cane batch textures must preserve source bytes while selecting Pixi's premultiplied blend pipeline.",
      { field: "texture.alphaMode", entityId: attachment.attachmentId },
    );
  }
  let flags = attachment.twoColor || forceTwoColor ? FLAG_TWO_COLOR : 0;
  if (attachment.texture.colorSpace === "linear") flags |= FLAG_TEXTURE_LINEAR;
  if (attachment.texture.alphaMode === "premultiplied") flags |= FLAG_TEXTURE_PREMULTIPLIED;
  return flags;
}

function packetHasTwoColorV1(packet: RuntimeRenderPacketV1): boolean {
  for (let index = 0; index < packet.attachments.length; index += 1) {
    if (packet.attachments[index]?.twoColor === true) return true;
  }
  return false;
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

function normalizeColorBatchingV1(
  value: CanePixiBatchViewOptionsV1["colorBatching"],
): "instance" | "attachment" {
  const result = value ?? "instance";
  if (result !== "instance" && result !== "attachment") {
    throw new RuntimeErrorV1(
      "invalidArgument",
      "pixiCreateView",
      "colorBatching must be 'instance' or 'attachment'.",
      { field: "colorBatching" },
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

function indexBytesV1(indices: readonly number[] | Uint32Array): number {
  return indices.length * Uint32Array.BYTES_PER_ELEMENT;
}

function sameIndexValuesV1(
  left: readonly number[] | Uint32Array,
  right: readonly number[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
