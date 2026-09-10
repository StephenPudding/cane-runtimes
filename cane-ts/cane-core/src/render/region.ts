import type {
  AffineV1,
  AtlasDocumentV1,
  AtlasRegionV1,
  RuntimeImageV1,
  RuntimeRegionAttachmentV1,
  RuntimeRenderAttachmentV1,
  RuntimeSlotV1,
  RuntimeTextureV1,
  RuntimeTriangleFacingV1,
} from "../contracts.js";
import { RuntimeErrorV1 } from "../errors.js";
import {
  multiplyAffineV1,
  regionLocalAffineV1,
} from "../math/affine.js";
import { f32, f32Div, f32Sub } from "../math/f32.js";
import { composeFinalTintV1, runtimeSlotTintBytesV1 } from "./tint.js";
import { normalizeWindingIntoV1 } from "./winding.js";
import { hasFiniteSourceProjectionV1 } from "./source-affine.js";
import {
  clipTexturedGeometryV1,
  type RuntimeClipContextV1,
} from "./clipping.js";
import {
  clipTexturedGeometryToAtlasTrimV1,
  mapAtlasUvsV1,
  type RuntimeTexturedGeometryV1,
} from "./mesh.js";

const SOURCE_INDICES: number[] = [0, 1, 2, 0, 2, 3];
const DIRECT_UVS: number[] = [0, 0, 1, 0, 1, 1, 0, 1];
const REGION_SOURCE_CACHE = new WeakMap<object, RuntimeRegionSourceGeometryV1>();

type MutableRenderAttachmentV1 = {
  -readonly [Property in keyof RuntimeRenderAttachmentV1]: RuntimeRenderAttachmentV1[Property]
};

export interface RegionRenderInputV1 {
  readonly drawIndex: number;
  readonly sourceZIndex: number;
  readonly slot: RuntimeSlotV1;
  readonly attachment: RuntimeRegionAttachmentV1;
  readonly boneWorld: AffineV1;
  readonly image: RuntimeImageV1;
  readonly atlas: AtlasDocumentV1 | null;
  readonly clip: RuntimeClipContextV1 | null;
}

export function buildRegionRenderAttachmentV1(
  input: RegionRenderInputV1,
  output: RuntimeRenderAttachmentV1 | null = null,
): RuntimeRenderAttachmentV1 | null {
  return buildPreparedRegionRenderAttachmentV1(input, output, null);
}

