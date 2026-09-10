import {
  RenderData,
  UI,
  UIRenderer,
  UIVertexFormat,
  director,
  sys,
  type EffectAsset,
  type Material,
  type Texture2D,
} from "cc";
import type { AffineV1, RuntimeFrameV1, RuntimeRenderPacketV1 } from "@cane-runtime/core";
import { CaneCocosErrorV1 } from "./errors.js";
import type {
  CaneCocosFollowerStatsV1,
  CaneCocosSceneNodeEntryV1,
} from "./followers.js";
import {
  CANE_COCOS_MAX_UINT16_VERTICES_V1,
  CaneCocosBatchPlannerV1,
  CaneCocosGeometryAssemblerV1,
  type CaneCocosColorModulationV1,
  type CaneCocosValidationModeV1,
  validateRenderPacketForCocosV1,
} from "./geometry.js";
import {
  CaneCocosNativeSubmissionBridgeV1,
  configureCaneRenderEntityV1,
  initializeCaneNativeRenderDataV1,
  submitCaneSubNodeV1,
  type CaneCocosDrawSubmissionV1,
  type CaneCocosNodeSubmissionV1,
  type CaneCocosSubmissionV1,
} from "./internal-bridge.js";
import { CaneCocosMaterialSetV1 } from "./materials.js";
import type {
  CaneCocosProjectionInvalidationV1,
  CaneCocosProjectionStatsV1,
  CaneCocosProjectionV1,
} from "./runtime.js";
import type { CocosTextureStore } from "./texture-store.js";

const CANE_ACCESSOR_KEY_V1 = 0x43414e45;

type MutableProjectionStatsV1 = {
  -readonly [Key in keyof CaneCocosProjectionStatsV1]: CaneCocosProjectionStatsV1[Key];
};

type CaneStaticAccessorV1 = ReturnType<typeof RenderData.createStaticVBAccessor>;

let sharedAccessorV1: CaneStaticAccessorV1 | null = null;
let sharedAccessorDeviceV1: object | null = null;
// Resource replacement can stage a new renderer on the same Native component.
// Only the renderer that last submitted may clear that component's draw infos.
const nativeSubmissionOwnerV1 = new WeakMap<UIRenderer, CaneCocosRendererV1>();

export interface CaneCocosRendererHostV1 {
  readonly component: UIRenderer;
  readonly enableBatch: boolean;
  writeColorModulation(output: CaneCocosColorModulationV1): CaneCocosColorModulationV1;
  writeWorldAffine(output: MutableAffineV1): MutableAffineV1;
  requestRenderDataUpdate(): void;
}

export interface CaneCocosSceneNodeSourceV1 {
  readonly sceneEntries: readonly CaneCocosSceneNodeEntryV1[];
  writeStats<T extends MutableFollowerStatsV1>(output: T): T;
}

interface MutableAffineV1 {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

interface MutableFollowerStatsV1 {
  boneObjects: number;
  slotObjects: number;
  activeSlotObjects: number;
  maskedSlotObjects: number;
  clippingMaskVertexWrites: number;
}

interface CaneCocosDrawCommandV1 extends CaneCocosDrawSubmissionV1 {
  kind: "draw";
  texture: Texture2D;
  material: Material;
  indexOffset: number;
  indexCount: number;
}

interface CaneCocosNodeCommandV1 extends CaneCocosNodeSubmissionV1 {
  kind: "node";
  node: CaneCocosNodeSubmissionV1["node"];
}

export interface CaneCocosRendererOptionsV1 {
  readonly validation?: CaneCocosValidationModeV1;
  readonly initialVertexCapacity?: number;
  readonly initialIndexCapacity?: number;
  /** Creator-imported packaged effect; required by the Native layout graph. */
  readonly colorEffectAsset?: EffectAsset;
}

/**
 * Cocos 2D projection of a Core-owned final frame. Web and Native consume the
 * same packed packet and retained submission sequence. No Core work is repeated.
 */
export class CaneCocosRendererV1 implements CaneCocosProjectionV1 {
  readonly #host: CaneCocosRendererHostV1;
  readonly #validation: CaneCocosValidationModeV1;
  readonly #planner = new CaneCocosBatchPlannerV1();
  readonly #packer = new CaneCocosGeometryAssemblerV1();
  readonly #drawCommandPool: CaneCocosDrawCommandV1[] = [];
  readonly #nodeCommandPool: CaneCocosNodeCommandV1[] = [];
  readonly #submissions: CaneCocosSubmissionV1[] = [];
  readonly #sceneNodesSnapshot: CaneCocosSceneNodeEntryV1[] = [];
  readonly #modulation: CaneCocosColorModulationV1 = { r: 255, g: 255, b: 255, alpha: 1 };
  readonly #materials: CaneCocosMaterialSetV1;
  readonly #nativeBridge = new CaneCocosNativeSubmissionBridgeV1();
  readonly #worldAffineScratch: MutableAffineV1 = identityAffineV1();
  readonly #packedWorldAffine: MutableAffineV1 = identityAffineV1();
  readonly #followerStats: MutableFollowerStatsV1 = emptyFollowerStatsV1();
  readonly #initialVertexCapacity: number;
  readonly #initialIndexCapacity: number;
  #sceneSource: CaneCocosSceneNodeSourceV1 | null = null;
  #renderData: RenderData | null = null;
  #packet: RuntimeRenderPacketV1 | null = null;
  #textures: CocosTextureStore | null = null;
  #validated = false;
  #destroyed = false;
  #dirty = true;
  #activeIndexCount = 0;
  #drawCommandCount = 0;
  #nodeCommandCount = 0;
  #submissionRevision = 0;
  #nativePreparedRevision = -1;
  #nativePreparedFrame = -1;
  #packedWorldAffineValid = false;
  #renderVertexBytes: Uint8Array | null = null;
  #activeRenderIndices: Uint16Array | null = null;
  #activeRenderIndexCount = -1;
  readonly #stats: MutableProjectionStatsV1 = emptyProjectionStatsV1();

