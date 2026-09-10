import type { AffineV1, RuntimePointV1 } from "@cane-runtime/core";
import { RuntimeErrorV1 } from "@cane-runtime/core";

export interface CaneCocosMutablePointV1 {
  x: number;
  y: number;
}

export interface CaneCocosMutableMat4V1 {
  m00: number;
  m01: number;
  m02: number;
  m03: number;
  m04: number;
  m05: number;
  m06: number;
  m07: number;
  m08: number;
  m09: number;
  m10: number;
  m11: number;
  m12: number;
  m13: number;
  m14: number;
  m15: number;
}

export interface CaneCocosAffineNodeChannelsV1 {
  x: number;
  y: number;
  rotationDegrees: number;
  scaleX: number;
  scaleY: number;
  skewXDegrees: number;
  skewYDegrees: number;
}

/** Cane and Cocos 2D both use X-right/Y-up; this conversion is intentionally an identity. */
export function writeCanePointToCocosV1<T extends CaneCocosMutablePointV1>(
  point: RuntimePointV1,
  output: T,
): T {
  output.x = point.x;
  output.y = point.y;
  return output;
}

export function writeCocosPointToCaneV1<T extends CaneCocosMutablePointV1>(
  point: Readonly<CaneCocosMutablePointV1>,
  output: T,
): T {
  output.x = point.x;
  output.y = point.y;
  return output;
}

/** Writes the exact 2D affine into Cocos' column-major Mat4 layout. */
export function writeCaneAffineToCocosMat4V1<T extends CaneCocosMutableMat4V1>(
  affine: AffineV1,
  output: T,
): T {
  output.m00 = affine.a;
  output.m01 = affine.b;
  output.m02 = 0;
  output.m03 = 0;
  output.m04 = affine.c;
  output.m05 = affine.d;
  output.m06 = 0;
  output.m07 = 0;
  output.m08 = 0;
  output.m09 = 0;
  output.m10 = 1;
  output.m11 = 0;
  output.m12 = affine.tx;
  output.m13 = affine.ty;
  output.m14 = 0;
  output.m15 = 1;
  return output;
}

/** Reads the 2D columns without a lossy TRS decomposition. */
export function writeCocosMat4ToCaneAffineV1<T extends AffineV1>(
  matrix: Readonly<CaneCocosMutableMat4V1>,
  output: { -readonly [Field in keyof T]: T[Field] },
): T {
  output.a = matrix.m00;
  output.b = matrix.m01;
  output.c = matrix.m04;
  output.d = matrix.m05;
  output.tx = matrix.m12;
  output.ty = matrix.m13;
  return output;
}

/**
 * Exact QR-style decomposition for Cocos Node + non-rotational UISkew.
 * The resulting local matrix is identical for every finite affine, including
 * reflection, negative/zero scale and arbitrary two-axis-authored shear.
 */
export function writeCaneAffineToCocosNodeChannelsV1<T extends CaneCocosAffineNodeChannelsV1>(
  affine: AffineV1,
  output: T,
): T {
  requireFiniteAffineV1(affine);
  const scaleX = Math.hypot(affine.a, affine.b);
  output.x = affine.tx;
  output.y = affine.ty;
  const determinant = affine.a * affine.d - affine.b * affine.c;
  if (scaleX > Number.EPSILON) {
    const rotationRadians = Math.atan2(affine.b, affine.a);
    const scaleY = determinant / scaleX;
    const shearX = (affine.a * affine.c + affine.b * affine.d) / (scaleX * scaleX);
    output.rotationDegrees = rotationRadians * 180 / Math.PI;
    output.scaleX = scaleX;
    output.scaleY = scaleY;
    output.skewXDegrees = Math.atan(shearX) * 180 / Math.PI;
    output.skewYDegrees = 0;
    return output;
  }
  const secondLength = Math.hypot(affine.c, affine.d);
  if (secondLength > Number.EPSILON) {
    const rotationRadians = Math.atan2(-affine.c, affine.d);
    const shearY = (affine.a * affine.c + affine.b * affine.d) / (secondLength * secondLength);
    output.rotationDegrees = rotationRadians * 180 / Math.PI;
    output.scaleX = 0;
    output.scaleY = secondLength;
    output.skewXDegrees = 0;
    output.skewYDegrees = Math.atan(shearY) * 180 / Math.PI;
    return output;
  }
  output.rotationDegrees = 0;
  output.scaleX = 0;
  output.scaleY = 0;
  output.skewXDegrees = 0;
  output.skewYDegrees = 0;
  return output;
}

export function writeTransformCanePointV1<T extends CaneCocosMutablePointV1>(
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

export function writeInverseTransformCanePointV1<T extends CaneCocosMutablePointV1>(
  affine: AffineV1,
  point: RuntimePointV1,
  output: T,
): T {
  const determinant = affine.a * affine.d - affine.b * affine.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON) {
    throw new RuntimeErrorV1(
      "invalidState",
      "cocosInverseAffine",
      "Bone matrix is singular and cannot be inverted.",
      { field: "bone.matrix" },
    );
  }
  const x = point.x - affine.tx;
  const y = point.y - affine.ty;
  output.x = (affine.d * x - affine.c * y) / determinant;
  output.y = (-affine.b * x + affine.a * y) / determinant;
  return output;
}

function requireFiniteAffineV1(affine: AffineV1): void {
  if (![affine.a, affine.b, affine.c, affine.d, affine.tx, affine.ty].every(Number.isFinite)) {
    throw new RuntimeErrorV1(
      "invalidArgument",
      "cocosDecomposeAffine",
      "Affine components must be finite.",
      { field: "affine" },
    );
  }
}
