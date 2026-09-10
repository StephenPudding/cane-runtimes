import {
  Asset,
  AssetManager,
  BufferAsset,
  ImageAsset,
  JsonAsset,
  TextAsset,
  Texture2D,
  assetManager,
} from "cc";
import type {
  RuntimeDataV1,
  RuntimeDecodedAtlasPageSizeV1,
  RuntimeDecodedImageSizeV1,
  RuntimeRenderPacketV1,
  RuntimeTextureV1,
} from "@cane-runtime/core";
import { CaneCocosErrorV1 } from "./errors.js";
import { resolveAssetUrlV1, textureKeyV1, texturePathV1 } from "./geometry.js";

export type CaneCocosResourceKindV1 = "runtime" | "atlas" | "texture";
export type CaneCocosTextureStoreChangeV1 = "bindingsChanged" | "contextLost" | "contextRestored";

export interface CaneCocosResourceRequestV1 {
  readonly url: string;
  readonly kind: CaneCocosResourceKindV1;
  readonly responseType: "arrayBuffer" | "json" | "image";
  readonly signal?: AbortSignal;
}

export interface CaneCocosResourceResolverV1 {
  resolve(request: CaneCocosResourceRequestV1): Promise<ArrayBuffer | CaneCocosResolvedAssetV1 | unknown>;
}

/** Optional ownership envelope used by engine-backed resolvers. */
export interface CaneCocosResolvedAssetV1 {
  readonly value: unknown;
  readonly release: () => void | Promise<void>;
}

export interface CaneCocosTextureDecodeRequestV1 {
  readonly descriptor: RuntimeTextureV1;
  readonly url: string;
  readonly payload: unknown;
  readonly colorSpace: RuntimeTextureV1["colorSpace"];
  readonly alphaMode: RuntimeTextureV1["alphaMode"];
  readonly minFilter: "nearest" | "linear";
  readonly magFilter: "nearest" | "linear";
  readonly wrapU: "clamp" | "repeat" | "mirror";
  readonly wrapV: "clamp" | "repeat" | "mirror";
}

export interface CaneCocosDecodedTextureV1 {
  readonly texture: Texture2D;
  /** Releases decoder-owned Texture/ImageAsset references. */
  readonly release: () => void | Promise<void>;
}

export interface CaneCocosTextureDecoderV1 {
  decode(request: CaneCocosTextureDecodeRequestV1): Promise<CaneCocosDecodedTextureV1>;
}

export interface CocosTextureStoreOptionsV1 {
  readonly baseUrl?: string;
  readonly atlasBaseUrls?: ReadonlyMap<string, string>;
  readonly resolver?: CaneCocosResourceResolverV1;
  readonly decoder?: CaneCocosTextureDecoderV1;
  readonly contextTarget?: EventTarget;
}

export interface CocosTextureRegistrationOptionsV1 {
  readonly ownership?: "external" | "store";
  readonly restore?: () => Promise<Texture2D>;
  readonly sourceColorSpace?: RuntimeTextureV1["colorSpace"];
  readonly sourceAlphaMode?: RuntimeTextureV1["alphaMode"];
}

