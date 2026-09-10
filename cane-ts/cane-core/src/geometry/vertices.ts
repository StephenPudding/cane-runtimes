import type {
  AffineV1,
  RuntimeAttachmentV1,
  RuntimeMeshAttachmentV1,
} from "../contracts.js";
import type { RuntimeDataV1 } from "../data.js";
import { RuntimeErrorV1 } from "../errors.js";
import { f32, f32Add, f32Div, f32Mul, f32Sub } from "../math/f32.js";
import { multiplyAffineV1, transformPointV1 } from "../math/affine.js";
import type { RuntimeSampledDeformV1 } from "../animation/sampling.js";

const MESH_SOURCE_CACHE = new WeakMap<RuntimeDataV1, WeakMap<RuntimeMeshAttachmentV1, RuntimeMeshAttachmentV1>>();
const MESH_DEFORM_OWNER_CACHE = new WeakMap<RuntimeDataV1, WeakMap<RuntimeMeshAttachmentV1, RuntimeMeshAttachmentV1>>();
const EMPTY_NUMBERS_V1: readonly number[] = Object.freeze([] as number[]);

export type RuntimeVertexAttachmentV1 = Extract<
  RuntimeAttachmentV1,
  { readonly vertices: readonly number[] }
>;

export function resolveMeshSourceV1(
  mesh: RuntimeMeshAttachmentV1,
  data: RuntimeDataV1,
): RuntimeMeshAttachmentV1 {
  const cache = meshResolutionCacheV1(MESH_SOURCE_CACHE, data);
  const cached = cache.get(mesh);
  if (cached !== undefined) return cached;
  let current = mesh;
  while (current.link !== null) {
    const parent = data.attachment(current.link.parentMeshId);
    if (parent.type !== "mesh") {
      throw new RuntimeErrorV1("missingReference", "apply", "Validated linked Mesh parent is unavailable.", {
        field: "parentMeshId",
        entityId: mesh.id,
      });
    }
    current = parent;
  }
  cache.set(mesh, current);
  return current;
}

export function resolveMeshDeformOwnerV1(
  mesh: RuntimeMeshAttachmentV1,
  data: RuntimeDataV1,
): RuntimeMeshAttachmentV1 {
  const cache = meshResolutionCacheV1(MESH_DEFORM_OWNER_CACHE, data);
  const cached = cache.get(mesh);
  if (cached !== undefined) return cached;
  let current = mesh;
  while (current.link !== null && current.link.inheritDeform) {
    const parent = data.attachment(current.link.parentMeshId);
    if (parent.type !== "mesh") {
      throw new RuntimeErrorV1("missingReference", "apply", "Validated linked Mesh deform owner is unavailable.", {
        field: "parentMeshId",
        entityId: mesh.id,
      });
    }
    current = parent;
  }
  cache.set(mesh, current);
  return current;
}

function meshResolutionCacheV1(
  cache: WeakMap<RuntimeDataV1, WeakMap<RuntimeMeshAttachmentV1, RuntimeMeshAttachmentV1>>,
  data: RuntimeDataV1,
): WeakMap<RuntimeMeshAttachmentV1, RuntimeMeshAttachmentV1> {
  let byMesh = cache.get(data);
  if (byMesh === undefined) {
    byMesh = new WeakMap();
    cache.set(data, byMesh);
  }
  return byMesh;
}

export function resolveVertexAttachmentSourceV1(
  attachment: RuntimeVertexAttachmentV1,
  data: RuntimeDataV1,
): RuntimeVertexAttachmentV1 {
  return attachment.type === "mesh" ? resolveMeshSourceV1(attachment, data) : attachment;
}

export function resolveVertexAttachmentDeformOwnerIdV1(
  attachment: RuntimeVertexAttachmentV1,
  data: RuntimeDataV1,
): string {
  return attachment.type === "mesh" ? resolveMeshDeformOwnerV1(attachment, data).id : attachment.id;
}

