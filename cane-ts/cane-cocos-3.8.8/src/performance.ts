import { RuntimeErrorV1 } from "@cane-runtime/core";

export interface CaneCocosFrameTimeSnapshotV1 {
  readonly sampleCount: number;
  readonly meanMilliseconds: number;
  readonly minimumMilliseconds: number;
  readonly maximumMilliseconds: number;
  readonly p50Milliseconds: number;
  readonly p95Milliseconds: number;
  readonly p99Milliseconds: number;
}

/** Fixed-capacity ring buffer; stable-frame recording allocates nothing. */
export class CaneCocosFrameTimeWindowV1 {
  readonly #samples: Float64Array;
  #writeIndex = 0;
  #sampleCount = 0;

  constructor(capacity = 240) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "cocosCreateFrameTimeWindow",
        "Frame-time window capacity must be a positive safe integer.",
        { field: "capacity" },
      );
    }
    this.#samples = new Float64Array(capacity);
  }

  get capacity(): number { return this.#samples.length; }
  get sampleCount(): number { return this.#sampleCount; }

  record(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.#samples[this.#writeIndex] = milliseconds;
    this.#writeIndex = (this.#writeIndex + 1) % this.#samples.length;
    if (this.#sampleCount < this.#samples.length) this.#sampleCount += 1;
  }

  clear(): void {
    this.#writeIndex = 0;
    this.#sampleCount = 0;
  }

  snapshot(): CaneCocosFrameTimeSnapshotV1 {
    if (this.#sampleCount === 0) {
      return {
        sampleCount: 0,
        meanMilliseconds: 0,
        minimumMilliseconds: 0,
        maximumMilliseconds: 0,
        p50Milliseconds: 0,
        p95Milliseconds: 0,
        p99Milliseconds: 0,
      };
    }
    const sorted = new Float64Array(this.#sampleCount);
    let sum = 0;
    for (let index = 0; index < this.#sampleCount; index += 1) {
      const value = this.#samples[index] ?? 0;
      sorted[index] = value;
      sum += value;
    }
    sorted.sort();
    return {
      sampleCount: this.#sampleCount,
      meanMilliseconds: sum / this.#sampleCount,
      minimumMilliseconds: sorted[0] ?? 0,
      maximumMilliseconds: sorted[this.#sampleCount - 1] ?? 0,
      p50Milliseconds: percentileV1(sorted, 0.5),
      p95Milliseconds: percentileV1(sorted, 0.95),
      p99Milliseconds: percentileV1(sorted, 0.99),
    };
  }
}

function percentileV1(sorted: Float64Array, percentile: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1);
  return sorted[index] ?? 0;
}
