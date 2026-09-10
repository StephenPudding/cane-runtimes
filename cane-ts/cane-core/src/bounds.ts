import type {
  RuntimeBoundsAabbV1,
  RuntimeBoundsHitV1,
  RuntimeBoundsPolygonV1,
  RuntimeBoundsSnapshotV1,
} from "./contracts.js";
import { RuntimeErrorV1 } from "./errors.js";
import { deepFreeze } from "./internal.js";

interface MutableRuntimeBoundsAabbV1 {
  empty: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

interface MutableRuntimeBoundsPolygonV1 {
  slotId: string;
  attachmentId: string;
  drawIndex: number;
  readonly worldVerticesXy: number[];
}

interface MutableRuntimeBoundsHitV1 {
  slotId: string;
  attachmentId: string;
  drawIndex: number;
}

const EMPTY_AABB_VALUES_V1 = Object.freeze({
  minX: 0,
  minY: 0,
  maxX: 0,
  maxY: 0,
  width: 0,
  height: 0,
});

/**
 * Retained bounds and hit-test storage for one already-published Runtime frame.
 *
 * `RuntimePlayerV1.writeBounds` overwrites this object. References returned by
 * `polygons`, `writePointHits`, and `writeSegmentHits` remain valid only until
 * the next write into the same RuntimeBoundsV1 instance. Use `snapshot()` when
 * an independently owned result is required.
 */
export class RuntimeBoundsV1 {
  #frameSequence = 0;
  readonly #aabb: MutableRuntimeBoundsAabbV1 = {
    empty: true,
    ...EMPTY_AABB_VALUES_V1,
  };
  readonly #polygonPool: MutableRuntimeBoundsPolygonV1[] = [];
  readonly #polygons: MutableRuntimeBoundsPolygonV1[] = [];
  readonly #hitPool: MutableRuntimeBoundsHitV1[] = [];

  get frameSequence(): number {
    return this.#frameSequence;
  }

  get aabb(): RuntimeBoundsAabbV1 {
    return this.#aabb;
  }

  /** Bounding Box attachments in back-to-front Slot draw order. */
  get polygons(): readonly RuntimeBoundsPolygonV1[] {
    return this.#polygons;
  }

  /** Returns the frontmost Bounding Box attachment containing the point. */
  containsPoint(x: number, y: number): RuntimeBoundsHitV1 | null {
    requireFinitePointV1("containsPoint", x, y);
    for (let index = this.#polygons.length - 1; index >= 0; index -= 1) {
      const polygon = this.#polygons[index];
      if (polygon !== undefined && polygonContainsPointV1(polygon.worldVerticesXy, x, y)) {
        return this.#writeHit(0, polygon);
      }
    }
    return null;
  }

  /** Writes all point hits in front-to-back draw order into retained host storage. */
  writePointHits(x: number, y: number, output: RuntimeBoundsHitV1[]): number {
    requireOutputArrayV1("writePointHits", output);
    requireFinitePointV1("writePointHits", x, y);
    let count = 0;
    for (let index = this.#polygons.length - 1; index >= 0; index -= 1) {
      const polygon = this.#polygons[index];
      if (polygon === undefined || !polygonContainsPointV1(polygon.worldVerticesXy, x, y)) continue;
      output[count] = this.#writeHit(count, polygon);
      count += 1;
    }
    output.length = count;
    return count;
  }

  /** Returns the frontmost Bounding Box attachment intersected by the segment. */
  intersectsSegment(x1: number, y1: number, x2: number, y2: number): RuntimeBoundsHitV1 | null {
    requireFiniteSegmentV1("intersectsSegment", x1, y1, x2, y2);
    for (let index = this.#polygons.length - 1; index >= 0; index -= 1) {
      const polygon = this.#polygons[index];
      if (polygon !== undefined && polygonIntersectsSegmentV1(polygon.worldVerticesXy, x1, y1, x2, y2)) {
        return this.#writeHit(0, polygon);
      }
    }
    return null;
  }