export function vertexPositionsToWeightedOffsetsV1(
  source: RuntimeVertexAttachmentV1,
  positions: readonly number[],
  output: number[] | null = null,
): number[] | null {
  if (source.weights.length === 0
    || source.vertices.length !== positions.length
    || source.vertices.length !== source.weights.length * 2) return null;
  for (let index = 0; index < positions.length; index += 1) {
    if (!Number.isFinite(positions[index])) return null;
  }
  const result = output ?? [];
  result.length = 0;
  for (let point = 0; point < source.weights.length; point += 1) {
    const setupX = source.vertices[point * 2];
    const setupY = source.vertices[point * 2 + 1];
    const positionX = positions[point * 2];
    const positionY = positions[point * 2 + 1];
    const influences = source.weights[point];
    if (setupX === undefined || setupY === undefined || positionX === undefined || positionY === undefined
      || influences === undefined || influences.length === 0) return null;
    const dx = f32Add(positionX, -setupX);
    const dy = f32Add(positionY, -setupY);
    for (const influence of influences) {
      if (influence.x !== null && influence.y !== null) {
        result.push(dx, dy);
      } else {
        const inverse = source.bindInverses?.[influence.boneId];
        if (inverse === undefined) return null;
        const offsetX = f32Add(f32Mul(inverse.a, dx), f32Mul(inverse.c, dy));
        const offsetY = f32Add(f32Mul(inverse.b, dx), f32Mul(inverse.d, dy));
        if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return null;
        result.push(offsetX, offsetY);
      }
    }
  }
  return result;
}

export function weightedOffsetsToVertexPositionsV1(
  source: RuntimeVertexAttachmentV1,
  offsets: readonly number[],
): number[] | null {
  const expected = source.weights.reduce((sum, influences) => sum + influences.length * 2, 0);
  if (source.weights.length === 0
    || source.vertices.length !== source.weights.length * 2
    || offsets.length !== expected
    || offsets.some((value) => !Number.isFinite(value))) return null;
  const result: number[] = [];
  let cursor = 0;
  for (let point = 0; point < source.weights.length; point += 1) {
    const influences = source.weights[point];
    const setupX = source.vertices[point * 2];
    const setupY = source.vertices[point * 2 + 1];
    if (influences === undefined || influences.length === 0 || setupX === undefined || setupY === undefined) return null;
    let deltaX = 0;
    let deltaY = 0;
    let positiveTotal = 0;
    for (const influence of influences) {
      const offsetX = offsets[cursor];
      const offsetY = offsets[cursor + 1];
      cursor += 2;
      if (offsetX === undefined || offsetY === undefined) return null;
      if (influence.weight <= 0) continue;
      let candidateX = offsetX;
      let candidateY = offsetY;
      if (influence.x === null || influence.y === null) {
        const inverse = source.bindInverses?.[influence.boneId];
        if (inverse === undefined) return null;
        const determinant = f32Add(f32Mul(inverse.a, inverse.d), -f32Mul(inverse.b, inverse.c));
        if (!Number.isFinite(determinant) || determinant === 0) return null;
        candidateX = f32Div(f32Add(f32Mul(inverse.d, offsetX), -f32Mul(inverse.c, offsetY)), determinant);
        candidateY = f32Div(f32Add(-f32Mul(inverse.b, offsetX), f32Mul(inverse.a, offsetY)), determinant);
      }
      deltaX = f32Add(deltaX, f32Mul(candidateX, influence.weight));
      deltaY = f32Add(deltaY, f32Mul(candidateY, influence.weight));
      positiveTotal = f32Add(positiveTotal, influence.weight);
    }
    if (!(positiveTotal > 0)) return null;
    result.push(
      f32Add(setupX, f32Div(deltaX, positiveTotal)),
      f32Add(setupY, f32Div(deltaY, positiveTotal)),
    );
  }
  return result.every(Number.isFinite) ? result : null;
}

