import {
  RuntimeDataV1,
  RuntimeErrorV1,
  decodeCanebV1,
  type AtlasDocumentV1,
  type RuntimeLoadOptionsV1,
} from "@cane-runtime/core";
import {
  Assets,
  ExtensionType,
  LoaderParserPriority,
  extensions,
  type AssetExtensionAdvanced,
  type Loader,
  type ResolvedAsset,
} from "pixi.js";
import {
  PixiTextureStore,
  type PixiAssetsLikeV1,
  type PixiTexturePipelineV1,
} from "./texture-store.js";

export interface CanePixiAssetLoadOptionsV1 {
  /** Inline Atlas documents and/or URLs relative to the Runtime asset. */
  readonly atlases?: readonly (AtlasDocumentV1 | string)[];
  /** Defaults to the Runtime asset's directory. */
  readonly textureBaseUrl?: string;
  readonly pipeline?: PixiTexturePipelineV1;
  /** Defaults to true. Disable only when the host will preload the Store itself. */
  readonly preloadTextures?: boolean;
  readonly runtime?: Omit<RuntimeLoadOptionsV1, "atlases">;
  /** Injectable PIXI.Assets-compatible owner for isolated loaders/tests. */
  readonly assets?: PixiAssetsLikeV1;
}

/** Options passed through `PIXI.Assets.load({ data: ... })`. */
export type CanePixiAssetLoaderDataV1 = CanePixiAssetLoadOptionsV1;

interface CanePixiAtlasLoaderV1 {
  load<T = unknown>(asset: unknown): Promise<T>;
  unload(asset: unknown): Promise<void>;
}

interface SharedAtlasDocumentLeaseV1 {
  readonly url: string;
  readonly loader: CanePixiAtlasLoaderV1;
  readonly promise: Promise<AtlasDocumentV1>;
  refs: number;
}

const SHARED_ATLAS_DOCUMENTS_V1 = new WeakMap<object, Map<string, SharedAtlasDocumentLeaseV1>>();

export class CanePixiAssetV1 {
  readonly data: RuntimeDataV1;
  readonly textures: PixiTextureStore;
  readonly sourceUrl: string;
  readonly atlasDependencyUrls: readonly string[];
  readonly #releaseDependencies: () => Promise<void>;
  #destroyed = false;

  constructor(
    data: RuntimeDataV1,
    textures: PixiTextureStore,
    sourceUrl: string,
    atlasDependencyUrls: readonly string[],
    releaseDependencies: () => Promise<void>,
  ) {
    this.data = data;
    this.textures = textures;
    this.sourceUrl = sourceUrl;
    this.atlasDependencyUrls = Object.freeze([...atlasDependencyUrls]);
    this.#releaseDependencies = releaseDependencies;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  /** Releases texture leases and Atlas JSON dependencies exactly once. */
  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    const results = await Promise.allSettled([
      this.textures.destroy(),
      this.#releaseDependencies(),
    ]);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure !== undefined) {
      throw new RuntimeErrorV1("invalidState", "pixiUnloadAsset", "Failed to release a Cane Pixi asset.", {
        cause: failure.reason,
      });
    }
  }
}

/** Creates and optionally texture-preloads a Cane Pixi asset from Runtime JSON. */
export async function createCanePixiAssetFromJsonV1(
  document: unknown,
  options: CanePixiAssetLoadOptionsV1 = {},
  sourceUrl = "",
): Promise<CanePixiAssetV1> {
  return createAssetV1(document, null, options, sourceUrl, null);
}

/** Loads `.caneb`, Runtime JSON, referenced Atlas JSON, and textures as one asset. */
export async function loadCanePixiAssetV1(
  sourceUrl: string,
  options: CanePixiAssetLoadOptionsV1 = {},
): Promise<CanePixiAssetV1> {
  requireSourceUrlV1(sourceUrl, "loadCanePixiAsset");
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new RuntimeErrorV1(
      "missingResource",
      "loadCanePixiAsset",
      `Failed to load Cane Runtime asset '${sourceUrl}' (${response.status}).`,
      { field: "src", entityId: sourceUrl },
    );
  }
  if (isCanebUrlV1(sourceUrl)) {
    const bytes = await response.arrayBuffer();
    return createAssetV1(null, bytes, options, sourceUrl, null);
  }
  let document: unknown;
  try {
    document = await response.json();
  } catch (error) {
    throw new RuntimeErrorV1("malformedInput", "loadCanePixiAsset", "Runtime JSON could not be decoded.", {
      field: "src",
      entityId: sourceUrl,
      cause: error,
    });
  }
  return createAssetV1(document, null, options, sourceUrl, null);
}

