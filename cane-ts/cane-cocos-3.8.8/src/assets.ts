import {
  Asset,
  BufferAsset,
  CCString,
  EffectAsset,
  JsonAsset,
  Layers,
  Node,
  Texture2D,
  _decorator,
} from "cc";
import {
  RuntimeDataV1,
  decodeCanebV1,
  type AtlasDocumentV1,
  type RuntimeLoadOptionsV1,
  type RuntimeTextureV1,
} from "@cane-runtime/core";
import { CaneCocosErrorV1 } from "./errors.js";
import {
  CocosTextureStore,
  defaultCaneCocosResourceResolverV1,
  defaultCaneCocosTextureDecoderV1,
  runtimeTextureDescriptorsV1,
  type CaneCocosResourceResolverV1,
  type CaneCocosTextureDecoderV1,
} from "./texture-store.js";
import { textureKeyV1 } from "./geometry.js";
import type { CaneSkeleton } from "./skeleton.js";
import { readCaneAssetNativeDataV1 } from "./internal-bridge.js";

const { ccclass, property } = _decorator;

export interface CaneCocosAssetLoadOptionsV1 {
  /** Inline Atlas documents or URLs relative to the Runtime asset. */
  readonly atlases?: readonly (AtlasDocumentV1 | string)[];
  readonly textureBaseUrl?: string;
  readonly preloadTextures?: boolean;
  readonly runtime?: Omit<RuntimeLoadOptionsV1, "atlases">;
  readonly resolver?: CaneCocosResourceResolverV1;
  readonly textureDecoder?: CaneCocosTextureDecoderV1;
  readonly contextTarget?: EventTarget;
}

interface SharedAtlasLeaseV1 {
  readonly resolver: CaneCocosResourceResolverV1;
  readonly url: string;
  readonly promise: Promise<AtlasDocumentV1>;
  refs: number;
}

const SHARED_ATLASES_V1 = new WeakMap<object, Map<string, SharedAtlasLeaseV1>>();

/** RuntimeData plus transactional texture and Atlas leases. */
export class CaneCocosAssetV1 {
  readonly data: RuntimeDataV1;
  readonly textures: CocosTextureStore;
  readonly sourceUrl: string;
  readonly atlasDependencyUrls: readonly string[];
  readonly #releaseAtlases: () => void;
  #destroyed = false;

  constructor(
    data: RuntimeDataV1,
    textures: CocosTextureStore,
    sourceUrl: string,
    atlasDependencyUrls: readonly string[],
    releaseAtlases: () => void,
  ) {
    this.data = data;
    this.textures = textures;
    this.sourceUrl = sourceUrl;
    this.atlasDependencyUrls = Object.freeze([...atlasDependencyUrls]);
    this.#releaseAtlases = releaseAtlases;
  }

  get destroyed(): boolean { return this.#destroyed; }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    let failure: unknown = null;
    try { await this.textures.destroy(); }
    catch (error) { failure = error; }
    finally { this.#releaseAtlases(); }
    if (failure !== null) {
      throw new CaneCocosErrorV1("invalidState", "Failed to release a Cane Cocos asset.", {
        operation: "cocosDestroyAsset",
        cause: failure,
      });
    }
  }
}

/**
 * Serializable Creator asset wrapper. The editor owns its Json/Buffer/Texture assets;
 * runtime instances lease them without changing project data.
 */
@ccclass("cane.CaneSkeletonDataAsset")
export class CaneSkeletonDataAsset extends Asset {
  // Embedded documents are plain serializable data. Creator's game packer
  // removes inline Asset objects that have no UUID, even though its Editor
  // loader accepts them. Keep legacy external JsonAsset references below.
  @property({ visible: false })
  private _runtimeDocument: unknown = null;

  @property({ visible: false })
  private _atlasDocuments: unknown[] = [];

  /** Assigned by the importer; retained by Creator's game dependency graph. */
  @property({ type: EffectAsset })
  colorEffectAsset: EffectAsset | null = null;

  @property({ type: JsonAsset })
  runtimeJson: JsonAsset | null = null;

  @property({ type: BufferAsset })
  runtimeBinary: BufferAsset | null = null;

  @property({ type: [JsonAsset] })
  atlasAssets: JsonAsset[] = [];

  /** Exact `RuntimeTextureV1` keys parallel to `textures`. */
  @property({ type: [CCString] })
  textureKeys: string[] = [];

  @property({ type: [Texture2D] })
  textures: Texture2D[] = [];

  #cachedData: RuntimeDataV1 | null = null;
  #cachedInput: unknown = null;
  #cachedAtlases: unknown[] = [];
  #cachedCompatibility = false;
  #cachedBinary = false;

