import { VERSION, director, gfx, sys } from "cc";
import {
  CaneCocosDeviceLossMonitorV1,
  type CaneCocosDeviceLossListenerV1,
  type CaneCocosWebGpuDeviceLossSourceV1,
} from "./device-lifecycle.js";
import { CaneCocosErrorV1 } from "./errors.js";

export const CANE_COCOS_CREATOR_VERSION_V1 = "3.8.8" as const;
export const CANE_COCOS_ENGINE_COMMIT_V1 = "411f98df047c25902f93440d4b22925c2fb65461" as const;

export type CaneCocosBackendV1 = "webgl" | "webgpu" | "native" | "unknown";

export interface CaneCocosEngineInfoV1 {
  readonly creatorVersion: string;
  readonly backend: CaneCocosBackendV1;
  readonly gfxApi: gfx.API | null;
  readonly native: boolean;
  readonly browser: boolean;
}

const WEBGPU_DEVICE_LOSS_MONITORS_V1 = new WeakMap<object, CaneCocosDeviceLossMonitorV1>();

export function assertCaneCocosVersionV1(operation = "cocosInitialize"): void {
  if (VERSION !== CANE_COCOS_CREATOR_VERSION_V1) {
    throw new CaneCocosErrorV1(
      "engineVersionMismatch",
      `@cane-runtime/cocos-3.8.8 requires Cocos Creator ${CANE_COCOS_CREATOR_VERSION_V1}; received ${VERSION}.`,
      {
        operation,
        field: "cc.VERSION",
        expected: CANE_COCOS_CREATOR_VERSION_V1,
        actual: VERSION,
      },
    );
  }
}

export function detectCaneCocosBackendV1(): CaneCocosBackendV1 {
  const api = director.root?.device.gfxAPI;
  if (api === gfx.API.WEBGPU) return "webgpu";
  if (api === gfx.API.WEBGL || api === gfx.API.WEBGL2 || api === gfx.API.GLES2 || api === gfx.API.GLES3) {
    return sys.isNative ? "native" : "webgl";
  }
  if (sys.isNative && api !== undefined) return "native";
  return "unknown";
}

export function queryCaneCocosEngineV1(): CaneCocosEngineInfoV1 {
  const api = director.root?.device.gfxAPI ?? null;
  return Object.freeze({
    creatorVersion: VERSION,
    backend: detectCaneCocosBackendV1(),
    gfxApi: api,
    native: sys.isNative,
    browser: sys.isBrowser,
  });
}

export function assertCaneCocosRendererReadyV1(operation = "cocosInitialize"): CaneCocosEngineInfoV1 {
  assertCaneCocosVersionV1(operation);
  if (director.root?.device === undefined) {
    throw new CaneCocosErrorV1("engineNotInitialized", "Cocos renderer is not initialized.", {
      operation,
      field: "director.root.device",
    });
  }
  const info = queryCaneCocosEngineV1();
  if (info.backend === "unknown") {
    throw new CaneCocosErrorV1("unsupportedBackend", "The active Cocos graphics backend is unsupported.", {
      operation,
      field: "gfx.Device.gfxAPI",
      actual: info.gfxApi,
    });
  }
  return info;
}

/**
 * Observes the exact Creator 3.8.8 WebGPU device-loss surface. Other backends
 * return a no-op unsubscribe because WebGL restoration is handled by the
 * texture store's canvas lifecycle and Native owns its GFX device lifecycle.
 */
export function observeCaneCocosDeviceLossV1(
  listener: CaneCocosDeviceLossListenerV1,
): () => void {
  const device = director.root?.device;
  if (device === undefined || device.gfxAPI !== gfx.API.WEBGPU) return () => undefined;
  const nativeDevice = (device as unknown as { readonly nativeDevice?: unknown }).nativeDevice;
  if (nativeDevice === null || typeof nativeDevice !== "object"
    || !("lost" in nativeDevice)
    || typeof (nativeDevice as { readonly lost?: { readonly then?: unknown } }).lost?.then !== "function") {
    throw new CaneCocosErrorV1(
      "unsupportedInternalApi",
      "Creator 3.8.8 WebGPUDevice.nativeDevice.lost is unavailable.",
      {
        operation: "cocosObserveWebGpuDeviceLoss",
        field: "gfx.WebGPUDevice.nativeDevice.lost",
        expected: "PromiseLike<GPUDeviceLostInfo>",
        backend: "webgpu",
      },
    );
  }
  let monitor = WEBGPU_DEVICE_LOSS_MONITORS_V1.get(nativeDevice);
  if (monitor === undefined) {
    monitor = new CaneCocosDeviceLossMonitorV1(nativeDevice as CaneCocosWebGpuDeviceLossSourceV1);
    WEBGPU_DEVICE_LOSS_MONITORS_V1.set(nativeDevice, monitor);
  }
  return monitor.subscribe(listener);
}
