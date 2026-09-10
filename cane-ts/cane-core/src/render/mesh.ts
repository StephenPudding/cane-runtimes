import type {
  AffineV1,
  AtlasDocumentV1,
  AtlasRegionV1,
  RuntimeImageV1,
  RuntimeMeshAttachmentV1,
  RuntimeRenderAttachmentV1,
  RuntimeSlotV1,
  RuntimeTextureV1,
  RuntimeTriangleFacingV1,
} from "../contracts.js";
import type { RuntimeDataV1 } from "../data.js";
import { RuntimeErrorV1 } from "../errors.js";
import type { RuntimeSampledDeformV1 } from "../animation/sampling.js";
import {
  clipTexturedGeometryV1,
  type RuntimeClipContextV1,
} from "./clipping.js";
import { f32, f32Div, f32Mul, f32Sub } from "../math/f32.js";
import {
  evaluateVertexAttachmentWorldV1,
  resolveMeshDeformOwnerV1,
  resolveMeshSourceV1,
} from "../geometry/vertices.js";
import { IDENTITY_AFFINE_V1 } from "../math/affine.js";
import { hasFiniteSourceProjectionV1 } from "./source-affine.js";
import { composeFinalTintV1, runtimeSlotTintBytesV1 } from "./tint.js";
import { normalizeWindingIntoV1 } from "./winding.js";

const ATLAS_SOURCE_TRIM_EPSILON = 0.000001;
const BINARY32_EPSILON = 1.1920928955078125e-7;
const MAX_VERTICES = 65_536;
const MESH_TEXTURE_CACHE = new WeakMap<object, RuntimeMeshTextureSourceV1>();
const MESH_GEOMETRY_SCRATCH = new WeakMap<object, MutableTexturedGeometryV1>();
const MESH_SOURCE_UV_SCRATCH = new WeakMap<object, number[]>();
const MESH_FINAL_UV_SCRATCH = new WeakMap<object, number[]>();
const MESH_ATLAS_UV_CACHE = new WeakMap<object, WeakMap<object, CachedAtlasUvsV1>>();

type MutableRenderAttachmentV1 = {
  -readonly [Property in keyof RuntimeRenderAttachmentV1]: RuntimeRenderAttachmentV1[Property]
};
type MutableTexturedGeometryV1 = {
  -readonly [Property in keyof RuntimeTexturedGeometryV1]: RuntimeTexturedGeometryV1[Property]
};

export interface MeshRenderInputV1 {
  readonly drawIndex: number;
  readonly sourceZIndex: number;
  readonly slot: RuntimeSlotV1;
  readonly mesh: RuntimeMeshAttachmentV1;
  readonly slotWorld: AffineV1;
  readonly worldByBoneId: ReadonlyMap<string, AffineV1>;
  readonly data: RuntimeDataV1;
  readonly deforms: ReadonlyMap<string, RuntimeSampledDeformV1>;
  readonly sequenceIndex: number | null;
  readonly clip: RuntimeClipContextV1 | null;
}

export function buildMeshRenderAttachmentV1(
  input: MeshRenderInputV1,
  output: RuntimeRenderAttachmentV1 | null = null,
): RuntimeRenderAttachmentV1 | null {
  return buildPreparedMeshRenderAttachmentV1(input, output, null);
}

