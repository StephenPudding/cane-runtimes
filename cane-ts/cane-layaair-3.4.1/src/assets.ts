import {
  RuntimeDataV1,
  decodeCanebV1,
  type AtlasDocumentV1,
  type RuntimeLoadOptionsV1,
} from "@cane-runtime/core";
import { CaneLayaErrorV1 } from "./errors.js";
import {
  LayaTextureStore,
  defaultCaneLayaResourceResolverV1,
  defaultCaneLayaTextureDecoderV1,
  type CaneLayaResourceRequestV1,
  type CaneLayaResourceResolverV1,
  type CaneLayaTextureDecoderV1,
} from "./texture-store.js";

export interface CaneLayaAssetLoadOptionsV1 {
  /** Inline Atlas documents or URLs relative to the Runtime asset. */
  readonly atlases?: readonly (AtlasDocumentV1 | string)[];
  readonly textureBaseUrl?: string;
  readonly preloadTextures?: boolean;
  readonly runtime?: Omit<RuntimeLoadOptionsV1, "atlases">;
  readonly resolver?: CaneLayaResourceResolverV1;
  readonly textureDecoder?: CaneLayaTextureDecoderV1;
  /** WebGL canvas event target; also enables WebGPU GPUDevice.lost observation. */
  readonly contextTarget?: EventTarget;
}

interface SharedAtlasLeaseV1 {
  readonly resolver: CaneLayaResourceResolverV1;
  readonly url: string;
  readonly promise: Promise<AtlasDocumentV1>;
  refs: number;
}

const SHARED_ATLASES_V1 = new WeakMap<object, Map<string, SharedAtlasLeaseV1>>();

/** Resolver backed by the real LayaAir loader/downloader, including mini-game adapters. */
export class LayaLoaderResourceResolverV1 implements CaneLayaResourceResolverV1 {
  readonly loader: Laya.Loader;

  constructor(loader: Laya.Loader = Laya.loader) {
    this.loader = loader;
  }

  async resolve(request: CaneLayaResourceRequestV1): Promise<ArrayBuffer | unknown> {
    let result: ArrayBuffer | unknown;
    try {
      result = request.responseType === "arrayBuffer"
        ? await this.loader.fetch(request.url, "arraybuffer")
        : await this.loader.fetch(request.url, "json");
    } catch (error) {
      throw new CaneLayaErrorV1("missingResource", `Laya.Loader failed to load '${request.url}'.`, {
        operation: `layaLoad${capitalizeV1(request.kind)}`,
        field: request.kind,
        url: request.url,
        cause: error,
      });
    }
    if (result === null || result === undefined) {
      throw new CaneLayaErrorV1("missingResource", `Laya.Loader failed to load '${request.url}'.`, {
        operation: `layaLoad${capitalizeV1(request.kind)}`,
        field: request.kind,
        url: request.url,
      });
    }
    return result;
  }
}

/** RuntimeData plus its transactional texture and Atlas dependency leases. */
export class CaneLayaAssetV1 {
  readonly data: RuntimeDataV1;
  readonly textures: LayaTextureStore;
  readonly sourceUrl: string;
  readonly atlasDependencyUrls: readonly string[];
  readonly #releaseAtlases: () => void;
  #destroyed = false;

  constructor(
    data: RuntimeDataV1,
    textures: LayaTextureStore,
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
    let textureFailure: unknown = null;
    try {
      await this.textures.destroy();
    } catch (error) {
      textureFailure = error;
    } finally {
      this.#releaseAtlases();
    }
    if (textureFailure !== null) {
      throw new CaneLayaErrorV1("invalidState", "Failed to release a Cane LayaAir asset.", {
        operation: "layaDestroyAsset",
        cause: textureFailure,
      });
    }
  }
}

export async function loadCaneLayaAssetV1(
  sourceUrl: string,
  options: CaneLayaAssetLoadOptionsV1 = {},
): Promise<CaneLayaAssetV1> {
  requireUrlV1(sourceUrl, "layaLoadAsset");
  const resolver = options.resolver ?? defaultCaneLayaResourceResolverV1;
  const responseType = isCanebUrlV1(sourceUrl) ? "arrayBuffer" : "json";
  let payload: ArrayBuffer | unknown;
  try {
    payload = await resolver.resolve({
      url: sourceUrl,
      kind: "runtime",
      responseType,
    });
  } catch (error) {
    if (error instanceof CaneLayaErrorV1) throw error;
    throw new CaneLayaErrorV1("missingResource", `Failed to load Cane Runtime asset '${sourceUrl}'.`, {
      operation: "layaLoadAsset",
      field: "runtime",
      url: sourceUrl,
      cause: error,
    });
  }
  if (responseType === "arrayBuffer") {
    if (!(payload instanceof ArrayBuffer)) {
      throw new CaneLayaErrorV1("decodeFailed", "CANEB resolver result must be an ArrayBuffer.", {
        operation: "layaLoadAsset",
        field: "runtime",
        url: sourceUrl,
      });
    }
    return createAssetV1(null, payload, options, sourceUrl, resolver);
  }
  return createAssetV1(payload, null, options, sourceUrl, resolver);
}