/** @internal Core Player entry that accepts an already validated immutable source. */
export function buildPreparedRegionRenderAttachmentV1(
  input: RegionRenderInputV1,
  output: RuntimeRenderAttachmentV1 | null,
  preparedSource: RuntimeRegionSourceGeometryV1 | null = null,
): RuntimeRenderAttachmentV1 | null {
  const reusableAffine = output?.sourceAffine ?? null;
  const sourceAffine = multiplyAffineV1(
    input.boneWorld,
    regionLocalAffineV1(input.attachment, reusableAffine),
    reusableAffine,
  );
  const source = preparedSource ?? resolveSourceGeometry(input.image, input.atlas);
  let worldVerticesXy = output?.worldVerticesXy as number[] | undefined ?? [];
  let uvs: readonly number[] = source.uvs;
  let indices: readonly number[] = SOURCE_INDICES;
  let geometryKind: RuntimeRenderAttachmentV1["geometryKind"] = "regionQuad";
  const localVertices = input.clip === null
    ? source.localVerticesXy
    : source.fullLocalVerticesXy;
  worldVerticesXy.length = localVertices.length;
  for (let offset = 0; offset < localVertices.length; offset += 2) {
    const x = localVertices[offset];
    const y = localVertices[offset + 1];
    if (x === undefined || y === undefined) {
      throw new RuntimeErrorV1("internal", "apply", "Region local vertex buffer is incomplete.");
    }
    worldVerticesXy[offset] = f32(sourceAffine.a * x + sourceAffine.c * y + sourceAffine.tx);
    worldVerticesXy[offset + 1] = f32(sourceAffine.b * x + sourceAffine.d * y + sourceAffine.ty);
  }
  if (input.clip !== null) {
    let geometry: RuntimeTexturedGeometryV1 | null = clipTexturedGeometryV1({
      worldVerticesXy,
      sourceUvs: DIRECT_UVS,
      indices: SOURCE_INDICES,
    }, input.clip);
    if (geometry === null) return null;
    if (source.region !== null) {
      geometry = clipTexturedGeometryToAtlasTrimV1(geometry, source.region);
      if (geometry === null) return null;
      uvs = mapAtlasUvsV1(geometry.sourceUvs, source.region);
    } else {
      uvs = geometry.sourceUvs;
    }
    worldVerticesXy = geometry.worldVerticesXy;
    indices = geometry.indices;
    geometryKind = "meshTriangles";
  }
  const normalizedIndices = output?.indices as number[] | undefined ?? [];
  const authoredTriangleFacing = output?.authoredTriangleFacing as RuntimeTriangleFacingV1[] | undefined ?? [];
  normalizeWindingIntoV1(
    worldVerticesXy,
    indices,
    normalizedIndices,
    authoredTriangleFacing,
  );
  if (!hasFiniteSourceProjectionV1(sourceAffine, worldVerticesXy)) {
    // Region owns this matrix. Keep its mutable allocation for the next reusable-frame build.
    const diagnostic = sourceAffine as { -readonly [K in keyof AffineV1]: AffineV1[K] };
    diagnostic.a = diagnostic.d = 1;
    diagnostic.b = diagnostic.c = diagnostic.tx = diagnostic.ty = 0;
  }
  const tint = composeFinalTintV1(
    input.slot.color,
    input.slot.alpha,
    input.attachment.color,
    input.attachment.alpha,
    input.slot.darkColor,
    output?.tint ?? null,
    runtimeSlotTintBytesV1(input.slot),
  );

  const value: RuntimeRenderAttachmentV1 = output ?? {
    drawIndex: input.drawIndex,
    sourceZIndex: input.sourceZIndex,
    slotId: input.slot.id,
    attachmentId: input.attachment.id,
    imageId: input.image.imageId,
    geometryKind,
    texture: source.texture,
    blendMode: input.slot.blendMode,
    tint,
    twoColor: tint.darkRgb !== null,
    sourceAffine,
    worldVerticesXy,
    uvs,
    indices: normalizedIndices,
    authoredTriangleFacing,
    frontFace: "counterClockwise",
  };
  if (output !== null) {
    const mutable = value as MutableRenderAttachmentV1;
    mutable.drawIndex = input.drawIndex;
    mutable.sourceZIndex = input.sourceZIndex;
    mutable.slotId = input.slot.id;
    mutable.attachmentId = input.attachment.id;
    mutable.imageId = input.image.imageId;
    mutable.geometryKind = geometryKind;
    mutable.texture = source.texture;
    mutable.blendMode = input.slot.blendMode;
    mutable.tint = tint;
    mutable.twoColor = tint.darkRgb !== null;
    mutable.sourceAffine = sourceAffine;
    mutable.worldVerticesXy = worldVerticesXy;
    mutable.uvs = uvs;
    mutable.indices = normalizedIndices;
    mutable.authoredTriangleFacing = authoredTriangleFacing;
    mutable.frontFace = "counterClockwise";
  }
  return value;
}

export interface RuntimeRegionSourceGeometryV1 {
  readonly localVerticesXy: readonly number[];
  readonly uvs: readonly number[];
  readonly texture: RuntimeTextureV1;
  readonly region: AtlasRegionV1 | null;
  readonly fullLocalVerticesXy: readonly number[];
}