const canePixiAssetLoaderV1 = {
  id: "cane-runtime",
  extension: {
    type: ExtensionType.LoadParser,
    priority: LoaderParserPriority.Normal,
    name: "cane-runtime",
  },
  test(url: string): boolean {
    return isCanebUrlV1(url);
  },
  async load(
    url: string,
    resolved?: ResolvedAsset<CanePixiAssetLoaderDataV1>,
    loader?: Loader,
  ): Promise<CanePixiAssetV1> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new RuntimeErrorV1("missingResource", "pixiLoadAsset", `Failed to load CANEB '${url}'.`, {
        field: "src",
        entityId: url,
      });
    }
    return createAssetV1(null, await response.arrayBuffer(), resolved?.data ?? {}, url, loader ?? null);
  },
  async testParse(asset: unknown): Promise<boolean> {
    return isRuntimeJsonV1(asset);
  },
  async parse(
    document: unknown,
    resolved?: ResolvedAsset<CanePixiAssetLoaderDataV1>,
    loader?: Loader,
  ): Promise<CanePixiAssetV1> {
    return createAssetV1(document, null, resolved?.data ?? {}, resolved?.src ?? "", loader ?? null);
  },
  async unload(asset: CanePixiAssetV1): Promise<void> {
    await asset.destroy();
  },
};

export const canePixiAssetExtensionV1 = {
  extension: ExtensionType.Asset,
  loader: canePixiAssetLoaderV1,
} satisfies AssetExtensionAdvanced<unknown, CanePixiAssetV1, CanePixiAssetV1>;

let assetsInstalled = false;

/** Registers `.caneb` loading and Runtime JSON post-parsing with PIXI.Assets. */
export function installCanePixiAssetsV1(): void {
  if (assetsInstalled) return;
  extensions.add(canePixiAssetExtensionV1);
  assetsInstalled = true;
}

async function createAssetV1(
  document: unknown | null,
  caneb: ArrayBuffer | null,
  options: CanePixiAssetLoadOptionsV1,
  sourceUrl: string,
  loader: Loader | null,
): Promise<CanePixiAssetV1> {
  const decodedDocument = caneb === null ? document : decodeCanebV1(caneb).document;
  const dependencyOwner = loader ?? Assets.loader;
  const atlasInputs = options.atlases ?? automaticAtlasReferencesV1(decodedDocument);
  const dependencies = await loadAtlasesV1(atlasInputs, sourceUrl, dependencyOwner);
  const textures = new PixiTextureStore({
    baseUrl: options.textureBaseUrl ?? sourceDirectoryV1(sourceUrl),
    pipeline: options.pipeline ?? "caneBatch",
    assets: options.assets ?? Assets,
  });
  let data: RuntimeDataV1;
  try {
    const runtimeOptions: RuntimeLoadOptionsV1 = {
      ...(options.runtime ?? {}),
      atlases: dependencies.documents,
    };
    data = caneb === null
      ? RuntimeDataV1.fromJson(decodedDocument, runtimeOptions)
      : RuntimeDataV1.fromCaneb(caneb, runtimeOptions);
    if (options.preloadTextures !== false) await textures.preloadData(data);
  } catch (error) {
    await Promise.allSettled([textures.destroy(), dependencies.release()]);
    throw error;
  }
  return new CanePixiAssetV1(
    data,
    textures,
    sourceUrl,
    dependencies.urls,
    dependencies.release,
  );
}