/** @internal Core Player entry that accepts an already validated immutable texture source. */
export function buildPreparedMeshRenderAttachmentV1(
  input: MeshRenderInputV1,
  output: RuntimeRenderAttachmentV1 | null,
  preparedTextureSource: RuntimeMeshTextureSourceV1 | null = null,
): RuntimeRenderAttachmentV1 | null {
  const source = resolveMeshSourceV1(input.mesh, input.data);
  const deformOwner = resolveMeshDeformOwnerV1(input.mesh, input.data);
  const worldVertices = evaluateVertexAttachmentWorldV1(
    source,
    input.slotWorld,
    input.worldByBoneId,
    input.deforms.get(deformOwner.id) ?? null,
    output?.worldVerticesXy as number[] | undefined ?? null,
  );
  const imageId = preparedTextureSource?.texture.imageId
    ?? selectedImageId(input.mesh, input.sequenceIndex);
  let textureSource = preparedTextureSource;
  if (textureSource === null) {
    const image = input.data.image(imageId);
    textureSource = resolveTexture(image, input.data.atlas(image.atlasId));
  }
  const cachedAtlasUvs = textureSource.region === null
    ? null
    : mappedAtlasUvsWithoutTrimV1(source, textureSource.region);
  let geometry: RuntimeTexturedGeometryV1;
  let finalUvs: number[];
  if (input.clip === null && (textureSource.region === null || cachedAtlasUvs !== null)) {
    geometry = reusableTexturedGeometryV1(
      output,
      worldVertices,
      source.uvs as number[],
      source.indices as number[],
    );
    finalUvs = textureSource.region === null ? source.uvs as number[] : cachedAtlasUvs as number[];
  } else {
    const sourceUvs = reusableUvScratchV1(MESH_SOURCE_UV_SCRATCH, output);
    copyNumbersV1(sourceUvs, source.uvs);
    geometry = reusableTexturedGeometryV1(
      output,
      worldVertices,
      sourceUvs,
      source.indices as number[],
    );
    if (input.clip !== null) {
      const clipped = clipTexturedGeometryV1(geometry, input.clip);
      if (clipped === null) return null;
      geometry = clipped;
    }
    if (textureSource.region === null) {
      finalUvs = geometry.sourceUvs;
    } else {
      const clipped = clipTexturedGeometryToAtlasTrimV1(geometry, textureSource.region);
      if (clipped === null) return null;
      geometry = clipped;
      finalUvs = mapAtlasUvsV1(
        geometry.sourceUvs,
        textureSource.region,
        reusableUvScratchV1(MESH_FINAL_UV_SCRATCH, output),
      );
    }
  }
  if (geometry.worldVerticesXy.length / 2 > MAX_VERTICES) {
    throw new RuntimeErrorV1("resourceLimit", "apply", "Mesh output exceeds 65,536 vertices.", {
      entityId: input.mesh.id,
    });
  }
  const normalizedIndices = output?.indices as number[] | undefined ?? [];
  const authoredTriangleFacing = output?.authoredTriangleFacing as RuntimeTriangleFacingV1[] | undefined ?? [];
  normalizeWindingIntoV1(
    geometry.worldVerticesXy,
    geometry.indices,
    normalizedIndices,
    authoredTriangleFacing,
  );
  const sourceAffine = hasFiniteSourceProjectionV1(input.slotWorld, geometry.worldVerticesXy)
    ? input.slotWorld : IDENTITY_AFFINE_V1;
  const tint = composeFinalTintV1(
    input.slot.color,
    input.slot.alpha,
    input.mesh.color,
    input.mesh.alpha,
    input.slot.darkColor,
    output?.tint ?? null,
    runtimeSlotTintBytesV1(input.slot),
  );
  const value: RuntimeRenderAttachmentV1 = output ?? {
    drawIndex: input.drawIndex,
    sourceZIndex: input.sourceZIndex,
    slotId: input.slot.id,
    attachmentId: input.mesh.id,
    imageId,
    geometryKind: "meshTriangles",
    texture: textureSource.texture,
    blendMode: input.slot.blendMode,
    tint,
    twoColor: tint.darkRgb !== null,
    sourceAffine,
    worldVerticesXy: geometry.worldVerticesXy,
    uvs: finalUvs,
    indices: normalizedIndices,
    authoredTriangleFacing,
    frontFace: "counterClockwise",
  };
  if (output !== null) {
    const mutable = value as MutableRenderAttachmentV1;
    mutable.drawIndex = input.drawIndex;
    mutable.sourceZIndex = input.sourceZIndex;
    mutable.slotId = input.slot.id;
    mutable.attachmentId = input.mesh.id;
    mutable.imageId = imageId;
    mutable.geometryKind = "meshTriangles";
    mutable.texture = textureSource.texture;
    mutable.blendMode = input.slot.blendMode;
    mutable.tint = tint;
    mutable.twoColor = tint.darkRgb !== null;
    mutable.sourceAffine = sourceAffine;
    mutable.worldVerticesXy = geometry.worldVerticesXy;
    mutable.uvs = finalUvs;
    mutable.indices = normalizedIndices;
    mutable.authoredTriangleFacing = authoredTriangleFacing;
    mutable.frontFace = "counterClockwise";
  }
  return value;
}

