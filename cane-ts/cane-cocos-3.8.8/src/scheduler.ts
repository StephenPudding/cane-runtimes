import { RuntimeErrorV1 } from "@cane-runtime/core";
import { CaneCocosFrameTimeWindowV1 } from "./performance.js";

export interface CaneCocosScheduledRuntimeV1 {
  readonly destroyed: boolean;
  paused: boolean;
  timeScale: number;
  updateWhenInvisible: boolean;
  readonly visibleInHierarchy: boolean;
  readonly lastApplyStats: {
    readonly activeAttachments: number;
    readonly activeVertices: number;
    readonly activeIndices: number;
    readonly vertexUploadBytes: number;
    readonly indexUploadBytes: number;
    readonly drawCalls: number;
    readonly isolatedDrawCalls: number;
    readonly naturalBatchSplits: number;
    readonly slotObjectBatchSplits: number;
    readonly clippingBatchSplits: number;
  };
  update(deltaSeconds: number): unknown;
  prepareRenderData(): void;
}

export interface CaneCocosSchedulerOptionsV1 {
  readonly measureFrameTime?: boolean;
  readonly frameTimeWindowSize?: number;
}

export interface CaneCocosSchedulerStatsV1 {
  readonly instances: number;
  readonly activeAttachments: number;
  readonly activeVertices: number;
  readonly activeIndices: number;
  readonly vertexUploadBytes: number;
  readonly indexUploadBytes: number;
  readonly drawCalls: number;
  readonly isolatedDrawCalls: number;
  readonly batchSplits: number;
  readonly clippingBatchSplits: number;
}

/** Shared manual scheduler; Cocos' engine-facing singleton system delegates to the same semantics. */
export class CaneCocosSchedulerV1 {
  readonly #runtimes: CaneCocosScheduledRuntimeV1[] = [];
  readonly #measureFrameTime: boolean;
  readonly frameTimes: CaneCocosFrameTimeWindowV1;
  #destroyed = false;

  constructor(options: CaneCocosSchedulerOptionsV1 = {}) {
    this.#measureFrameTime = options.measureFrameTime ?? false;
    this.frameTimes = new CaneCocosFrameTimeWindowV1(options.frameTimeWindowSize ?? 240);
  }

  get size(): number { return this.#runtimes.length; }
  get destroyed(): boolean { return this.#destroyed; }

  add(runtime: CaneCocosScheduledRuntimeV1): this {
    this.#assertLive();
    if (runtime.destroyed) {
      throw new RuntimeErrorV1("invalidState", "cocosSchedule", "Cannot schedule a destroyed runtime.");
    }
    if (!this.#runtimes.includes(runtime)) this.#runtimes.push(runtime);
    return this;
  }

  remove(runtime: CaneCocosScheduledRuntimeV1): boolean {
    const index = this.#runtimes.indexOf(runtime);
    if (index < 0) return false;
    this.#runtimes.splice(index, 1);
    return true;
  }

  update(deltaSeconds: number): void {
    this.#assertDelta(deltaSeconds);
    const started = this.#measureFrameTime ? nowV1() : 0;
    let write = 0;
    for (let read = 0; read < this.#runtimes.length; read += 1) {
      const runtime = this.#runtimes[read];
      if (runtime === undefined || runtime.destroyed) continue;
      this.#runtimes[write] = runtime;
      write += 1;
      if (!runtime.paused && (runtime.updateWhenInvisible || runtime.visibleInHierarchy)) {
        // The runtime is the single owner of time-scale application. Keeping the
        // scheduler in engine-time also makes manual and automatic updates match.
        runtime.update(deltaSeconds);
      }
    }
    this.#runtimes.length = write;
    if (this.#measureFrameTime) this.frameTimes.record(nowV1() - started);
  }

  prepareRenderData(): void {
    this.#assertLive();
    let write = 0;
    for (let read = 0; read < this.#runtimes.length; read += 1) {
      const runtime = this.#runtimes[read];
      if (runtime === undefined || runtime.destroyed) continue;
      this.#runtimes[write] = runtime;
      write += 1;
      if (runtime.updateWhenInvisible || runtime.visibleInHierarchy) runtime.prepareRenderData();
    }
    this.#runtimes.length = write;
  }

  stats(): CaneCocosSchedulerStatsV1 {
    let activeAttachments = 0;
    let activeVertices = 0;
    let activeIndices = 0;
    let vertexUploadBytes = 0;
    let indexUploadBytes = 0;
    let drawCalls = 0;
    let isolatedDrawCalls = 0;
    let batchSplits = 0;
    let clippingBatchSplits = 0;
    let instances = 0;
    for (let index = 0; index < this.#runtimes.length; index += 1) {
      const runtime = this.#runtimes[index];
      if (runtime === undefined || runtime.destroyed) continue;
      const stats = runtime.lastApplyStats;
      instances += 1;
      activeAttachments += stats.activeAttachments;
      activeVertices += stats.activeVertices;
      activeIndices += stats.activeIndices;
      vertexUploadBytes += stats.vertexUploadBytes;
      indexUploadBytes += stats.indexUploadBytes;
      drawCalls += stats.drawCalls;
      isolatedDrawCalls += stats.isolatedDrawCalls;
      batchSplits += stats.naturalBatchSplits + stats.slotObjectBatchSplits;
      clippingBatchSplits += stats.clippingBatchSplits;
    }
    return {
      instances,
      activeAttachments,
      activeVertices,
      activeIndices,
      vertexUploadBytes,
      indexUploadBytes,
      drawCalls,
      isolatedDrawCalls,
      batchSplits,
      clippingBatchSplits,
    };
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#runtimes.length = 0;
    this.frameTimes.clear();
    this.#destroyed = true;
  }

  #assertDelta(deltaSeconds: number): void {
    this.#assertLive();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "cocosSchedule",
        "deltaSeconds must be finite and non-negative.",
        { field: "deltaSeconds" },
      );
    }
  }

  #assertLive(): void {
    if (this.#destroyed) {
      throw new RuntimeErrorV1("invalidState", "cocosSchedule", "Scheduler is destroyed.");
    }
  }
}

function nowV1(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
