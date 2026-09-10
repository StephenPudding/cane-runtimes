import type {
  AffineV1,
  RuntimeClippingAttachmentV1,
} from "../contracts.js";
import type { RuntimeSampledDeformV1 } from "../animation/sampling.js";
import { RuntimeErrorV1 } from "../errors.js";
import { evaluateVertexAttachmentWorldV1 } from "../geometry/vertices.js";
import { f32Add, f32Div, f32Mul, f32Sub } from "../math/f32.js";
import type { RuntimeTexturedGeometryV1 } from "./mesh.js";

export const CLIP_EPSILON_V1 = Math.fround(0.00001);
const BINARY32_EPSILON = 1.1920928955078125e-7;
const MAX_VERTICES = 65_536;

interface ClipPointV1 {
  readonly x: number;
  readonly y: number;
}

interface TexturedPointV1 extends ClipPointV1 {
  readonly u: number;
  readonly v: number;
}

export interface RuntimeClipContextV1 {
  readonly attachmentId: string;
  readonly endSlotId: string | null;
  readonly inverse: boolean;
  readonly convexPieces: readonly (readonly ClipPointV1[])[];
}

export function createRuntimeClipContextV1(
  attachment: RuntimeClippingAttachmentV1,
  slotWorld: AffineV1,
  worldByBoneId: ReadonlyMap<string, AffineV1>,
  deform: RuntimeSampledDeformV1 | null,
): RuntimeClipContextV1 | null {
  const world = evaluateVertexAttachmentWorldV1(attachment, slotWorld, worldByBoneId, deform);
  const points: ClipPointV1[] = [];
  for (let offset = 0; offset < world.length; offset += 2) {
    const x = world[offset];
    const y = world[offset + 1];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push({ x, y });
  }
  const normalized = normalizePolygon(points);
  if (normalized === null) return null;

  let convexPieces: readonly (readonly ClipPointV1[])[];
  if (isConvex(normalized)) {
    convexPieces = [normalized];
  } else if (attachment.convex) {
    const hull = convexHull(normalized);
    if (hull === null) return null;
    convexPieces = [hull];
  } else {
    const ears = earClip(normalized);
    if (ears === null) return null;
    convexPieces = ears;
  }
  return {
    attachmentId: attachment.id,
    endSlotId: attachment.endSlotId,
    inverse: attachment.inverse,
    convexPieces,
  };
}

export function clipTexturedGeometryV1(
  geometry: RuntimeTexturedGeometryV1,
  clip: RuntimeClipContextV1,
): RuntimeTexturedGeometryV1 | null {
  const outputVertices: number[] = [];
  const outputUvs: number[] = [];
  const outputIndices: number[] = [];
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const triangle = [
      texturedVertexAt(geometry, geometry.indices[offset] ?? 0),
      texturedVertexAt(geometry, geometry.indices[offset + 1] ?? 0),
      texturedVertexAt(geometry, geometry.indices[offset + 2] ?? 0),
    ];
    const fragments = clip.inverse
      ? subtractPieces(triangle, clip.convexPieces)
      : intersectPieces(triangle, clip.convexPieces);
    for (const fragment of fragments) {
      emitFragment(fragment, outputVertices, outputUvs, outputIndices);
    }
  }
  if (outputIndices.length === 0) return null;
  return {
    worldVerticesXy: outputVertices,
    sourceUvs: outputUvs,
    indices: outputIndices,
  };
}

function normalizePolygon(input: readonly ClipPointV1[]): ClipPointV1[] | null {
  if (input.length < 3) return null;
  const area = signedArea(input);
  if (!Number.isFinite(area) || Math.abs(area) <= CLIP_EPSILON_V1) return null;
  return area < 0 ? [...input].reverse() : [...input];
}

function signedArea(points: readonly ClipPointV1[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) continue;
    twiceArea = f32Add(
      twiceArea,
      f32Sub(f32Mul(current.x, next.y), f32Mul(next.x, current.y)),
    );
  }
  return f32Mul(twiceArea, 0.5);
}

function edgeDistance(a: ClipPointV1, b: ClipPointV1, point: ClipPointV1): number {
  return f32Sub(
    f32Mul(f32Sub(b.x, a.x), f32Sub(point.y, a.y)),
    f32Mul(f32Sub(b.y, a.y), f32Sub(point.x, a.x)),
  );
}

function isConvex(points: readonly ClipPointV1[]): boolean {
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    if (a === undefined || b === undefined || c === undefined) return false;
    if (edgeDistance(a, b, c) < -CLIP_EPSILON_V1) return false;
  }
  return true;
}