export async function createCaneLayaAssetFromJsonV1(
  document: unknown,
  options: CaneLayaAssetLoadOptionsV1 = {},
  sourceUrl = "",
): Promise<CaneLayaAssetV1> {
  return createAssetV1(
    document,
    null,
    options,
    sourceUrl,
    options.resolver ?? defaultCaneLayaResourceResolverV1,
  );
}

export async function createCaneLayaAssetFromCanebV1(
  bytes: ArrayBuffer,
  options: CaneLayaAssetLoadOptionsV1 = {},
  sourceUrl = "",
): Promise<CaneLayaAssetV1> {
  if (!(bytes instanceof ArrayBuffer)) {
    throw new CaneLayaErrorV1("invalidArgument", "bytes must be an ArrayBuffer.", {
      operation: "layaCreateAssetFromCaneb",
      field: "bytes",
    });
  }
  return createAssetV1(
    null,
    bytes,
    options,
    sourceUrl,
    options.resolver ?? defaultCaneLayaResourceResolverV1,
  );
}

async function createAssetV1(
  document: unknown | null,
  caneb: ArrayBuffer | null,
  options: CaneLayaAssetLoadOptionsV1,
  sourceUrl: string,
  resolver: CaneLayaResourceResolverV1,
): Promise<CaneLayaAssetV1> {
  let decodedDocument = document;
  if (caneb !== null) {
    try {
      decodedDocument = decodeCanebV1(caneb).document;
    } catch (error) {
      throw new CaneLayaErrorV1("decodeFailed", "CANEB could not be decoded.", {
        operation: "layaCreateAsset",
        field: "caneb",
        url: sourceUrl,
        cause: error,
      });
    }
  }
  const atlasInputs = options.atlases ?? automaticAtlasReferencesV1(decodedDocument);
  const atlases = await loadAtlasesV1(atlasInputs, sourceUrl, resolver);
  const textures = new LayaTextureStore({
    baseUrl: options.textureBaseUrl ?? sourceDirectoryV1(sourceUrl),
    ...(options.textureBaseUrl === undefined ? { atlasBaseUrls: atlases.baseUrls } : {}),
    resolver,
    decoder: options.textureDecoder ?? defaultCaneLayaTextureDecoderV1,
    ...(options.contextTarget === undefined ? {} : { contextTarget: options.contextTarget }),
  });
  try {
    const runtimeOptions: RuntimeLoadOptionsV1 = {
      ...(options.runtime ?? {}),
      atlases: atlases.documents,
    };
    const data = caneb === null
      ? RuntimeDataV1.fromJson(decodedDocument, runtimeOptions)
      : RuntimeDataV1.fromCaneb(caneb, runtimeOptions);
    if (options.preloadTextures !== false) await textures.preloadData(data);
    return new CaneLayaAssetV1(data, textures, sourceUrl, atlases.urls, atlases.release);
  } catch (error) {
    await textures.destroy().catch(() => undefined);
    atlases.release();
    throw error;
  }
}

async function loadAtlasesV1(
  inputs: readonly (AtlasDocumentV1 | string)[],
  sourceUrl: string,
  resolver: CaneLayaResourceResolverV1,
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
      throw new CaneLayaErrorV1("invalidArgument", "Atlas input must be a URL or document.", {
        operation: "layaLoadAtlases",
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
    throw new CaneLayaErrorV1("missingResource", "One or more Cane Atlas documents failed to load.", {
      operation: "layaLoadAtlases",
      field: "atlases",
      cause: failure,
    });
  }
  return { documents, urls, release, baseUrls };
}

function acquireAtlasV1(resolver: CaneLayaResourceResolverV1, url: string): SharedAtlasLeaseV1 {
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
    throw new CaneLayaErrorV1("invalidArgument", "sourceUrl must be a non-empty NUL-free string.", {
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

function capitalizeV1(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
