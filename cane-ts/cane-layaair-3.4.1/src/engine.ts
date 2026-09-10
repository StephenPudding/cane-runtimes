import { CaneLayaErrorV1 } from "./errors.js";

export const CANE_LAYAAIR_VERSION_V1 = "3.4.1" as const;
export const CANE_LAYAAIR_GIT_COMMIT_V1 = "f368b43098fe6bde7b961546114e71907c5f8a98" as const;

export type CaneLayaBackendV1 = "webgl" | "webgpu" | "native" | "no-render" | "unknown";
export type CaneLayaWebBackendV1 = Extract<CaneLayaBackendV1, "webgl" | "webgpu">;

export interface CaneLayaBackendCapabilitiesV1 {
  readonly backend: CaneLayaWebBackendV1 | "unsupported";
  readonly region: boolean;
  readonly mesh: boolean;
  readonly weightedMesh: boolean;
  readonly deform: boolean;
  readonly linkedMesh: boolean;
  readonly sequence: boolean;
  readonly coreClipping: boolean;
  readonly foreignObjectClipping: boolean;
  readonly lightTint: boolean;
  readonly darkTint: boolean;
  readonly blendModes: boolean;
  readonly fullAffine: boolean;
}

export const CANE_LAYA_WEBGL_CAPABILITIES_V1 = Object.freeze({
  backend: "webgl",
  region: true,
  mesh: true,
  weightedMesh: true,
  deform: true,
  linkedMesh: true,
  sequence: true,
  coreClipping: true,
  foreignObjectClipping: true,
  lightTint: true,
  darkTint: true,
  blendModes: true,
  fullAffine: true,
} as const);

/**
 * LayaAir's official Spine web renderer uses the same renderer-neutral 2D
 * device/pass factories for WebGL and WebGPU. Cane follows that contract:
 * Core geometry and material semantics are identical; only Laya's selected
 * driver owns the actual GPU resources and shader translation.
 */
export const CANE_LAYA_WEBGPU_CAPABILITIES_V1 = Object.freeze({
  ...CANE_LAYA_WEBGL_CAPABILITIES_V1,
  backend: "webgpu",
} as const);

export const CANE_LAYA_UNSUPPORTED_BACKEND_CAPABILITIES_V1 = Object.freeze({
  backend: "unsupported",
  region: false,
  mesh: false,
  weightedMesh: false,
  deform: false,
  linkedMesh: false,
  sequence: false,
  coreClipping: false,
  foreignObjectClipping: false,
  lightTint: false,
  darkTint: false,
  blendModes: false,
  fullAffine: false,
} as const);

/**
 * LayaAir 3.4.1 has no engine-wide in-place replacement for every lost WebGL
 * resource or for a lost WebGPU device. Cane can rebuild its own resources
 * only after the host has initialized a fresh Laya engine.
 */
export const CANE_LAYA_CONTEXT_RECOVERY_V1 = Object.freeze({
  inPlace: false,
  requiresEngineReinitialization: true,
  reason: "LayaAir 3.4.1 does not recreate every lost WebGL resource or WebGPU device in place.",
} as const);

export interface CaneLayaWebGpuDeviceLossV1 {
  readonly backend: "webgpu";
  readonly engine: object;
  readonly device: object;
  readonly info: unknown;
}

interface LayaGlobalProbeV1 {
  readonly LayaEnv?: { readonly version?: unknown; readonly isModernAPIs?: unknown };
  readonly stage?: unknown;
  readonly Mesh2D?: unknown;
  readonly Mesh2DRender?: unknown;
  readonly Shader3D?: unknown;
  readonly LayaGL?: {
    readonly renderEngine?: {
      readonly constructor?: { readonly name?: string };
      readonly lost?: unknown;
      readonly _lost?: unknown;
      readonly getDevice?: () => {
        readonly lost?: PromiseLike<unknown>;
      };
    };
  };
}

/** Checks the host before any GPU resource is created. */
export function assertLayaAir341V1(operation = "layaCreateRuntime"): typeof Laya {
  const host = (globalThis as unknown as { readonly Laya?: LayaGlobalProbeV1 }).Laya;
  if (host === undefined || host === null) {
    throw new CaneLayaErrorV1(
      "engineUnavailable",
      "LayaAir must be loaded as globalThis.Laya before the Cane adapter.",
      { operation, field: "globalThis.Laya" },
    );
  }
  const version = host.LayaEnv?.version;
  if (version !== CANE_LAYAAIR_VERSION_V1) {
    throw new CaneLayaErrorV1(
      "engineVersionMismatch",
      `Cane LayaAir adapter requires exactly ${CANE_LAYAAIR_VERSION_V1}.`,
      {
        operation,
        field: "Laya.LayaEnv.version",
        expected: CANE_LAYAAIR_VERSION_V1,
        actual: version,
      },
    );
  }
  if (typeof host.Mesh2D !== "function"
    || typeof host.Mesh2DRender !== "function"
    || typeof host.Shader3D !== "function") {
    throw new CaneLayaErrorV1(
      "engineUnavailable",
      "LayaAir 3.4.1 core and 2D render modules must be loaded before the Cane adapter.",
      { operation, field: "Laya.Mesh2D" },
    );
  }
  return host as unknown as typeof Laya;
}

/**
 * Centralized version-locked backend probe. `LayaGL.renderEngine` is used only
 * here because LayaAir 3.4.1 has no equivalent public backend-kind accessor.
 */
