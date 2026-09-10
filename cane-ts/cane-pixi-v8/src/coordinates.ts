import type { AffineV1, RuntimePointV1 } from "@cane-runtime/core";
import { RuntimeErrorV1 } from "@cane-runtime/core";
import { Matrix, Point, type PointData } from "pixi.js";

export interface MutablePointV1 {
  x: number;
  y: number;
}

export interface MutableAffineV1 {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

/** Cane X-right/Y-up point to Pixi X-right/Y-down point. */
export function writeCanePointToPixiV1<T extends MutablePointV1>(point: RuntimePointV1, output: T): T {
  output.x = point.x;
  output.y = -point.y;
  return output;
}

export function canePointToPixiV1(point: RuntimePointV1): Point {
  return writeCanePointToPixiV1(point, new Point());
}

/** Pixi X-right/Y-down point to Cane X-right/Y-up point. */
export function writePixiPointToCaneV1<T extends MutablePointV1>(point: PointData, output: T): T {
  output.x = point.x;
  output.y = -point.y;
  return output;
}

export function pixiPointToCaneV1(point: PointData): RuntimePointV1 {
  return writePixiPointToCaneV1(point, { x: 0, y: 0 });
}

/**
 * Converts a complete affine basis with `F * M * F`, where
 * `F = diag(1,-1)`. This preserves shear, reflection and signed scale.
 */
export function writeCaneAffineToPixiMatrixV1(affine: AffineV1, output: Matrix): Matrix {
  return output.set(
    affine.a,
    -affine.b,
    -affine.c,
    affine.d,
    affine.tx,
    -affine.ty,
  );
}

export function caneAffineToPixiMatrixV1(affine: AffineV1): Matrix {
  return writeCaneAffineToPixiMatrixV1(affine, new Matrix());
}

/** The coordinate reflection is its own inverse. */
export function writePixiMatrixToCaneAffineV1<T extends MutableAffineV1>(matrix: Matrix, output: T): T {
  output.a = matrix.a;
  output.b = -matrix.b;
  output.c = -matrix.c;
  output.d = matrix.d;
  output.tx = matrix.tx;
  output.ty = -matrix.ty;
  return output;
}

export function pixiMatrixToCaneAffineV1(matrix: Matrix): AffineV1 {
  return writePixiMatrixToCaneAffineV1(matrix, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
}

export function writeTransformCanePointV1<T extends MutablePointV1>(
  affine: AffineV1,
  point: RuntimePointV1,
  output: T,
): T {
  const x = point.x;
  const y = point.y;
  output.x = affine.a * x + affine.c * y + affine.tx;
  output.y = affine.b * x + affine.d * y + affine.ty;
  return output;
}

export function writeInverseTransformCanePointV1<T extends MutablePointV1>(
  affine: AffineV1,
  point: RuntimePointV1,
  output: T,
): T {
  const determinant = affine.a * affine.d - affine.b * affine.c;
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new RuntimeErrorV1(
      "invalidState",
      "globalToBone",
      "Bone world affine is singular and cannot be inverted.",
      { field: "bone.matrix" },
    );
  }
  const x = point.x - affine.tx;
  const y = point.y - affine.ty;
  output.x = (affine.d * x - affine.c * y) / determinant;
  output.y = (-affine.b * x + affine.a * y) / determinant;
  return output;
}