export interface CocosTextureStoreStatsV1 {
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

interface TextureLoadRequestV1 extends TextureStyleV1 {
  readonly key: string;
  readonly descriptor: RuntimeTextureV1;
  readonly url: string;
  readonly field: string;
  readonly entityId: string;
}

interface SharedTextureLeaseV1 {
  readonly cacheKey: string;
  readonly resolverOwner: object;
  readonly decoderOwner: object;
  readonly resolver: CaneCocosResourceResolverV1;
  readonly decoder: CaneCocosTextureDecoderV1;
  readonly request: TextureLoadRequestV1;
  promise: Promise<CaneCocosDecodedTextureV1>;
  decoded: CaneCocosDecodedTextureV1 | null;
  restorePromise: Promise<CaneCocosDecodedTextureV1> | null;
  refs: number;
}

interface TextureBindingV1 {
  readonly key: string;
  readonly descriptor: RuntimeTextureV1;
  readonly lease: SharedTextureLeaseV1 | null;
  ownership: "external" | "store";
  texture: Texture2D;
  restore: (() => Promise<Texture2D>) | null;
}

type MutableTextureStoreStatsV1 = {
  -readonly [Field in keyof CocosTextureStoreStatsV1]: CocosTextureStoreStatsV1[Field]
};

const SHARED_TEXTURES_V1 = new WeakMap<
  object,
  WeakMap<object, Map<string, SharedTextureLeaseV1>>
>();

/** Resource resolver backed by Cocos AssetManager, including native and mini-game downloaders. */
export class CocosAssetManagerResourceResolverV1 implements CaneCocosResourceResolverV1 {
  async resolve(request: CaneCocosResourceRequestV1): Promise<ArrayBuffer | unknown> {
    if (isAbortedV1(request.signal)) throw abortErrorV1(request.url);
    const asset = await loadRemoteV1(request);
    if (isAbortedV1(request.signal)) {
      if (asset instanceof Asset) assetManager.releaseAsset(asset);
      throw abortErrorV1(request.url);
    }
    if (request.responseType === "image") {
      if (!(asset instanceof Asset)) return asset;
      return resolvedAssetV1(asset, () => assetManager.releaseAsset(asset));
    }
    try {
      if (asset instanceof JsonAsset) return asset.json;
      if (asset instanceof BufferAsset) return copyArrayBufferV1(asset.buffer());
      if (asset instanceof TextAsset) {
      if (request.responseType === "json") {
        try { return JSON.parse(asset.text) as unknown; }
        catch (error) {
          throw new CaneCocosErrorV1("decodeFailed", `Invalid JSON at '${request.url}'.`, {
            operation: "cocosResolveResource",
            field: request.kind,
            url: request.url,
            cause: error,
          });
        }
      }
      return new TextEncoder().encode(asset.text).buffer;
      }
      if (asset instanceof ArrayBuffer) return asset;
      if (ArrayBuffer.isView(asset)) {
        return asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength);
      }
      if (request.responseType === "json" && isRecordV1(asset)) return asset;
      throw new CaneCocosErrorV1("decodeFailed", `Cocos AssetManager returned an incompatible asset for '${request.url}'.`, {
        operation: "cocosResolveResource",
        field: request.kind,
        url: request.url,
        actual: asset?.constructor?.name ?? typeof asset,
      });
    } finally {
      if (asset instanceof Asset) assetManager.releaseAsset(asset);
    }
  }
}

/** Bundle resolver for project-local Creator assets; paths are supplied without file extensions. */
export class CocosBundleResourceResolverV1 implements CaneCocosResourceResolverV1 {
  readonly bundle: AssetManager.Bundle;
  readonly #pathMap: ReadonlyMap<string, string>;

  constructor(bundle: AssetManager.Bundle, pathMap: ReadonlyMap<string, string> = new Map()) {
    this.bundle = bundle;
    this.#pathMap = pathMap;
  }

  async resolve(request: CaneCocosResourceRequestV1): Promise<ArrayBuffer | unknown> {
    if (isAbortedV1(request.signal)) throw abortErrorV1(request.url);
    const path = this.#pathMap.get(request.url) ?? stripExtensionV1(request.url);
    const constructor = request.responseType === "image"
      ? ImageAsset
      : request.responseType === "json" ? JsonAsset : BufferAsset;
    const asset = await new Promise<Asset>((resolve, reject) => {
      const loader = this.bundle as unknown as {
        load(
          assetPath: string,
          assetType: typeof ImageAsset | typeof JsonAsset | typeof BufferAsset,
          callback: (error: Error | null, value: Asset | null) => void,
        ): void;
      };
      loader.load(path, constructor, (error, value) => {
        // Creator 3.8.8 uses both `null` and `undefined` for a successful
        // AssetManager callback despite the public declaration spelling null.
        if (error !== null && error !== undefined) reject(error);
        else if (value === null || value === undefined) reject(new Error(`Bundle asset '${path}' is empty.`));
        else resolve(value);
      });
    }).catch((error: unknown) => {
      throw new CaneCocosErrorV1("missingResource", `Cocos Bundle failed to load '${path}'.`, {
        operation: "cocosResolveBundleResource",
        field: request.kind,
        url: request.url,
        cause: error,
      });
    });
    if (isAbortedV1(request.signal)) {
      assetManager.releaseAsset(asset);
      throw abortErrorV1(request.url);
    }
    if (request.responseType === "image") {
      return resolvedAssetV1(asset, () => assetManager.releaseAsset(asset));
    }
    try {
      if (asset instanceof JsonAsset) return asset.json;
      if (asset instanceof BufferAsset) return copyArrayBufferV1(asset.buffer());
      throw new CaneCocosErrorV1("decodeFailed", `Bundle asset '${path}' has an incompatible type.`, {
        operation: "cocosResolveBundleResource",
        field: request.kind,
        url: request.url,
        actual: asset.constructor.name,
      });
    } finally {
      assetManager.releaseAsset(asset);
    }
  }
}

