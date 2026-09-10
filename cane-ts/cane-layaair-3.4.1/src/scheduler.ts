import { RuntimeErrorV1 } from "@cane-runtime/core";
import { CaneLayaFrameTimeWindowV1 } from "./performance.js";
import type { CaneLayaRuntime } from "./runtime.js";

export interface CaneLayaSchedulerOptionsV1 {
  readonly timer?: Laya.Timer;
  readonly autoUpdate?: boolean;
  readonly measureFrameTime?: boolean;
  readonly frameTimeWindowSize?: number;
}

export interface CaneLayaSchedulerStatsV1 {
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

/** One `Laya.Timer.frameLoop` callback for any number of Cane characters. */
export class CaneLayaSchedulerV1 {
  readonly #runtimes: CaneLayaRuntime[] = [];
  readonly #measureFrameTime: boolean;
  readonly frameTimes: CaneLayaFrameTimeWindowV1;
  #timer: Laya.Timer;
  #autoUpdate = false;
  #destroyed = false;
  readonly #tick = (): void => {
    this.update(this.#timer.delta / 1000);
  };

  constructor(options: CaneLayaSchedulerOptionsV1 = {}) {
    this.#timer = options.timer ?? Laya.timer;
    this.#measureFrameTime = options.measureFrameTime ?? false;
    this.frameTimes = new CaneLayaFrameTimeWindowV1(options.frameTimeWindowSize ?? 240);
    this.autoUpdate = options.autoUpdate ?? true;
  }

  get size(): number { return this.#runtimes.length; }
  get destroyed(): boolean { return this.#destroyed; }
  get autoUpdate(): boolean { return this.#autoUpdate; }
  set autoUpdate(value: boolean) {
    if (this.#destroyed && value) {
      throw new RuntimeErrorV1("invalidState", "layaSchedule", "Scheduler is destroyed.");
    }
    if (this.#autoUpdate === value) return;
    this.#autoUpdate = value;
    if (value) this.#timer.frameLoop(1, this, this.#tick);
    else this.#timer.clear(this, this.#tick);
  }

  get timer(): Laya.Timer { return this.#timer; }
  set timer(value: Laya.Timer) {
    if (value === this.#timer) return;
    const reconnect = this.#autoUpdate;
    if (reconnect) this.#timer.clear(this, this.#tick);
    this.#timer = value;
    if (reconnect) this.#timer.frameLoop(1, this, this.#tick);
  }

  add(runtime: CaneLayaRuntime): this {
    this.#assertLive();
    if (runtime.destroyed) {
      throw new RuntimeErrorV1("invalidState", "layaSchedule", "Cannot schedule a destroyed runtime.");
    }
    if (!this.#runtimes.includes(runtime)) {
      runtime.autoUpdate = false;
      this.#runtimes.push(runtime);
    }
    return this;
  }

  remove(runtime: CaneLayaRuntime): boolean {
    const index = this.#runtimes.indexOf(runtime);
    if (index < 0) return false;
    this.#runtimes.splice(index, 1);
    return true;
  }

  update(deltaSeconds: number): void {
    this.#assertLive();
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "layaSchedule",
        "deltaSeconds must be finite and non-negative.",
        { field: "deltaSeconds" },
      );
    }
    const started = this.#measureFrameTime ? nowV1() : 0;
    let write = 0;
    for (let read = 0; read < this.#runtimes.length; read += 1) {
      const runtime = this.#runtimes[read];
      if (runtime === undefined || runtime.destroyed) continue;
      this.#runtimes[write] = runtime;
      write += 1;
      if (runtime.updateWhenInvisible || runtime.visible) runtime.update(deltaSeconds);
    }
    this.#runtimes.length = write;
    if (this.#measureFrameTime) this.frameTimes.record(nowV1() - started);
  }

  /** Cold-path aggregate; this method is intentionally outside the frame loop. */
  stats(): CaneLayaSchedulerStatsV1 {
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
    this.autoUpdate = false;
    this.#runtimes.length = 0;
    this.frameTimes.clear();
    this.#destroyed = true;
  }

  #assertLive(): void {
    if (this.#destroyed) {
      throw new RuntimeErrorV1("invalidState", "layaSchedule", "Scheduler is destroyed.");
    }
  }
}

function nowV1(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
