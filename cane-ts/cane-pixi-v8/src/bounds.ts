import {
  RuntimeBoundsV1,
  RuntimeErrorV1,
  type RuntimeBoundsHitV1,
  type RuntimeBoundsOptionsV1,
} from "@cane-runtime/core";
import { Point, Rectangle, type PointData } from "pixi.js";
import type { CanePixiRuntime } from "./runtime.js";

export interface CanePixiBoundsProviderOptionsV1 extends RuntimeBoundsOptionsV1 {
  /** Recompute on every query instead of only after Core publishes a new frame. */
  readonly alwaysRefresh?: boolean;
}

/**
 * Retained Pixi-coordinate facade over Core's authoritative current-frame bounds.
 *
 * Queries never advance animation or solve constraints. Local inputs/outputs use
 * the CanePixiRuntime Container's Pixi Y-down coordinates; global methods also
 * include every parent transform in the Pixi scene graph.
 */
export class CanePixiBoundsProviderV1 {
  readonly runtime: CanePixiRuntime;
  readonly coreBounds = new RuntimeBoundsV1();
  readonly #localAabb = new Rectangle();
  readonly #globalAabb = new Rectangle();
  readonly #localScratch = new Point();
  readonly #globalScratch = new Point();
  readonly #cornerScratch = new Point();
  #options: Required<CanePixiBoundsProviderOptionsV1>;
  #lastSequence = -1;

  constructor(runtime: CanePixiRuntime, options: CanePixiBoundsProviderOptionsV1 = {}) {
    this.runtime = runtime;
    this.#options = normalizeBoundsProviderOptionsV1(options);
  }

