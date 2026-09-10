import type { RuntimeDataV1, RuntimeTextureV1 } from "@cane-runtime/core";
import { CaneCocosErrorV1 } from "./errors.js";
import { textureKeyV1 } from "./geometry.js";

/** Shared by the Creator importer and GPU loader; no engine process is needed. */
export function runtimeTextureDescriptorsV1(data: RuntimeDataV1): Map<string, RuntimeTextureV1> {
  const resources = new Map<string, RuntimeTextureV1>();
  for (const image of data.document.images) {
    if (image.atlasId === null) {
      if (image.path === null) continue;
      const descriptor: RuntimeTextureV1 = {
        kind: "direct", imageId: image.imageId, path: image.path, colorSpace: "srgb", alphaMode: "straight",
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
      kind: "atlas", imageId: image.imageId, atlasId: atlas.atlasId, pageId: page.pageId,
      pagePath: page.image, regionId: region.regionId, colorSpace: atlas.colorSpace, alphaMode: atlas.alphaMode,
    };
    resources.set(textureKeyV1(descriptor), descriptor);
  }
  return resources;
}

function missingTextureV1(entityId: string, field: string): CaneCocosErrorV1 {
  return new CaneCocosErrorV1("missingResource", "Cane texture resource is unavailable.", {
    operation: "cocosResolveTexture", field, entityId,
  });
}
