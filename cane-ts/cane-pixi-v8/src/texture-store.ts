import type {
  RuntimeDataV1,
  RuntimeDecodedAtlasPageSizeV1,
  RuntimeDecodedImageSizeV1,
  RuntimeRenderPacketV1,
  RuntimeTextureV1,
} from "@cane-runtime/core";
import { RuntimeErrorV1 } from "@cane-runtime/core";
import {
  Assets,
  type ALPHA_MODES,
  type SCALE_MODE,
  type Texture,
  type WRAP_MODE,
} from "pixi.js";

export interface PixiTextureStoreOptionsV1 {
  readonly baseUrl?: string;
  /**
   * `caneBatch` preserves source bytes for the Cane shader. `pixiBasic` lets
   * Pixi premultiply straight-alpha bytes for its built-in Mesh shader.
   */
  readonly pipeline?: PixiTexturePipelineV1;
  /** Injectable PIXI.Assets-compatible owner, primarily for isolated hosts/tests. */
  readonly assets?: PixiAssetsLikeV1;
  /** Optional WebGL canvas or renderer-owned EventTarget for loss/restoration. */
  readonly contextTarget?: EventTarget;
  /** Optional Pixi renderer whose WebGL canvas or WebGPU device is observed. */
  readonly renderer?: PixiRendererContextLikeV1;
}

/** Minimal public surface needed from a WebGPU device; no DOM WebGPU types leak into consumers. */
export interface PixiWebGpuDeviceLikeV1 {
  readonly lost: PromiseLike<unknown>;
}

/** Structural Pixi renderer view used by the lifecycle bridge. */
export interface PixiRendererContextLikeV1 {
  readonly canvas?: unknown;
  readonly gpu?: { readonly device?: PixiWebGpuDeviceLikeV1 };
}

export type PixiTexturePipelineV1 = "caneBatch" | "pixiBasic";

export interface PixiAssetsLikeV1 {
  load<T = unknown>(asset: unknown): Promise<T>;
  unload(asset: unknown): Promise<void>;
}

export interface PixiTextureRegistrationOptionsV1 {
  /** External is the safe default: destroying the store keeps the texture alive. */
  readonly ownership?: "external" | "store";
}

export interface PixiTextureStoreStatsV1 {
  readonly bindings: number;
  readonly assetBindings: number;
  readonly registeredBindings: number;
  readonly loadsStarted: number;
  readonly sharedCacheHits: number;
  readonly unloads: number;
  readonly loadFailures: number;
  readonly contextLosses: number;
  readonly contextRestores: number;
  readonly webGpuDeviceLosses: number;
  readonly gpuInvalidations: number;
}

interface PixiTextureLoadStyleV1 {
  readonly minFilter: SCALE_MODE;
  readonly magFilter: SCALE_MODE;
  readonly addressModeU: WRAP_MODE;
  readonly addressModeV: WRAP_MODE;
}

interface TextureLoadRequestV1 {
  readonly key: string;
  readonly url: string;
  readonly alphaMode: ALPHA_MODES;
  readonly field: string;
  readonly entityId: string;
  readonly style: PixiTextureLoadStyleV1 | null;
}

interface SharedAssetTextureV1 {
  readonly alias: string;
  readonly assets: PixiAssetsLikeV1;
  readonly promise: Promise<Texture>;
  refs: number;
}

interface TextureBindingV1 {
  readonly key: string;
  readonly texture: Texture;
  readonly lease: SharedAssetTextureV1 | null;
  readonly ownership: "external" | "store";
}

type MutableTextureStoreStatsV1 = {
  -readonly [Field in keyof PixiTextureStoreStatsV1]: PixiTextureStoreStatsV1[Field]
};

const SHARED_ASSET_TEXTURES_V1 = new WeakMap<object, Map<string, SharedAssetTextureV1>>();