export interface RuntimeMeshTextureSourceV1 {
  readonly texture: RuntimeTextureV1;
  readonly region: AtlasRegionV1 | null;
}

interface CachedAtlasUvsV1 {
  readonly mapped: number[] | null;
}

function mappedAtlasUvsWithoutTrimV1(
  source: RuntimeMeshAttachmentV1,
  region: AtlasRegionV1,
): number[] | null {
  let byRegion = MESH_ATLAS_UV_CACHE.get(source);
  if (byRegion === undefined) {
    byRegion = new WeakMap<object, CachedAtlasUvsV1>();
    MESH_ATLAS_UV_CACHE.set(source, byRegion);
  }
  const cached = byRegion.get(region);
  if (cached !== undefined) return cached.mapped;

  const logicalWidth = region.rotation === "none" ? region.width : region.height;
  const logicalHeight = region.rotation === "none" ? region.height : region.width;
  const minU = region.sourceX / region.sourceWidth;
  const maxU = (region.sourceX + logicalWidth) / region.sourceWidth;
  const minV = region.sourceY / region.sourceHeight;
  const maxV = (region.sourceY + logicalHeight) / region.sourceHeight;
  let inside = true;
  for (let offset = 0; offset < source.uvs.length; offset += 2) {
    const u = source.uvs[offset] ?? 0;
    const v = source.uvs[offset + 1] ?? 0;
    if (u < minU - ATLAS_SOURCE_TRIM_EPSILON || u > maxU + ATLAS_SOURCE_TRIM_EPSILON
      || v < minV - ATLAS_SOURCE_TRIM_EPSILON || v > maxV + ATLAS_SOURCE_TRIM_EPSILON) {
      inside = false;
      break;
    }
  }
  const mapped = inside ? mapAtlasUvsV1(source.uvs, region) : null;
  byRegion.set(region, { mapped });
  return mapped;
}

function resolveTexture(image: RuntimeImageV1, atlas: AtlasDocumentV1 | null): RuntimeMeshTextureSourceV1 {
  const cached = MESH_TEXTURE_CACHE.get(image);
  if (cached !== undefined) return cached;
  if (image.atlasId === null) {
    if (image.path === null) {
      throw new RuntimeErrorV1("missingResource", "apply", "Direct image path is unavailable.", {
        entityId: image.imageId,
      });
    }
    const created: RuntimeMeshTextureSourceV1 = {
      texture: {
        kind: "direct",
        imageId: image.imageId,
        path: image.path,
        colorSpace: "srgb",
        alphaMode: "straight",
      },
      region: null,
    };
    MESH_TEXTURE_CACHE.set(image, created);
    return created;
  }
  if (atlas === null) {
    throw new RuntimeErrorV1("missingResource", "apply", `Missing Atlas '${image.atlasId}'.`, {
      entityId: image.imageId,
    });
  }
  const region = atlas.regions.find((candidate) => candidate.imageId === image.imageId);
  if (region === undefined) {
    throw new RuntimeErrorV1("missingResource", "apply", "Atlas region is unavailable.", {
      entityId: image.imageId,
    });
  }
  const page = atlas.pages.find((candidate) => candidate.pageId === region.pageId);
  if (page === undefined) {
    throw new RuntimeErrorV1("missingResource", "apply", "Atlas page is unavailable.", {
      entityId: region.pageId,
    });
  }
  const created: RuntimeMeshTextureSourceV1 = {
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
  };
  MESH_TEXTURE_CACHE.set(image, created);
  return created;
}

/** @internal Prepares immutable Mesh texture data for a retained render input. */
export function prepareMeshTextureSourceV1(
  image: RuntimeImageV1,
  atlas: AtlasDocumentV1 | null,
): RuntimeMeshTextureSourceV1 {
  return resolveTexture(image, atlas);
}

function selectedImageId(mesh: RuntimeMeshAttachmentV1, sequenceIndex: number | null): string {
  if (mesh.sequence === null) return mesh.imageId;
  const index = sequenceIndex ?? mesh.sequence.setupIndex;
  return mesh.sequence.imageIds[index] ?? mesh.imageId;
}