export class CocosTextureDecoderV1 implements CaneCocosTextureDecoderV1 {
  async decode(request: CaneCocosTextureDecodeRequestV1): Promise<CaneCocosDecodedTextureV1> {
    const payload = request.payload;
    let texture: Texture2D;
    let source: Asset | null = null;
    let ownsTexture = true;
    if (payload instanceof Texture2D) {
      texture = payload;
      texture.addRef();
      source = texture;
      ownsTexture = false;
    } else {
      let image: ImageAsset;
      if (payload instanceof ImageAsset) {
        image = payload;
        image.addRef();
        source = image;
      } else if (payload instanceof ArrayBuffer) {
        image = await imageAssetFromBytesV1(payload, request.url);
        source = image;
      } else {
        throw new CaneCocosErrorV1("decodeFailed", "Texture payload must be a Cocos ImageAsset, Texture2D or ArrayBuffer.", {
          operation: "cocosDecodeTexture",
          field: "payload",
          entityId: request.descriptor.imageId,
          url: request.url,
          actual: payload?.constructor?.name ?? typeof payload,
        });
      }
      texture = new Texture2D(`Cane:${request.descriptor.imageId}`);
      texture.image = image;
    }
    applyTextureStyleV1(texture, request);
    let released = false;
    return {
      texture,
      release: (): void => {
        if (released) return;
        released = true;
        if (ownsTexture && texture.isValid) texture.destroy();
        if (source !== null && source.isValid) source.decRef(true);
      },
    };
  }
}

function resolvedAssetV1(value: unknown, release: () => void | Promise<void>): CaneCocosResolvedAssetV1 {
  let active = true;
  return {
    value,
    release: (): void | Promise<void> => {
      if (!active) return;
      active = false;
      return release();
    },
  };
}

function isResolvedAssetV1(value: unknown): value is CaneCocosResolvedAssetV1 {
  return isRecordV1(value) && "value" in value && typeof value.release === "function";
}

function copyArrayBufferV1(value: ArrayBuffer): ArrayBuffer {
  return value.slice(0);
}

export const defaultCaneCocosResourceResolverV1 = new CocosAssetManagerResourceResolverV1();
export const defaultCaneCocosTextureDecoderV1 = new CocosTextureDecoderV1();

/** Transactional, reference-counted Cocos Texture2D store. */
export class CocosTextureStore {
  readonly #baseUrl: string;
  readonly #atlasBaseUrls: ReadonlyMap<string, string>;
  readonly #resolver: CaneCocosResourceResolverV1;
  readonly #decoder: CaneCocosTextureDecoderV1;
  readonly #bindings = new Map<string, TextureBindingV1>();
  readonly #listeners = new Set<(change: CaneCocosTextureStoreChangeV1) => void>();
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
  #operationTail: Promise<void> = Promise.resolve();
  #restorePromise: Promise<void> | null = null;

  constructor(options: CocosTextureStoreOptionsV1 = {}) {
    this.#baseUrl = options.baseUrl ?? "";
    this.#atlasBaseUrls = options.atlasBaseUrls ?? new Map();
    this.#resolver = options.resolver ?? defaultCaneCocosResourceResolverV1;
    this.#decoder = options.decoder ?? defaultCaneCocosTextureDecoderV1;
    if (options.contextTarget !== undefined) this.bindRendererLifecycle(options.contextTarget);
  }