export class PixiTextureStore {
  readonly #baseUrl: string;
  readonly #pipeline: PixiTexturePipelineV1;
  readonly #assets: PixiAssetsLikeV1;
  readonly #bindings = new Map<string, TextureBindingV1>();
  readonly #contextUnsubscribers = new Set<() => void>();
  readonly #stats: MutableTextureStoreStatsV1 = {
    bindings: 0,
    assetBindings: 0,
    registeredBindings: 0,
    loadsStarted: 0,
    sharedCacheHits: 0,
    unloads: 0,
    loadFailures: 0,
    contextLosses: 0,
    contextRestores: 0,
    webGpuDeviceLosses: 0,
    gpuInvalidations: 0,
  };
  #destroyed = false;
  #webGpuAwaitingReplacement = false;

  constructor(options: PixiTextureStoreOptionsV1 = {}) {
    this.#baseUrl = options.baseUrl ?? "";
    const pipeline = options.pipeline ?? "caneBatch";
    if (pipeline !== "caneBatch" && pipeline !== "pixiBasic") {
      throw new RuntimeErrorV1("invalidArgument", "pixiCreateTextureStore", "Unknown Pixi texture pipeline.", {
        field: "pipeline",
      });
    }
    this.#pipeline = pipeline;
    this.#assets = options.assets ?? Assets;
    if (options.contextTarget !== undefined) this.bindContextLifecycle(options.contextTarget);
    if (options.renderer !== undefined) this.bindRendererContextLifecycle(options.renderer);
  }

  get pipeline(): PixiTexturePipelineV1 {
    return this.#pipeline;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  get stats(): PixiTextureStoreStatsV1 {
    this.#refreshBindingStats();
    return { ...this.#stats };
  }

  async preload(packet: RuntimeRenderPacketV1): Promise<void> {
    this.#assertLive("pixiPreload");
    const resources = new Map<string, RuntimeTextureV1>();
    for (const attachment of packet.attachments) {
      resources.set(textureKeyV1(attachment.texture), attachment.texture);
    }
    await this.#preloadResources(resources);
  }

  /** Loads every direct image and Atlas page, including future skins/sequences. */
  async preloadData(data: RuntimeDataV1): Promise<void> {
    this.#assertLive("pixiPreload");
    const resources = runtimeTextureDescriptorsV1(data);
    const styles = runtimeTextureLoadStylesV1(data);
    const requests = textureLoadRequestsV1(resources, styles, this.#baseUrl, this.#pipeline);
    for (const atlas of data.atlases) {
      for (const page of atlas.pages) {
        const key = atlasPageTextureKeyV1(atlas.atlasId, page.pageId, page.image);
        if (requests.has(key)) continue;
        requests.set(key, {
          key,
          url: resolveAssetUrlV1(this.#baseUrl, page.image),
          alphaMode: pixiAlphaModeForCaneSourceV1(atlas.alphaMode, this.#pipeline),
          field: "pagePath",
          entityId: page.pageId,
          style: styles.get(key) ?? null,
        });
      }
    }
    const acquiredKeys = await this.#preloadRequests(requests);

    try {
      const directImages: RuntimeDecodedImageSizeV1[] = [];
      for (const descriptor of resources.values()) {
        const texture = this.texture(descriptor);
        if (descriptor.kind === "direct") {
          directImages.push({
            imageId: descriptor.imageId,
            width: texture.source.pixelWidth,
            height: texture.source.pixelHeight,
          });
        }
      }

      const atlasPages: RuntimeDecodedAtlasPageSizeV1[] = [];
      for (const atlas of data.atlases) {
        for (const page of atlas.pages) {
          const key = atlasPageTextureKeyV1(atlas.atlasId, page.pageId, page.image);
          const texture = this.#bindings.get(key)?.texture;
          if (texture === undefined) throw missingTextureV1(page.pageId, "pagePath");
          validatePixiTextureSourceAlphaModeV1(
            atlas.alphaMode,
            page.pageId,
            texture,
            "pixiPreload",
            this.#pipeline,
          );
          atlasPages.push({
            atlasId: atlas.atlasId,
            pageId: page.pageId,
            width: texture.source.pixelWidth,
            height: texture.source.pixelHeight,
          });
        }
      }
      data.validateDecodedTextureSizes(directImages, atlasPages);
    } catch (error) {
      await this.#rollbackBindings(acquiredKeys);
      throw error;
    }
  }

  async #preloadResources(
    resources: ReadonlyMap<string, RuntimeTextureV1>,
    styles: ReadonlyMap<string, PixiTextureLoadStyleV1> | null = null,
  ): Promise<void> {
    const requests = textureLoadRequestsV1(resources, styles, this.#baseUrl, this.#pipeline);
    const acquiredKeys = await this.#preloadRequests(requests);
    try {
      for (const [key, descriptor] of resources) {
        const texture = this.#bindings.get(key)?.texture;
        if (texture === undefined) throw missingTextureV1(descriptor.imageId, descriptor.kind === "direct" ? "path" : "pagePath");
        validatePixiTextureUploadModeV1(descriptor, texture, "pixiPreload", this.#pipeline);
      }
    } catch (error) {
      await this.#rollbackBindings(acquiredKeys);
      throw error;
    }
  }

  async #preloadRequests(requests: ReadonlyMap<string, TextureLoadRequestV1>): Promise<string[]> {
    const pending: TextureLoadRequestV1[] = [];
    for (const request of requests.values()) {
      if (this.#bindings.has(request.key)) {
        this.#stats.sharedCacheHits += 1;
      } else {
        pending.push(request);
      }
    }
    const settled = await Promise.allSettled(pending.map((request) => this.#acquireBinding(request)));
    const acquired: TextureBindingV1[] = [];
    let firstError: unknown = null;
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      if (result?.status === "fulfilled") acquired.push(result.value);
      else if (result?.status === "rejected" && firstError === null) firstError = result.reason;
    }
    if (firstError !== null || this.#destroyed) {
      await Promise.allSettled(acquired.map((binding) => releaseSharedAssetV1(binding.lease)));
      if (this.#destroyed) {
        throw new RuntimeErrorV1("invalidState", "pixiPreload", "Texture store was destroyed while loading.");
      }
      throw firstError;
    }
    for (const binding of acquired) this.#bindings.set(binding.key, binding);
    this.#refreshBindingStats();
    return acquired.map((binding) => binding.key);
  }

  async #acquireBinding(request: TextureLoadRequestV1): Promise<TextureBindingV1> {
    this.#stats.loadsStarted += 1;
    try {
      const acquired = await acquireSharedAssetV1(this.#assets, request, this.#pipeline);
      if (acquired.shared) this.#stats.sharedCacheHits += 1;
      return { key: request.key, texture: acquired.texture, lease: acquired.lease, ownership: "external" };
    } catch (error) {
      this.#stats.loadFailures += 1;
      throw new RuntimeErrorV1("missingResource", "pixiPreload", `Failed to load texture '${request.url}'.`, {
        field: request.field,
        entityId: request.entityId,
        cause: error,
      });
    }
  }

  register(
    descriptor: RuntimeTextureV1,
    texture: Texture,
    options: PixiTextureRegistrationOptionsV1 = {},
  ): void {
    this.#assertLive("pixiRegisterTexture");
    validatePixiTextureUploadModeV1(descriptor, texture, "pixiRegisterTexture", this.#pipeline);
    const key = textureKeyV1(descriptor);
    const existing = this.#bindings.get(key);
    if (existing !== undefined) {
      if (existing.texture === texture) return;
      throw new RuntimeErrorV1(
        "invalidState",
        "pixiRegisterTexture",
        "A different texture is already bound; unload it before replacement.",
        { entityId: descriptor.imageId },
      );
    }
    const ownership = options.ownership ?? "external";
    if (ownership !== "external" && ownership !== "store") {
      throw new RuntimeErrorV1("invalidArgument", "pixiRegisterTexture", "Unknown texture ownership.", {
        field: "ownership",
      });
    }
    this.#bindings.set(key, { key, texture, lease: null, ownership });
    this.#refreshBindingStats();
  }

  texture(descriptor: RuntimeTextureV1): Texture {
    this.#assertLive("pixiApply");
    const result = this.#bindings.get(textureKeyV1(descriptor))?.texture;
    if (result === undefined) {
      throw new RuntimeErrorV1("missingResource", "pixiApply", "Texture was not preloaded.", {
        field: descriptor.kind === "direct" ? "path" : "pagePath",
        entityId: descriptor.imageId,
      });
    }
    return result;
  }

  async unload(descriptor?: RuntimeTextureV1): Promise<void> {
    this.#assertLive("pixiUnload");
    const keys = descriptor === undefined ? [...this.#bindings.keys()] : [textureKeyV1(descriptor)];
    const bindings: TextureBindingV1[] = [];
    for (const key of keys) {
      const binding = this.#bindings.get(key);
      if (binding === undefined) continue;
      this.#bindings.delete(key);
      bindings.push(binding);
    }
    await this.#releaseBindings(bindings);
  }

  /** Backward-compatible alias; await it when deterministic release matters. */
  clearBindings(): Promise<void> {
    return this.unload();
  }

  /** Drops renderer-specific GPU handles; retained source data uploads lazily again. */
  invalidateGpuResources(): number {
    this.#assertLive("pixiInvalidateGpuResources");
    const sources = new Set<Texture["source"]>();
    for (const binding of this.#bindings.values()) sources.add(binding.texture.source);
    for (const source of sources) source.unload();
    this.#stats.gpuInvalidations += sources.size;
    return sources.size;
  }

  handleContextLost(): void {
    if (this.#destroyed) return;
    this.#stats.contextLosses += 1;
  }

  handleContextRestored(): number {
    if (this.#destroyed) return 0;
    this.#stats.contextRestores += 1;
    return this.invalidateGpuResources();
  }

  bindContextLifecycle(target: EventTarget): () => void {
    this.#assertLive("pixiBindContextLifecycle");
    if (target === null || typeof target.addEventListener !== "function") {
      throw new RuntimeErrorV1("invalidArgument", "pixiBindContextLifecycle", "target must be an EventTarget.", {
        field: "target",
      });
    }
    const lost = (event: Event): void => {
      if ("preventDefault" in event) event.preventDefault();
      this.handleContextLost();
    };
    const restored = (): void => {
      this.handleContextRestored();
    };
    target.addEventListener("webglcontextlost", lost);
    target.addEventListener("webglcontextrestored", restored);
    let active = true;
    const unbind = (): void => {
      if (!active) return;
      active = false;
      target.removeEventListener("webglcontextlost", lost);
      target.removeEventListener("webglcontextrestored", restored);
      this.#contextUnsubscribers.delete(unbind);
    };
    this.#contextUnsubscribers.add(unbind);
    return unbind;
  }

  /**
   * Watches a WebGPU device. Device loss is terminal for that device, so a
   * host recreates/rebinds its Pixi renderer; binding the replacement records
   * restoration and retained TextureSources upload lazily to the new device.
   */
  bindWebGpuDeviceLifecycle(device: PixiWebGpuDeviceLikeV1): () => void {
    this.#assertLive("pixiBindWebGpuDeviceLifecycle");
    if (device === null || typeof device !== "object" || device.lost === undefined
      || typeof device.lost.then !== "function") {
      throw new RuntimeErrorV1(
        "invalidArgument",
        "pixiBindWebGpuDeviceLifecycle",
        "device.lost must be a PromiseLike value.",
        { field: "device.lost" },
      );
    }
    if (this.#webGpuAwaitingReplacement) {
      this.#webGpuAwaitingReplacement = false;
      this.#stats.contextRestores += 1;
    }
    let active = true;
    const unbind = (): void => {
      if (!active) return;
      active = false;
      this.#contextUnsubscribers.delete(unbind);
    };
    const settleLoss = (): void => {
      if (!active) return;
      active = false;
      this.#contextUnsubscribers.delete(unbind);
      this.#handleWebGpuDeviceLost();
    };
    this.#contextUnsubscribers.add(unbind);
    void Promise.resolve(device.lost).then(
      settleLoss,
      settleLoss,
    );
    return unbind;
  }

  /** Selects the official WebGPU device signal or WebGL canvas events. */
  bindRendererContextLifecycle(renderer: PixiRendererContextLikeV1): () => void {
    this.#assertLive("pixiBindRendererContextLifecycle");
    const device = renderer.gpu?.device;
    if (device !== undefined) return this.bindWebGpuDeviceLifecycle(device);
    const canvas = renderer.canvas;
    if (isEventTargetLikeV1(canvas)) return this.bindContextLifecycle(canvas);
    throw new RuntimeErrorV1(
      "invalidArgument",
      "pixiBindRendererContextLifecycle",
      "renderer must expose either gpu.device.lost or an EventTarget canvas.",
      { field: "renderer" },
    );
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    for (const unsubscribe of [...this.#contextUnsubscribers]) unsubscribe();
    const bindings = [...this.#bindings.values()];
    this.#bindings.clear();
    this.#destroyed = true;
    await this.#releaseBindings(bindings);
  }

  #handleWebGpuDeviceLost(): void {
    if (this.#destroyed) return;
    this.#stats.contextLosses += 1;
    this.#stats.webGpuDeviceLosses += 1;
    this.#webGpuAwaitingReplacement = true;
    this.invalidateGpuResources();
  }

  async #rollbackBindings(keys: readonly string[]): Promise<void> {
    const bindings: TextureBindingV1[] = [];
    for (const key of keys) {
      const binding = this.#bindings.get(key);
      if (binding === undefined) continue;
      this.#bindings.delete(key);
      bindings.push(binding);
    }
    await this.#releaseBindings(bindings);
  }

  async #releaseBindings(bindings: readonly TextureBindingV1[]): Promise<void> {
    const ownedTextures = new Set<Texture>();
    const releases: Promise<void>[] = [];
    for (const binding of bindings) {
      if (binding.lease !== null) releases.push(releaseSharedAssetV1(binding.lease));
      else if (binding.ownership === "store") ownedTextures.add(binding.texture);
    }
    // A single Texture may be registered under multiple Runtime descriptors.
    // Do not destroy an owned registration while another live binding still
    // references the same Texture (regardless of that binding's ownership).
    for (const binding of this.#bindings.values()) ownedTextures.delete(binding.texture);
    for (const texture of ownedTextures) {
      if (!texture.destroyed) texture.destroy(true);
    }
    const settled = await Promise.allSettled(releases);
    this.#stats.unloads += bindings.length;
    this.#refreshBindingStats();
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure !== undefined) {
      throw new RuntimeErrorV1("invalidState", "pixiUnload", "PIXI.Assets failed to unload a Cane texture.", {
        cause: failure.reason,
      });
    }
  }

  #refreshBindingStats(): void {
    let assets = 0;
    let registered = 0;
    for (const binding of this.#bindings.values()) {
      if (binding.lease === null) registered += 1;
      else assets += 1;
    }
    this.#stats.bindings = this.#bindings.size;
    this.#stats.assetBindings = assets;
    this.#stats.registeredBindings = registered;
  }

  #assertLive(operation: string): void {
    if (this.#destroyed) {
      throw new RuntimeErrorV1("invalidState", operation, "Texture store has been destroyed.");
    }
  }
}

function isEventTargetLikeV1(value: unknown): value is EventTarget {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { addEventListener?: unknown; removeEventListener?: unknown };
  return typeof candidate.addEventListener === "function"
    && typeof candidate.removeEventListener === "function";
}

function textureLoadRequestsV1(
  resources: ReadonlyMap<string, RuntimeTextureV1>,
  styles: ReadonlyMap<string, PixiTextureLoadStyleV1> | null,
  baseUrl: string,
  pipeline: PixiTexturePipelineV1,
): Map<string, TextureLoadRequestV1> {
  const requests = new Map<string, TextureLoadRequestV1>();
  for (const [key, descriptor] of resources) {
    requests.set(key, {
      key,
      url: resolveAssetUrlV1(baseUrl, texturePathV1(descriptor)),
      alphaMode: pixiAlphaModeForCaneTextureV1(descriptor, pipeline),
      field: descriptor.kind === "direct" ? "path" : "pagePath",
      entityId: descriptor.imageId,
      style: styles?.get(key) ?? null,
    });
  }
  return requests;
}

async function acquireSharedAssetV1(
  assets: PixiAssetsLikeV1,
  request: TextureLoadRequestV1,
  pipeline: PixiTexturePipelineV1,
): Promise<{ readonly texture: Texture; readonly lease: SharedAssetTextureV1; readonly shared: boolean }> {
  const owner = assets as object;
  let registry = SHARED_ASSET_TEXTURES_V1.get(owner);
  if (registry === undefined) {
    registry = new Map();
    SHARED_ASSET_TEXTURES_V1.set(owner, registry);
  }
  const styleSignature = request.style === null
    ? "default"
    : `${request.style.minFilter}:${request.style.magFilter}:${request.style.addressModeU}:${request.style.addressModeV}`;
  const alias = `cane-runtime:${pipeline}:${request.alphaMode}:${styleSignature}:${request.key}:${request.url}`;
  let lease = registry.get(alias);
  const shared = lease !== undefined;
  if (lease === undefined) {
    lease = {
      alias,
      assets,
      refs: 0,
      promise: assets.load<Texture>({
        alias,
        src: request.url,
        parser: "texture",
        data: request.style === null
          ? { alphaMode: request.alphaMode }
          : { alphaMode: request.alphaMode, ...request.style },
      }),
    };
    registry.set(alias, lease);
  }
  lease.refs += 1;
  try {
    const texture = await lease.promise;
    return { texture, lease, shared };
  } catch (error) {
    lease.refs -= 1;
    if (lease.refs === 0 && registry.get(alias) === lease) {
      registry.delete(alias);
      await assets.unload(alias).catch(() => undefined);
    }
    throw error;
  }
}

async function releaseSharedAssetV1(lease: SharedAssetTextureV1 | null): Promise<void> {
  if (lease === null) return;
  const registry = SHARED_ASSET_TEXTURES_V1.get(lease.assets as object);
  if (registry?.get(lease.alias) !== lease || lease.refs <= 0) return;
  lease.refs -= 1;
  if (lease.refs > 0) return;
  registry.delete(lease.alias);
  await lease.assets.unload(lease.alias);
}

function missingTextureV1(entityId: string, field: string): RuntimeErrorV1 {
  return new RuntimeErrorV1("missingResource", "pixiPreload", "Texture was not preloaded.", {
    field,
    entityId,
  });
}

/** Chooses upload semantics for either the Cane shader or Pixi's basic shader. */
export function pixiAlphaModeForCaneTextureV1(
  texture: RuntimeTextureV1,
  pipeline: PixiTexturePipelineV1 = "caneBatch",
): ALPHA_MODES {
  return pixiAlphaModeForCaneSourceV1(texture.alphaMode, pipeline);
}

export function validatePixiTextureUploadModeV1(
  descriptor: RuntimeTextureV1,
  texture: Texture,
  operation = "pixiRegisterTexture",
  pipeline: PixiTexturePipelineV1 = "caneBatch",
): void {
  validatePixiTextureSourceAlphaModeV1(
    descriptor.alphaMode,
    descriptor.imageId,
    texture,
    operation,
    pipeline,
  );
}

function validatePixiTextureSourceAlphaModeV1(
  alphaMode: RuntimeTextureV1["alphaMode"],
  entityId: string,
  texture: Texture,
  operation: string,
  pipeline: PixiTexturePipelineV1,
): void {
  const expected = pixiAlphaModeForCaneSourceV1(alphaMode, pipeline);
  if (texture.source.alphaMode !== expected) {
    throw new RuntimeErrorV1(
      "validationFailed",
      operation,
      `Pixi texture alphaMode must be '${expected}' for Cane '${alphaMode}' source bytes.`,
      {
        field: "texture.source.alphaMode",
        entityId,
      },
    );
  }
}

function pixiAlphaModeForCaneSourceV1(
  alphaMode: RuntimeTextureV1["alphaMode"],
  pipeline: PixiTexturePipelineV1,
): ALPHA_MODES {
  if (pipeline === "caneBatch") return "premultiplied-alpha";
  return alphaMode === "straight" ? "premultiply-alpha-on-upload" : "premultiplied-alpha";
}

export function textureKeyV1(texture: RuntimeTextureV1): string {
  return texture.kind === "direct"
    ? `direct:${texture.imageId}:${texture.path}`
    : atlasPageTextureKeyV1(texture.atlasId, texture.pageId, texture.pagePath);
}

function atlasPageTextureKeyV1(atlasId: string, pageId: string, pagePath: string): string {
  return `atlas:${atlasId}:${pageId}:${pagePath}`;
}

/** Builds one load descriptor per direct image or shared Atlas page. */
export function runtimeTextureDescriptorsV1(data: RuntimeDataV1): Map<string, RuntimeTextureV1> {
  const resources = new Map<string, RuntimeTextureV1>();
  for (const image of data.document.images) {
    if (image.atlasId === null) {
      if (image.path === null) continue;
      const descriptor: RuntimeTextureV1 = {
        kind: "direct",
        imageId: image.imageId,
        path: image.path,
        colorSpace: "srgb",
        alphaMode: "straight",
      };
      resources.set(textureKeyV1(descriptor), descriptor);
      continue;
    }

    const atlas = data.atlas(image.atlasId);
    if (atlas === null) {
      throw new RuntimeErrorV1("missingResource", "pixiPreload", "Atlas is unavailable.", {
        field: "atlasId",
        entityId: image.atlasId,
      });
    }
    const region = atlas.regions.find((candidate) => candidate.imageId === image.imageId);
    if (region === undefined) {
      throw new RuntimeErrorV1("missingResource", "pixiPreload", "Atlas region is unavailable.", {
        field: "region",
        entityId: image.imageId,
      });
    }
    const page = atlas.pages.find((candidate) => candidate.pageId === region.pageId);
    if (page === undefined) {
      throw new RuntimeErrorV1("missingResource", "pixiPreload", "Atlas page is unavailable.", {
        field: "page",
        entityId: region.pageId,
      });
    }
    const descriptor: RuntimeTextureV1 = {
      kind: "atlas",
      imageId: image.imageId,
      atlasId: atlas.atlasId,
      pageId: page.pageId,
      pagePath: page.image,
      regionId: region.regionId,
      colorSpace: atlas.colorSpace,
      alphaMode: atlas.alphaMode,
    };
    resources.set(textureKeyV1(descriptor), descriptor);
  }
  return resources;
}

function runtimeTextureLoadStylesV1(data: RuntimeDataV1): Map<string, PixiTextureLoadStyleV1> {
  const styles = new Map<string, PixiTextureLoadStyleV1>();
  for (const atlas of data.atlases) {
    for (const page of atlas.pages) {
      styles.set(atlasPageTextureKeyV1(atlas.atlasId, page.pageId, page.image), {
        minFilter: page.minFilter === "nearest" ? "nearest" : "linear",
        magFilter: page.magFilter === "nearest" ? "nearest" : "linear",
        addressModeU: pixiWrapModeV1(page.wrapU),
        addressModeV: pixiWrapModeV1(page.wrapV),
      });
    }
  }
  return styles;
}

function pixiWrapModeV1(value: string): WRAP_MODE {
  if (value === "repeat") return "repeat";
  if (value === "mirror") return "mirror-repeat";
  return "clamp-to-edge";
}

export function texturePathV1(texture: RuntimeTextureV1): string {
  return texture.kind === "direct" ? texture.path : texture.pagePath;
}

export function resolveAssetUrlV1(baseUrl: string, portablePath: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(portablePath)) {
    return portablePath;
  }
  if (baseUrl.length === 0) return portablePath;
  if (/^[a-z][a-z0-9+.-]*:/i.test(baseUrl)) {
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL(portablePath, normalizedBase).toString();
  }
  return `${baseUrl.replace(/\/$/, "")}/${portablePath}`;
}
