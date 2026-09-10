import type {
  RuntimeDataV1,
  RuntimeDecodedAtlasPageSizeV1,
  RuntimeDecodedImageSizeV1,
  RuntimeRenderPacketV1,
  RuntimeTextureV1,
} from "@cane-runtime/core";
import { CaneLayaErrorV1 } from "./errors.js";
import {
  assertCaneLayaContextRecoveryReadyV1,
  bindCaneLayaWebGpuDeviceLossV1,
  detectCaneLayaBackendV1,
  type CaneLayaWebGpuDeviceLossV1,
} from "./engine.js";
import { resolveAssetUrlV1, textureKeyV1, texturePathV1 } from "./geometry.js";

export type CaneLayaResourceKindV1 = "runtime" | "atlas" | "texture";
export type CaneLayaTextureStoreChangeV1 = "bindingsChanged" | "contextLost" | "contextRestored";

export interface CaneLayaResourceRequestV1 {
  readonly url: string;
  readonly kind: CaneLayaResourceKindV1;
  readonly responseType: "arrayBuffer" | "json";
  readonly signal?: AbortSignal;
}

export interface CaneLayaResourceResolverV1 {
  resolve(request: CaneLayaResourceRequestV1): Promise<ArrayBuffer | unknown>;
}

export interface CaneLayaTextureDecodeRequestV1 {
  readonly url: string;
  readonly bytes: ArrayBuffer;
  readonly colorSpace: RuntimeTextureV1["colorSpace"];
  readonly alphaMode: RuntimeTextureV1["alphaMode"];
  readonly minFilter: "nearest" | "linear";
  readonly magFilter: "nearest" | "linear";
  readonly wrapU: "clamp" | "repeat" | "mirror";
  readonly wrapV: "clamp" | "repeat" | "mirror";
}

export interface CaneLayaTextureDecoderV1 {
  decode(request: CaneLayaTextureDecodeRequestV1): Promise<Laya.Texture2D>;
}

export interface LayaTextureStoreOptionsV1 {
  readonly baseUrl?: string;
  /** Per-Atlas page roots, normally derived from each Atlas document URL. */
  readonly atlasBaseUrls?: ReadonlyMap<string, string>;
  readonly resolver?: CaneLayaResourceResolverV1;
  readonly decoder?: CaneLayaTextureDecoderV1;
  /** WebGL canvas event target; also enables WebGPU GPUDevice.lost observation. */
  readonly contextTarget?: EventTarget;
}

export interface LayaTextureRegistrationOptionsV1 {
  readonly ownership?: "external" | "store";
  /** Host callback used after the host has recreated its web renderer. */
  readonly restore?: () => Promise<Laya.Texture2D>;
  /** Must describe raw encoded texture bytes; hardware sRGB decode is rejected. */
  readonly sourceColorSpace?: "raw";
  readonly sourceAlphaMode?: RuntimeTextureV1["alphaMode"];
}

export interface LayaTextureStoreStatsV1 {
  readonly bindings: number;
  readonly sharedBindings: number;
  readonly registeredBindings: number;
  readonly loadsStarted: number;
  readonly sharedCacheHits: number;
  readonly unloads: number;
  readonly loadFailures: number;
  readonly contextLosses: number;
  readonly contextRestores: number;
  readonly restoredTextures: number;
  readonly restoreFailures: number;
}

interface TextureStyleV1 {
  readonly minFilter: "nearest" | "linear";
  readonly magFilter: "nearest" | "linear";
  readonly wrapU: "clamp" | "repeat" | "mirror";
  readonly wrapV: "clamp" | "repeat" | "mirror";
}

interface TextureLoadRequestV1 extends Omit<CaneLayaTextureDecodeRequestV1, "bytes"> {
  readonly key: string;
  readonly descriptor: RuntimeTextureV1;
  readonly field: string;
  readonly entityId: string;
}

interface SharedTextureLeaseV1 {
  readonly cacheKey: string;
  readonly owner: object;
  readonly resolver: CaneLayaResourceResolverV1;
  readonly decoder: CaneLayaTextureDecoderV1;
  readonly request: TextureLoadRequestV1;
  promise: Promise<Laya.Texture2D>;
  texture: Laya.Texture2D | null;
  restorePromise: Promise<Laya.Texture2D> | null;
  refs: number;
}