export interface RuntimeTexturedGeometryV1 {
  readonly worldVerticesXy: number[];
  readonly sourceUvs: number[];
  readonly indices: number[];
}

function reusableTexturedGeometryV1(
  owner: RuntimeRenderAttachmentV1 | null,
  worldVerticesXy: number[],
  sourceUvs: number[],
  indices: number[],
): MutableTexturedGeometryV1 {
  if (owner === null) return { worldVerticesXy, sourceUvs, indices };
  let result = MESH_GEOMETRY_SCRATCH.get(owner);
  if (result === undefined) {
    result = { worldVerticesXy, sourceUvs, indices };
    MESH_GEOMETRY_SCRATCH.set(owner, result);
  } else {
    result.worldVerticesXy = worldVerticesXy;
    result.sourceUvs = sourceUvs;
    result.indices = indices;
  }
  return result;
}

function reusableUvScratchV1(
  cache: WeakMap<object, number[]>,
  owner: RuntimeRenderAttachmentV1 | null,
): number[] {
  if (owner === null) return [];
  let result = cache.get(owner);
  if (result === undefined) {
    result = [];
    cache.set(owner, result);
  }
  return result;
}

interface TexturedVertexV1 {
  readonly x: number;
  readonly y: number;
  readonly u: number;
  readonly v: number;
}

export function clipTexturedGeometryToAtlasTrimV1(
  geometry: RuntimeTexturedGeometryV1,
  region: AtlasRegionV1,
): RuntimeTexturedGeometryV1 | null {
  const logicalWidth = region.rotation === "none" ? region.width : region.height;
  const logicalHeight = region.rotation === "none" ? region.height : region.width;
  const minU = region.sourceX / region.sourceWidth;
  const maxU = (region.sourceX + logicalWidth) / region.sourceWidth;
  const minV = region.sourceY / region.sourceHeight;
  const maxV = (region.sourceY + logicalHeight) / region.sourceHeight;
  let alreadyInside = true;
  for (let offset = 0; offset < geometry.sourceUvs.length; offset += 2) {
    const u = geometry.sourceUvs[offset] ?? 0;
    const v = geometry.sourceUvs[offset + 1] ?? 0;
    if (u < minU - ATLAS_SOURCE_TRIM_EPSILON || u > maxU + ATLAS_SOURCE_TRIM_EPSILON
      || v < minV - ATLAS_SOURCE_TRIM_EPSILON || v > maxV + ATLAS_SOURCE_TRIM_EPSILON) {
      alreadyInside = false;
      break;
    }
  }
  if (alreadyInside) return geometry;

  const outputVertices: number[] = [];
  const outputUvs: number[] = [];
  const outputIndices: number[] = [];
  const planes: readonly ((vertex: TexturedVertexV1) => number)[] = [
    (vertex) => vertex.u - minU,
    (vertex) => maxU - vertex.u,
    (vertex) => vertex.v - minV,
    (vertex) => maxV - vertex.v,
  ];
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const sourceIndices = [geometry.indices[offset], geometry.indices[offset + 1], geometry.indices[offset + 2]];
    let polygon: TexturedVertexV1[] = sourceIndices.map((index) => vertexAt(geometry, index ?? 0));
    for (const distance of planes) {
      polygon = clipPolygon(polygon, distance);
      if (polygon.length < 3) break;
    }
    if (polygon.length < 3) continue;
    const base = outputVertices.length / 2;
    if (base + polygon.length > MAX_VERTICES) {
      throw new RuntimeErrorV1("resourceLimit", "apply", "Atlas-trimmed Mesh exceeds 65,536 vertices.");
    }
    for (const vertex of polygon) {
      outputVertices.push(f32(vertex.x), f32(vertex.y));
      outputUvs.push(f32(vertex.u), f32(vertex.v));
    }
    for (let index = 1; index + 1 < polygon.length; index += 1) {
      outputIndices.push(base, base + index, base + index + 1);
    }
  }
  if (outputIndices.length === 0) return null;
  return { worldVerticesXy: outputVertices, sourceUvs: outputUvs, indices: outputIndices };
}

function vertexAt(geometry: RuntimeTexturedGeometryV1, index: number): TexturedVertexV1 {
  return {
    x: geometry.worldVerticesXy[index * 2] ?? 0,
    y: geometry.worldVerticesXy[index * 2 + 1] ?? 0,
    u: geometry.sourceUvs[index * 2] ?? 0,
    v: geometry.sourceUvs[index * 2 + 1] ?? 0,
  };
}