async function loadAtlasesV1(
  inputs: readonly (AtlasDocumentV1 | string)[],
  sourceUrl: string,
  loader: CanePixiAtlasLoaderV1,
): Promise<{
  readonly documents: AtlasDocumentV1[];
  readonly urls: string[];
  readonly release: () => Promise<void>;
}> {
  const documents: AtlasDocumentV1[] = [];
  const urls: string[] = [];
  const leases: SharedAtlasDocumentLeaseV1[] = [];
  const seenUrls = new Set<string>();
  for (const input of inputs) {
    if (typeof input === "string") {
      const url = resolveSiblingAssetUrlV1(sourceUrl, input);
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      urls.push(url);
      leases.push(acquireAtlasDocumentV1(loader, url));
    } else if (input !== null && typeof input === "object") {
      documents.push(input);
    } else {
      throw new RuntimeErrorV1("invalidArgument", "pixiLoadAsset", "Atlas input must be a URL or document.", {
        field: "atlases",
      });
    }
  }
  const settled = await Promise.allSettled(leases.map((lease) => lease.promise));
  let firstError: unknown = null;
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    if (result?.status === "fulfilled") documents.push(result.value as AtlasDocumentV1);
    else if (result?.status === "rejected" && firstError === null) firstError = result.reason;
  }
  let released = false;
  const release = async (): Promise<void> => {
    if (released || leases.length === 0) return;
    released = true;
    const settledReleases = await Promise.allSettled(leases.map(releaseAtlasDocumentV1));
    const failure = settledReleases.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
  };
  if (firstError !== null) {
    await release().catch(() => undefined);
    throw new RuntimeErrorV1("missingResource", "pixiLoadAsset", "Failed to load a Cane Atlas document.", {
      field: "atlases",
      cause: firstError,
    });
  }
  return { documents, urls, release };
}

function acquireAtlasDocumentV1(
  loader: CanePixiAtlasLoaderV1,
  url: string,
): SharedAtlasDocumentLeaseV1 {
  const owner = loader as object;
  let leases = SHARED_ATLAS_DOCUMENTS_V1.get(owner);
  if (leases === undefined) {
    leases = new Map();
    SHARED_ATLAS_DOCUMENTS_V1.set(owner, leases);
  }
  const existing = leases.get(url);
  if (existing !== undefined) {
    existing.refs += 1;
    return existing;
  }
  const lease: SharedAtlasDocumentLeaseV1 = {
    url,
    loader,
    promise: Promise.resolve().then(() => loader.load<AtlasDocumentV1>({ src: url, parser: "json" })),
    refs: 1,
  };
  leases.set(url, lease);
  void lease.promise.catch(() => {
    if (lease.refs === 0 && leases?.get(url) === lease) leases.delete(url);
  });
  return lease;
}

async function releaseAtlasDocumentV1(lease: SharedAtlasDocumentLeaseV1): Promise<void> {
  if (lease.refs <= 0) return;
  lease.refs -= 1;
  if (lease.refs > 0) return;
  const leases = SHARED_ATLAS_DOCUMENTS_V1.get(lease.loader as object);
  if (leases?.get(lease.url) === lease) leases.delete(lease.url);
  // Unload after the in-flight load settles so Pixi cannot repopulate its
  // cache after rollback. A rejected load is still explicitly evicted to make
  // a subsequent retry deterministic.
  await lease.promise.catch(() => undefined);
  await lease.loader.unload(lease.url);
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

function isRuntimeJsonV1(value: unknown): boolean {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as { readonly format?: unknown }).format === "cane-runtime";
}

function isCanebUrlV1(url: string): boolean {
  return /\.caneb(?:[?#]|$)/i.test(url);
}

function requireSourceUrlV1(value: string, operation: string): void {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new RuntimeErrorV1("invalidArgument", operation, "sourceUrl must be a non-empty NUL-free string.", {
      field: "sourceUrl",
    });
  }
}

function sourceDirectoryV1(sourceUrl: string): string {
  if (sourceUrl.length === 0) return "";
  const query = sourceUrl.search(/[?#]/);
  const clean = query < 0 ? sourceUrl : sourceUrl.slice(0, query);
  const slash = clean.lastIndexOf("/");
  return slash < 0 ? "" : clean.slice(0, slash + 1);
}

function resolveSiblingAssetUrlV1(sourceUrl: string, path: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(path)) return path;
  if (/^[a-z][a-z0-9+.-]*:/i.test(sourceUrl)) return new URL(path, sourceUrl).toString();
  return `${sourceDirectoryV1(sourceUrl)}${path}`;
}

installCanePixiAssetsV1();