  /** Writes all segment hits in front-to-back draw order into retained host storage. */
  writeSegmentHits(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    output: RuntimeBoundsHitV1[],
  ): number {
    requireOutputArrayV1("writeSegmentHits", output);
    requireFiniteSegmentV1("writeSegmentHits", x1, y1, x2, y2);
    let count = 0;
    for (let index = this.#polygons.length - 1; index >= 0; index -= 1) {
      const polygon = this.#polygons[index];
      if (polygon === undefined
        || !polygonIntersectsSegmentV1(polygon.worldVerticesXy, x1, y1, x2, y2)) continue;
      output[count] = this.#writeHit(count, polygon);
      count += 1;
    }
    output.length = count;
    return count;
  }

  aabbContainsPoint(x: number, y: number): boolean {
    requireFinitePointV1("aabbContainsPoint", x, y);
    const aabb = this.#aabb;
    return !aabb.empty && x >= aabb.minX && x <= aabb.maxX && y >= aabb.minY && y <= aabb.maxY;
  }

  aabbIntersectsSegment(x1: number, y1: number, x2: number, y2: number): boolean {
    requireFiniteSegmentV1("aabbIntersectsSegment", x1, y1, x2, y2);
    if (this.#aabb.empty) return false;
    return segmentIntersectsAabbV1(x1, y1, x2, y2, this.#aabb);
  }

  aabbIntersectsBounds(other: RuntimeBoundsV1): boolean {
    requireBoundsV1("aabbIntersectsBounds", other);
    const left = this.#aabb;
    const right = other.#aabb;
    return !left.empty && !right.empty
      && left.minX <= right.maxX
      && left.maxX >= right.minX
      && left.minY <= right.maxY
      && left.maxY >= right.minY;
  }

  /** Exact polygon intersection for the active Bounding Box attachments. */
  intersectsBounds(other: RuntimeBoundsV1): boolean {
    requireBoundsV1("intersectsBounds", other);
    if (!this.aabbIntersectsBounds(other)) return false;
    for (let leftIndex = 0; leftIndex < this.#polygons.length; leftIndex += 1) {
      const left = this.#polygons[leftIndex];
      if (left === undefined) continue;
      for (let rightIndex = 0; rightIndex < other.#polygons.length; rightIndex += 1) {
        const right = other.#polygons[rightIndex];
        if (right !== undefined
          && polygonsIntersectV1(left.worldVerticesXy, right.worldVerticesXy)) return true;
      }
    }
    return false;
  }

  polygonForAttachment(attachmentId: string): RuntimeBoundsPolygonV1 | null {
    if (typeof attachmentId !== "string" || attachmentId.length === 0) {
      throw new RuntimeErrorV1("invalidArgument", "polygonForAttachment", "attachmentId must be a non-empty string.", {
        field: "attachmentId",
      });
    }
    for (let index = this.#polygons.length - 1; index >= 0; index -= 1) {
      const polygon = this.#polygons[index];
      if (polygon?.attachmentId === attachmentId) return polygon;
    }
    return null;
  }

  /** Creates a deeply owned immutable result. This is intentionally allocating. */
  snapshot(): RuntimeBoundsSnapshotV1 {
    return deepFreeze({
      frameSequence: this.#frameSequence,
      aabb: { ...this.#aabb },
      polygons: this.#polygons.map((polygon) => ({
        slotId: polygon.slotId,
        attachmentId: polygon.attachmentId,
        drawIndex: polygon.drawIndex,
        worldVerticesXy: [...polygon.worldVerticesXy],
      })),
    });
  }

  /** @internal RuntimePlayerV1 write protocol. */
  beginWrite(frameSequence: number): void {
    if (!Number.isSafeInteger(frameSequence) || frameSequence < 0) {
      throw new RuntimeErrorV1("invalidArgument", "writeBounds", "frameSequence must be a non-negative safe integer.", {
        field: "frameSequence",
      });
    }
    this.#frameSequence = frameSequence;
    this.#aabb.empty = true;
    this.#aabb.minX = 0;
    this.#aabb.minY = 0;
    this.#aabb.maxX = 0;
    this.#aabb.maxY = 0;
    this.#aabb.width = 0;
    this.#aabb.height = 0;
    this.#polygons.length = 0;
  }

