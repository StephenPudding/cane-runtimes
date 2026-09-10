import type { RuntimeTriangleFacingV1 } from "../contracts.js";
import { RuntimeErrorV1 } from "../errors.js";

const INDEX_REVISION_BY_ARRAY = new WeakMap<object, number>();

export interface NormalizedWindingV1 {
  readonly indices: number[];
  readonly authoredTriangleFacing: RuntimeTriangleFacingV1[];
}

export function normalizeWindingV1(
  worldVerticesXy: readonly number[],
  sourceIndices: readonly number[],
  output: NormalizedWindingV1 | null = null,
): NormalizedWindingV1 {
  validateWindingBuffersV1(worldVerticesXy, sourceIndices);
  const indices = output?.indices ?? [];
  const authoredTriangleFacing = output?.authoredTriangleFacing ?? [];
  normalizeWindingIntoV1(worldVerticesXy, sourceIndices, indices, authoredTriangleFacing);
  if (output !== null) return output;
  return { indices, authoredTriangleFacing };
}

/**
 * Trusted Core hot path. Input topology and world geometry have already passed
 * Runtime validation, so validation does not have to remain in the per-frame
 * triangle loop. The caller owns and reuses both output arrays.
 */
export function normalizeWindingIntoV1(
  worldVerticesXy: readonly number[],
  sourceIndices: readonly number[],
  indices: number[],
  authoredTriangleFacing: RuntimeTriangleFacingV1[],
): void {
  let indicesChanged = indices.length !== sourceIndices.length;
  indices.length = sourceIndices.length;
  authoredTriangleFacing.length = sourceIndices.length / 3;

  for (let offset = 0; offset < sourceIndices.length; offset += 3) {
    const i0 = sourceIndices[offset] as number;
    const i1 = sourceIndices[offset + 1] as number;
    const i2 = sourceIndices[offset + 2] as number;

    const ax = worldVerticesXy[i0 * 2] as number;
    const ay = worldVerticesXy[i0 * 2 + 1] as number;
    const bx = worldVerticesXy[i1 * 2] as number;
    const by = worldVerticesXy[i1 * 2 + 1] as number;
    const cx = worldVerticesXy[i2 * 2] as number;
    const cy = worldVerticesXy[i2 * 2 + 1] as number;

    // Normalize each public input once and retain Rust's binary32 operation
    // boundaries. Re-rounding already-rounded operands at every nested helper
    // call was semantically redundant and dominated the stable-frame profile.
    const ax32 = Math.fround(ax);
    const ay32 = Math.fround(ay);
    const bx32 = Math.fround(bx);
    const by32 = Math.fround(by);
    const cx32 = Math.fround(cx);
    const cy32 = Math.fround(cy);
    const abX = Math.fround(bx32 - ax32);
    const acY = Math.fround(cy32 - ay32);
    const abY = Math.fround(by32 - ay32);
    const acX = Math.fround(cx32 - ax32);
    const leftArea = Math.fround(abX * acY);
    const rightArea = Math.fround(abY * acX);
    const signedDoubleArea = Math.fround(leftArea - rightArea);
    if (!Number.isFinite(signedDoubleArea)) {
      throw new RuntimeErrorV1("nonFinite", "apply", "Final triangle area is non-finite.", { field: "indices" });
    }

    const reverse = signedDoubleArea < 0;
    authoredTriangleFacing[offset / 3] = reverse
      ? "towardViewer"
      : signedDoubleArea > 0 ? "awayFromViewer" : "edgeOn";
    const normalizedI1 = reverse ? i2 : i1;
    const normalizedI2 = reverse ? i1 : i2;
    if (indices[offset] !== i0
      || indices[offset + 1] !== normalizedI1
      || indices[offset + 2] !== normalizedI2) {
      indicesChanged = true;
      indices[offset] = i0;
      indices[offset + 1] = normalizedI1;
      indices[offset + 2] = normalizedI2;
    }
  }

  const previousRevision = INDEX_REVISION_BY_ARRAY.get(indices) ?? 0;
  if (indicesChanged || previousRevision === 0) {
    INDEX_REVISION_BY_ARRAY.set(indices, previousRevision + 1);
  }
}

function validateWindingBuffersV1(
  worldVerticesXy: readonly number[],
  sourceIndices: readonly number[],
): void {
  for (let offset = 0; offset < sourceIndices.length; offset += 3) {
    const i0 = sourceIndices[offset];
    const i1 = sourceIndices[offset + 1];
    const i2 = sourceIndices[offset + 2];
    if (i0 === undefined || i1 === undefined || i2 === undefined) {
      throw new RangeError("Triangle index buffer is incomplete.");
    }
    const ax = worldVerticesXy[i0 * 2];
    const ay = worldVerticesXy[i0 * 2 + 1];
    const bx = worldVerticesXy[i1 * 2];
    const by = worldVerticesXy[i1 * 2 + 1];
    const cx = worldVerticesXy[i2 * 2];
    const cy = worldVerticesXy[i2 * 2 + 1];
    if (ax === undefined || ay === undefined || bx === undefined || by === undefined || cx === undefined || cy === undefined) {
      throw new RangeError("Triangle index is outside the vertex buffer.");
    }
  }
}

/**
 * Returns Core's non-normative mutation revision for a retained normalized
 * index array. Copies and third-party arrays intentionally return null.
 */
export function runtimeWindingIndexRevisionV1(indices: readonly number[]): number | null {
  return INDEX_REVISION_BY_ARRAY.get(indices) ?? null;
}