  /** Shared immutable Core data. Each component still owns its own player. */
  getRuntimeData(options: Omit<RuntimeLoadOptionsV1, "atlases"> = {}): RuntimeDataV1 {
    // Imported CANEB uses Creator's ordinary native .bin dependency. Legacy
    // scene-authored BufferAsset references remain supported as well.
    const native: unknown = this.runtimeBinary !== null ? this.runtimeBinary.buffer() : readCaneAssetNativeDataV1(this);
    const binary = this.runtimeBinary !== null || native instanceof ArrayBuffer || ArrayBuffer.isView(native);
    const input = binary ? native : this._runtimeDocument ?? this.runtimeJson?.json;
    if (input === null || input === undefined) {
      throw new CaneCocosErrorV1("missingResource", "CaneSkeletonDataAsset has no Runtime JSON or CANEB.", {
        operation: "cocosInstantiateSkeletonData", field: "runtimeJson/runtimeBinary", entityId: this.uuid,
      });
    }
    const compatibility = options.allowUnverifiedFeatures === true;
    const importedAtlases = this._atlasDocuments;
    const atlasCount = importedAtlases.length || this.atlasAssets.length;
    if (this.#cachedData !== null && input === this.#cachedInput && binary === this.#cachedBinary && compatibility === this.#cachedCompatibility
      && atlasCount === this.#cachedAtlases.length
      && (importedAtlases.length
        ? importedAtlases.every((value, index) => value === this.#cachedAtlases[index])
        : this.atlasAssets.every((value, index) => value?.json === this.#cachedAtlases[index]))) return this.#cachedData;
    const atlases = importedAtlases.length ? importedAtlases as AtlasDocumentV1[] : this.atlasAssets.map((asset, index) => {
      if (asset?.json === null || asset?.json === undefined) {
        throw new CaneCocosErrorV1("decodeFailed", "Cane Atlas JsonAsset is empty.", {
          operation: "cocosInstantiateSkeletonData", field: `atlasAssets[${index}]`, entityId: this.uuid,
        });
      }
      return asset.json;
    });
    const data = binary
      ? RuntimeDataV1.fromCaneb(input as ArrayBuffer | ArrayBufferView, { ...options, atlases })
      : RuntimeDataV1.fromJson(input, { ...options, atlases });
    this.#cachedInput = input;
    this.#cachedAtlases = atlases;
    this.#cachedCompatibility = compatibility;
    this.#cachedBinary = binary;
    this.#cachedData = data;
    return data;
  }

  /** Legacy Asset node factory, sharing the current Creator instantiation path. */
  createNode(callback: (error: Error | null, node: Node) => void): void {
    let node: Node;
    try { node = this.#createSceneNode(); }
    catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)), null as unknown as Node);
      return;
    }
    callback(null, node);
  }

  /** Creator 3.8.8's asset drop path uses cc.instantiate for custom assets. */
  protected _instantiate(): Node { return this.#createSceneNode(); }

  #createSceneNode(): Node {
    const node = new Node(this.name || "Cane skeleton");
    try {
      node.layer = Layers.Enum.UI_2D;
      const skeleton = node.addComponent("cane.CaneSkeleton") as CaneSkeleton | null;
      if (skeleton === null) throw new Error("CaneSkeleton component is not registered; install the Cane Runtime extension.");
      skeleton.colorEffectAsset = this.colorEffectAsset;
      skeleton.skeletonData = this;
    } catch (error) {
      node.destroy();
      throw error;
    }
    return node;
  }

  async instantiate(options: Omit<CaneCocosAssetLoadOptionsV1, "atlases"> = {}): Promise<CaneCocosAssetV1> {
    // Allow the caller to attach its rejection handler before validation.
    // Creator's native 3.8.8 Promise bookkeeping asserts when a synchronously
    // rejected Promise gains a handler immediately after its creation.
    await Promise.resolve();
    const data = this.getRuntimeData(options.runtime);
    const asset = new CaneCocosAssetV1(data, new CocosTextureStore({
      baseUrl: options.textureBaseUrl ?? sourceDirectoryV1(this.nativeUrl),
      resolver: options.resolver ?? defaultCaneCocosResourceResolverV1,
      decoder: options.textureDecoder ?? defaultCaneCocosTextureDecoderV1,
      ...(options.contextTarget === undefined ? {} : { contextTarget: options.contextTarget }),
    }), this.nativeUrl, [], () => undefined);
    try {
      const descriptors = runtimeTextureDescriptorsV1(asset.data);
      const keyedTextures = new Map<string, Texture2D>();
      for (let index = 0; index < this.textures.length; index += 1) {
        const texture = this.textures[index];
        const key = this.textureKeys[index];
        if (texture !== undefined && key !== undefined && key.length > 0) keyedTextures.set(key, texture);
      }
      for (const descriptor of descriptors.values()) {
        const texture = keyedTextures.get(textureKeyV1(descriptor))
          ?? keyedTextures.get(descriptor.imageId);
        if (texture !== undefined && !asset.textures.has(descriptor)) {
          asset.textures.register(descriptor, texture, {
            ownership: "external",
            sourceColorSpace: descriptor.colorSpace,
            sourceAlphaMode: descriptor.alphaMode,
          });
        }
      }
      if (options.preloadTextures !== false) await asset.textures.preloadData(asset.data);
      return asset;
    } catch (error) {
      await asset.destroy().catch(() => undefined);
      throw error;
    }
  }
}

export async function loadCaneCocosAssetV1(
  sourceUrl: string,
  options: CaneCocosAssetLoadOptionsV1 = {},
): Promise<CaneCocosAssetV1> {
  requireUrlV1(sourceUrl, "cocosLoadAsset");
  const resolver = options.resolver ?? defaultCaneCocosResourceResolverV1;
  const responseType = isCanebUrlV1(sourceUrl) ? "arrayBuffer" : "json";
  let payload: ArrayBuffer | unknown;
  try {
    payload = await resolver.resolve({ url: sourceUrl, kind: "runtime", responseType });
  } catch (error) {
    if (error instanceof CaneCocosErrorV1) throw error;
    throw new CaneCocosErrorV1("missingResource", `Failed to load Cane Runtime asset '${sourceUrl}'.`, {
      operation: "cocosLoadAsset",
      field: "runtime",
      url: sourceUrl,
      cause: error,
    });
  }
  if (responseType === "arrayBuffer") {
    if (!(payload instanceof ArrayBuffer)) {
      throw new CaneCocosErrorV1("decodeFailed", "CANEB resolver result must be an ArrayBuffer.", {
        operation: "cocosLoadAsset",
        field: "runtime",
        url: sourceUrl,
      });
    }
    return createAssetV1(null, payload, options, sourceUrl, resolver);
  }
  return createAssetV1(payload, null, options, sourceUrl, resolver);
}

export async function createCaneCocosAssetFromJsonV1(
  document: unknown,
  options: CaneCocosAssetLoadOptionsV1 = {},
  sourceUrl = "",
): Promise<CaneCocosAssetV1> {
  return createAssetV1(
    document,
    null,
    options,
    sourceUrl,
    options.resolver ?? defaultCaneCocosResourceResolverV1,
  );
}

export async function createCaneCocosAssetFromCanebV1(
  bytes: ArrayBuffer,
  options: CaneCocosAssetLoadOptionsV1 = {},
  sourceUrl = "",
): Promise<CaneCocosAssetV1> {
  if (!(bytes instanceof ArrayBuffer)) {
    throw new CaneCocosErrorV1("invalidArgument", "bytes must be an ArrayBuffer.", {
      operation: "cocosCreateAssetFromCaneb",
      field: "bytes",
    });
  }
  return createAssetV1(
    null,
    bytes,
    options,
    sourceUrl,
    options.resolver ?? defaultCaneCocosResourceResolverV1,
  );
}

async function createAssetV1(
  document: unknown | null,
  caneb: ArrayBuffer | null,
  options: CaneCocosAssetLoadOptionsV1,
  sourceUrl: string,
  resolver: CaneCocosResourceResolverV1,
): Promise<CaneCocosAssetV1> {
  let decodedDocument = document;
  if (caneb !== null) {
    try { decodedDocument = decodeCanebV1(caneb).document; }
    catch (error) {
      throw new CaneCocosErrorV1("decodeFailed", "CANEB could not be decoded.", {
        operation: "cocosCreateAsset",
        field: "caneb",
        url: sourceUrl,
        cause: error,
      });
    }
  }
  const atlasInputs = options.atlases ?? automaticAtlasReferencesV1(decodedDocument);
  const atlases = await loadAtlasesV1(atlasInputs, sourceUrl, resolver);
  const textures = new CocosTextureStore({
    baseUrl: options.textureBaseUrl ?? sourceDirectoryV1(sourceUrl),
    ...(options.textureBaseUrl === undefined ? { atlasBaseUrls: atlases.baseUrls } : {}),
    resolver,
    decoder: options.textureDecoder ?? defaultCaneCocosTextureDecoderV1,
    ...(options.contextTarget === undefined ? {} : { contextTarget: options.contextTarget }),
  });
  try {
    const runtimeOptions: RuntimeLoadOptionsV1 = { ...(options.runtime ?? {}), atlases: atlases.documents };
    const data = caneb === null
      ? RuntimeDataV1.fromJson(decodedDocument, runtimeOptions)
      : RuntimeDataV1.fromCaneb(caneb, runtimeOptions);
    if (options.preloadTextures !== false) await textures.preloadData(data);
    return new CaneCocosAssetV1(data, textures, sourceUrl, atlases.urls, atlases.release);
  } catch (error) {
    await textures.destroy().catch(() => undefined);
    atlases.release();
    throw error;
  }
}

async function loadAtlasesV1(
  inputs: readonly (AtlasDocumentV1 | string)[],
  sourceUrl: string,
  resolver: CaneCocosResourceResolverV1,
): Promise<{
  readonly documents: AtlasDocumentV1[];
  readonly urls: string[];
  readonly release: () => void;
  readonly baseUrls: ReadonlyMap<string, string>;
}> {
  const documents: AtlasDocumentV1[] = [];
  const urls: string[] = [];
  const leases: SharedAtlasLeaseV1[] = [];
  const leaseUrls: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    if (typeof input === "string") {
      const url = resolveSiblingAssetUrlV1(sourceUrl, input);
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      leases.push(acquireAtlasV1(resolver, url));
      leaseUrls.push(url);
    } else if (input !== null && typeof input === "object") {
      documents.push(input);
    } else {
      throw new CaneCocosErrorV1("invalidArgument", "Atlas input must be a URL or document.", {
        operation: "cocosLoadAtlases",
        field: "atlases",
      });
    }
  }
  const settled = await Promise.allSettled(leases.map((lease) => lease.promise));
  let failure: unknown = null;
  const baseUrls = new Map<string, string>();
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    if (result === undefined) continue;
    if (result.status === "fulfilled") {
      documents.push(result.value);
      const url = leaseUrls[index];
      if (url !== undefined) baseUrls.set(result.value.atlasId, sourceDirectoryV1(url));
    } else failure ??= result.reason;
  }
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    for (const lease of leases) releaseAtlasV1(lease);
  };
  if (failure !== null) {
    release();
    throw new CaneCocosErrorV1("missingResource", "One or more Cane Atlas documents failed to load.", {
      operation: "cocosLoadAtlases",
      field: "atlases",
      cause: failure,
    });
  }
  return { documents, urls, release, baseUrls };
}