  /** @internal RuntimePlayerV1 write protocol. */
  includeVertices(worldVerticesXy: readonly number[]): void {
    if (worldVerticesXy.length % 2 !== 0) {
      throw new RuntimeErrorV1("invalidState", "writeBounds", "World vertex buffer must contain x/y pairs.");
    }
    for (let offset = 0; offset < worldVerticesXy.length; offset += 2) {
      const x = worldVerticesXy[offset];
      const y = worldVerticesXy[offset + 1];
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw new RuntimeErrorV1("nonFinite", "writeBounds", "World vertex buffer contains a non-finite point.");
      }
      this.#includePoint(x, y);
    }
    this.#finishAabb();
  }

  /** @internal Returns a retained vertex buffer that the Core evaluator may overwrite. */
  acquirePolygon(slotId: string, attachmentId: string, drawIndex: number): number[] {
    const index = this.#polygons.length;
    let polygon = this.#polygonPool[index];
    if (polygon === undefined) {
      polygon = { slotId, attachmentId, drawIndex, worldVerticesXy: [] };
      this.#polygonPool[index] = polygon;
    } else {
      polygon.slotId = slotId;
      polygon.attachmentId = attachmentId;
      polygon.drawIndex = drawIndex;
      polygon.worldVerticesXy.length = 0;
    }
    this.#polygons[index] = polygon;
    return polygon.worldVerticesXy;
  }

  /** @internal Commits the last acquired polygon after Core geometry evaluation. */
  commitPolygon(): void {
    const polygon = this.#polygons[this.#polygons.length - 1];
    if (polygon === undefined || polygon.worldVerticesXy.length < 6
      || polygon.worldVerticesXy.length % 2 !== 0) {
      if (polygon !== undefined) this.#polygons.length -= 1;
      throw new RuntimeErrorV1("invalidState", "writeBounds", "Bounding Box polygon must contain at least three points.");
    }
    this.includeVertices(polygon.worldVerticesXy);
  }

  #includePoint(x: number, y: number): void {
    const aabb = this.#aabb;
    if (aabb.empty) {
      aabb.empty = false;
      aabb.minX = x;
      aabb.minY = y;
      aabb.maxX = x;
      aabb.maxY = y;
      return;
    }
    if (x < aabb.minX) aabb.minX = x;
    if (x > aabb.maxX) aabb.maxX = x;
    if (y < aabb.minY) aabb.minY = y;
    if (y > aabb.maxY) aabb.maxY = y;
  }

  #finishAabb(): void {
    const aabb = this.#aabb;
    if (aabb.empty) {
      Object.assign(aabb, EMPTY_AABB_VALUES_V1);
      return;
    }
    aabb.width = aabb.maxX - aabb.minX;
    aabb.height = aabb.maxY - aabb.minY;
  }

  #writeHit(index: number, polygon: MutableRuntimeBoundsPolygonV1): RuntimeBoundsHitV1 {
    let hit = this.#hitPool[index];
    if (hit === undefined) {
      hit = { slotId: polygon.slotId, attachmentId: polygon.attachmentId, drawIndex: polygon.drawIndex };
      this.#hitPool[index] = hit;
    } else {
      hit.slotId = polygon.slotId;
      hit.attachmentId = polygon.attachmentId;
      hit.drawIndex = polygon.drawIndex;
    }
    return hit;
  }
}

function requireBoundsV1(operation: string, value: RuntimeBoundsV1): void {
  if (!(value instanceof RuntimeBoundsV1)) {
    throw new RuntimeErrorV1("invalidArgument", operation, "other must be a RuntimeBoundsV1.", { field: "other" });
  }
}

function requireOutputArrayV1(operation: string, output: RuntimeBoundsHitV1[]): void {
  if (!Array.isArray(output)) {
    throw new RuntimeErrorV1("invalidArgument", operation, "output must be an array.", { field: "output" });
  }
}

function requireFinitePointV1(operation: string, x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RuntimeErrorV1("nonFinite", operation, "Point coordinates must be finite.");
  }
}

function requireFiniteSegmentV1(
  operation: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    throw new RuntimeErrorV1("nonFinite", operation, "Segment coordinates must be finite.");
  }
}

function pointOnSegmentV1(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  const scale = Math.max(1, Math.abs(px), Math.abs(py), Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by));
  if (Math.abs(cross) > Number.EPSILON * 32 * scale * scale) return false;
  return px >= Math.min(ax, bx) && px <= Math.max(ax, bx)
    && py >= Math.min(ay, by) && py <= Math.max(ay, by);
}

