import { RuntimeErrorV1 } from "@cane-runtime/core";
import { Container, Graphics, Text } from "pixi.js";
import { CanePixiBoundsProviderV1 } from "./bounds.js";
import type { CanePixiRuntime } from "./runtime.js";

export interface CanePixiDebugViewOptionsV1 {
  readonly autoAttach?: boolean;
  readonly autoRefresh?: boolean;
  readonly bones?: boolean;
  readonly attachmentBounds?: boolean;
  readonly boundingBoxes?: boolean;
  readonly clipping?: boolean;
  readonly drawOrder?: boolean;
  readonly metrics?: boolean;
  /** Optional profiler-owned exact measurement; ordinary JS cannot observe this portably. */
  readonly temporaryAllocationBytes?: () => number | null;
}

export interface CanePixiDebugSnapshotV1 {
  readonly frameSequence: number;
  readonly animationSamples: number;
  readonly constraintGeometrySolves: number;
  readonly framesPublished: number;
  readonly coreCpuMilliseconds: number | null;
  readonly projectionCpuMilliseconds: number | null;
  readonly activeAttachments: number;
  readonly activeVertices: number;
  readonly vertexUploadBytes: number;
  readonly isolatedDrawCalls: number;
  readonly slotObjectBatchSplits: number;
  readonly temporaryAllocationBytes: number | null;
  readonly jsHeapUsedBytes: number | null;
  readonly jsHeapDeltaBytes: number | null;
}

type MutableDebugSnapshotV1 = {
  -readonly [Field in keyof CanePixiDebugSnapshotV1]: CanePixiDebugSnapshotV1[Field]
};

/** Optional renderer-only diagnostic overlay; it never changes Core state. */
export class CanePixiDebugViewV1 extends Container {
  readonly runtime: CanePixiRuntime;
  readonly graphics = new Graphics({ label: "CaneRuntimeDebugGeometry" });
  readonly labels = new Text({
    text: "",
    style: {
      fontFamily: "monospace",
      fontSize: 11,
      fill: 0xe6fff8,
      stroke: { color: 0x001a17, width: 3 },
      lineHeight: 14,
    },
  });
  readonly #bounds: CanePixiBoundsProviderV1;
  readonly #options: Required<Omit<CanePixiDebugViewOptionsV1, "temporaryAllocationBytes">>;
  readonly #allocationProbe: (() => number | null) | null;
  readonly #boneLengthById = new Map<string, number>();
  readonly #drawOrderScratch: string[] = [];
  readonly #snapshot: MutableDebugSnapshotV1 = emptyDebugSnapshotV1();
  #catalogIdentity: object | null = null;
  #lastFrameSequence = -1;
  #lastApplySequence = -1;
  #lastHeapUsedBytes: number | null = null;

