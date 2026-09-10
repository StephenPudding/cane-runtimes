import { CaneCocosErrorV1 } from "./errors.js";

export interface CaneCocosWebGpuDeviceLostInfoV1 {
  readonly reason?: unknown;
  readonly message?: unknown;
}

export interface CaneCocosWebGpuDeviceLossSourceV1 {
  readonly lost: PromiseLike<CaneCocosWebGpuDeviceLostInfoV1>;
}

export type CaneCocosDeviceLossListenerV1 = (error: CaneCocosErrorV1) => void;

/**
 * Fans one WebGPU `GPUDevice.lost` promise out to any number of Cane hosts.
 * Creator 3.8.8 does not recreate a lost WebGPU device, so this monitor
 * reports a terminal structured error rather than pretending resources were
 * restored on the invalid device.
 */
export class CaneCocosDeviceLossMonitorV1 {
  readonly #listeners = new Set<CaneCocosDeviceLossListenerV1>();
  #error: CaneCocosErrorV1 | null = null;
  #destroyed = false;

  constructor(source: CaneCocosWebGpuDeviceLossSourceV1) {
    void Promise.resolve(source.lost).then(
      (info) => this.#publish(createDeviceLostErrorV1(info)),
      (cause: unknown) => this.#publish(createDeviceLostErrorV1(undefined, cause)),
    );
  }

  get lostError(): CaneCocosErrorV1 | null { return this.#error; }
  get destroyed(): boolean { return this.#destroyed; }

  subscribe(listener: CaneCocosDeviceLossListenerV1): () => void {
    if (this.#destroyed) {
      throw new CaneCocosErrorV1("invalidState", "The WebGPU device-loss monitor is destroyed.", {
        operation: "cocosObserveWebGpuDeviceLoss",
        field: "monitor",
        backend: "webgpu",
      });
    }
    let active = true;
    this.#listeners.add(listener);
    const error = this.#error;
    if (error !== null) {
      queueMicrotask(() => {
        if (active && !this.#destroyed) listener(error);
      });
    }
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listener);
    };
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#listeners.clear();
  }

  #publish(error: CaneCocosErrorV1): void {
    if (this.#destroyed || this.#error !== null) return;
    this.#error = error;
    for (const listener of this.#listeners) listener(error);
  }
}

function createDeviceLostErrorV1(
  info?: CaneCocosWebGpuDeviceLostInfoV1,
  cause?: unknown,
): CaneCocosErrorV1 {
  return new CaneCocosErrorV1(
    "contextLost",
    "The Cocos WebGPU device was lost. Creator 3.8.8 cannot restore it in place; recreate the Cocos application/device and reload Cane assets.",
    {
      operation: "cocosObserveWebGpuDeviceLoss",
      field: "gfx.WebGPUDevice.nativeDevice.lost",
      backend: "webgpu",
      actual: info === undefined ? undefined : {
        reason: info.reason === undefined ? "unknown" : String(info.reason),
        message: info.message === undefined ? "" : String(info.message),
      },
      ...(cause === undefined ? {} : { cause }),
    },
  );
}
