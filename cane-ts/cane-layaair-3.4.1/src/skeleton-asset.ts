import type { AtlasDocumentV1 } from "@cane-runtime/core";
import { CaneLayaErrorV1 } from "./errors.js";
import {
  createCaneLayaAssetFromCanebV1, createCaneLayaAssetFromJsonV1,
  LayaLoaderResourceResolverV1, type CaneLayaAssetV1,
} from "./assets.js";
import type { CaneLayaResourceRequestV1, CaneLayaResourceResolverV1 } from "./texture-store.js";

/** Engine resource bindings. The original Cane documents and binary are preserved. */
export interface CaneLayaSkeletonAssetDocumentV1 {
  readonly format: "cane-laya-skeleton";
  readonly version: 1;
  readonly document: unknown;
  readonly caneb: string | null;
  readonly atlases: readonly { readonly url: string; readonly document: AtlasDocumentV1 }[];
  readonly textures: readonly { readonly url: string; readonly asset: string }[];
}

let engineResolver: LayaLoaderResourceResolverV1 | undefined;
const shared = new Map<string, { refs: number; promise: Promise<CaneLayaAssetV1> }>();

export interface CaneLayaSkeletonAssetLeaseV1 {
  readonly asset: CaneLayaAssetV1;
  release(): Promise<void>;
}

/** Shared immutable data and texture leases; every component still owns its player. */
export async function acquireCaneLayaSkeletonAssetV1(url: string): Promise<CaneLayaSkeletonAssetLeaseV1> {
  const key = Laya.URL.formatURL(url);
  let entry = shared.get(key);
  if (entry === undefined) {
    entry = { refs: 0, promise: loadCaneLayaSkeletonAssetV1(url) };
    shared.set(key, entry);
  }
  const leaseEntry = entry;
  leaseEntry.refs += 1;
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    leaseEntry.refs -= 1;
    if (leaseEntry.refs !== 0) return;
    if (shared.get(key) === leaseEntry) shared.delete(key);
    const asset = await leaseEntry.promise.catch(() => null);
    if (asset !== null) await asset.destroy();
  };
  try { return { asset: await leaseEntry.promise, release }; }
  catch (error) { await release(); throw error; }
}

/** Invalidation affects new leases; existing players keep their live resources. */
export function invalidateCaneLayaSkeletonAssetV1(url: string): void {
  shared.delete(Laya.URL.formatURL(url));
}

/** Loads the IDE-generated asset in both Scene view and published games. */
export async function loadCaneLayaSkeletonAssetV1(url: string): Promise<CaneLayaAssetV1> {
  const loader = engineResolver ??= new LayaLoaderResourceResolverV1();
  const input = await loader.resolve({ url, kind: "runtime", responseType: "json" });
  if ((input as { format?: string } | null)?.format === "cane-laya-import-error") {
    throw new CaneLayaErrorV1("missingResource", String((input as { message?: unknown }).message ?? "Cane import failed."), {
      operation: "layaLoadSkeletonAsset", url,
    });
  }
  const doc = input as Partial<CaneLayaSkeletonAssetDocumentV1> | null;
  if (doc?.format !== "cane-laya-skeleton" || doc.version !== 1
      || !Array.isArray(doc.atlases) || !Array.isArray(doc.textures)
      || !(doc.caneb === null || typeof doc.caneb === "string")) {
    throw new CaneLayaErrorV1("decodeFailed", "Expected an imported Cane skeleton asset (version 1).", {
      operation: "layaLoadSkeletonAsset", url,
    });
  }
  const atlases = new Map<string, AtlasDocumentV1>();
  const textures = new Map<string, string>();
  for (const item of doc.atlases) {
    if (typeof item?.url !== "string" || atlases.has(item.url)) throw invalidBinding(url);
    atlases.set(item.url, item.document);
  }
  for (const item of doc.textures) {
    if (typeof item?.url !== "string" || typeof item.asset !== "string"
        || item.asset.length === 0 || textures.has(item.url)) throw invalidBinding(url);
    textures.set(item.url, item.asset);
  }
  const resolver: CaneLayaResourceResolverV1 = {
    async resolve(request: CaneLayaResourceRequestV1) {
      if (request.kind === "atlas" && atlases.has(request.url)) return atlases.get(request.url);
      const asset = request.kind === "texture" ? textures.get(request.url) : undefined;
      if (asset === undefined) throw new CaneLayaErrorV1("missingResource", `Missing imported Cane dependency '${request.url}'.`, {
        operation: "layaLoadSkeletonDependency", url: request.url,
      });
      return loader.resolve({ ...request, url: asset });
    },
  };
  const canvas = typeof document === "undefined" ? null : document.querySelector("canvas");
  const options = { resolver, atlases: [...atlases.keys()],
    ...(canvas === null ? {} : { contextTarget: canvas }) };
  const source = "cane-resource://source/runtime.json";
  if (doc.caneb === null) return createCaneLayaAssetFromJsonV1(doc.document, options, source);
  let binary: Uint8Array<ArrayBuffer>;
  try { binary = Uint8Array.from(atob(doc.caneb), char => char.charCodeAt(0)); }
  catch (error) { throw new CaneLayaErrorV1("decodeFailed", "Imported CANEB payload is not valid base64.", {
    operation: "layaLoadSkeletonAsset", url, cause: error,
  }); }
  return createCaneLayaAssetFromCanebV1(binary.buffer, options, source);
}

function invalidBinding(url: string): CaneLayaErrorV1 {
  return new CaneLayaErrorV1("decodeFailed", "Invalid or duplicate imported Cane resource binding.", {
    operation: "layaLoadSkeletonAsset", url,
  });
}
