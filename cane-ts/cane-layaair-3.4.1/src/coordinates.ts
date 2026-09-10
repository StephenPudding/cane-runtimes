import type { AffineV1, RuntimePointV1 } from "@cane-runtime/core";
import { RuntimeErrorV1 } from "@cane-runtime/core";

export interface CaneLayaMutablePointV1 {
  x: number;
  y: number;
}

export interface CaneLayaMutableAffineV1 {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

/** Cane X-right/Y-up point to Laya X-right/Y-down point. */
export function writeCanePointToLayaV1<T extends CaneLayaMutablePointV1>(
  point: RuntimePointV1,
  output: T,
): T {
  output.x = point.x;
  output.y = -point.y;
  return output;
}

export function canePointToLayaV1(point: RuntimePointV1): Laya.Point {
  return writeCanePointToLayaV1(point, new Laya.Point());
}

/** Laya X-right/Y-down point to Cane X-right/Y-up point. */
export function writeLayaPointToCaneV1<T extends CaneLayaMutablePointV1>(
  point: Readonly<CaneLayaMutablePointV1>,
  output: T,
): T {
  output.x = point.x;
  output.y = -point.y;
  return output;
}

export function layaPointToCaneV1(point: Readonly<CaneLayaMutablePointV1>): RuntimePointV1 {
  return writeLayaPointToCaneV1(point, { x: 0, y: 0 });
}

/** Full basis conversion `F * M * F`, retaining shear, reflection and signed scale. */
export function writeCaneAffineToLayaMatrixV1(affine: AffineV1, output: Laya.Matrix): Laya.Matrix {
  output.setTo(affine.a, -affine.b, -affine.c, affine.d, affine.tx, -affine.ty);
  return output;
}

export function caneAffineToLayaMatrixV1(affine: AffineV1): Laya.Matrix {
  return writeCaneAffineToLayaMatrixV1(affine, new Laya.Matrix());
}

/**
 * Applies a complete Cane affine to a Laya Sprite without using
 * `Sprite.transform = matrix`. LayaAir 3.4.1's matrix extractor is lossy for
 * reflection combined with two-axis shear, while its public scale/skew
 * representation can express both matrix columns exactly.
 */
export function applyCaneAffineToLayaSpriteV1(
  affine: AffineV1,
  sprite: Laya.Sprite,
  scratch: Laya.Matrix = new Laya.Matrix(),
): Laya.Matrix {
  writeCaneAffineToLayaMatrixV1(affine, scratch);
  return applyLayaMatrixToSpriteV1(scratch, sprite);
}

/** Applies an arbitrary finite 2D affine through Laya's public TRS/skew API. */
export function applyLayaMatrixToSpriteV1(matrix: Laya.Matrix, sprite: Laya.Sprite): Laya.Matrix {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const scaleY = Math.hypot(matrix.c, matrix.d);
  const yAxisDegrees = scaleX === 0 ? 0 : Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
  const xAxisDegrees = scaleY === 0 ? 0 : Math.atan2(-matrix.c, matrix.d) * 180 / Math.PI;
  sprite.pos(matrix.tx, matrix.ty);
  sprite.rotation = 0;
  sprite.scale(scaleX, scaleY);
  sprite.skew(-xAxisDegrees, yAxisDegrees);
  return matrix;
}

/** The Y reflection is its own inverse. */
export function writeLayaMatrixToCaneAffineV1<T extends CaneLayaMutableAffineV1>(
  matrix: Laya.Matrix,
  output: T,
): T {
  output.a = matrix.a;
  output.b = -matrix.b;
  output.c = -matrix.c;
  output.d = matrix.d;
  output.tx = matrix.tx;
  output.ty = -matrix.ty;
  return output;
}

export function layaMatrixToCaneAffineV1(matrix: Laya.Matrix): AffineV1 {
  return writeLayaMatrixToCaneAffineV1(matrix, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
}

export function writeTransformCanePointV1<T extends CaneLayaMutablePointV1>(
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

export function writeInverseTransformCanePointV1<T extends CaneLayaMutablePointV1>(
  affine: AffineV1,
  point: RuntimePointV1,
  output: T,
): T {
  const determinant = affine.a * affine.d - affine.b * affine.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON) {
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