function convexHull(points: readonly ClipPointV1[]): ClipPointV1[] | null {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  const unique = sorted.filter((point, index) => {
    const previous = sorted[index - 1];
    return previous === undefined || previous.x !== point.x || previous.y !== point.y;
  });
  if (unique.length < 3) return null;
  const lower: ClipPointV1[] = [];
  for (const point of unique) {
    while (lower.length >= 2) {
      const a = lower[lower.length - 2];
      const b = lower[lower.length - 1];
      if (a === undefined || b === undefined || edgeDistance(a, b, point) > CLIP_EPSILON_V1) break;
      lower.pop();
    }
    lower.push(point);
  }
  const upper: ClipPointV1[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    if (point === undefined) continue;
    while (upper.length >= 2) {
      const a = upper[upper.length - 2];
      const b = upper[upper.length - 1];
      if (a === undefined || b === undefined || edgeDistance(a, b, point) > CLIP_EPSILON_V1) break;
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  const result = [...lower, ...upper];
  return result.length < 3 || Math.abs(signedArea(result)) <= CLIP_EPSILON_V1 ? null : result;
}

function earClip(points: readonly ClipPointV1[]): ClipPointV1[][] | null {
  const remaining = points.map((_, index) => index);
  const output: ClipPointV1[][] = [];
  const budget = points.length * points.length;
  let attempts = 0;
  while (remaining.length > 3) {
    let found = false;
    for (let position = 0; position < remaining.length; position += 1) {
      const previousIndex = remaining[(position + remaining.length - 1) % remaining.length];
      const currentIndex = remaining[position];
      const nextIndex = remaining[(position + 1) % remaining.length];
      const previous = previousIndex === undefined ? undefined : points[previousIndex];
      const current = currentIndex === undefined ? undefined : points[currentIndex];
      const next = nextIndex === undefined ? undefined : points[nextIndex];
      if (previous === undefined || current === undefined || next === undefined) return null;
      if (edgeDistance(previous, current, next) <= CLIP_EPSILON_V1) continue;
      let contains = false;
      for (const candidateIndex of remaining) {
        if (candidateIndex === previousIndex || candidateIndex === currentIndex || candidateIndex === nextIndex) continue;
        const candidate = points[candidateIndex];
        if (candidate !== undefined && pointInClosedTriangle(candidate, previous, current, next)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      output.push([previous, current, next]);
      remaining.splice(position, 1);
      found = true;
      break;
    }
    if (!found) return null;
    attempts += 1;
    if (attempts > budget) return null;
  }
  const final = remaining.map((index) => points[index]).filter((point): point is ClipPointV1 => point !== undefined);
  if (final.length !== 3) return null;
  output.push(final);
  return output;
}

function pointInClosedTriangle(
  point: ClipPointV1,
  a: ClipPointV1,
  b: ClipPointV1,
  c: ClipPointV1,
): boolean {
  return edgeDistance(a, b, point) >= -CLIP_EPSILON_V1
    && edgeDistance(b, c, point) >= -CLIP_EPSILON_V1
    && edgeDistance(c, a, point) >= -CLIP_EPSILON_V1;
}

function intersectPieces(
  triangle: readonly TexturedPointV1[],
  pieces: readonly (readonly ClipPointV1[])[],
): TexturedPointV1[][] {
  const fragments: TexturedPointV1[][] = [];
  for (const piece of pieces) {
    const fragment = intersectConvex(triangle, piece);
    if (isValidFragment(fragment)) fragments.push(fragment);
  }
  return fragments;
}

function subtractPieces(
  triangle: readonly TexturedPointV1[],
  pieces: readonly (readonly ClipPointV1[])[],
): TexturedPointV1[][] {
  let fragments: TexturedPointV1[][] = [removeDuplicateTextured(triangle)];
  for (const piece of pieces) {
    const next: TexturedPointV1[][] = [];
    for (const fragment of fragments) next.push(...subtractConvex(fragment, piece));
    fragments = next;
    if (fragments.length === 0) break;
  }
  return fragments.filter(isValidFragment);
}

function intersectConvex(
  polygon: readonly TexturedPointV1[],
  clip: readonly ClipPointV1[],
): TexturedPointV1[] {
  let current = [...polygon];
  for (let index = 0; index < clip.length; index += 1) {
    const a = clip[index];
    const b = clip[(index + 1) % clip.length];
    if (a === undefined || b === undefined) return [];
    current = clipHalfPlane(current, (point) => edgeDistance(a, b, point), true);
    if (current.length < 3) return [];
  }
  return current;
}

function subtractConvex(
  polygon: readonly TexturedPointV1[],
  clip: readonly ClipPointV1[],
): TexturedPointV1[][] {
  let remaining = [...polygon];
  const retained: TexturedPointV1[][] = [];
  for (let index = 0; index < clip.length; index += 1) {
    const a = clip[index];
    const b = clip[(index + 1) % clip.length];
    if (a === undefined || b === undefined) return retained;
    const distance = (point: TexturedPointV1): number => edgeDistance(a, b, point);
    const outside = clipHalfPlane(remaining, distance, false);
    if (isValidFragment(outside)) retained.push(outside);
    remaining = clipHalfPlane(remaining, distance, true);
    if (remaining.length < 3) break;
  }
  return retained;
}

function clipHalfPlane(
  polygon: readonly TexturedPointV1[],
  distance: (point: TexturedPointV1) => number,
  keepInside: boolean,
): TexturedPointV1[] {
  if (polygon.length === 0) return [];
  const output: TexturedPointV1[] = [];
  let previous = polygon[polygon.length - 1];
  if (previous === undefined) return output;
  let previousDistance = distance(previous);
  let previousKept = keepInside
    ? previousDistance >= -CLIP_EPSILON_V1
    : previousDistance <= CLIP_EPSILON_V1;
  for (const current of polygon) {
    const currentDistance = distance(current);
    const currentKept = keepInside
      ? currentDistance >= -CLIP_EPSILON_V1
      : currentDistance <= CLIP_EPSILON_V1;
    if (currentKept !== previousKept) {
      const denominator = f32Sub(previousDistance, currentDistance);
      if (Math.abs(denominator) > BINARY32_EPSILON) {
        const progress = Math.min(Math.max(f32Div(previousDistance, denominator), 0), 1);
        output.push(interpolate(previous, current, progress));
      }
    }
    if (currentKept) output.push(current);
    previous = current;
    previousDistance = currentDistance;
    previousKept = currentKept;
  }
  return removeDuplicateTextured(output);
}

function interpolate(from: TexturedPointV1, to: TexturedPointV1, progress: number): TexturedPointV1 {
  return {
    x: f32Add(from.x, f32Mul(f32Sub(to.x, from.x), progress)),
    y: f32Add(from.y, f32Mul(f32Sub(to.y, from.y), progress)),
    u: f32Add(from.u, f32Mul(f32Sub(to.u, from.u), progress)),
    v: f32Add(from.v, f32Mul(f32Sub(to.v, from.v), progress)),
  };
}

function removeDuplicateTextured(points: readonly TexturedPointV1[]): TexturedPointV1[] {
  const output: TexturedPointV1[] = [];
  for (const point of points) {
    const previous = output[output.length - 1];
    if (previous === undefined || !samePosition(previous, point)) output.push(point);
  }
  const first = output[0];
  const last = output[output.length - 1];
  if (output.length > 1 && first !== undefined && last !== undefined && samePosition(first, last)) output.pop();
  return output;
}

function samePosition(left: ClipPointV1, right: ClipPointV1): boolean {
  return Math.abs(f32Sub(left.x, right.x)) <= CLIP_EPSILON_V1
    && Math.abs(f32Sub(left.y, right.y)) <= CLIP_EPSILON_V1;
}

function isValidFragment(fragment: readonly TexturedPointV1[]): fragment is TexturedPointV1[] {
  const area = signedArea(fragment);
  return fragment.length >= 3 && Number.isFinite(area) && Math.abs(area) > CLIP_EPSILON_V1;
}

function texturedVertexAt(geometry: RuntimeTexturedGeometryV1, index: number): TexturedPointV1 {
  return {
    x: geometry.worldVerticesXy[index * 2] ?? 0,
    y: geometry.worldVerticesXy[index * 2 + 1] ?? 0,
    u: geometry.sourceUvs[index * 2] ?? 0,
    v: geometry.sourceUvs[index * 2 + 1] ?? 0,
  };
}

function emitFragment(
  fragment: readonly TexturedPointV1[],
  vertices: number[],
  uvs: number[],
  indices: number[],
): void {
  const base = vertices.length / 2;
  if (base + fragment.length > MAX_VERTICES) {
    throw new RuntimeErrorV1("resourceLimit", "apply", "Clipped attachment exceeds 65,536 vertices.");
  }
  for (const point of fragment) {
    vertices.push(point.x, point.y);
    uvs.push(point.u, point.v);
  }
  for (let index = 1; index + 1 < fragment.length; index += 1) {
    indices.push(base, base + index, base + index + 1);
  }
}