  get options(): CanePixiBoundsProviderOptionsV1 {
    return { ...this.#options };
  }

  setOptions(options: CanePixiBoundsProviderOptionsV1): this {
    this.#options = normalizeBoundsProviderOptionsV1(options);
    this.#lastSequence = -1;
    return this;
  }

  /** Refreshes retained Core storage. Repeated stable-frame calls do no work. */
  sync(force = false): RuntimeBoundsV1 {
    const sequence = this.runtime.player.currentFrame.sequence;
    if (force || this.#options.alwaysRefresh || sequence !== this.#lastSequence) {
      this.runtime.player.writeBounds(this.coreBounds, this.#options);
      this.#lastSequence = sequence;
    }
    return this.coreBounds;
  }

  /** Writes the current AABB in this Runtime Container's Pixi-local space. */
  writeLocalAabb(output: Rectangle = this.#localAabb): Rectangle {
    requireRectangleV1(output, "writeLocalAabb");
    const aabb = this.sync().aabb;
    if (aabb.empty) return setRectangleV1(output, 0, 0, 0, 0);
    return setRectangleV1(output, aabb.minX, -aabb.maxY, aabb.width, aabb.height);
  }

  /** Writes a scene-global AABB, including arbitrary Pixi parent transforms. */
  writeGlobalAabb(output: Rectangle = this.#globalAabb): Rectangle {
    requireRectangleV1(output, "writeGlobalAabb");
    const local = this.writeLocalAabb(this.#localAabb);
    if (local.width === 0 && local.height === 0 && this.coreBounds.aabb.empty) {
      return setRectangleV1(output, 0, 0, 0, 0);
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < 4; index += 1) {
      this.#cornerScratch.x = (index & 1) === 0 ? local.x : local.x + local.width;
      this.#cornerScratch.y = (index & 2) === 0 ? local.y : local.y + local.height;
      this.runtime.toGlobal(this.#cornerScratch, this.#globalScratch);
      minX = Math.min(minX, this.#globalScratch.x);
      minY = Math.min(minY, this.#globalScratch.y);
      maxX = Math.max(maxX, this.#globalScratch.x);
      maxY = Math.max(maxY, this.#globalScratch.y);
    }
    return setRectangleV1(output, minX, minY, maxX - minX, maxY - minY);
  }

  /** Frontmost Bounding Box hit for a point in Runtime Pixi-local space. */
  containsLocalPoint(point: PointData): RuntimeBoundsHitV1 | null {
    requirePointV1(point, "containsLocalPoint");
    return this.sync().containsPoint(point.x, -point.y);
  }

  /** Frontmost Bounding Box hit for a Pixi global point. */
  containsGlobalPoint(point: PointData): RuntimeBoundsHitV1 | null {
    this.#globalToCaneV1(point, "containsGlobalPoint");
    return this.sync().containsPoint(this.#localScratch.x, this.#localScratch.y);
  }

  /** Bounding Box intersection for a segment in Runtime Pixi-local space. */
  intersectsLocalSegment(start: PointData, end: PointData): RuntimeBoundsHitV1 | null {
    requirePointV1(start, "intersectsLocalSegment");
    requirePointV1(end, "intersectsLocalSegment");
    return this.sync().intersectsSegment(start.x, -start.y, end.x, -end.y);
  }

  /** Bounding Box intersection for a Pixi global segment. */
  intersectsGlobalSegment(start: PointData, end: PointData): RuntimeBoundsHitV1 | null {
    this.#globalToCaneV1(start, "intersectsGlobalSegment");
    const x1 = this.#localScratch.x;
    const y1 = this.#localScratch.y;
    this.#globalToCaneV1(end, "intersectsGlobalSegment");
    return this.sync().intersectsSegment(x1, y1, this.#localScratch.x, this.#localScratch.y);
  }

  aabbContainsLocalPoint(point: PointData): boolean {
    requirePointV1(point, "aabbContainsLocalPoint");
    return this.sync().aabbContainsPoint(point.x, -point.y);
  }

  aabbContainsGlobalPoint(point: PointData): boolean {
    this.#globalToCaneV1(point, "aabbContainsGlobalPoint");
    return this.sync().aabbContainsPoint(this.#localScratch.x, this.#localScratch.y);
  }

  #globalToCaneV1(point: PointData, operation: string): void {
    requirePointV1(point, operation);
    this.runtime.toLocal(point, undefined, this.#localScratch);
    this.#localScratch.y = -this.#localScratch.y;
  }
}

function normalizeBoundsProviderOptionsV1(
  options: CanePixiBoundsProviderOptionsV1,
): Required<CanePixiBoundsProviderOptionsV1> {
  if (options === null || typeof options !== "object") {
    throw new RuntimeErrorV1("invalidArgument", "pixiCreateBoundsProvider", "options must be an object.", {
      field: "options",
    });
  }
  const result = {
    includeRenderGeometry: options.includeRenderGeometry ?? true,
    includeBoundingBoxes: options.includeBoundingBoxes ?? true,
    includeTransparent: options.includeTransparent ?? false,
    alwaysRefresh: options.alwaysRefresh ?? false,
  };
  for (const [field, value] of Object.entries(result)) {
    if (typeof value !== "boolean") {
      throw new RuntimeErrorV1("invalidArgument", "pixiCreateBoundsProvider", `${field} must be boolean.`, {
        field,
      });
    }
  }
  return result;
}

function requirePointV1(point: PointData, operation: string): void {
  if (point === null || typeof point !== "object" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RuntimeErrorV1("invalidArgument", operation, "point must contain finite x/y coordinates.", {
      field: "point",
    });
  }
}

function requireRectangleV1(output: Rectangle, operation: string): void {
  if (!(output instanceof Rectangle)) {
    throw new RuntimeErrorV1("invalidArgument", operation, "output must be a Pixi Rectangle.", {
      field: "output",
    });
  }
}

function setRectangleV1(
  output: Rectangle,
  x: number,
  y: number,
  width: number,
  height: number,
): Rectangle {
  output.x = x;
  output.y = y;
  output.width = width;
  output.height = height;
  return output;
}