function acquireAtlasV1(resolver: CaneCocosResourceResolverV1, url: string): SharedAtlasLeaseV1 {
  const owner = resolver as object;
  let registry = SHARED_ATLASES_V1.get(owner);
  if (registry === undefined) {
    registry = new Map();
    SHARED_ATLASES_V1.set(owner, registry);
  }
  let lease = registry.get(url);
  if (lease === undefined) {
    lease = {
      resolver,
      url,
      refs: 0,
      promise: resolver.resolve({ url, kind: "atlas", responseType: "json" })
        .then((value) => value as AtlasDocumentV1),
    };
    registry.set(url, lease);
  }
  lease.refs += 1;
  return lease;
}

function releaseAtlasV1(lease: SharedAtlasLeaseV1): void {
  if (lease.refs <= 0) return;
  lease.refs -= 1;
  if (lease.refs > 0) return;
  const registry = SHARED_ATLASES_V1.get(lease.resolver as object);
  if (registry?.get(lease.url) === lease) registry.delete(lease.url);
}

function automaticAtlasReferencesV1(document: unknown): string[] {
  if (document === null || typeof document !== "object" || Array.isArray(document)) return [];
  const references = (document as { readonly atlases?: unknown }).atlases;
  if (!Array.isArray(references)) return [];
  const output: string[] = [];
  for (const reference of references) {
    if (reference === null || typeof reference !== "object" || Array.isArray(reference)) continue;
    const path = (reference as { readonly path?: unknown }).path;
    if (typeof path === "string" && path.length > 0) output.push(path);
  }
  return output;
}

function isCanebUrlV1(url: string): boolean {
  return /\.caneb(?:[?#]|$)/iu.test(url);
}

function requireUrlV1(url: string, operation: string): void {
  if (typeof url !== "string" || url.length === 0 || url.includes("\0")) {
    throw new CaneCocosErrorV1("invalidArgument", "sourceUrl must be a non-empty NUL-free string.", {
      operation,
      field: "sourceUrl",
    });
  }
}

function sourceDirectoryV1(sourceUrl: string): string {
  if (sourceUrl.length === 0) return "";
  const query = sourceUrl.search(/[?#]/u);
  const clean = query < 0 ? sourceUrl : sourceUrl.slice(0, query);
  const slash = clean.lastIndexOf("/");
  return slash < 0 ? "" : clean.slice(0, slash + 1);
}

function resolveSiblingAssetUrlV1(sourceUrl: string, path: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(path)) return path;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(sourceUrl)) return new URL(path, sourceUrl).toString();
  return `${sourceDirectoryV1(sourceUrl)}${path}`;
}

void (null as RuntimeTextureV1 | null);
