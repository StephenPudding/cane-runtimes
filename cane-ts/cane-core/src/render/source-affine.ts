import type { AffineV1 } from "../contracts.js";
import { determinantV1 } from "../math/affine.js";
import { f32, f32Div, f32Mul, f32Sub } from "../math/f32.js";

/** Diagnostic projection only; this never rewrites authoritative world vertices. */
export function hasFiniteSourceProjectionV1(source: AffineV1, world: readonly number[]): boolean {
  const determinant = determinantV1(source);
  if (!Number.isFinite(determinant) || determinant === 0) return false;
  const a = f32Div(source.d, determinant), b = f32Div(-source.b, determinant);
  const c = f32Div(-source.c, determinant), d = f32Div(source.a, determinant);
  const tx = f32Div(f32Sub(f32Mul(source.c, source.ty), f32Mul(source.d, source.tx)), determinant);
  const ty = f32Div(f32Sub(f32Mul(source.b, source.tx), f32Mul(source.a, source.ty)), determinant);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)
    || !Number.isFinite(d) || !Number.isFinite(tx) || !Number.isFinite(ty)) return false;
  for (let i = 0; i < world.length; i += 2) {
    const x = world[i] as number, y = world[i + 1] as number;
    if (!Number.isFinite(f32(f32(f32Mul(a, x) + f32Mul(c, y)) + tx))
      || !Number.isFinite(f32(f32(f32Mul(b, x) + f32Mul(d, y)) + ty))) return false;
  }
  return true;
}