  constructor(runtime: CanePixiRuntime, options: CanePixiDebugViewOptionsV1 = {}) {
    super({ label: "CanePixiDebugView" });
    if (runtime === null || typeof runtime !== "object" || runtime.destroyed) {
      throw new RuntimeErrorV1("invalidArgument", "pixiCreateDebugView", "runtime must be a live CanePixiRuntime.", {
        field: "runtime",
      });
    }
    this.runtime = runtime;
    this.#options = normalizeDebugOptionsV1(options);
    this.#allocationProbe = options.temporaryAllocationBytes ?? null;
    this.#bounds = new CanePixiBoundsProviderV1(runtime, {
      includeRenderGeometry: false,
      includeBoundingBoxes: true,
      includeTransparent: true,
    });
    this.eventMode = "none";
    this.graphics.eventMode = "none";
    this.labels.eventMode = "none";
    this.addChild(this.graphics, this.labels);
    if (this.#options.autoRefresh) this.onRender = () => this.refresh();
    if (this.#options.autoAttach) runtime.addChild(this);
    this.refresh(true);
  }

  get lastSnapshot(): CanePixiDebugSnapshotV1 {
    return { ...this.#snapshot };
  }

  attach(): this {
    if (this.parent !== this.runtime) this.runtime.addChild(this);
    return this;
  }

  detach(): this {
    if (this.parent === this.runtime) this.runtime.removeChild(this);
    return this;
  }

  /** Redraws only after Core or the adapter publishes/applies a new frame. */
  refresh(force = false): void {
    if (this.destroyed || this.runtime.destroyed) return;
    const frame = this.runtime.player.currentFrame;
    const apply = this.runtime.lastApplyStats;
    if (!force && frame.sequence === this.#lastFrameSequence && apply.applySequence === this.#lastApplySequence) return;
    this.#lastFrameSequence = frame.sequence;
    this.#lastApplySequence = apply.applySequence;
    this.#ensureCatalog();
    this.graphics.clear();

    if (this.#options.attachmentBounds) this.#drawAttachmentBounds();
    if (this.#options.boundingBoxes) this.#drawBoundingBoxes();
    if (this.#options.clipping) this.#drawClipping();
    if (this.#options.bones) this.#drawBones();
    this.#updateSnapshot();
    this.#updateLabels();
  }

  override destroy(...args: Parameters<Container["destroy"]>): void {
    if (this.destroyed) return;
    this.onRender = null;
    if (args.length === 0) super.destroy({ children: true });
    else super.destroy(...args);
  }

  #drawBones(): void {
    const bones = this.runtime.player.currentFrame.bones;
    for (let index = 0; index < bones.length; index += 1) {
      const bone = bones[index];
      if (bone === undefined) continue;
      const length = this.#boneLengthById.get(bone.id) ?? 0;
      const startX = bone.matrix.tx;
      const startY = -bone.matrix.ty;
      const endX = bone.matrix.tx + bone.matrix.a * length;
      const endY = -(bone.matrix.ty + bone.matrix.b * length);
      this.graphics.moveTo(startX, startY).lineTo(endX, endY).stroke({
        width: 1.5,
        color: 0x43f5c5,
        alpha: 0.9,
      });
      this.graphics.circle(startX, startY, 2.5).fill({ color: 0x70ffe0, alpha: 0.95 });
    }
  }

  #drawAttachmentBounds(): void {
    const attachments = this.runtime.player.currentFrame.renderPacket.attachments;
    for (let index = 0; index < attachments.length; index += 1) {
      const vertices = attachments[index]?.worldVerticesXy;
      if (vertices === undefined || vertices.length < 2) continue;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let offset = 0; offset < vertices.length; offset += 2) {
        const x = vertices[offset] ?? 0;
        const y = -(vertices[offset + 1] ?? 0);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      this.graphics.rect(minX, minY, maxX - minX, maxY - minY).stroke({
        width: 1,
        color: 0x46a6ff,
        alpha: 0.55,
      });
    }
  }

  #drawBoundingBoxes(): void {
    const polygons = this.#bounds.sync().polygons;
    for (let index = 0; index < polygons.length; index += 1) {
      const vertices = polygons[index]?.worldVerticesXy;
      if (vertices === undefined || vertices.length < 6) continue;
      this.graphics.moveTo(vertices[0] ?? 0, -(vertices[1] ?? 0));
      for (let offset = 2; offset < vertices.length; offset += 2) {
        this.graphics.lineTo(vertices[offset] ?? 0, -(vertices[offset + 1] ?? 0));
      }
      this.graphics.closePath().stroke({ width: 2, color: 0xffc857, alpha: 0.9 });
    }
  }

  #drawClipping(): void {
    this.runtime.player.writeDrawOrderSlotIds(this.#drawOrderScratch);
    for (let index = 0; index < this.#drawOrderScratch.length; index += 1) {
      const slotId = this.#drawOrderScratch[index];
      if (slotId === undefined) continue;
      const attachmentId = this.runtime.player.querySlotAttachmentId(slotId);
      if (attachmentId === null) continue;
      const attachment = this.runtime.player.data.document.attachments.find(
        (candidate) => candidate.id === attachmentId,
      );
      if (attachment?.type !== "clipping") continue;
      const geometry = this.runtime.player.queryClippingGeometry(attachmentId);
      if (geometry === null) continue;
      for (let polygonIndex = 0; polygonIndex < geometry.convexPolygonsXy.length; polygonIndex += 1) {
        const vertices = geometry.convexPolygonsXy[polygonIndex];
        if (vertices === undefined || vertices.length < 6) continue;
        this.graphics.moveTo(vertices[0] ?? 0, -(vertices[1] ?? 0));
        for (let offset = 2; offset < vertices.length; offset += 2) {
          this.graphics.lineTo(vertices[offset] ?? 0, -(vertices[offset + 1] ?? 0));
        }
        this.graphics.closePath()
          .fill({ color: 0xd45cff, alpha: 0.08 })
          .stroke({ width: 1.5, color: 0xd45cff, alpha: 0.9 });
      }
    }
  }

  #updateSnapshot(): void {
    const frame = this.runtime.player.currentFrame;
    const evaluation = this.runtime.player.lastEvaluationStats;
    const apply = this.runtime.lastApplyStats;
    const heap = queryHeapUsedBytesV1();
    this.#snapshot.frameSequence = frame.sequence;
    this.#snapshot.animationSamples = evaluation.animationSamples;
    this.#snapshot.constraintGeometrySolves = evaluation.constraintGeometrySolves;
    this.#snapshot.framesPublished = evaluation.framesPublished;
    this.#snapshot.coreCpuMilliseconds = apply.coreCpuMilliseconds;
    this.#snapshot.projectionCpuMilliseconds = apply.projectionCpuMilliseconds;
    this.#snapshot.activeAttachments = apply.activeAttachments;
    this.#snapshot.activeVertices = apply.activeVertices;
    this.#snapshot.vertexUploadBytes = apply.vertexUploadBytes;
    this.#snapshot.isolatedDrawCalls = apply.isolatedDrawCalls;
    this.#snapshot.slotObjectBatchSplits = apply.slotObjectBatchSplits;
    this.#snapshot.temporaryAllocationBytes = this.#allocationProbe?.() ?? null;
    this.#snapshot.jsHeapUsedBytes = heap;
    this.#snapshot.jsHeapDeltaBytes = heap === null || this.#lastHeapUsedBytes === null
      ? null
      : heap - this.#lastHeapUsedBytes;
    this.#lastHeapUsedBytes = heap;
  }

  #updateLabels(): void {
    if (!this.#options.drawOrder && !this.#options.metrics) {
      this.labels.visible = false;
      return;
    }
    this.labels.visible = true;
    const lines: string[] = [];
    const snapshot = this.#snapshot;
    if (this.#options.metrics) {
      lines.push(
        `sample / solve / publish  ${snapshot.animationSamples} / ${snapshot.constraintGeometrySolves} / ${snapshot.framesPublished}`,
        `Core / Pixi CPU           ${formatMsV1(snapshot.coreCpuMilliseconds)} / ${formatMsV1(snapshot.projectionCpuMilliseconds)}`,
        `vertices / upload         ${snapshot.activeVertices} / ${formatBytesV1(snapshot.vertexUploadBytes)}`,
        `draws / Slot splits       ${snapshot.isolatedDrawCalls} / ${snapshot.slotObjectBatchSplits}`,
        `temp allocation           ${snapshot.temporaryAllocationBytes === null ? "profiler unavailable" : formatBytesV1(snapshot.temporaryAllocationBytes)}`,
        `JS heap delta             ${snapshot.jsHeapDeltaBytes === null ? "unavailable" : formatSignedBytesV1(snapshot.jsHeapDeltaBytes)}`,
      );
    }
    if (this.#options.drawOrder) {
      const attachments = this.runtime.player.currentFrame.renderPacket.attachments;
      lines.push("draw order");
      for (let index = 0; index < attachments.length; index += 1) {
        const attachment = attachments[index];
        if (attachment !== undefined) lines.push(`  ${attachment.drawIndex}: ${attachment.slotId} / ${attachment.attachmentId}`);
      }
    }
    this.labels.text = lines.join("\n");
    const aabb = this.runtime.bounds.writeLocalAabb();
    this.labels.position.set(aabb.x + aabb.width + 12, aabb.y);
  }

  #ensureCatalog(): void {
    if (this.#catalogIdentity === this.runtime.player.data) return;
    this.#catalogIdentity = this.runtime.player.data;
    this.#boneLengthById.clear();
    for (const bone of this.runtime.player.data.document.bones) this.#boneLengthById.set(bone.id, bone.length);
  }
}

function normalizeDebugOptionsV1(
  options: CanePixiDebugViewOptionsV1,
): Required<Omit<CanePixiDebugViewOptionsV1, "temporaryAllocationBytes">> {
  if (options === null || typeof options !== "object") {
    throw new RuntimeErrorV1("invalidArgument", "pixiCreateDebugView", "options must be an object.", {
      field: "options",
    });
  }
  const result = {
    autoAttach: options.autoAttach ?? true,
    autoRefresh: options.autoRefresh ?? true,
    bones: options.bones ?? true,
    attachmentBounds: options.attachmentBounds ?? false,
    boundingBoxes: options.boundingBoxes ?? true,
    clipping: options.clipping ?? true,
    drawOrder: options.drawOrder ?? true,
    metrics: options.metrics ?? true,
  };
  for (const [field, value] of Object.entries(result)) {
    if (typeof value !== "boolean") {
      throw new RuntimeErrorV1("invalidArgument", "pixiCreateDebugView", `${field} must be boolean.`, {
        field,
      });
    }
  }
  if (options.temporaryAllocationBytes !== undefined
    && typeof options.temporaryAllocationBytes !== "function") {
    throw new RuntimeErrorV1(
      "invalidArgument",
      "pixiCreateDebugView",
      "temporaryAllocationBytes must be a function.",
      { field: "temporaryAllocationBytes" },
    );
  }
  return result;
}

function emptyDebugSnapshotV1(): MutableDebugSnapshotV1 {
  return {
    frameSequence: 0,
    animationSamples: 0,
    constraintGeometrySolves: 0,
    framesPublished: 0,
    coreCpuMilliseconds: null,
    projectionCpuMilliseconds: null,
    activeAttachments: 0,
    activeVertices: 0,
    vertexUploadBytes: 0,
    isolatedDrawCalls: 0,
    slotObjectBatchSplits: 0,
    temporaryAllocationBytes: null,
    jsHeapUsedBytes: null,
    jsHeapDeltaBytes: null,
  };
}

function queryHeapUsedBytesV1(): number | null {
  const memory = (performance as unknown as {
    readonly memory?: { readonly usedJSHeapSize?: unknown };
  }).memory;
  const value = memory?.usedJSHeapSize;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatMsV1(value: number | null): string {
  return value === null ? "off" : `${value.toFixed(3)} ms`;
}

function formatBytesV1(value: number): string {
  if (Math.abs(value) < 1024) return `${Math.round(value)} B`;
  return `${(value / 1024).toFixed(1)} KiB`;
}

function formatSignedBytesV1(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatBytesV1(value)}`;
}