interface TextureBindingV1 {
  readonly key: string;
  readonly descriptor: RuntimeTextureV1;
  readonly lease: SharedTextureLeaseV1 | null;
  readonly ownership: "external" | "store";
  readonly restore: (() => Promise<Laya.Texture2D>) | null;
  texture: Laya.Texture2D;
}

type MutableTextureStoreStatsV1 = {
  -readonly [Field in keyof LayaTextureStoreStatsV1]: LayaTextureStoreStatsV1[Field]
};

const SHARED_TEXTURES_V1 = new WeakMap<
  object,
  WeakMap<object, Map<string, SharedTextureLeaseV1>>
>();

export class FetchCaneLayaResourceResolverV1 implements CaneLayaResourceResolverV1 {
  async resolve(request: CaneLayaResourceRequestV1): Promise<ArrayBuffer | unknown> {
    let response: Response;
    try {
      response = await fetch(
        request.url,
        request.signal === undefined ? undefined : { signal: request.signal },
      );
    } catch (error) {
      throw resourceErrorV1("missingResource", `Failed to fetch '${request.url}'.`, request, error);
    }
    if (!response.ok) {
      throw resourceErrorV1(
        "missingResource",
        `Failed to fetch '${request.url}' (${response.status}).`,
        request,
      );
    }
    if (request.responseType === "arrayBuffer") return response.arrayBuffer();
    try {
      return await response.json();
    } catch (error) {
      throw resourceErrorV1("decodeFailed", `JSON at '${request.url}' could not be decoded.`, request, error);
    }
  }
}

export class BrowserCaneLayaTextureDecoderV1 implements CaneLayaTextureDecoderV1 {
  async decode(request: CaneLayaTextureDecodeRequestV1): Promise<Laya.Texture2D> {
    if (typeof createImageBitmap !== "function") {
      throw new CaneLayaErrorV1(
        "decodeFailed",
        "createImageBitmap is unavailable; provide a platform CaneLayaTextureDecoderV1.",
        { operation: "layaDecodeTexture", field: "createImageBitmap", url: request.url },
      );
    }
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([request.bytes]), {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
      });
    } catch (error) {
      throw new CaneLayaErrorV1("decodeFailed", `Texture '${request.url}' could not be decoded.`, {
        operation: "layaDecodeTexture",
        field: "texture",
        url: request.url,
        cause: error,
      });
    }
    try {
      // Keep GPU storage raw. The Cane shader applies explicit Runtime v1
      // color-space and PMA semantics once, independent of browser defaults.
      const texture = new Laya.Texture2D(
        bitmap.width,
        bitmap.height,
        Laya.TextureFormat.R8G8B8A8,
        false,
        false,
        false,
        false,
      );
      texture.setImageData(bitmap, false, false);
      texture.filterMode = request.minFilter === "nearest" && request.magFilter === "nearest"
        ? Laya.FilterMode.Point
        : Laya.FilterMode.Bilinear;
      texture.wrapModeU = wrapModeV1(request.wrapU);
      texture.wrapModeV = wrapModeV1(request.wrapV);
      texture.name = `Cane:${request.url}`;
      texture.url = request.url;
      return texture;
    } finally {
      bitmap.close();
    }
  }
}

export const defaultCaneLayaResourceResolverV1 = new FetchCaneLayaResourceResolverV1();
export const defaultCaneLayaTextureDecoderV1 = new BrowserCaneLayaTextureDecoderV1();