  get destroyed(): boolean { return this.#destroyed; }
  get stats(): CocosTextureStoreStatsV1 { return this.#stats; }

  has(descriptor: RuntimeTextureV1): boolean {
    return this.#bindings.has(textureKeyV1(descriptor));
  }

  onTexturesChanged(listener: (change: CaneCocosTextureStoreChangeV1) => void): () => void {
    this.#assertLive("cocosObserveTextures");
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  async preload(packet: RuntimeRenderPacketV1): Promise<void> {
    const resources = new Map<string, RuntimeTextureV1>();
    for (const attachment of packet.attachments) {
      resources.set(textureKeyV1(attachment.texture), attachment.texture);
    }
    await this.#enqueue(async () => {
      this.#assertLive("cocosPreloadTextures");
      await this.#preloadRequests(textureLoadRequestsV1(resources, null, this.#baseUrl, this.#atlasBaseUrls));
    });
  }

  async preloadData(data: RuntimeDataV1): Promise<void> {
    const resources = runtimeTextureDescriptorsV1(data);
    const styles = runtimeTextureLoadStylesV1(data);
    await this.#enqueue(async () => {
      this.#assertLive("cocosPreloadTextures");
      const acquiredKeys = await this.#preloadRequests(
        textureLoadRequestsV1(resources, styles, this.#baseUrl, this.#atlasBaseUrls),
      );
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
            const key = atlasPageTextureKeyV1(atlas.atlasId, page.pageId, page.image);
            const binding = this.#bindings.get(key);
            if (binding === undefined) throw missingTextureV1(page.pageId, "pagePath");
            const texture = currentTextureV1(binding);
            atlasPages.push({
              atlasId: atlas.atlasId,
              pageId: page.pageId,
              width: texture.width,
              height: texture.height,
            });
          }
        }
        data.validateDecodedTextureSizes(directImages, atlasPages);
      } catch (error) {
        await this.#rollback(acquiredKeys);
        throw new CaneCocosErrorV1("dimensionMismatch", "Decoded Cane texture dimensions are invalid.", {
          operation: "cocosPreloadTextures",
          field: "textureDimensions",
          cause: error,
        });
      }
    });
  }

  register(
    descriptor: RuntimeTextureV1,
    texture: Texture2D,
    options: CocosTextureRegistrationOptionsV1 = {},
  ): void {
    this.#assertLive("cocosRegisterTexture");
    validateRegisteredTextureV1(descriptor, texture, options);
    const key = textureKeyV1(descriptor);
    const existing = this.#bindings.get(key);
    if (existing !== undefined) {
      if (currentTextureV1(existing) === texture) return;
      throw new CaneCocosErrorV1("invalidState", "A different texture is already registered.", {
        operation: "cocosRegisterTexture",
        entityId: descriptor.imageId,
      });
    }
    const ownership = options.ownership ?? "external";
    this.#bindings.set(key, {
      key,
      descriptor,
      lease: null,
      ownership,
      texture,
      restore: options.restore ?? null,
    });
    this.#refreshStats();
    this.#notify("bindingsChanged");
  }

  texture(descriptor: RuntimeTextureV1): Texture2D {
    this.#assertLive("cocosResolveTexture");
    const binding = this.#bindings.get(textureKeyV1(descriptor));
    if (binding === undefined) {
      throw missingTextureV1(descriptor.imageId, descriptor.kind === "direct" ? "path" : "pagePath");
    }
    const texture = currentTextureV1(binding);
    if (!texture.isValid) throw missingTextureV1(descriptor.imageId, "texture");
    return texture;
  }

  async unload(descriptor?: RuntimeTextureV1): Promise<void> {
    return this.#enqueue(async () => {
      this.#assertLive("cocosUnloadTexture");
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
      if (bindings.length > 0) this.#notify("bindingsChanged");
    });
  }

  handleContextLost(): void {
    if (this.#destroyed) return;
    this.#stats.contextLosses += 1;
    this.#notify("contextLost");
  }

  async handleContextRestored(): Promise<void> {
    this.#assertLive("cocosRestoreContext");
    if (this.#restorePromise !== null) return this.#restorePromise;
    const restore = this.#enqueue(async () => {
      this.#stats.contextRestores += 1;
      try {
        await this.#restoreAll();
        this.#notify("contextRestored");
      } catch (error) {
        this.#stats.restoreFailures += 1;
        throw new CaneCocosErrorV1("contextRestoreFailed", "One or more Cane textures could not be restored.", {
          operation: "cocosRestoreContext",
          cause: error,
        });
      }
    });
    this.#restorePromise = restore;
    try { await restore; }
    finally { if (this.#restorePromise === restore) this.#restorePromise = null; }
  }

  bindRendererLifecycle(target: EventTarget): () => void {
    this.#assertLive("cocosBindContextLifecycle");
    const lost = (event: Event): void => {
      event.preventDefault();
      this.handleContextLost();
    };
    const restored = (): void => {
      void this.handleContextRestored().catch((error: unknown) => {
        console.error("Cane Cocos texture restoration failed.", error);
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
      else failure ??= result.reason;
    }
    if (failure !== null || this.#destroyed) {
      await Promise.allSettled(acquired.map((binding) => releaseSharedLeaseV1(binding.lease)));
      if (this.#destroyed) {
        throw new CaneCocosErrorV1("invalidState", "Texture store was destroyed while loading.", {
          operation: "cocosPreloadTextures",
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
    let acquiredLease: SharedTextureLeaseV1 | null = null;
    try {
      const { lease, shared } = acquireSharedLeaseV1(this.#resolver, this.#decoder, request);
      acquiredLease = lease;
      if (shared) this.#stats.sharedCacheHits += 1;
      const decoded = await lease.promise;
      return {
        key: request.key,
        descriptor: request.descriptor,
        lease,
        ownership: "external",
        texture: decoded.texture,
        restore: null,
      };
    } catch (error) {
      // Failed acquisitions never become bindings, so release the reference
      // here instead of leaving a rejected shared promise pinned forever.
      await releaseSharedLeaseV1(acquiredLease).catch(() => undefined);
      this.#stats.loadFailures += 1;
      if (error instanceof CaneCocosErrorV1) throw error;
      throw new CaneCocosErrorV1("missingResource", `Failed to load texture '${request.url}'.`, {
        operation: "cocosPreloadTextures",
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
          if (binding.texture.isValid && binding.texture.getGFXTexture() !== null) return binding.texture;
          throw new CaneCocosErrorV1("contextRestoreFailed", "Registered texture has no restore callback.", {
            operation: "cocosRestoreContext",
            entityId: binding.descriptor.imageId,
          });
        }
        const replacement = await binding.restore();
        validateRegisteredTextureV1(binding.descriptor, replacement, {});
        const previous = binding.texture;
        binding.texture = replacement;
        if (binding.ownership === "store" && previous !== replacement && previous.isValid) previous.destroy();
        return replacement;
      }),
    ]);
    let firstFailure: unknown = null;
    for (const result of results) {
      if (result.status === "fulfilled") this.#stats.restoredTextures += 1;
      else firstFailure ??= result.reason;
    }
    if (firstFailure !== null) throw firstFailure;
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
    const owned = new Set<Texture2D>();
    const releases: Promise<void>[] = [];
    for (const binding of bindings) {
      if (binding.lease !== null) releases.push(releaseSharedLeaseV1(binding.lease));
      else if (binding.ownership === "store") owned.add(binding.texture);
    }
    for (const binding of this.#bindings.values()) owned.delete(currentTextureV1(binding));
    for (const texture of owned) if (texture.isValid) texture.destroy();
    const settled = await Promise.allSettled(releases);
    this.#stats.unloads += bindings.length;
    this.#refreshStats();
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure !== undefined) {
      throw new CaneCocosErrorV1("invalidState", "Failed to release a shared Cocos texture.", {
        operation: "cocosUnloadTexture",
        cause: failure.reason,
      });
    }
  }

  #notify(change: CaneCocosTextureStoreChangeV1): void {
    for (const listener of this.#listeners) listener(change);
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
      throw new CaneCocosErrorV1("invalidState", "Texture store has been destroyed.", { operation });
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
  resolver: CaneCocosResourceResolverV1,
  decoder: CaneCocosTextureDecoderV1,
  request: TextureLoadRequestV1,
): { readonly lease: SharedTextureLeaseV1; readonly shared: boolean } {
  const resolverOwner = resolver as object;
  const decoderOwner = decoder as object;
  let resolverRegistry = SHARED_TEXTURES_V1.get(resolverOwner);
  if (resolverRegistry === undefined) {
    resolverRegistry = new WeakMap();
    SHARED_TEXTURES_V1.set(resolverOwner, resolverRegistry);
  }
  let registry = resolverRegistry.get(decoderOwner);
  if (registry === undefined) {
    registry = new Map();
    resolverRegistry.set(decoderOwner, registry);
  }
  const cacheKey = `${request.key}|${request.url}|${request.descriptor.colorSpace}|${request.descriptor.alphaMode}`
    + `|${request.minFilter}:${request.magFilter}:${request.wrapU}:${request.wrapV}`;
  let lease = registry.get(cacheKey);
  const shared = lease !== undefined;
  if (lease === undefined) {
    lease = {
      cacheKey,
      resolverOwner,
      decoderOwner,
      resolver,
      decoder,
      request,
      promise: Promise.resolve(null as unknown as CaneCocosDecodedTextureV1),
      decoded: null,
      restorePromise: null,
      refs: 0,
    };
    lease.promise = loadSharedTextureV1(lease);
    registry.set(cacheKey, lease);
  }
  lease.refs += 1;
  return { lease, shared };
}

async function loadSharedTextureV1(lease: SharedTextureLeaseV1): Promise<CaneCocosDecodedTextureV1> {
  const payload = await lease.resolver.resolve({
    url: lease.request.url,
    kind: "texture",
    responseType: "image",
  });
  const envelope = isResolvedAssetV1(payload) ? payload : null;
  let decoded: CaneCocosDecodedTextureV1;
  try {
    decoded = await lease.decoder.decode({
      descriptor: lease.request.descriptor,
      url: lease.request.url,
      payload: envelope?.value ?? payload,
      colorSpace: lease.request.descriptor.colorSpace,
      alphaMode: lease.request.descriptor.alphaMode,
      minFilter: lease.request.minFilter,
      magFilter: lease.request.magFilter,
      wrapU: lease.request.wrapU,
      wrapV: lease.request.wrapV,
    });
  } catch (error) {
    try { await envelope?.release(); } catch { /* Preserve the decode failure. */ }
    throw error;
  }
  try {
    await envelope?.release();
    validateDecodedTextureV1(decoded.texture, lease.request);
  } catch (error) {
    try { await decoded.release(); } catch { /* Preserve the validation/release failure. */ }
    throw error;
  }
  lease.decoded = decoded;
  return decoded;
}

async function restoreSharedLeaseV1(lease: SharedTextureLeaseV1): Promise<CaneCocosDecodedTextureV1> {
  if (lease.restorePromise !== null) return lease.restorePromise;
  const restore = (async (): Promise<CaneCocosDecodedTextureV1> => {
    const previous = await lease.promise;
    const replacement = await loadSharedTextureV1(lease);
    lease.promise = Promise.resolve(replacement);
    if (previous !== replacement) await previous.release();
    return replacement;
  })();
  lease.restorePromise = restore;
  try { return await restore; }
  finally { if (lease.restorePromise === restore) lease.restorePromise = null; }
}

async function releaseSharedLeaseV1(lease: SharedTextureLeaseV1 | null): Promise<void> {
  if (lease === null || lease.refs <= 0) return;
  const registry = SHARED_TEXTURES_V1.get(lease.resolverOwner)?.get(lease.decoderOwner);
  if (registry?.get(lease.cacheKey) !== lease) return;
  lease.refs -= 1;
  if (lease.refs > 0) return;
  registry.delete(lease.cacheKey);
  const decoded = await lease.promise.catch(() => null);
  if (decoded !== null) await decoded.release();
}

function currentTextureV1(binding: TextureBindingV1): Texture2D {
  return binding.lease?.decoded?.texture ?? binding.texture;
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

function atlasPageTextureKeyV1(atlasId: string, pageId: string, pagePath: string): string {
  return `atlas:${atlasId}:${pageId}:${pagePath}`;
}

function normalizeWrapV1(value: string): TextureStyleV1["wrapU"] {
  if (value === "repeat") return "repeat";
  if (value === "mirror" || value === "mirroredRepeat") return "mirror";
  return "clamp";
}

function applyTextureStyleV1(texture: Texture2D, request: CaneCocosTextureDecodeRequestV1): void {
  texture.setFilters(
    request.minFilter === "nearest" ? Texture2D.Filter.NEAREST : Texture2D.Filter.LINEAR,
    request.magFilter === "nearest" ? Texture2D.Filter.NEAREST : Texture2D.Filter.LINEAR,
  );
  texture.setWrapMode(wrapModeV1(request.wrapU), wrapModeV1(request.wrapV));
}

function wrapModeV1(value: TextureStyleV1["wrapU"]): (typeof Texture2D.WrapMode)[keyof typeof Texture2D.WrapMode] {
  if (value === "repeat") return Texture2D.WrapMode.REPEAT;
  if (value === "mirror") return Texture2D.WrapMode.MIRRORED_REPEAT;
  return Texture2D.WrapMode.CLAMP_TO_EDGE;
}

function validateDecodedTextureV1(texture: Texture2D, request: TextureLoadRequestV1): void {
  if (!texture.isValid || texture.width <= 0 || texture.height <= 0) {
    throw new CaneCocosErrorV1("decodeFailed", "Decoded Cocos texture is invalid.", {
      operation: "cocosDecodeTexture",
      field: request.field,
      entityId: request.entityId,
      url: request.url,
    });
  }
}

function validateRegisteredTextureV1(
  descriptor: RuntimeTextureV1,
  texture: Texture2D,
  options: CocosTextureRegistrationOptionsV1,
): void {
  if (!(texture instanceof Texture2D) || !texture.isValid || texture.width <= 0 || texture.height <= 0) {
    throw new CaneCocosErrorV1("invalidArgument", "texture must be a valid decoded Cocos Texture2D.", {
      operation: "cocosRegisterTexture",
      field: "texture",
      entityId: descriptor.imageId,
    });
  }
  if (options.sourceColorSpace !== undefined && options.sourceColorSpace !== descriptor.colorSpace) {
    throw new CaneCocosErrorV1("invalidArgument", "Texture color-space metadata does not match Core.", {
      operation: "cocosRegisterTexture",
      field: "textureMetadata",
      expected: descriptor.colorSpace,
      actual: options.sourceColorSpace,
    });
  }
  if (options.sourceAlphaMode !== undefined && options.sourceAlphaMode !== descriptor.alphaMode) {
    throw new CaneCocosErrorV1("invalidArgument", "Texture alpha metadata does not match Core.", {
      operation: "cocosRegisterTexture",
      field: "textureMetadata",
      expected: descriptor.alphaMode,
      actual: options.sourceAlphaMode,
    });
  }
}

async function loadRemoteV1(request: CaneCocosResourceRequestV1): Promise<unknown> {
  const options = extensionOptionsV1(request.url, request.responseType);
  return new Promise<unknown>((resolve, reject) => {
    assetManager.loadRemote(request.url, options, (error, asset) => {
      if (error !== null && error !== undefined) reject(error);
      else if (asset === null || asset === undefined) reject(new Error(`Remote asset '${request.url}' is empty.`));
      else resolve(asset);
    });
  }).catch((error: unknown) => {
    throw new CaneCocosErrorV1("missingResource", `Cocos AssetManager failed to load '${request.url}'.`, {
      operation: "cocosResolveResource",
      field: request.kind,
      url: request.url,
      cause: error,
    });
  });
}

function extensionOptionsV1(url: string, type: CaneCocosResourceRequestV1["responseType"]): { ext?: string } | null {
  const clean = url.split(/[?#]/u, 1)[0] ?? url;
  if (/\.[a-z0-9]+$/iu.test(clean)) return null;
  if (type === "json") return { ext: ".json" };
  if (type === "arrayBuffer") return { ext: ".bin" };
  return { ext: ".png" };
}

async function imageAssetFromBytesV1(bytes: ArrayBuffer, url: string): Promise<ImageAsset> {
  if (typeof createImageBitmap !== "function") {
    throw new CaneCocosErrorV1("decodeFailed", "ArrayBuffer texture decoding requires createImageBitmap in this host.", {
      operation: "cocosDecodeTexture",
      field: "payload",
      url,
    });
  }
  const bitmap = await createImageBitmap(new Blob([bytes]));
  return new ImageAsset(bitmap);
}

function missingTextureV1(entityId: string, field: string): CaneCocosErrorV1 {
  return new CaneCocosErrorV1("missingResource", "Cane texture resource is unavailable.", {
    operation: "cocosResolveTexture",
    field,
    entityId,
  });
}

function abortErrorV1(url: string): CaneCocosErrorV1 {
  return new CaneCocosErrorV1("missingResource", `Loading '${url}' was aborted.`, {
    operation: "cocosResolveResource",
    url,
  });
}

function stripExtensionV1(path: string): string {
  const clean = path.replace(/[?#].*$/u, "");
  // Creator imports `character.caneb.bin` as the Bundle path `character.caneb`.
  // CANEB is the logical runtime format here, not the source-file extension
  // AssetManager removes when resolving a Bundle asset.
  if (/\.caneb$/iu.test(clean)) return clean;
  return clean.replace(/\.[^/.]+$/u, "");
}

function isRecordV1(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAbortedV1(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}
