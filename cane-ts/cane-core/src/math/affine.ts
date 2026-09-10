import type {
  AffineV1,
  BoneTransformModeV1,
  RootTransformV1,
  RuntimeBoneV1,
} from "../contracts.js";
import {
  F32_DEGREES_TO_RADIANS,
  F32_PI,
  F32_RADIANS_TO_DEGREES,
  degreesToRadians,
  f32,
  f32Add,
  f32Div,
  f32Hypot,
  f32Mul,
  f32Sub,
} from "./f32.js";

export const IDENTITY_AFFINE_V1: AffineV1 = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
});

export const IDENTITY_ROOT_TRANSFORM_V1: RootTransformV1 = Object.freeze({
  x: 0,
  y: 0,
  rotationDegrees: 0,
  scaleX: 1,
  scaleY: 1,
});

type MutableAffineV1 = { -readonly [Property in keyof AffineV1]: AffineV1[Property] };

function affine(
  a: number,
  b: number,
  c: number,
  d: number,
  tx: number,
  ty: number,
  output: AffineV1 | null = null,
): AffineV1 {
  const nextA = f32(a);
  const nextB = f32(b);
  const nextC = f32(c);
  const nextD = f32(d);
  const nextTx = f32(tx);
  const nextTy = f32(ty);
  if (output !== null) {
    const mutable = output as MutableAffineV1;
    mutable.a = nextA;
    mutable.b = nextB;
    mutable.c = nextC;
    mutable.d = nextD;
    mutable.tx = nextTx;
    mutable.ty = nextTy;
    return output;
  }
  return { a: nextA, b: nextB, c: nextC, d: nextD, tx: nextTx, ty: nextTy };
}

export function multiplyAffineV1(
  left: AffineV1,
  right: AffineV1,
  output: AffineV1 | null = null,
): AffineV1 {
  // Normalize each public input exactly once, then round at the same f32
  // multiplication/addition boundaries as Rust. Besides avoiding redundant
  // Math.fround calls, caching all fields makes output aliasing either input
  // safe without allocating a temporary affine in performance mode.
  const la = Math.fround(left.a);
  const lb = Math.fround(left.b);
  const lc = Math.fround(left.c);
  const ld = Math.fround(left.d);
  const ltx = Math.fround(left.tx);
  const lty = Math.fround(left.ty);
  const ra = Math.fround(right.a);
  const rb = Math.fround(right.b);
  const rc = Math.fround(right.c);
  const rd = Math.fround(right.d);
  const rtx = Math.fround(right.tx);
  const rty = Math.fround(right.ty);
  const a = Math.fround(Math.fround(la * ra) + Math.fround(lc * rb));
  const b = Math.fround(Math.fround(lb * ra) + Math.fround(ld * rb));
  const c = Math.fround(Math.fround(la * rc) + Math.fround(lc * rd));
  const d = Math.fround(Math.fround(lb * rc) + Math.fround(ld * rd));
  const tx = Math.fround(Math.fround(Math.fround(la * rtx) + Math.fround(lc * rty)) + ltx);
  const ty = Math.fround(Math.fround(Math.fround(lb * rtx) + Math.fround(ld * rty)) + lty);
  if (output !== null) {
    const mutable = output as MutableAffineV1;
    mutable.a = a;
    mutable.b = b;
    mutable.c = c;
    mutable.d = d;
    mutable.tx = tx;
    mutable.ty = ty;
    return output;
  }
  return { a, b, c, d, tx, ty };
}

export function transformPointV1(
  matrix: AffineV1,
  x: number,
  y: number,
  output: [number, number] | null = null,
): readonly [number, number] {
  const nextX = f32Add(f32Add(f32Mul(matrix.a, x), f32Mul(matrix.c, y)), matrix.tx);
  const nextY = f32Add(f32Add(f32Mul(matrix.b, x), f32Mul(matrix.d, y)), matrix.ty);
  if (output !== null) {
    output[0] = nextX;
    output[1] = nextY;
    return output;
  }
  return [nextX, nextY];
}

export function determinantV1(matrix: AffineV1): number {
  return f32Sub(f32Mul(matrix.a, matrix.d), f32Mul(matrix.c, matrix.b));
}

