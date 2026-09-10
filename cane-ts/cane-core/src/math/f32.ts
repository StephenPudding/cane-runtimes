export const F32_PI = Math.fround(Math.PI);
export const F32_DEGREES_TO_RADIANS = Math.fround(F32_PI / Math.fround(180));
export const F32_RADIANS_TO_DEGREES = Math.fround(Math.fround(180) / F32_PI);

export function f32(value: number): number {
  return Math.fround(value);
}

export function f32Add(left: number, right: number): number {
  return Math.fround(Math.fround(left) + Math.fround(right));
}

export function f32Sub(left: number, right: number): number {
  return Math.fround(Math.fround(left) - Math.fround(right));
}

export function f32Mul(left: number, right: number): number {
  return Math.fround(Math.fround(left) * Math.fround(right));
}

export function f32Div(left: number, right: number): number {
  return Math.fround(Math.fround(left) / Math.fround(right));
}

export function f32Hypot(x: number, y: number): number {
  return Math.fround(Math.sqrt(f32Add(f32Mul(x, x), f32Mul(y, y))));
}

/**
 * Projects two binary32 matrix components to a binary32 axis length.
 *
 * Finite binary32 values can be squared safely in JavaScript's binary64
 * arithmetic, so this avoids the allocation-heavy generic Math.hypot path.
 * Non-finite inputs retain Math.hypot's observable edge-case semantics.
 */
export function f32MatrixAxisLength(x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return Math.fround(Math.hypot(x, y));
  }
  return Math.fround(Math.sqrt(x * x + y * y));
}

export function degreesToRadians(degrees: number): number {
  return f32Mul(degrees, F32_DEGREES_TO_RADIANS);
}

export function finiteF32(value: number): number {
  const result = Math.fround(value);
  if (!Number.isFinite(result)) {
    throw new RangeError("Expected a finite binary32 value.");
  }
  return result;
}