function polygonContainsPointV1(vertices: readonly number[], x: number, y: number): boolean {
  const pointCount = vertices.length / 2;
  if (pointCount < 3) return false;
  let inside = false;
  let previous = pointCount - 1;
  for (let current = 0; current < pointCount; current += 1) {
    const currentX = vertices[current * 2];
    const currentY = vertices[current * 2 + 1];
    const previousX = vertices[previous * 2];
    const previousY = vertices[previous * 2 + 1];
    if (currentX === undefined || currentY === undefined || previousX === undefined || previousY === undefined) {
      return false;
    }
    if (pointOnSegmentV1(x, y, previousX, previousY, currentX, currentY)) return true;
    if ((currentY > y) !== (previousY > y)) {
      const intersectionX = ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
      if (x < intersectionX) inside = !inside;
    }
    previous = current;
  }
  return inside;
}

function orientationV1(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segmentsIntersectV1(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const o1 = orientationV1(ax, ay, bx, by, cx, cy);
  const o2 = orientationV1(ax, ay, bx, by, dx, dy);
  const o3 = orientationV1(cx, cy, dx, dy, ax, ay);
  const o4 = orientationV1(cx, cy, dx, dy, bx, by);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0))
    && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return (o1 === 0 && pointOnSegmentV1(cx, cy, ax, ay, bx, by))
    || (o2 === 0 && pointOnSegmentV1(dx, dy, ax, ay, bx, by))
    || (o3 === 0 && pointOnSegmentV1(ax, ay, cx, cy, dx, dy))
    || (o4 === 0 && pointOnSegmentV1(bx, by, cx, cy, dx, dy));
}

function polygonIntersectsSegmentV1(
  vertices: readonly number[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  if (polygonContainsPointV1(vertices, x1, y1) || polygonContainsPointV1(vertices, x2, y2)) return true;
  const pointCount = vertices.length / 2;
  let previous = pointCount - 1;
  for (let current = 0; current < pointCount; current += 1) {
    const ax = vertices[previous * 2];
    const ay = vertices[previous * 2 + 1];
    const bx = vertices[current * 2];
    const by = vertices[current * 2 + 1];
    if (ax !== undefined && ay !== undefined && bx !== undefined && by !== undefined
      && segmentsIntersectV1(x1, y1, x2, y2, ax, ay, bx, by)) return true;
    previous = current;
  }
  return false;
}

function polygonsIntersectV1(left: readonly number[], right: readonly number[]): boolean {
  const leftX = left[0];
  const leftY = left[1];
  const rightX = right[0];
  const rightY = right[1];
  if (leftX === undefined || leftY === undefined || rightX === undefined || rightY === undefined) return false;
  if (polygonContainsPointV1(left, rightX, rightY) || polygonContainsPointV1(right, leftX, leftY)) return true;
  const leftCount = left.length / 2;
  const rightCount = right.length / 2;
  for (let leftPoint = 0; leftPoint < leftCount; leftPoint += 1) {
    const leftNext = (leftPoint + 1) % leftCount;
    const ax = left[leftPoint * 2];
    const ay = left[leftPoint * 2 + 1];
    const bx = left[leftNext * 2];
    const by = left[leftNext * 2 + 1];
    if (ax === undefined || ay === undefined || bx === undefined || by === undefined) continue;
    for (let rightPoint = 0; rightPoint < rightCount; rightPoint += 1) {
      const rightNext = (rightPoint + 1) % rightCount;
      const cx = right[rightPoint * 2];
      const cy = right[rightPoint * 2 + 1];
      const dx = right[rightNext * 2];
      const dy = right[rightNext * 2 + 1];
      if (cx !== undefined && cy !== undefined && dx !== undefined && dy !== undefined
        && segmentsIntersectV1(ax, ay, bx, by, cx, cy, dx, dy)) return true;
    }
  }
  return false;
}

function segmentIntersectsAabbV1(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  aabb: RuntimeBoundsAabbV1,
): boolean {
  let minimum = 0;
  let maximum = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const tests: readonly (readonly [number, number])[] = [
    [-dx, x1 - aabb.minX],
    [dx, aabb.maxX - x1],
    [-dy, y1 - aabb.minY],
    [dy, aabb.maxY - y1],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const ratio = q / p;
    if (p < 0) {
      if (ratio > maximum) return false;
      if (ratio > minimum) minimum = ratio;
    } else {
      if (ratio < minimum) return false;
      if (ratio < maximum) maximum = ratio;
    }
  }
  return true;
}