export function localBoneAffineV1(bone: RuntimeBoneV1, output: AffineV1 | null = null): AffineV1 {
  const rx = degreesToRadians(f32Add(bone.rotation, bone.shearX));
  const ry = degreesToRadians(f32Add(bone.rotation, bone.shearY));
  return affine(
    f32Mul(Math.cos(rx), bone.scaleX),
    f32Mul(Math.sin(rx), bone.scaleX),
    f32Mul(-Math.sin(ry), bone.scaleY),
    f32Mul(Math.cos(ry), bone.scaleY),
    bone.x,
    bone.y,
    output,
  );
}

export function rootAffineV1(root: RootTransformV1, output: AffineV1 | null = null): AffineV1 {
  const rotation = degreesToRadians(root.rotationDegrees);
  const cosine = f32(Math.cos(rotation));
  const sine = f32(Math.sin(rotation));
  return affine(
    f32Mul(cosine, root.scaleX),
    f32Mul(sine, root.scaleX),
    f32Mul(-sine, root.scaleY),
    f32Mul(cosine, root.scaleY),
    root.x,
    root.y,
    output,
  );
}

export function regionLocalAffineV1(region: {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}, output: AffineV1 | null = null): AffineV1 {
  const rotation = degreesToRadians(region.rotation);
  const cosine = f32(Math.cos(rotation));
  const sine = f32(Math.sin(rotation));
  return affine(
    f32Mul(cosine, region.scaleX),
    f32Mul(sine, region.scaleX),
    f32Mul(-sine, region.scaleY),
    f32Mul(cosine, region.scaleY),
    region.x,
    region.y,
    output,
  );
}

export function childWorldAffineV1(
  parent: AffineV1,
  bone: RuntimeBoneV1,
  mode: BoneTransformModeV1 = bone.transformMode,
  output: AffineV1 | null = null,
): AffineV1 {
  if (mode === "normal") {
    const local = localBoneAffineV1(bone, output === parent ? null : output);
    return multiplyAffineV1(parent, local, output);
  }
  if (mode === "onlyTranslation") return childWorldOnlyTranslationV1(parent, bone, output);
  if (mode === "noRotationOrReflection") return childWorldNoRotationOrReflectionV1(parent, bone, output);
  return childWorldNoScaleV1(parent, bone, mode, output);
}

function childWorldOnlyTranslationV1(
  parent: AffineV1,
  bone: RuntimeBoneV1,
  output: AffineV1 | null,
): AffineV1 {
  const worldX = f32Add(f32Add(f32Mul(parent.a, bone.x), f32Mul(parent.c, bone.y)), parent.tx);
  const worldY = f32Add(f32Add(f32Mul(parent.b, bone.x), f32Mul(parent.d, bone.y)), parent.ty);
  const local = localBoneAffineV1(bone, output === parent ? null : output);
  return affine(local.a, local.b, local.c, local.d, worldX, worldY, output);
}