export function detectCaneLayaBackendV1(): CaneLayaBackendV1 {
  const host = assertLayaAir341V1("layaDetectBackend") as unknown as LayaGlobalProbeV1;
  if (host.LayaEnv?.isModernAPIs === true) return "native";
  const constructorName = host.LayaGL?.renderEngine?.constructor?.name ?? "";
  if (/WebGPU|LayaX/i.test(constructorName)) return "webgpu";
  if (/WebGL/i.test(constructorName)) return "webgl";
  if (/NoRender/i.test(constructorName)) return "no-render";
  return "unknown";
}

export function caneLayaBackendCapabilitiesV1(
  backend: CaneLayaBackendV1 = detectCaneLayaBackendV1(),
): CaneLayaBackendCapabilitiesV1 {
  if (backend === "webgl") return CANE_LAYA_WEBGL_CAPABILITIES_V1;
  if (backend === "webgpu") return CANE_LAYA_WEBGPU_CAPABILITIES_V1;
  return CANE_LAYA_UNSUPPORTED_BACKEND_CAPABILITIES_V1;
}

/** Accepts either official LayaAir 3.4.1 web renderer after `Laya.init`. */
export function assertCaneLayaWebRendererV1(
  operation = "layaCreateRuntime",
): CaneLayaWebBackendV1 {
  const host = assertLayaAir341V1(operation);
  if (host.stage === null || host.stage === undefined) {
    throw new CaneLayaErrorV1(
      "engineNotInitialized",
      "Call and await Laya.init(...) before creating Cane GPU resources.",
      { operation, field: "Laya.stage" },
    );
  }
  const backend = detectCaneLayaBackendV1();
  if (backend !== "webgl" && backend !== "webgpu") {
    throw new CaneLayaErrorV1(
      "unsupportedBackend",
      `LayaAir backend '${backend}' is not a fully equivalent Cane renderer.`,
      { operation, field: "backend", expected: ["webgl", "webgpu"], actual: backend },
    );
  }
  return backend;
}

/** @deprecated Prefer `assertCaneLayaWebRendererV1` unless WebGL is specifically required. */
export function assertCaneLayaWebGlV1(operation = "layaCreateRuntime"): void {
  const backend = assertCaneLayaWebRendererV1(operation);
  if (backend !== "webgl") {
    throw new CaneLayaErrorV1(
      "unsupportedBackend",
      `LayaAir backend '${backend}' is not a fully equivalent Cane renderer.`,
      { operation, field: "backend", expected: "webgl", actual: backend },
    );
  }
}

/**
 * Observes the selected WebGPU device without importing WebGPU declarations
 * into the public Core surface. The Promise itself cannot be cancelled, so
 * unsubscribe makes the retained callback inert.
 */
export function bindCaneLayaWebGpuDeviceLossV1(
  listener: (loss: CaneLayaWebGpuDeviceLossV1) => void,
  operation = "layaBindRendererLifecycle",
): () => void {
  if (typeof listener !== "function") {
    throw new CaneLayaErrorV1("invalidArgument", "listener must be a function.", {
      operation,
      field: "listener",
    });
  }
  const backend = assertCaneLayaWebRendererV1(operation);
  if (backend !== "webgpu") return () => {};
  const host = assertLayaAir341V1(operation) as unknown as LayaGlobalProbeV1;
  const engine = host.LayaGL?.renderEngine;
  const device = engine?.getDevice?.();
  const lost = device?.lost;
  if (engine === undefined || device === undefined || lost === undefined
    || typeof lost.then !== "function") {
    throw new CaneLayaErrorV1(
      "engineUnavailable",
      "The LayaAir 3.4.1 WebGPU driver did not expose its initialized GPU device.",
      { operation, field: "Laya.LayaGL.renderEngine.getDevice().lost" },
    );
  }
  let active = true;
  void Promise.resolve(lost).then(
    (info) => {
      if (active) listener({ backend, engine, device, info });
    },
    (info: unknown) => {
      if (active) listener({ backend, engine, device, info });
    },
  );
  return () => { active = false; };
}

/** Version-locked guard around LayaAir's non-public renderer state. */
export function assertCaneLayaContextRecoveryReadyV1(
  operation = "layaRestoreContext",
  lostWebGpuEngine?: object | null,
): void {
  const host = assertLayaAir341V1(operation) as unknown as LayaGlobalProbeV1;
  const engine = host.LayaGL?.renderEngine;
  const lost = engine?.lost ?? engine?._lost;
  if (lost === true) {
    throw new CaneLayaErrorV1(
      "contextRestoreFailed",
      "LayaAir 3.4.1 cannot restore its complete WebGL engine in place; initialize a fresh Laya engine before restoring Cane resources.",
      {
        operation,
        field: "Laya.LayaGL.renderEngine.lost",
        expected: false,
        actual: true,
      },
    );
  }
  if (engine !== undefined && lostWebGpuEngine === engine) {
    throw new CaneLayaErrorV1(
      "contextRestoreFailed",
      "LayaAir 3.4.1 cannot replace a lost WebGPU device in place; initialize a fresh Laya engine before restoring Cane resources.",
      {
        operation,
        field: "Laya.LayaGL.renderEngine",
        expected: "fresh WebGPU engine",
        actual: "lost WebGPU engine",
      },
    );
  }
}