/** Shared, transactional texture ownership for one or many Cane characters. */
export class LayaTextureStore {
  readonly #baseUrl: string;
  readonly #atlasBaseUrls: ReadonlyMap<string, string>;
  readonly #resolver: CaneLayaResourceResolverV1;
  readonly #decoder: CaneLayaTextureDecoderV1;
  readonly #bindings = new Map<string, TextureBindingV1>();
  readonly #listeners = new Set<(change: CaneLayaTextureStoreChangeV1) => void>();
  readonly #contextUnsubscribers = new Set<() => void>();
  readonly #stats: MutableTextureStoreStatsV1 = {
    bindings: 0,
    sharedBindings: 0,
    registeredBindings: 0,
    loadsStarted: 0,
    sharedCacheHits: 0,
    unloads: 0,
    loadFailures: 0,
    contextLosses: 0,
    contextRestores: 0,
    restoredTextures: 0,
    restoreFailures: 0,
  };
  #destroyed = false;
  #restorePromise: Promise<void> | null = null;
  #lostWebGpuEngine: object | null = null;
  #operationTail: Promise<void> = Promise.resolve();

  constructor(options: LayaTextureStoreOptionsV1 = {}) {
    this.#baseUrl = options.baseUrl ?? "";
    this.#atlasBaseUrls = new Map(options.atlasBaseUrls ?? []);
    this.#resolver = options.resolver ?? defaultCaneLayaResourceResolverV1;
    this.#decoder = options.decoder ?? defaultCaneLayaTextureDecoderV1;
    if (options.contextTarget !== undefined) this.bindRendererLifecycle(options.contextTarget);
  }

  get destroyed(): boolean { return this.#destroyed; }
  get resolver(): CaneLayaResourceResolverV1 { return this.#resolver; }
  get stats(): LayaTextureStoreStatsV1 {
    this.#refreshStats();
    return { ...this.#stats };
  }

  onTexturesChanged(listener: (change: CaneLayaTextureStoreChangeV1) => void): () => void {
    this.#assertLive("layaOnTexturesChanged");
    if (typeof listener !== "function") {
      throw new CaneLayaErrorV1("invalidArgument", "listener must be a function.", {
        operation: "layaOnTexturesChanged",
        field: "listener",
      });
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async preload(packet: RuntimeRenderPacketV1): Promise<void> {
    return this.#enqueue(async () => {
      this.#assertLive("layaPreloadTextures");
      const resources = new Map<string, RuntimeTextureV1>();
      for (const attachment of packet.attachments) {
        resources.set(textureKeyV1(attachment.texture), attachment.texture);
      }
      await this.#preloadRequests(textureLoadRequestsV1(
        resources,
        null,
        this.#baseUrl,
        this.#atlasBaseUrls,
      ));
    });
  }

  /** Loads direct images and every Atlas page, including inactive skins/sequences. */
  async preloadData(data: RuntimeDataV1): Promise<void> {
    return this.#enqueue(async () => {
      this.#assertLive("layaPreloadTextures");
      const resources = runtimeTextureDescriptorsV1(data);
      const styles = runtimeTextureLoadStylesV1(data);
      const requests = textureLoadRequestsV1(resources, styles, this.#baseUrl, this.#atlasBaseUrls);
      for (const atlas of data.atlases) {
        for (const page of atlas.pages) {
          const key = atlasPageTextureKeyV1(atlas.atlasId, page.pageId, page.image);
          if (requests.has(key)) continue;
          requests.set(key, {
            key,
            descriptor: {
              kind: "atlas",
              imageId: page.pageId,
              atlasId: atlas.atlasId,
              pageId: page.pageId,
              pagePath: page.image,
              regionId: "",
              colorSpace: atlas.colorSpace,
              alphaMode: atlas.alphaMode,
            },
            url: resolveAssetUrlV1(this.#atlasBaseUrls.get(atlas.atlasId) ?? this.#baseUrl, page.image),
            colorSpace: atlas.colorSpace,
            alphaMode: atlas.alphaMode,
            minFilter: page.minFilter === "nearest" ? "nearest" : "linear",
            magFilter: page.magFilter === "nearest" ? "nearest" : "linear",
            wrapU: normalizeWrapV1(page.wrapU),
            wrapV: normalizeWrapV1(page.wrapV),
            field: "pagePath",
            entityId: page.pageId,
          });
        }
      }
      const acquiredKeys = await this.#preloadRequests(requests);
      try {
        const directImages: RuntimeDecodedImageSizeV1[] = [];
        for (const descriptor of resources.values()) {
          if (descriptor.kind !== "direct") continue;
          const texture = this.texture(descriptor);
          directImages.push({ imageId: descriptor.imageId, width: texture.width, height: texture.height });
        }
        const atlasPages: RuntimeDecodedAtlasPageSizeV1[] = [];
        for (const atlas of data.atlases) {
          for (const page of atlas.pages) {
            const binding = this.#bindings.get(atlasPageTextureKeyV1(atlas.atlasId, page.pageId, page.image));
            if (binding === undefined) throw missingTextureV1(page.pageId, "pagePath");
            const texture = currentTextureV1(binding);
            atlasPages.push({ atlasId: atlas.atlasId, pageId: page.pageId, width: texture.width, height: texture.height });
          }
        }
        data.validateDecodedTextureSizes(directImages, atlasPages);
      } catch (error) {
        await this.#rollback(acquiredKeys);
        throw new CaneLayaErrorV1("dimensionMismatch", "Decoded Cane texture dimensions are invalid.", {
          operation: "layaPreloadTextures",
          field: "textureDimensions",
          cause: error,
        });
      }
    });
  }

  register(
    descriptor: RuntimeTextureV1,
    texture: Laya.Texture2D,
    options: LayaTextureRegistrationOptionsV1 = {},
  ): void {
    this.#assertLive("layaRegisterTexture");
    validateTextureV1(descriptor, texture, options, "layaRegisterTexture");
    const key = textureKeyV1(descriptor);
    const existing = this.#bindings.get(key);
    if (existing !== undefined) {
      if (currentTextureV1(existing) === texture) return;
      throw new CaneLayaErrorV1("invalidState", "A different texture is already registered.", {
        operation: "layaRegisterTexture",
        entityId: descriptor.imageId,
      });
    }
    const ownership = options.ownership ?? "external";
    if (ownership !== "external" && ownership !== "store") {
      throw new CaneLayaErrorV1("invalidArgument", "Unknown texture ownership.", {
        operation: "layaRegisterTexture",
        field: "ownership",
        actual: ownership,
      });
    }
    this.#bindings.set(key, {
      key,
      descriptor,
      texture,
      lease: null,
      ownership,
      restore: options.restore ?? null,
    });
    this.#refreshStats();
    this.#notify("bindingsChanged");
  }

  texture(descriptor: RuntimeTextureV1): Laya.Texture2D {
    this.#assertLive("layaResolveTexture");
    const binding = this.#bindings.get(textureKeyV1(descriptor));
    if (binding === undefined) throw missingTextureV1(descriptor.imageId, descriptor.kind === "direct" ? "path" : "pagePath");
    return currentTextureV1(binding);
  }

  async unload(descriptor?: RuntimeTextureV1): Promise<void> {
    return this.#enqueue(async () => {
      this.#assertLive("layaUnloadTexture");
      const bindings: TextureBindingV1[] = [];
      if (descriptor === undefined) {
        for (const binding of this.#bindings.values()) bindings.push(binding);
        this.#bindings.clear();
      } else {
        const key = textureKeyV1(descriptor);
        const binding = this.#bindings.get(key);
        if (binding !== undefined) {
          this.#bindings.delete(key);
          bindings.push(binding);
        }
      }
      await this.#releaseBindings(bindings);
      this.#notify("bindingsChanged");
    });
  }

  handleContextLost(): void {
    if (this.#destroyed) return;
    this.#stats.contextLosses += 1;
    this.#notify("contextLost");
  }

  async handleContextRestored(): Promise<void> {
    this.#assertLive("layaRestoreContext");
    if (this.#restorePromise !== null) return this.#restorePromise;
    const restore = this.#enqueue(async () => {
      this.#assertLive("layaRestoreContext");
      this.#stats.contextRestores += 1;
      try {
        assertCaneLayaContextRecoveryReadyV1("layaRestoreContext", this.#lostWebGpuEngine);
      } catch (error) {
        this.#stats.restoreFailures += 1;
        throw error;
      }
      await this.#restoreAll();
      this.#lostWebGpuEngine = null;
    });
    this.#restorePromise = restore;
    try {
      await restore;
    } finally {
      if (this.#restorePromise === restore) this.#restorePromise = null;
    }
  }

  bindRendererLifecycle(target?: EventTarget): () => void {
    this.#assertLive("layaBindContextLifecycle");
    const backend = detectCaneLayaBackendV1();
    if (backend === "webgpu") {
      const unbind = bindCaneLayaWebGpuDeviceLossV1((loss) => {
        this.#handleWebGpuDeviceLost(loss);
      });
      let active = true;
      const trackedUnbind = (): void => {
        if (!active) return;
        active = false;
        unbind();
        this.#contextUnsubscribers.delete(trackedUnbind);
      };
      this.#contextUnsubscribers.add(trackedUnbind);
      return trackedUnbind;
    }
    if (target === undefined || target === null || typeof target.addEventListener !== "function") {
      throw new CaneLayaErrorV1("invalidArgument", "target must be an EventTarget.", {
        operation: "layaBindContextLifecycle",
        field: "target",
      });
    }
    const lost = (event: Event): void => {
      event.preventDefault();
      this.handleContextLost();
    };
    const restored = (): void => {
      void this.handleContextRestored().catch((error: unknown) => {
        console.error("Cane LayaAir texture restoration failed.", error);
      });
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

  /** @deprecated Use `bindRendererLifecycle`; retained for API compatibility. */
  bindContextLifecycle(target: EventTarget): () => void {
    return this.bindRendererLifecycle(target);
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    return this.#enqueue(async () => {
      if (this.#destroyed) return;
      for (const unsubscribe of [...this.#contextUnsubscribers]) unsubscribe();
      const bindings = [...this.#bindings.values()];
      this.#bindings.clear();
      this.#destroyed = true;
      this.#listeners.clear();
      await this.#releaseBindings(bindings);
    });
  }

  async #preloadRequests(requests: ReadonlyMap<string, TextureLoadRequestV1>): Promise<string[]> {
    const pending: TextureLoadRequestV1[] = [];
    for (const request of requests.values()) {
      if (this.#bindings.has(request.key)) this.#stats.sharedCacheHits += 1;
      else pending.push(request);
    }
    const settled = await Promise.allSettled(pending.map((request) => this.#acquire(request)));
    const acquired: TextureBindingV1[] = [];
    let failure: unknown = null;
    for (const result of settled) {
      if (result.status === "fulfilled") acquired.push(result.value);
      else if (failure === null) failure = result.reason;
    }
    if (failure !== null || this.#destroyed) {
      await Promise.allSettled(acquired.map((binding) => releaseSharedLeaseV1(binding.lease)));
      if (this.#destroyed) {
        throw new CaneLayaErrorV1("invalidState", "Texture store was destroyed while loading.", {
          operation: "layaPreloadTextures",
        });
      }
      throw failure;
    }
    for (const binding of acquired) this.#bindings.set(binding.key, binding);
    this.#refreshStats();
    if (acquired.length > 0) this.#notify("bindingsChanged");
    return acquired.map((binding) => binding.key);
  }

  async #acquire(request: TextureLoadRequestV1): Promise<TextureBindingV1> {
    this.#stats.loadsStarted += 1;
    try {
      const { lease, shared } = acquireSharedLeaseV1(this.#resolver, this.#decoder, request);
      if (shared) this.#stats.sharedCacheHits += 1;
      const texture = await lease.promise;
      return {
        key: request.key,
        descriptor: request.descriptor,
        lease,
        texture,
        ownership: "external",
        restore: null,
      };
    } catch (error) {
      this.#stats.loadFailures += 1;
      if (error instanceof CaneLayaErrorV1) throw error;
      throw new CaneLayaErrorV1("missingResource", `Failed to load texture '${request.url}'.`, {
        operation: "layaPreloadTextures",
        field: request.field,
        entityId: request.entityId,
        url: request.url,
        cause: error,
      });
    }
  }

  async #restoreAll(): Promise<void> {
    const uniqueLeases = new Set<SharedTextureLeaseV1>();
    const registered: TextureBindingV1[] = [];
    for (const binding of this.#bindings.values()) {
      if (binding.lease === null) registered.push(binding);
      else uniqueLeases.add(binding.lease);
    }
    const results = await Promise.allSettled([
      ...[...uniqueLeases].map(restoreSharedLeaseV1),
      ...registered.map(async (binding) => {
        if (binding.restore === null) {
          throw new CaneLayaErrorV1(
            "contextRestoreFailed",
            "Externally registered texture has no restore callback.",
            { operation: "layaRestoreContext", entityId: binding.descriptor.imageId },
          );
        }
        const replacement = await binding.restore();
        validateTextureV1(binding.descriptor, replacement, {}, "layaRestoreContext");
        const previous = binding.texture;
        binding.texture = replacement;
        if (binding.ownership === "store" && previous !== replacement && !previous.destroyed) previous.destroy();
        return replacement;
      }),
    ]);
    let firstFailure: unknown = null;
    for (const result of results) {
      if (result.status === "fulfilled") this.#stats.restoredTextures += 1;
      else {
        this.#stats.restoreFailures += 1;
        firstFailure ??= result.reason;
      }
    }
    if (firstFailure !== null) {
      throw new CaneLayaErrorV1("contextRestoreFailed", "One or more Cane textures could not be restored.", {
        operation: "layaRestoreContext",
        cause: firstFailure,
      });
    }
    // Mesh2D vertex/index buffers are GPU resources too. Consumers use this
    // distinct signal to rebuild retained buffers from the current Core frame.
    this.#notify("contextRestored");
  }

  async #rollback(keys: readonly string[]): Promise<void> {
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
    const owned = new Set<Laya.Texture2D>();
    const releases: Promise<void>[] = [];
    for (const binding of bindings) {
      if (binding.lease !== null) releases.push(releaseSharedLeaseV1(binding.lease));
      else if (binding.ownership === "store") owned.add(binding.texture);
    }
    for (const binding of this.#bindings.values()) owned.delete(currentTextureV1(binding));
    for (const texture of owned) if (!texture.destroyed) texture.destroy();
    const settled = await Promise.allSettled(releases);
    this.#stats.unloads += bindings.length;
    this.#refreshStats();
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure !== undefined) {
      throw new CaneLayaErrorV1("invalidState", "Failed to release a shared Laya texture.", {
        operation: "layaUnloadTexture",
        cause: failure.reason,
      });
    }
  }

  #notify(change: CaneLayaTextureStoreChangeV1): void {
    for (const listener of this.#listeners) listener(change);
  }

  #handleWebGpuDeviceLost(loss: CaneLayaWebGpuDeviceLossV1): void {
    if (this.#destroyed) return;
    this.#lostWebGpuEngine = loss.engine;
    this.handleContextLost();
  }

  #refreshStats(): void {
    let shared = 0;
    let registered = 0;
    for (const binding of this.#bindings.values()) {
      if (binding.lease === null) registered += 1;
      else shared += 1;
    }
    this.#stats.bindings = this.#bindings.size;
    this.#stats.sharedBindings = shared;
    this.#stats.registeredBindings = registered;
  }

  #assertLive(operation: string): void {
    if (this.#destroyed) {
      throw new CaneLayaErrorV1("invalidState", "Texture store has been destroyed.", { operation });
    }
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

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
    if (atlas === null) throw missingTextureV1(image.atlasId, "atlasId");
    const region = atlas.regions.find((candidate) => candidate.imageId === image.imageId);
    if (region === undefined) throw missingTextureV1(image.imageId, "region");
    const page = atlas.pages.find((candidate) => candidate.pageId === region.pageId);
    if (page === undefined) throw missingTextureV1(region.pageId, "page");
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

function acquireSharedLeaseV1(
  resolver: CaneLayaResourceResolverV1,
  decoder: CaneLayaTextureDecoderV1,
  request: TextureLoadRequestV1,
): { readonly lease: SharedTextureLeaseV1; readonly shared: boolean } {
  const owner = resolver as object;
  const decoderOwner = decoder as object;
  let resolverRegistry = SHARED_TEXTURES_V1.get(owner);
  if (resolverRegistry === undefined) {
    resolverRegistry = new WeakMap();
    SHARED_TEXTURES_V1.set(owner, resolverRegistry);
  }
  let registry = resolverRegistry.get(decoderOwner);
  if (registry === undefined) {
    registry = new Map();
    resolverRegistry.set(decoderOwner, registry);
  }
  const cacheKey = `${request.key}|${request.url}|${request.colorSpace}|${request.alphaMode}`
    + `|${request.minFilter}:${request.magFilter}:${request.wrapU}:${request.wrapV}`;
  let lease = registry.get(cacheKey);
  const shared = lease !== undefined;
  if (lease === undefined) {
    lease = {
      cacheKey,
      owner,
      resolver,
      decoder,
      request,
      promise: Promise.resolve(null as unknown as Laya.Texture2D),
      texture: null,
      restorePromise: null,
      refs: 0,
    };
    lease.promise = loadSharedTextureV1(lease);
    registry.set(cacheKey, lease);
  }
  lease.refs += 1;
  void lease.promise.catch(() => {
    lease!.refs -= 1;
    if (lease!.refs === 0 && registry!.get(cacheKey) === lease) registry!.delete(cacheKey);
  });
  return { lease, shared };
}

async function loadSharedTextureV1(lease: SharedTextureLeaseV1): Promise<Laya.Texture2D> {
  const payload = await lease.resolver.resolve({
    url: lease.request.url,
    kind: "texture",
    responseType: "arrayBuffer",
  });
  if (!(payload instanceof ArrayBuffer)) {
    throw new CaneLayaErrorV1("decodeFailed", "Texture resolver must return an ArrayBuffer.", {
      operation: "layaPreloadTextures",
      field: lease.request.field,
      entityId: lease.request.entityId,
      url: lease.request.url,
      actual: typeof payload,
    });
  }
  const texture = await lease.decoder.decode({ ...lease.request, bytes: payload });
  validateDecodedTextureV1(texture, lease.request);
  lease.texture = texture;
  return texture;
}

async function restoreSharedLeaseV1(lease: SharedTextureLeaseV1): Promise<Laya.Texture2D> {
  if (lease.restorePromise !== null) return lease.restorePromise;
  const restore = (async (): Promise<Laya.Texture2D> => {
    const previous = await lease.promise;
    const replacement = await loadSharedTextureV1(lease);
    lease.promise = Promise.resolve(replacement);
    if (previous !== replacement && !previous.destroyed) previous.destroy();
    return replacement;
  })();
  lease.restorePromise = restore;
  try {
    return await restore;
  } finally {
    if (lease.restorePromise === restore) lease.restorePromise = null;
  }
}

async function releaseSharedLeaseV1(lease: SharedTextureLeaseV1 | null): Promise<void> {
  if (lease === null || lease.refs <= 0) return;
  const registry = SHARED_TEXTURES_V1.get(lease.owner)?.get(lease.decoder as object);
  if (registry?.get(lease.cacheKey) !== lease) return;
  lease.refs -= 1;
  if (lease.refs > 0) return;
  registry.delete(lease.cacheKey);
  const texture = await lease.promise.catch(() => null);
  if (texture !== null && !texture.destroyed) texture.destroy();
}

function currentTextureV1(binding: TextureBindingV1): Laya.Texture2D {
  return binding.lease?.texture ?? binding.texture;
}

function textureLoadRequestsV1(
  resources: ReadonlyMap<string, RuntimeTextureV1>,
  styles: ReadonlyMap<string, TextureStyleV1> | null,
  baseUrl: string,
  atlasBaseUrls: ReadonlyMap<string, string>,
): Map<string, TextureLoadRequestV1> {
  const requests = new Map<string, TextureLoadRequestV1>();
  for (const [key, descriptor] of resources) {
    const style = styles?.get(key) ?? DEFAULT_STYLE_V1;
    requests.set(key, {
      key,
      descriptor,
      url: resolveAssetUrlV1(
        descriptor.kind === "atlas" ? atlasBaseUrls.get(descriptor.atlasId) ?? baseUrl : baseUrl,
        texturePathV1(descriptor),
      ),
      colorSpace: descriptor.colorSpace,
      alphaMode: descriptor.alphaMode,
      ...style,
      field: descriptor.kind === "direct" ? "path" : "pagePath",
      entityId: descriptor.imageId,
    });
  }
  return requests;
}

const DEFAULT_STYLE_V1: TextureStyleV1 = Object.freeze({
  minFilter: "linear",
  magFilter: "linear",
  wrapU: "clamp",
  wrapV: "clamp",
});

function runtimeTextureLoadStylesV1(data: RuntimeDataV1): Map<string, TextureStyleV1> {
  const styles = new Map<string, TextureStyleV1>();
  for (const atlas of data.atlases) {
    for (const page of atlas.pages) {
      styles.set(atlasPageTextureKeyV1(atlas.atlasId, page.pageId, page.image), {
        minFilter: page.minFilter === "nearest" ? "nearest" : "linear",
        magFilter: page.magFilter === "nearest" ? "nearest" : "linear",
        wrapU: normalizeWrapV1(page.wrapU),
        wrapV: normalizeWrapV1(page.wrapV),
      });
    }
  }
  return styles;
}

function validateDecodedTextureV1(texture: Laya.Texture2D, request: TextureLoadRequestV1): void {
  if (!(texture instanceof Laya.Texture2D) || texture.destroyed
    || !Number.isFinite(texture.width) || texture.width <= 0
    || !Number.isFinite(texture.height) || texture.height <= 0) {
    throw new CaneLayaErrorV1("decodeFailed", "Decoder returned an invalid Laya.Texture2D.", {
      operation: "layaDecodeTexture",
      field: request.field,
      entityId: request.entityId,
      url: request.url,
    });
  }
  if (texture.gammaSpace) {
    throw new CaneLayaErrorV1(
      "decodeFailed",
      "Texture must use raw GPU storage; Cane applies color-space conversion in its shader.",
      { operation: "layaDecodeTexture", field: "texture.gammaSpace", entityId: request.entityId },
    );
  }
}

function validateTextureV1(
  descriptor: RuntimeTextureV1,
  texture: Laya.Texture2D,
  options: LayaTextureRegistrationOptionsV1,
  operation: string,
): void {
  const request: TextureLoadRequestV1 = {
    key: textureKeyV1(descriptor),
    descriptor,
    url: texturePathV1(descriptor),
    colorSpace: descriptor.colorSpace,
    alphaMode: descriptor.alphaMode,
    ...DEFAULT_STYLE_V1,
    field: descriptor.kind === "direct" ? "path" : "pagePath",
    entityId: descriptor.imageId,
  };
  validateDecodedTextureV1(texture, request);
  if ((options.sourceColorSpace ?? "raw") !== "raw"
    || (options.sourceAlphaMode ?? descriptor.alphaMode) !== descriptor.alphaMode) {
    throw new CaneLayaErrorV1("invalidArgument", "Registered texture metadata differs from Core.", {
      operation,
      field: "textureMetadata",
      entityId: descriptor.imageId,
    });
  }
}

function atlasPageTextureKeyV1(atlasId: string, pageId: string, pagePath: string): string {
  return `atlas:${atlasId}:${pageId}:${pagePath}`;
}

function normalizeWrapV1(value: string): TextureStyleV1["wrapU"] {
  if (value === "repeat") return "repeat";
  if (value === "mirror") return "mirror";
  return "clamp";
}

function wrapModeV1(value: TextureStyleV1["wrapU"]): Laya.WrapMode {
  if (value === "repeat") return Laya.WrapMode.Repeat;
  if (value === "mirror") return Laya.WrapMode.Mirrored;
  return Laya.WrapMode.Clamp;
}

function missingTextureV1(entityId: string, field: string): CaneLayaErrorV1 {
  return new CaneLayaErrorV1("missingResource", "Cane texture is not loaded.", {
    operation: "layaResolveTexture",
    field,
    entityId,
  });
}

function resourceErrorV1(
  code: "missingResource" | "decodeFailed",
  message: string,
  request: CaneLayaResourceRequestV1,
  cause?: unknown,
): CaneLayaErrorV1 {
  return new CaneLayaErrorV1(code, message, {
    operation: `layaLoad${request.kind[0]?.toUpperCase() ?? ""}${request.kind.slice(1)}`,
    field: request.kind,
    url: request.url,
    ...(cause === undefined ? {} : { cause }),
  });
}