function childWorldNoRotationOrReflectionV1(
  parent: AffineV1,
  bone: RuntimeBoneV1,
  output: AffineV1 | null,
): AffineV1 {
  // This is the hottest inherited-transform path for constrained rigs. Keep
  // every Rust-compatible binary32 rounding boundary explicit here so V8 can
  // optimize the whole numeric kernel without crossing the generic f32 helper
  // call boundary dozens of times per descendant propagation.
  const parentA = Math.fround(parent.a);
  const parentB = Math.fround(parent.b);
  const parentC = Math.fround(parent.c);
  const parentD = Math.fround(parent.d);
  const boneX = Math.fround(bone.x);
  const boneY = Math.fround(bone.y);
  const worldX = Math.fround(
    Math.fround(Math.fround(parentA * boneX) + Math.fround(parentC * boneY))
      + Math.fround(parent.tx),
  );
  const worldY = Math.fround(
    Math.fround(Math.fround(parentB * boneX) + Math.fround(parentD * boneY))
      + Math.fround(parent.ty),
  );

  let pa = parentA;
  let pb = parentC;
  let pc = parentB;
  let pd = parentD;
  const squared = Math.fround(Math.fround(pa * pa) + Math.fround(pc * pc));
  let parentRotation: number;

  if (squared > Math.fround(0.0001)) {
    const numerator = Math.abs(Math.fround(Math.fround(pa * pd) - Math.fround(pb * pc)));
    const scale = Math.fround(numerator / squared);
    pb = Math.fround(pc * scale);
    pd = Math.fround(pa * scale);
    parentRotation = Math.fround(
      Math.fround(Math.atan2(pc, pa)) * F32_RADIANS_TO_DEGREES,
    );
  } else {
    pa = 0;
    pc = 0;
    parentRotation = Math.fround(
      90 - Math.fround(Math.fround(Math.atan2(pd, pb)) * F32_RADIANS_TO_DEGREES),
    );
  }

  const rxDegrees = Math.fround(
    Math.fround(Math.fround(bone.rotation) + Math.fround(bone.shearX)) - parentRotation,
  );
  const ryDegrees = Math.fround(
    Math.fround(
      Math.fround(Math.fround(bone.rotation) + Math.fround(bone.shearY)) - parentRotation,
    ) + 90,
  );
  const rx = Math.fround(rxDegrees * F32_DEGREES_TO_RADIANS);
  const ry = Math.fround(ryDegrees * F32_DEGREES_TO_RADIANS);
  const scaleX = Math.fround(bone.scaleX);
  const scaleY = Math.fround(bone.scaleY);
  const la = Math.fround(Math.fround(Math.cos(rx)) * scaleX);
  const lc = Math.fround(Math.fround(Math.sin(rx)) * scaleX);
  const lb = Math.fround(Math.fround(Math.cos(ry)) * scaleY);
  const ld = Math.fround(Math.fround(Math.sin(ry)) * scaleY);
  const nextA = Math.fround(Math.fround(pa * la) - Math.fround(pb * lc));
  const nextB = Math.fround(Math.fround(pc * la) + Math.fround(pd * lc));
  const nextC = Math.fround(Math.fround(pa * lb) - Math.fround(pb * ld));
  const nextD = Math.fround(Math.fround(pc * lb) + Math.fround(pd * ld));

  if (output !== null) {
    const mutable = output as MutableAffineV1;
    mutable.a = nextA;
    mutable.b = nextB;
    mutable.c = nextC;
    mutable.d = nextD;
    mutable.tx = worldX;
    mutable.ty = worldY;
    return output;
  }
  return { a: nextA, b: nextB, c: nextC, d: nextD, tx: worldX, ty: worldY };
}

function childWorldNoScaleV1(
  parent: AffineV1,
  bone: RuntimeBoneV1,
  mode: "noScale" | "noScaleOrReflection",
  output: AffineV1 | null,
): AffineV1 {
  const worldX = f32Add(f32Add(f32Mul(parent.a, bone.x), f32Mul(parent.c, bone.y)), parent.tx);
  const worldY = f32Add(f32Add(f32Mul(parent.b, bone.x), f32Mul(parent.d, bone.y)), parent.ty);
  return childWorldWithoutScaleV1(parent, bone, mode, worldX, worldY, output);
}

function childWorldWithoutScaleV1(
  parent: AffineV1,
  bone: RuntimeBoneV1,
  mode: "noScale" | "noScaleOrReflection",
  worldX: number,
  worldY: number,
  output: AffineV1 | null,
): AffineV1 {
  const rotation = degreesToRadians(bone.rotation);
  const cosine = f32(Math.cos(rotation));
  const sine = f32(Math.sin(rotation));
  let za = f32Add(f32Mul(parent.a, cosine), f32Mul(parent.c, sine));
  let zc = f32Add(f32Mul(parent.b, cosine), f32Mul(parent.d, sine));
  const axisLength = f32Hypot(za, zc);

  if (axisLength > Math.fround(0.00001)) {
    za = f32Div(za, axisLength);
    zc = f32Div(zc, axisLength);
  }

  let reflection = f32Hypot(za, zc);
  if (mode === "noScale" && determinantV1(parent) < 0) {
    reflection = f32(-reflection);
  }

  const perpendicular = f32Add(f32Div(F32_PI, 2), f32(Math.atan2(zc, za)));
  const zb = f32Mul(Math.cos(perpendicular), reflection);
  const zd = f32Mul(Math.sin(perpendicular), reflection);
  const shearX = degreesToRadians(bone.shearX);
  const shearY = degreesToRadians(f32Add(90, bone.shearY));
  const la = f32Mul(Math.cos(shearX), bone.scaleX);
  const lc = f32Mul(Math.sin(shearX), bone.scaleX);
  const lb = f32Mul(Math.cos(shearY), bone.scaleY);
  const ld = f32Mul(Math.sin(shearY), bone.scaleY);

  return affine(
    f32Add(f32Mul(za, la), f32Mul(zb, lc)),
    f32Add(f32Mul(zc, la), f32Mul(zd, lc)),
    f32Add(f32Mul(za, lb), f32Mul(zb, ld)),
    f32Add(f32Mul(zc, lb), f32Mul(zd, ld)),
    worldX,
    worldY,
    output,
  );
}