  constructor(host: CaneCocosRendererHostV1, options: CaneCocosRendererOptionsV1 = {}) {
    this.#host = host;
    this.#validation = options.validation ?? "once";
    this.#initialVertexCapacity = positiveCapacityV1(
      options.initialVertexCapacity ?? 256,
      "initialVertexCapacity",
    );
    this.#initialIndexCapacity = positiveCapacityV1(
      options.initialIndexCapacity ?? 384,
      "initialIndexCapacity",
    );
    this.#materials = new CaneCocosMaterialSetV1({
      owner: host.component,
      enableBatch: host.enableBatch,
      ...(options.colorEffectAsset === undefined ? {} : { effectAsset: options.colorEffectAsset }),
    });
  }

  get renderData(): RenderData | null { return this.#renderData; }
  get stats(): CaneCocosProjectionStatsV1 { return this.#stats; }
  get submissions(): readonly CaneCocosSubmissionV1[] { return this.#submissions; }

  createRenderData(): RenderData {
    this.#assertLive();
    if (this.#renderData !== null) return this.#renderData;
    const accessor = ensureAccessorV1();
    const data = RenderData.add(UIVertexFormat.vfmtPosUvTwoColor4B, accessor);
    data.resize(this.#initialVertexCapacity, this.#initialIndexCapacity);
    data.updateSize(0, 0);
    initializeCaneNativeRenderDataV1(data, this.#host.component);
    this.#renderData = data;
    configureCaneRenderEntityV1(this.#host.component, this.#host.enableBatch);
    return data;
  }

  setSceneNodeSource(source: CaneCocosSceneNodeSourceV1 | null): void {
    this.#assertLive();
    if (source === this.#sceneSource) return;
    this.#sceneSource = source;
    this.#sceneNodesSnapshot.length = 0;
    this.invalidate("frame");
  }

  setEnableBatch(value: boolean): void {
    this.#assertLive();
    this.#materials.setEnableBatch(value);
    configureCaneRenderEntityV1(this.#host.component, value);
    this.#packedWorldAffineValid = false;
    this.invalidate("transform");
  }

  setMaterialTemplate(material: Material): void {
    this.#assertLive();
    this.#materials.setTemplate(material);
    this.invalidate("color");
  }

  /** True when batched world-space vertices must be repacked for a host transform change. */
  hostTransformChanged(): boolean {
    this.#assertLive();
    if (!this.#host.enableBatch) return false;
    this.#host.writeWorldAffine(this.#worldAffineScratch);
    return !this.#packedWorldAffineValid
      || !equalAffineV1(this.#worldAffineScratch, this.#packedWorldAffine);
  }

  apply(frame: RuntimeFrameV1, textures: CocosTextureStore): CaneCocosProjectionStatsV1 {
    this.#assertLive();
    const packet = frame.renderPacket;
    if (this.#validation === "always" || (this.#validation === "once" && !this.#validated)) {
      validateRenderPacketForCocosV1(packet);
      this.#validated = true;
    }
    const data = this.createRenderData();
    this.#packet = packet;
    this.#textures = textures;
    const modulation = this.#host.writeColorModulation(this.#modulation);
    const worldTransform = this.#host.enableBatch
      ? this.#host.writeWorldAffine(this.#worldAffineScratch)
      : null;
    const upload = this.#packer.applyRange(
      packet,
      0,
      packet.attachments.length,
      modulation,
      worldTransform,
    );
    if (upload.vertexCount > CANE_COCOS_MAX_UINT16_VERTICES_V1) {
      throw new CaneCocosErrorV1(
        "renderContractViolation",
        "One Cane character frame exceeds Cocos 3.8.8's 16-bit middleware mesh limit.",
        {
          operation: "cocosApplyRenderPacket",
          field: "renderPacket.vertices",
          expected: `<= ${CANE_COCOS_MAX_UINT16_VERTICES_V1}`,
          actual: upload.vertexCount,
        },
      );
    }
    if (worldTransform !== null) {
      copyAffineV1(this.#packedWorldAffine, worldTransform);
      this.#packedWorldAffineValid = true;
    } else {
      this.#packedWorldAffineValid = false;
    }

    const requiredVertexCapacity = Math.max(upload.vertexCount, this.#initialVertexCapacity);
    const requiredIndexCapacity = Math.max(upload.indexCount, this.#initialIndexCapacity);
    let reallocated = false;
    if (data.chunk.vb.byteLength < requiredVertexCapacity * 7 * Float32Array.BYTES_PER_ELEMENT
      || data.chunk.indexCount < requiredIndexCapacity) {
      data.resize(requiredVertexCapacity, requiredIndexCapacity);
      reallocated = true;
    }
    data.updateSize(upload.vertexCount, upload.indexCount);
    if (upload.vertexUploadBytes > 0) {
      if (this.#renderVertexBytes === null
        || this.#renderVertexBytes.buffer !== data.chunk.vb.buffer
        || this.#renderVertexBytes.byteOffset !== data.chunk.vb.byteOffset
        || this.#renderVertexBytes.byteLength !== upload.vertexUploadBytes) {
        this.#renderVertexBytes = new Uint8Array(
          data.chunk.vb.buffer,
          data.chunk.vb.byteOffset,
          upload.vertexUploadBytes,
        );
      }
      this.#renderVertexBytes.set(upload.vertexBytes);
    }
    if (data.indices === null || data.indices.length < upload.indexCount) {
      data.indices = new Uint16Array(requiredIndexCapacity);
      reallocated = true;
    }
    const indices = data.indices;
    const chunkVertexOffset = data.chunk.vertexOffset;
    for (let index = 0; index < upload.indexCount; index += 1) {
      indices[index] = (upload.indices[index] ?? 0) + chunkVertexOffset;
    }
    if (this.#activeRenderIndexCount !== upload.indexCount
      || this.#activeRenderIndices?.buffer !== indices.buffer) {
      this.#activeRenderIndices = indices.subarray(0, upload.indexCount);
      this.#activeRenderIndexCount = upload.indexCount;
    }
    this.#activeIndexCount = upload.indexCount;
    const naturalRangeCount = this.#planner.write(packet);
    this.#buildSubmissions(packet, textures);
    data.accessor.getMeshBuffer(data.chunk.bufferId).setDirty();
    this.#sceneSource?.writeStats(this.#followerStats);
    if (this.#sceneSource === null) clearFollowerStatsV1(this.#followerStats);
    const slotSplits = this.#followerStats.activeSlotObjects;
    const stats = this.#stats;
    stats.activeAttachments = packet.attachments.length;
    stats.activeVertices = upload.vertexCount;
    stats.activeIndices = upload.indexCount;
    stats.vertexUploadBytes = upload.vertexUploadBytes;
    stats.indexUploadBytes = upload.indexCount * Uint16Array.BYTES_PER_ELEMENT;
    stats.bufferUploads = upload.vertexCount === 0 ? 0 : 1;
    stats.bufferReallocations = reallocated || upload.grew ? 1 : 0;
    stats.drawCalls = this.#drawCommandCount;
    stats.isolatedDrawCalls = slotSplits;
    stats.batchSegments = this.#drawCommandCount;
    stats.naturalBatchSplits = Math.max(0, naturalRangeCount - 1);
    stats.slotObjectBatchSplits = slotSplits;
    stats.clippingBatchSplits = countClippingSplitsV1(packet.attachments)
      + this.#followerStats.maskedSlotObjects;
    stats.boneObjects = this.#followerStats.boneObjects;
    stats.slotObjects = this.#followerStats.slotObjects;
    stats.activeSlotObjects = this.#followerStats.activeSlotObjects;
    stats.maskedSlotObjects = this.#followerStats.maskedSlotObjects;
    stats.clippingMaskVertexWrites = this.#followerStats.clippingMaskVertexWrites;
    this.#prepareNativeSubmissions();
    this.#dirty = false;
    return this.#stats;
  }

  /** Refreshes child interleaving without invoking or projecting Core again. */
  refreshSceneObjects(): void {
    this.#assertLive();
    const packet = this.#packet;
    const textures = this.#textures;
    if (packet === null || textures === null) return;
    if (!this.#sceneSnapshotMatches()) this.#buildSubmissions(packet, textures);
    this.#prepareNativeSubmissions();
  }

  submit(batcher: UI): void {
    this.#assertLive();
    if (sys.isNative) return;
    const data = this.#renderData;
    if (data === null) return;
    const needsMesh = this.#activeIndexCount > 0 && this.#drawCommandCount > 0;
    const meshBuffer = needsMesh ? data.getMeshBuffer() : null;
    if (needsMesh && meshBuffer === null) {
      throw new CaneCocosErrorV1("engineNotInitialized", "Cocos middleware MeshBuffer is unavailable.", {
        operation: "cocosSubmitRenderData",
        field: "renderData.meshBuffer",
      });
    }
    const origin = meshBuffer?.indexOffset ?? 0;
    for (let index = 0; index < this.#submissions.length; index += 1) {
      const submission = this.#submissions[index];
      if (submission === undefined) continue;
      if (submission.kind === "node") {
        submitCaneSubNodeV1(batcher, submission.node);
      } else if (meshBuffer !== null
        && submission.texture.isValid
        && submission.material.isValid) {
        batcher.commitMiddleware(
          this.#host.component,
          meshBuffer,
          origin + submission.indexOffset,
          submission.indexCount,
          submission.texture,
          submission.material,
          this.#host.enableBatch,
        );
      }
    }
    if (needsMesh) {
      data.accessor.appendIndices(
        data.chunk.bufferId,
        this.#activeRenderIndices!,
      );
      data.accessor.getMeshBuffer(data.chunk.bufferId).setDirty();
    }
  }

  invalidate(_reason: CaneCocosProjectionInvalidationV1): void {
    if (this.#destroyed) return;
    this.#dirty = true;
    this.#host.requestRenderDataUpdate();
  }

  destroy(): void {
    if (this.#destroyed) return;
    if (nativeSubmissionOwnerV1.get(this.#host.component) === this) {
      this.#nativeBridge.clear(this.#host.component);
      nativeSubmissionOwnerV1.delete(this.#host.component);
    }
    this.#materials.destroy();
    if (this.#renderData !== null) {
      RenderData.remove(this.#renderData);
      this.#renderData = null;
    }
    this.#submissions.length = 0;
    this.#drawCommandPool.length = 0;
    this.#nodeCommandPool.length = 0;
    this.#sceneNodesSnapshot.length = 0;
    this.#packet = null;
    this.#textures = null;
    this.#renderVertexBytes = null;
    this.#activeRenderIndices = null;
    this.#activeRenderIndexCount = -1;
    this.#activeIndexCount = 0;
    this.#destroyed = true;
  }

  #buildSubmissions(packet: RuntimeRenderPacketV1, textures: CocosTextureStore): void {
    const entries = this.#sceneSource?.sceneEntries ?? EMPTY_SCENE_ENTRIES_V1;
    let submissionCount = 0;
    let drawCount = 0;
    let nodeCount = 0;
    let sceneIndex = 0;
    let attachmentCursor = 0;
    let rangeIndex = 0;
    let indexOffset = 0;

    while (attachmentCursor <= packet.attachments.length) {
      while (sceneIndex < entries.length && entries[sceneIndex]!.cursor === attachmentCursor) {
        const entry = entries[sceneIndex]!;
        let command = this.#nodeCommandPool[nodeCount];
        if (command === undefined) {
          command = { kind: "node", node: entry.node };
          this.#nodeCommandPool[nodeCount] = command;
        } else {
          command.node = entry.node;
        }
        this.#submissions[submissionCount] = command;
        submissionCount += 1;
        nodeCount += 1;
        sceneIndex += 1;
      }
      if (attachmentCursor === packet.attachments.length) break;
      const range = this.#planner.ranges[rangeIndex];
      if (range === undefined || attachmentCursor < range.start || attachmentCursor >= range.end) {
        throw new CaneCocosErrorV1(
          "renderContractViolation",
          "Cocos batch planner did not cover the published attachment cursor.",
          {
            operation: "cocosBuildSubmissions",
            field: "batchRanges",
            actual: attachmentCursor,
          },
        );
      }
      let end = range.end;
      const nextScene = entries[sceneIndex];
      if (nextScene !== undefined && nextScene.cursor < end) end = nextScene.cursor;
      if (end <= attachmentCursor) {
        throw new CaneCocosErrorV1(
          "renderContractViolation",
          "Scene-object cursor did not advance the Cocos submission list.",
          {
            operation: "cocosBuildSubmissions",
            field: "sceneEntries.cursor",
            actual: end,
          },
        );
      }
      let indexCount = 0;
      for (let index = attachmentCursor; index < end; index += 1) {
        indexCount += packet.attachments[index]?.indices.length ?? 0;
      }
      const first = packet.attachments[attachmentCursor]!;
      let command = this.#drawCommandPool[drawCount];
      if (command === undefined) {
        command = {
          kind: "draw",
          texture: textures.texture(first.texture),
          material: this.#materials.get(first.blendMode),
          indexOffset,
          indexCount,
        };
        this.#drawCommandPool[drawCount] = command;
      } else {
        command.texture = textures.texture(first.texture);
        command.material = this.#materials.get(first.blendMode);
        command.indexOffset = indexOffset;
        command.indexCount = indexCount;
      }
      this.#submissions[submissionCount] = command;
      submissionCount += 1;
      drawCount += 1;
      indexOffset += indexCount;
      attachmentCursor = end;
      if (attachmentCursor === range.end) rangeIndex += 1;
    }

    if (sceneIndex !== entries.length) {
      const invalid = entries[sceneIndex];
      throw new CaneCocosErrorV1(
        "renderContractViolation",
        "Scene-object cursor lies outside the published RenderPacket.",
        {
          operation: "cocosBuildSubmissions",
          field: "sceneEntries.cursor",
          actual: invalid?.cursor,
        },
      );
    }
    this.#submissions.length = submissionCount;
    this.#drawCommandCount = drawCount;
    this.#nodeCommandCount = nodeCount;
    this.#captureSceneSnapshot(entries);
    this.#submissionRevision += 1;
  }

  #sceneSnapshotMatches(): boolean {
    const entries = this.#sceneSource?.sceneEntries ?? EMPTY_SCENE_ENTRIES_V1;
    if (entries.length !== this.#sceneNodesSnapshot.length) return false;
    for (let index = 0; index < entries.length; index += 1) {
      const current = entries[index];
      const previous = this.#sceneNodesSnapshot[index];
      if (current === undefined || previous === undefined
        || current.node !== previous.node
        || current.cursor !== previous.cursor
        || current.source !== previous.source) return false;
    }
    return true;
  }

  #captureSceneSnapshot(entries: readonly CaneCocosSceneNodeEntryV1[]): void {
    for (let index = 0; index < entries.length; index += 1) {
      const source = entries[index]!;
      let target = this.#sceneNodesSnapshot[index];
      if (target === undefined) {
        target = {
          cursor: source.cursor,
          node: source.node,
          source: source.source,
          lastSeenSequence: source.lastSeenSequence,
        };
        this.#sceneNodesSnapshot[index] = target;
      } else {
        target.cursor = source.cursor;
        target.node = source.node;
        target.source = source.source;
        target.lastSeenSequence = source.lastSeenSequence;
      }
    }
    this.#sceneNodesSnapshot.length = entries.length;
  }

  #prepareNativeSubmissions(): void {
    if (!sys.isNative) return;
    const data = this.#renderData;
    if (data === null) return;
    const frame = director.getTotalFrames();
    if (this.#nativePreparedRevision === this.#submissionRevision
      && this.#nativePreparedFrame === frame) return;
    let origin = 0;
    if (this.#activeIndexCount > 0) {
      const meshBuffer = data.getMeshBuffer();
      if (meshBuffer === null) {
        throw new CaneCocosErrorV1(
          "engineNotInitialized",
          "Cocos native middleware MeshBuffer is unavailable.",
          { operation: "cocosPrepareNativeDrawInfos", field: "renderData.meshBuffer" },
        );
      }
      origin = meshBuffer.indexOffset;
      data.accessor.appendIndices(
        data.chunk.bufferId,
        this.#activeRenderIndices!,
      );
      data.accessor.getMeshBuffer(data.chunk.bufferId).setDirty();
    }
    nativeSubmissionOwnerV1.set(this.#host.component, this);
    this.#nativeBridge.prepare(
      this.#host.component,
      data,
      this.#submissions,
      this.#submissions.length,
      origin,
    );
    this.#nativePreparedRevision = this.#submissionRevision;
    this.#nativePreparedFrame = frame;
  }

  #assertLive(): void {
    if (this.#destroyed) {
      throw new CaneCocosErrorV1("invalidState", "The Cocos renderer is destroyed.", {
        operation: "cocosRenderer",
      });
    }
  }
}

const EMPTY_SCENE_ENTRIES_V1: readonly CaneCocosSceneNodeEntryV1[] = Object.freeze([]);

function emptyProjectionStatsV1(): MutableProjectionStatsV1 {
  return {
    activeAttachments: 0,
    activeVertices: 0,
    activeIndices: 0,
    vertexUploadBytes: 0,
    indexUploadBytes: 0,
    bufferUploads: 0,
    bufferReallocations: 0,
    drawCalls: 0,
    isolatedDrawCalls: 0,
    batchSegments: 0,
    naturalBatchSplits: 0,
    slotObjectBatchSplits: 0,
    clippingBatchSplits: 0,
    boneObjects: 0,
    slotObjects: 0,
    activeSlotObjects: 0,
    maskedSlotObjects: 0,
    clippingMaskVertexWrites: 0,
  };
}

function ensureAccessorV1(): CaneStaticAccessorV1 {
  const root = director.root;
  if (root === null || root === undefined) {
    throw new CaneCocosErrorV1("engineNotInitialized", "Cocos Director root is unavailable.", {
      operation: "cocosCreateRenderData",
      field: "director.root",
    });
  }
  if (sharedAccessorV1 !== null && sharedAccessorDeviceV1 === root.device) return sharedAccessorV1;
  const accessor = RenderData.createStaticVBAccessor(
    UIVertexFormat.vfmtPosUvTwoColor4B,
    CANE_COCOS_MAX_UINT16_VERTICES_V1,
    CANE_COCOS_MAX_UINT16_VERTICES_V1 * 4,
  );
  root.batcher2D.registerBufferAccessor(CANE_ACCESSOR_KEY_V1, accessor);
  sharedAccessorV1 = accessor;
  sharedAccessorDeviceV1 = root.device;
  return accessor;
}

function positiveCapacityV1(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CaneCocosErrorV1("invalidArgument", `${field} must be a positive integer.`, {
      operation: "cocosCreateRenderer",
      field,
      actual: value,
    });
  }
  return value;
}

function countClippingSplitsV1(
  attachments: RuntimeFrameV1["renderPacket"]["attachments"],
): number {
  let count = 0;
  for (let index = 1; index < attachments.length; index += 1) {
    const previous = attachments[index - 1];
    const current = attachments[index];
    if (previous !== undefined && current !== undefined
      && previous.sourceZIndex + 1 !== current.sourceZIndex) count += 1;
  }
  return count;
}

function identityAffineV1(): MutableAffineV1 {
  return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
}

function copyAffineV1(output: MutableAffineV1, input: AffineV1): void {
  output.a = input.a;
  output.b = input.b;
  output.c = input.c;
  output.d = input.d;
  output.tx = input.tx;
  output.ty = input.ty;
}

function equalAffineV1(left: AffineV1, right: AffineV1): boolean {
  return left.a === right.a
    && left.b === right.b
    && left.c === right.c
    && left.d === right.d
    && left.tx === right.tx
    && left.ty === right.ty;
}

function emptyFollowerStatsV1(): MutableFollowerStatsV1 {
  return {
    boneObjects: 0,
    slotObjects: 0,
    activeSlotObjects: 0,
    maskedSlotObjects: 0,
    clippingMaskVertexWrites: 0,
  };
}

function clearFollowerStatsV1(output: MutableFollowerStatsV1): void {
  output.boneObjects = 0;
  output.slotObjects = 0;
  output.activeSlotObjects = 0;
  output.maskedSlotObjects = 0;
  output.clippingMaskVertexWrites = 0;
}

void (null as CaneCocosFollowerStatsV1 | null);
