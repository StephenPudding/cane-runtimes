import {
  RuntimeBoundsV1,
  RuntimeErrorV1,
  type RuntimeBoundsHitV1,
  type RuntimeBoundsOptionsV1,
} from "@cane-runtime/core";
import type { CaneLayaRuntime } from "./runtime.js";

export interface CaneLayaBoundsProviderOptionsV1 extends RuntimeBoundsOptionsV1 {
  readonly alwaysRefresh?: boolean;
}

/** Retained Y-down/scene-global facade over Core's current-frame bounds. */
export class CaneLayaBoundsProviderV1 {
  readonly runtime: CaneLayaRuntime;
  readonly coreBounds = new RuntimeBoundsV1();
  readonly #localAabb = new Laya.Rectangle();
  readonly #globalAabb = new Laya.Rectangle();
  readonly #scratch = new Laya.Point();
  #options: Required<CaneLayaBoundsProviderOptionsV1>;
  #lastSequence = -1;

  constructor(runtime: CaneLayaRuntime, options: CaneLayaBoundsProviderOptionsV1 = {}) {
    this.runtime = runtime;
    this.#options = normalizeOptionsV1(options);
  }

  get options(): CaneLayaBoundsProviderOptionsV1 { return { ...this.#options }; }

  setOptions(options: CaneLayaBoundsProviderOptionsV1): this {
    this.#options = normalizeOptionsV1(options);
    this.#lastSequence = -1;
    return this;
  }

  sync(force = false): RuntimeBoundsV1 {
    const sequence = this.runtime.player.currentFrame.sequence;
    if (force || this.#options.alwaysRefresh || sequence !== this.#lastSequence) {
      this.runtime.player.writeBounds(this.coreBounds, this.#options);
      this.#lastSequence = sequence;
    }
    return this.coreBounds;
  }

  writeLocalAabb(output: Laya.Rectangle = this.#localAabb): Laya.Rectangle {
    const aabb = this.sync().aabb;
    return aabb.empty
      ? output.setTo(0, 0, 0, 0)
      : output.setTo(aabb.minX, -aabb.maxY, aabb.width, aabb.height);
  }

  writeGlobalAabb(output: Laya.Rectangle = this.#globalAabb): Laya.Rectangle {
    const local = this.writeLocalAabb(this.#localAabb);
    if (this.coreBounds.aabb.empty) return output.setTo(0, 0, 0, 0);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < 4; index += 1) {
      this.#scratch.setTo(
        (index & 1) === 0 ? local.x : local.x + local.width,
        (index & 2) === 0 ? local.y : local.y + local.height,
      );
      this.runtime.localToGlobal(this.#scratch, false);
      minX = Math.min(minX, this.#scratch.x);
      minY = Math.min(minY, this.#scratch.y);
      maxX = Math.max(maxX, this.#scratch.x);
      maxY = Math.max(maxY, this.#scratch.y);
    }
    return output.setTo(minX, minY, maxX - minX, maxY - minY);
  }

  containsLocalPoint(point: Readonly<{ x: number; y: number }>): RuntimeBoundsHitV1 | null {
    requirePointV1(point, "layaContainsLocalPoint");
    return this.sync().containsPoint(point.x, -point.y);
  }

  containsGlobalPoint(point: Readonly<{ x: number; y: number }>): RuntimeBoundsHitV1 | null {
    this.#toCaneLocalV1(point, "layaContainsGlobalPoint");
    return this.sync().containsPoint(this.#scratch.x, this.#scratch.y);
  }

  intersectsLocalSegment(
    start: Readonly<{ x: number; y: number }>,
    end: Readonly<{ x: number; y: number }>,
  ): RuntimeBoundsHitV1 | null {
    requirePointV1(start, "layaIntersectsLocalSegment");
    requirePointV1(end, "layaIntersectsLocalSegment");
    return this.sync().intersectsSegment(start.x, -start.y, end.x, -end.y);
  }

  intersectsGlobalSegment(
    start: Readonly<{ x: number; y: number }>,
    end: Readonly<{ x: number; y: number }>,
  ): RuntimeBoundsHitV1 | null {
    this.#toCaneLocalV1(start, "layaIntersectsGlobalSegment");
    const x1 = this.#scratch.x;
    const y1 = this.#scratch.y;
    this.#toCaneLocalV1(end, "layaIntersectsGlobalSegment");
    return this.sync().intersectsSegment(x1, y1, this.#scratch.x, this.#scratch.y);
  }

  aabbContainsLocalPoint(point: Readonly<{ x: number; y: number }>): boolean {
    requirePointV1(point, "layaAabbContainsLocalPoint");
    return this.sync().aabbContainsPoint(point.x, -point.y);
  }

  aabbContainsGlobalPoint(point: Readonly<{ x: number; y: number }>): boolean {
    this.#toCaneLocalV1(point, "layaAabbContainsGlobalPoint");
    return this.sync().aabbContainsPoint(this.#scratch.x, this.#scratch.y);
  }

  #toCaneLocalV1(point: Readonly<{ x: number; y: number }>, operation: string): void {
    requirePointV1(point, operation);
    this.#scratch.setTo(point.x, point.y);
    this.runtime.globalToLocal(this.#scratch, false);
    this.#scratch.y = -this.#scratch.y;
  }
}

function normalizeOptionsV1(
  options: CaneLayaBoundsProviderOptionsV1,
): Required<CaneLayaBoundsProviderOptionsV1> {
  if (options === null || typeof options !== "object") {
    throw new RuntimeErrorV1("invalidArgument", "layaCreateBounds", "options must be an object.", {
      field: "options",
    });
  }
  return {
    includeRenderGeometry: options.includeRenderGeometry ?? true,
    includeBoundingBoxes: options.includeBoundingBoxes ?? true,
    includeTransparent: options.includeTransparent ?? false,
    alwaysRefresh: options.alwaysRefresh ?? false,
  };
}

function requirePointV1(point: Readonly<{ x: number; y: number }>, operation: string): void {
  if (point === null || typeof point !== "object" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RuntimeErrorV1("invalidArgument", operation, "point must contain finite x/y.", {
      field: "point",
    });
  }
}