function clipPolygon(
  polygon: readonly TexturedVertexV1[],
  distance: (vertex: TexturedVertexV1) => number,
): TexturedVertexV1[] {
  if (polygon.length === 0) return [];
  const output: TexturedVertexV1[] = [];
  let previous = polygon[polygon.length - 1];
  if (previous === undefined) return output;
  let previousDistance = distance(previous);
  let previousInside = previousDistance >= -ATLAS_SOURCE_TRIM_EPSILON;
  for (const current of polygon) {
    const currentDistance = distance(current);
    const currentInside = currentDistance >= -ATLAS_SOURCE_TRIM_EPSILON;
    if (currentInside !== previousInside) {
      const denominator = previousDistance - currentDistance;
      if (Math.abs(denominator) > BINARY32_EPSILON) {
        const t = Math.min(Math.max(previousDistance / denominator, 0), 1);
        output.push(interpolateVertex(previous, current, t));
      }
    }
    if (currentInside) output.push(current);
    previous = current;
    previousDistance = currentDistance;
    previousInside = currentInside;
  }
  return removeDuplicateVertices(output);
}

function interpolateVertex(from: TexturedVertexV1, to: TexturedVertexV1, progress: number): TexturedVertexV1 {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    u: from.u + (to.u - from.u) * progress,
    v: from.v + (to.v - from.v) * progress,
  };
}

function removeDuplicateVertices(vertices: readonly TexturedVertexV1[]): TexturedVertexV1[] {
  const result: TexturedVertexV1[] = [];
  for (const vertex of vertices) {
    const previous = result[result.length - 1];
    if (previous === undefined || !sameVertex(previous, vertex)) result.push(vertex);
  }
  if (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    if (first !== undefined && last !== undefined && sameVertex(first, last)) result.pop();
  }
  return result;
}

function sameVertex(left: TexturedVertexV1, right: TexturedVertexV1): boolean {
  return Math.abs(left.x - right.x) <= ATLAS_SOURCE_TRIM_EPSILON
    && Math.abs(left.y - right.y) <= ATLAS_SOURCE_TRIM_EPSILON
    && Math.abs(left.u - right.u) <= ATLAS_SOURCE_TRIM_EPSILON
    && Math.abs(left.v - right.v) <= ATLAS_SOURCE_TRIM_EPSILON;
}

export function mapAtlasUvsV1(
  sourceUvs: readonly number[],
  region: AtlasRegionV1,
  output: number[] | null = null,
): number[] {
  const logicalWidth = region.rotation === "none" ? region.width : region.height;
  const logicalHeight = region.rotation === "none" ? region.height : region.width;
  const topLeft = region.uvs[0] ?? [0, 0];
  const topRight = region.uvs[1] ?? [0, 0];
  const bottomRight = region.uvs[2] ?? [0, 0];
  const bottomLeft = region.uvs[3] ?? [0, 0];
  const result = output ?? [];
  if (result !== sourceUvs) result.length = sourceUvs.length;
  for (let offset = 0; offset < sourceUvs.length; offset += 2) {
    const sourceU = sourceUvs[offset] ?? 0;
    const sourceV = sourceUvs[offset + 1] ?? 0;
    const x = (sourceU * region.sourceWidth - region.sourceX) / logicalWidth;
    const y = (sourceV * region.sourceHeight - region.sourceY) / logicalHeight;
    const topU = topLeft[0] + (topRight[0] - topLeft[0]) * x;
    const topV = topLeft[1] + (topRight[1] - topLeft[1]) * x;
    const bottomU = bottomLeft[0] + (bottomRight[0] - bottomLeft[0]) * x;
    const bottomV = bottomLeft[1] + (bottomRight[1] - bottomLeft[1]) * x;
    result[offset] = f32(topU + (bottomU - topU) * y);
    result[offset + 1] = f32(topV + (bottomV - topV) * y);
  }
  return result;
}

function copyNumbersV1(target: number[], source: readonly number[]): void {
  target.length = source.length;
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index];
    if (value !== undefined) target[index] = value;
  }
}