export function evaluateVertexAttachmentWorldV1(
  source: RuntimeVertexAttachmentV1,
  slotWorld: AffineV1,
  worldByBoneId: ReadonlyMap<string, AffineV1>,
  deform: RuntimeSampledDeformV1 | null,
  output: number[] | null = null,
): number[] {
  const result = output ?? [];
  if (source.weights.length === 0) {
    const positions = deform?.weighted === false ? deform.values : source.vertices;
    result.length = source.vertices.length;
    for (let offset = 0; offset < source.vertices.length; offset += 2) {
      const x = positions[offset] ?? source.vertices[offset];
      const y = positions[offset + 1] ?? source.vertices[offset + 1];
      if (x === undefined || y === undefined) {
        throw new RuntimeErrorV1("internal", "apply", "Unweighted vertex buffer is incomplete.", {
          entityId: source.id,
        });
      }
      result[offset] = f32Add(f32Add(f32Mul(slotWorld.a, x), f32Mul(slotWorld.c, y)), slotWorld.tx);
      result[offset + 1] = f32Add(f32Add(f32Mul(slotWorld.b, x), f32Mul(slotWorld.d, y)), slotWorld.ty);
    }
    return result;
  }

  const offsets = deform?.weighted === true ? deform.values : EMPTY_NUMBERS_V1;
  let deformOffset = 0;
  let outputOffset = 0;
  result.length = source.weights.length * 2;
  for (let point = 0; point < source.weights.length; point += 1) {
    const setupX = source.vertices[point * 2];
    const setupY = source.vertices[point * 2 + 1];
    if (setupX === undefined || setupY === undefined) {
      throw new RuntimeErrorV1("internal", "apply", "Weighted setup vertex buffer is incomplete.", {
        entityId: source.id,
      });
    }
    let worldX = 0;
    let worldY = 0;
    let positiveTotal = 0;
    const influences = source.weights[point];
    if (influences === undefined) continue;
    for (let influenceIndex = 0; influenceIndex < influences.length; influenceIndex += 1) {
      const influence = influences[influenceIndex];
      if (influence === undefined) continue;
      const offsetX = offsets[deformOffset] ?? 0;
      const offsetY = offsets[deformOffset + 1] ?? 0;
      deformOffset += 2;
      if (influence.weight <= 0) continue;
      let localX: number;
      let localY: number;
      if (influence.x !== null && influence.y !== null) {
        localX = f32Add(influence.x, offsetX);
        localY = f32Add(influence.y, offsetY);
      } else {
        const inverse = source.bindInverses?.[influence.boneId];
        if (inverse === undefined) {
          throw new RuntimeErrorV1("missingReference", "apply", "Weighted influence bind inverse is unavailable.", {
            field: "bindInverses",
            entityId: source.id,
          });
        }
        localX = f32Add(f32Add(f32Mul(inverse.a, setupX), f32Mul(inverse.c, setupY)), f32Add(inverse.tx, offsetX));
        localY = f32Add(f32Add(f32Mul(inverse.b, setupX), f32Mul(inverse.d, setupY)), f32Add(inverse.ty, offsetY));
      }
      const boneWorld = worldByBoneId.get(influence.boneId);
      if (boneWorld === undefined) {
        throw new RuntimeErrorV1("missingReference", "apply", "Weighted influence bone is unavailable.", {
          field: "boneId",
          entityId: source.id,
        });
      }
      const influenceX = f32Add(
        f32Add(f32Mul(boneWorld.a, localX), f32Mul(boneWorld.c, localY)),
        boneWorld.tx,
      );
      const influenceY = f32Add(
        f32Add(f32Mul(boneWorld.b, localX), f32Mul(boneWorld.d, localY)),
        boneWorld.ty,
      );
      worldX = f32Add(worldX, f32Mul(influenceX, influence.weight));
      worldY = f32Add(worldY, f32Mul(influenceY, influence.weight));
      positiveTotal = f32Add(positiveTotal, influence.weight);
    }
    if (!(positiveTotal > 0)) {
      throw new RuntimeErrorV1("invalidState", "apply", "Weighted vertex has no positive influence total.", {
        entityId: source.id,
      });
    }
    result[outputOffset] = f32Div(worldX, positiveTotal);
    result[outputOffset + 1] = f32Div(worldY, positiveTotal);
    outputOffset += 2;
  }
  result.length = outputOffset;
  return result;
}

const F32_EPSILON_V1 = Math.fround(1.1920928955078125e-7);