function resolveSourceGeometry(
  image: RuntimeImageV1,
  atlas: AtlasDocumentV1 | null,
): RuntimeRegionSourceGeometryV1 {
  const cached = REGION_SOURCE_CACHE.get(image);
  if (cached !== undefined) return cached;
  if (image.atlasId === null) {
    if (image.path === null) {
      throw new RuntimeErrorV1("missingResource", "apply", "Direct image path is unavailable.", {
        field: "image",
        entityId: image.imageId,
      });
    }
    const halfWidth = f32Div(requiredDirectDimensionV1(image, "width"), 2);
    const halfHeight = f32Div(requiredDirectDimensionV1(image, "height"), 2);
    const localVerticesXy = [
      f32(-halfWidth),
      halfHeight,
      halfWidth,
      halfHeight,
      halfWidth,
      f32(-halfHeight),
      f32(-halfWidth),
      f32(-halfHeight),
    ];
    const created: RuntimeRegionSourceGeometryV1 = {
      localVerticesXy,
      uvs: DIRECT_UVS,
      texture: {
        kind: "direct",
        imageId: image.imageId,
        path: image.path,
        colorSpace: "srgb",
        alphaMode: "straight",
      },
      region: null,
      fullLocalVerticesXy: localVerticesXy,
    };
    REGION_SOURCE_CACHE.set(image, created);
    return created;
  }

  if (atlas === null || atlas.atlasId !== image.atlasId) {
    throw new RuntimeErrorV1("missingResource", "apply", `Missing Atlas '${image.atlasId}'.`, {
      field: "atlas",
      entityId: image.imageId,
    });
  }
  const region = atlas.regions.find((candidate) => candidate.imageId === image.imageId);
  if (region === undefined) {
    throw new RuntimeErrorV1("missingResource", "apply", "Atlas region is missing.", {
      field: "region",
      entityId: image.imageId,
    });
  }
  const page = atlas.pages.find((candidate) => candidate.pageId === region.pageId);
  if (page === undefined) {
    throw new RuntimeErrorV1("missingResource", "apply", "Atlas page is missing.", {
      field: "page",
      entityId: region.pageId,
    });
  }

  const created: RuntimeRegionSourceGeometryV1 = {
    localVerticesXy: atlasLocalVertices(region),
    uvs: region.uvs.flatMap(([u, v]) => [f32(u), f32(v)]),
    texture: {
      kind: "atlas",
      imageId: image.imageId,
      atlasId: atlas.atlasId,
      pageId: page.pageId,
      pagePath: page.image,
      regionId: region.regionId,
      colorSpace: atlas.colorSpace,
      alphaMode: atlas.alphaMode,
    },
    region,
    fullLocalVerticesXy: fullSourceLocalVertices(image, region),
  };
  REGION_SOURCE_CACHE.set(image, created);
  return created;
}

/** @internal Prepares immutable Region texture/quad data for a retained render input. */
export function prepareRegionSourceGeometryV1(
  image: RuntimeImageV1,
  atlas: AtlasDocumentV1 | null,
): RuntimeRegionSourceGeometryV1 {
  return resolveSourceGeometry(image, atlas);
}

function fullSourceLocalVertices(
  image: RuntimeImageV1,
  region: AtlasRegionV1 | null,
): readonly number[] {
  const width = region?.sourceWidth ?? requiredDirectDimensionV1(image, "width");
  const height = region?.sourceHeight ?? requiredDirectDimensionV1(image, "height");
  const halfWidth = f32Div(width, 2);
  const halfHeight = f32Div(height, 2);
  return [
    f32(-halfWidth), halfHeight,
    halfWidth, halfHeight,
    halfWidth, f32(-halfHeight),
    f32(-halfWidth), f32(-halfHeight),
  ];
}

function requiredDirectDimensionV1(
  image: RuntimeImageV1,
  field: "width" | "height",
): number {
  const value = image[field];
  if (value === null || value <= 0) {
    throw new RuntimeErrorV1(
      "missingResource",
      "buildRenderPacket",
      `direct image \`${image.imageId}\` needs positive decoded ${field} metadata before rendering`,
      {
        field: `images.${image.imageId}.${field}`,
        entityId: image.imageId,
      },
    );
  }
  return value;
}

function atlasLocalVertices(region: AtlasRegionV1): readonly number[] {
  const logicalWidth = region.rotation === "none" ? region.width : region.height;
  const logicalHeight = region.rotation === "none" ? region.height : region.width;
  const halfSourceWidth = f32Div(region.sourceWidth, 2);
  const halfSourceHeight = f32Div(region.sourceHeight, 2);
  const left = f32Sub(region.sourceX, halfSourceWidth);
  const right = f32(left + logicalWidth);
  const top = f32Sub(halfSourceHeight, region.sourceY);
  const bottom = f32Sub(top, logicalHeight);
  return [left, top, right, top, right, bottom, left, bottom];
}
