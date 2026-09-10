import type { RuntimeBlendModeV1, RuntimeRenderPacketV1 } from "@cane-runtime/core";
import {
  CaneLayaGeometryAssemblerV1,
  type CaneLayaValidationModeV1,
  validateRenderAttachmentForLayaV1,
  validateRenderPacketForLayaV1,
} from "./geometry.js";
import {
  createCaneLayaMeshV1,
  uploadCaneLayaMeshV1,
} from "./laya-mesh-bridge.js";
import { CaneLayaMaterialSetV1 } from "./shader.js";
import { LayaTextureStore } from "./texture-store.js";

export interface CaneLayaBatchViewOptionsV1 {
  readonly textures: LayaTextureStore;
  readonly materials: CaneLayaMaterialSetV1;
  readonly validationMode?: CaneLayaValidationModeV1;
}

export interface CaneLayaBatchApplyStatsV1 {
  readonly attachments: number;
  readonly vertices: number;
  readonly indices: number;
  readonly vertexUploadBytes: number;
  readonly indexUploadBytes: number;
  readonly uploads: number;
  readonly meshRebuilds: number;
  readonly drawCalls: number;
}

export type MutableCaneLayaBatchApplyStatsV1 = {
  -readonly [Field in keyof CaneLayaBatchApplyStatsV1]: CaneLayaBatchApplyStatsV1[Field]
};

/** One retained Mesh2D node for a contiguous texture/blend range. */
export class CaneLayaBatchView extends Laya.Sprite {
  readonly #textures: LayaTextureStore;
  readonly #materials: CaneLayaMaterialSetV1;
  readonly #validationMode: CaneLayaValidationModeV1;
  readonly #assembler = new CaneLayaGeometryAssemblerV1();
  readonly #renderer: Laya.Mesh2DRender;
  readonly #stats: MutableCaneLayaBatchApplyStatsV1 = emptyBatchStatsV1();
  readonly #validatedAttachmentIds = new Set<string>();
  #mesh: Laya.Mesh2D | null = null;
  #staleMesh: Laya.Mesh2D | null = null;
  #destroying = false;

  constructor(options: CaneLayaBatchViewOptionsV1) {
    super();
    this.name = "CaneLayaBatch";
    this.mouseEnabled = false;
    this.mouseThrough = true;
    this.#textures = options.textures;
    this.#materials = options.materials;
    this.#validationMode = options.validationMode ?? "once";
    this.#renderer = this.addComponent(Laya.Mesh2DRender);
    this.visible = false;
  }