/** Solves one logical source vertex position that reaches a world-space target. */
export function vertexAttachmentPositionForWorldTargetV1(
  source: RuntimeVertexAttachmentV1,
  slotWorld: AffineV1,
  worldByBoneId: ReadonlyMap<string, AffineV1>,
  pointIndex: number,
  targetX: number,
  targetY: number,
): readonly [number, number] | null {
  if (!validPointIndex(source, pointIndex) || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return null;
  const setupWorld = evaluateVertexAttachmentWorldV1(source, slotWorld, worldByBoneId, null);
  const setupX = setupWorld[pointIndex * 2];
  const setupY = setupWorld[pointIndex * 2 + 1];
  const sourceX = source.vertices[pointIndex * 2];
  const sourceY = source.vertices[pointIndex * 2 + 1];
  const linear = deformWorldLinearV1(source, slotWorld, worldByBoneId, pointIndex);
  if (setupX === undefined || setupY === undefined || sourceX === undefined || sourceY === undefined || linear === null) {
    return null;
  }
  const localDelta = inverseLinearDeltaV1(linear, f32Sub(targetX, setupX), f32Sub(targetY, setupY));
  if (localDelta === null) return null;
  const result: readonly [number, number] = [
    f32Add(sourceX, localDelta[0]),
    f32Add(sourceY, localDelta[1]),
  ];
  return result.every(Number.isFinite) ? result : null;
}

/** Resolves one bone-local target position per influence in stable source order. */
export function vertexAttachmentWeightLocalPositionsForWorldTargetV1(
  source: RuntimeVertexAttachmentV1,
  worldByBoneId: ReadonlyMap<string, AffineV1>,
  pointIndex: number,
  targetX: number,
  targetY: number,
): readonly (readonly [number, number])[] | null {
  if (!validPointIndex(source, pointIndex) || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return null;
  const influences = source.weights[pointIndex];
  if (influences === undefined || influences.length === 0) return null;
  const result: Array<readonly [number, number]> = [];
  for (const influence of influences) {
    const world = worldByBoneId.get(influence.boneId);
    if (world === undefined) return null;
    const position = inverseTransformPointV1(world, targetX, targetY);
    if (position === null) return null;
    result.push(position);
  }
  return result;
}

/** Updates the complete weighted-influence offset buffer for one world-space vertex target. */
export function vertexAttachmentWeightedOffsetsForWorldTargetV1(
  source: RuntimeVertexAttachmentV1,
  slotWorld: AffineV1,
  worldByBoneId: ReadonlyMap<string, AffineV1>,
  pointIndex: number,
  currentOffsets: readonly number[],
  targetX: number,
  targetY: number,
): number[] | null {
  if (!validPointIndex(source, pointIndex) || source.weights.length === 0
    || !Number.isFinite(targetX) || !Number.isFinite(targetY)) return null;
  const expected = weightedOffsetCountV1(source);
  const influences = source.weights[pointIndex];
  if (expected === null || influences === undefined || influences.length === 0
    || currentOffsets.length !== expected || currentOffsets.some((value) => !Number.isFinite(value))) return null;
  const currentWorld = evaluateVertexAttachmentWorldV1(
    source,
    slotWorld,
    worldByBoneId,
    { weighted: true, values: currentOffsets },
  );
  const currentX = currentWorld[pointIndex * 2];
  const currentY = currentWorld[pointIndex * 2 + 1];
  const linear = deformWorldLinearV1(source, slotWorld, worldByBoneId, pointIndex);
  if (currentX === undefined || currentY === undefined || linear === null) return null;
  const deformDelta = inverseLinearDeltaV1(
    linear,
    f32Sub(targetX, currentX),
    f32Sub(targetY, currentY),
  );
  if (deformDelta === null) return null;

  const output = currentOffsets.map(f32);
  let cursor = 0;
  for (let vertex = 0; vertex < pointIndex; vertex += 1) {
    const previous = source.weights[vertex];
    if (previous === undefined) return null;
    cursor += previous.length * 2;
  }
  for (const influence of influences) {
    let dx = deformDelta[0];
    let dy = deformDelta[1];
    if (influence.x === null || influence.y === null) {
      const bindInverse = source.bindInverses?.[influence.boneId];
      if (bindInverse === undefined) return null;
      dx = f32Add(f32Mul(bindInverse.a, deformDelta[0]), f32Mul(bindInverse.c, deformDelta[1]));
      dy = f32Add(f32Mul(bindInverse.b, deformDelta[0]), f32Mul(bindInverse.d, deformDelta[1]));
    }
    const currentOffsetX = output[cursor];
    const currentOffsetY = output[cursor + 1];
    if (currentOffsetX === undefined || currentOffsetY === undefined) return null;
    output[cursor] = f32Add(currentOffsetX, dx);
    output[cursor + 1] = f32Add(currentOffsetY, dy);
    if (!Number.isFinite(output[cursor]) || !Number.isFinite(output[cursor + 1])) return null;
    cursor += 2;
  }
  return output;
}

/** Preserves existing per-influence offsets while applying complete logical source-position edits. */
export function weightedOffsetsAfterVertexPositionEditV1(
  source: RuntimeVertexAttachmentV1,
  currentOffsets: readonly number[],
  beforePositions: readonly number[],
  afterPositions: readonly number[],
): number[] | null {
  const expectedOffsets = weightedOffsetCountV1(source);
  if (expectedOffsets === null || currentOffsets.length !== expectedOffsets
    || beforePositions.length !== source.vertices.length || afterPositions.length !== source.vertices.length
    || currentOffsets.some((value) => !Number.isFinite(value))
    || beforePositions.some((value) => !Number.isFinite(value))
    || afterPositions.some((value) => !Number.isFinite(value))) return null;
  const output = currentOffsets.map(f32);
  let cursor = 0;
  for (let point = 0; point < source.weights.length; point += 1) {
    const beforeX = beforePositions[point * 2];
    const beforeY = beforePositions[point * 2 + 1];
    const afterX = afterPositions[point * 2];
    const afterY = afterPositions[point * 2 + 1];
    const influences = source.weights[point];
    if (beforeX === undefined || beforeY === undefined || afterX === undefined || afterY === undefined
      || influences === undefined || influences.length === 0) return null;
    const positionDx = f32Sub(afterX, beforeX);
    const positionDy = f32Sub(afterY, beforeY);
    for (const influence of influences) {
      let dx = positionDx;
      let dy = positionDy;
      if (influence.x === null || influence.y === null) {
        const bindInverse = source.bindInverses?.[influence.boneId];
        if (bindInverse === undefined) return null;
        dx = f32Add(f32Mul(bindInverse.a, positionDx), f32Mul(bindInverse.c, positionDy));
        dy = f32Add(f32Mul(bindInverse.b, positionDx), f32Mul(bindInverse.d, positionDy));
      }
      const currentX = output[cursor];
      const currentY = output[cursor + 1];
      if (currentX === undefined || currentY === undefined) return null;
      output[cursor] = f32Add(currentX, dx);
      output[cursor + 1] = f32Add(currentY, dy);
      if (!Number.isFinite(output[cursor]) || !Number.isFinite(output[cursor + 1])) return null;
      cursor += 2;
    }
  }
  return cursor === output.length ? output : null;
}

function validPointIndex(source: RuntimeVertexAttachmentV1, pointIndex: number): boolean {
  return Number.isInteger(pointIndex) && pointIndex >= 0
    && source.vertices.length % 2 === 0 && pointIndex < source.vertices.length / 2;
}

function weightedOffsetCountV1(source: RuntimeVertexAttachmentV1): number | null {
  if (source.weights.length === 0 || source.vertices.length !== source.weights.length * 2
    || source.weights.some((influences) => influences.length === 0)) return null;
  return source.weights.reduce((count, influences) => count + influences.length * 2, 0);
}

function deformWorldLinearV1(
  source: RuntimeVertexAttachmentV1,
  slotWorld: AffineV1,
  worldByBoneId: ReadonlyMap<string, AffineV1>,
  pointIndex: number,
): AffineV1 | null {
  if (source.weights.length === 0) {
    return { a: slotWorld.a, b: slotWorld.b, c: slotWorld.c, d: slotWorld.d, tx: 0, ty: 0 };
  }
  const influences = source.weights[pointIndex];
  if (influences === undefined || influences.length === 0) return null;
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let total = 0;
  for (const influence of influences) {
    if (!(influence.weight > 0)) continue;
    const boneWorld = worldByBoneId.get(influence.boneId);
    if (boneWorld === undefined) return null;
    let effective = boneWorld;
    if (influence.x === null || influence.y === null) {
      const bindInverse = source.bindInverses?.[influence.boneId];
      if (bindInverse === undefined) return null;
      effective = multiplyAffineV1(boneWorld, bindInverse);
    }
    a = f32Add(a, f32Mul(effective.a, influence.weight));
    b = f32Add(b, f32Mul(effective.b, influence.weight));
    c = f32Add(c, f32Mul(effective.c, influence.weight));
    d = f32Add(d, f32Mul(effective.d, influence.weight));
    total = f32Add(total, influence.weight);
  }
  if (!Number.isFinite(total) || !(total > F32_EPSILON_V1)) return null;
  return {
    a: f32Div(a, total),
    b: f32Div(b, total),
    c: f32Div(c, total),
    d: f32Div(d, total),
    tx: 0,
    ty: 0,
  };
}

function inverseLinearDeltaV1(
  matrix: AffineV1,
  dx: number,
  dy: number,
): readonly [number, number] | null {
  const determinant = f32Sub(f32Mul(matrix.a, matrix.d), f32Mul(matrix.b, matrix.c));
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= F32_EPSILON_V1) return null;
  const x = f32Div(f32Sub(f32Mul(matrix.d, dx), f32Mul(matrix.c, dy)), determinant);
  const y = f32Div(f32Add(f32Mul(-matrix.b, dx), f32Mul(matrix.a, dy)), determinant);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function inverseTransformPointV1(
  matrix: AffineV1,
  x: number,
  y: number,
): readonly [number, number] | null {
  return inverseLinearDeltaV1(matrix, f32Sub(x, matrix.tx), f32Sub(y, matrix.ty));
}

export function identityAffineForGeometryV1(): AffineV1 {
  return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
}
