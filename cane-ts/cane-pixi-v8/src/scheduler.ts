import { RuntimeErrorV1 } from "@cane-runtime/core";
import { Ticker } from "pixi.js";
import { CanePixiFrameTimeWindowV1 } from "./performance.js";
import type { CanePixiRuntime } from "./runtime.js";

export interface CanePixiSchedulerOptionsV1 {
  readonly ticker?: Ticker;
  readonly autoUpdate?: boolean;
  /** Enables one CPU wall-clock measurement around the whole instance loop. */
  readonly measureFrameTime?: boolean;
  readonly frameTimeWindowSize?: number;
}

export interface CanePixiSchedulerStatsV1 {
  readonly instances: number;
  readonly activeAttachments: number;
  readonly activeVertices: number;
  readonly activeIndices: number;
  readonly vertexUploadBytes: number;
  readonly indexRepackBytes: number;
  readonly isolatedDrawCalls: number;
}

/**
 * One Ticker listener for many Cane players. Use runtimes with autoUpdate:false,
 * then add them here to reduce listener dispatch and keep update order stable.
 */
export class CanePixiSchedulerV1 {
  readonly #runtimes: CanePixiRuntime[] = [];
  readonly #measureFrameTime: boolean;
  readonly frameTimes: CanePixiFrameTimeWindowV1;
  #ticker: Ticker;
  #autoUpdate = false;
  readonly #tick = (ticker: Ticker): void => {
    this.update(ticker.deltaMS / 1000);
  };

  constructor(options: CanePixiSchedulerOptionsV1 = {}) {
    this.#ticker = options.ticker ?? Ticker.shared;
    this.#measureFrameTime = options.measureFrameTime ?? false;
    this.frameTimes = new CanePixiFrameTimeWindowV1(options.frameTimeWindowSize ?? 240);
    this.autoUpdate = options.autoUpdate ?? true;
  }

  get size(): number {
    return this.#runtimes.length;
  }

  get autoUpdate(): boolean {
    return this.#autoUpdate;
  }

  set autoUpdate(value: boolean) {
    if (this.#autoUpdate === value) return;
    this.#autoUpdate = value;
    if (value) this.#ticker.add(this.#tick);
    else this.#ticker.remove(this.#tick);
  }

  get ticker(): Ticker {
    return this.#ticker;
  }

  set ticker(value: Ticker) {
    if (this.#ticker === value) return;
    const reconnect = this.#autoUpdate;
    if (reconnect) this.#ticker.remove(this.#tick);
    this.#ticker = value;
    if (reconnect) this.#ticker.add(this.#tick);
  }

  add(runtime: CanePixiRuntime): void {
    if (this.#runtimes.includes(runtime)) return;
    if (runtime.destroyed) {
      throw new RuntimeErrorV1("invalidState", "pixiSchedule", "Cannot schedule a destroyed Cane runtime.");
    }
    runtime.autoUpdate = false;
    this.#runtimes.push(runtime);
  }

  remove(runtime: CanePixiRuntime): boolean {
    const index = this.#runtimes.indexOf(runtime);
    if (index < 0) return false;
    this.#runtimes.splice(index, 1);
    return true;
  }

  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "pixiSchedule",
        "deltaSeconds must be finite and non-negative.",
        { field: "deltaSeconds" },
      );
    }
    const started = this.#measureFrameTime ? performance.now() : 0;
    for (let index = 0; index < this.#runtimes.length; index += 1) {
      const runtime = this.#runtimes[index];
      if (runtime !== undefined && !runtime.destroyed) runtime.update(deltaSeconds);
    }
    if (this.#measureFrameTime) this.frameTimes.record(performance.now() - started);
  }

  /** Cold-path aggregate derived from each view's most recent apply. */
  stats(): CanePixiSchedulerStatsV1 {
    let activeAttachments = 0;
    let activeVertices = 0;
    let activeIndices = 0;
    let vertexUploadBytes = 0;
    let indexRepackBytes = 0;
    let isolatedDrawCalls = 0;
    for (const runtime of this.#runtimes) {
      const stats = runtime.lastApplyStats;
      activeAttachments += stats.activeAttachments;
      activeVertices += stats.activeVertices;
      activeIndices += stats.activeIndices;
      vertexUploadBytes += stats.vertexUploadBytes;
      indexRepackBytes += stats.indexRepackBytes;
      isolatedDrawCalls += stats.isolatedDrawCalls;
    }
    return {
      instances: this.#runtimes.length,
      activeAttachments,
      activeVertices,
      activeIndices,
      vertexUploadBytes,
      indexRepackBytes,
      isolatedDrawCalls,
    };
  }

  destroy(): void {
    this.autoUpdate = false;
    this.#runtimes.length = 0;
    this.frameTimes.clear();
  }
}