  get lastApplyStats(): CaneLayaBatchApplyStatsV1 {
    return { ...this.#stats };
  }

  /** Allocation-free stats copy for schedulers and composite runtimes. */
  writeLastApplyStats(
    output: MutableCaneLayaBatchApplyStatsV1,
  ): MutableCaneLayaBatchApplyStatsV1 {
    output.attachments = this.#stats.attachments;
    output.vertices = this.#stats.vertices;
    output.indices = this.#stats.indices;
    output.vertexUploadBytes = this.#stats.vertexUploadBytes;
    output.indexUploadBytes = this.#stats.indexUploadBytes;
    output.uploads = this.#stats.uploads;
    output.meshRebuilds = this.#stats.meshRebuilds;
    output.drawCalls = this.#stats.drawCalls;
    return output;
  }

  applyRange(packet: RuntimeRenderPacketV1, start: number, end: number): CaneLayaBatchApplyStatsV1 {
    if (this.destroyed) throw new Error("Cannot apply a frame to a destroyed CaneLayaBatchView.");
    if (this.#validationMode === "always") validateRenderPacketForLayaV1(packet);
    if (start >= end) {
      this.visible = false;
      resetBatchStatsV1(this.#stats);
      return this.#stats;
    }
    const first = packet.attachments[start];
    if (first === undefined) throw new Error("Cane batch range starts outside the packet.");
    if (this.#validationMode === "once") {
      for (let index = start; index < end; index += 1) {
        const attachment = packet.attachments[index];
        if (attachment === undefined || this.#validatedAttachmentIds.has(attachment.attachmentId)) continue;
        validateRenderAttachmentForLayaV1(attachment, index);
        this.#validatedAttachmentIds.add(attachment.attachmentId);
      }
    }
    const upload = this.#assembler.applyRange(packet, start, end);
    const currentMesh = this.#mesh;
    const rebuilt = currentMesh === null || upload.grew;
    if (rebuilt) {
      this.#replaceMesh(upload);
    } else {
      uploadCaneLayaMeshV1(currentMesh, upload);
    }
    this.#renderer.texture = this.#textures.texture(first.texture);
    this.#renderer.sharedMaterial = this.#materials.get(first.blendMode);
    this.visible = upload.indexCount > 0;
    this.#stats.attachments = end - start;
    this.#stats.vertices = upload.vertexCount;
    this.#stats.indices = upload.indexCount;
    this.#stats.vertexUploadBytes = upload.vertexUploadBytes;
    this.#stats.indexUploadBytes = upload.indexUploadBytes;
    this.#stats.uploads = upload.indexCount > 0 ? 2 : 0;
    this.#stats.meshRebuilds = rebuilt ? 1 : 0;
    this.#stats.drawCalls = upload.indexCount > 0 ? 1 : 0;
    return this.#stats;
  }

  setBlendMode(blendMode: RuntimeBlendModeV1): void {
    this.#renderer.sharedMaterial = this.#materials.get(blendMode);
  }

  /** Rebuilds buffers after host renderer recreation without re-evaluating Core. */
  invalidateGpuResources(): void {
    if (this.#mesh === null) return;
    // Do not assign Mesh2DRender.sharedMesh = null here. LayaAir 3.4.1 then
    // falls back to its unit quad, whose restored GPU declaration may not yet
    // exist. Keep the old resource referenced until an atomic replacement is
    // installed by the immediately following applyRange call.
    if (this.#staleMesh !== null && this.#staleMesh !== this.#mesh && !this.#staleMesh.destroyed) {
      this.#staleMesh.destroy();
    }
    this.#staleMesh = this.#mesh;
    this.#mesh = null;
  }

  override destroy(destroyChild = true): void {
    if (this.destroyed || this.#destroying) return;
    this.#destroying = true;
    const mesh = this.#mesh;
    const staleMesh = this.#staleMesh;
    this.#mesh = null;
    this.#staleMesh = null;
    super.destroy(destroyChild);
    if (mesh !== null && !mesh.destroyed) mesh.destroy();
    if (staleMesh !== null && staleMesh !== mesh && !staleMesh.destroyed) staleMesh.destroy();
  }

  #replaceMesh(upload: ReturnType<CaneLayaGeometryAssemblerV1["applyRange"]>): void {
    const previous = this.#mesh ?? this.#staleMesh;
    const replacement = createCaneLayaMeshV1(upload);
    this.#mesh = replacement;
    this.#renderer.sharedMesh = replacement;
    this.#staleMesh = null;
    if (previous !== null && !previous.destroyed) previous.destroy();
  }
}

export function emptyBatchStatsV1(): MutableCaneLayaBatchApplyStatsV1 {
  return {
    attachments: 0,
    vertices: 0,
    indices: 0,
    vertexUploadBytes: 0,
    indexUploadBytes: 0,
    uploads: 0,
    meshRebuilds: 0,
    drawCalls: 0,
  };
}

function resetBatchStatsV1(stats: MutableCaneLayaBatchApplyStatsV1): void {
  stats.attachments = 0;
  stats.vertices = 0;
  stats.indices = 0;
  stats.vertexUploadBytes = 0;
  stats.indexUploadBytes = 0;
  stats.uploads = 0;
  stats.meshRebuilds = 0;
  stats.drawCalls = 0;
}
