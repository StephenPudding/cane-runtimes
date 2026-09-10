import type {
  RuntimeBoneLocalAdditiveV1,
  RuntimeBoneLocalPatchV1,
  RuntimeBoneLocalV1,
  RuntimeConstraintOverrideV1,
  RuntimeConstraintV1,
  RuntimePoseModifierOperationV1,
  RuntimePoseModifiersV1,
} from "./contracts.js";

type MutableBoneLocalV1 = { -readonly [Key in keyof RuntimeBoneLocalV1]: RuntimeBoneLocalV1[Key] };
type MutableBonePatchV1 = { -readonly [Key in keyof RuntimeBoneLocalPatchV1]-?: number | null };
type MutableBoneAdditiveV1 = { -readonly [Key in keyof RuntimeBoneLocalAdditiveV1]-?: number | null };
type MutableConstraintOverrideV1<Value extends RuntimeConstraintOverrideV1 = RuntimeConstraintOverrideV1> =
  Value extends unknown ? { -readonly [Key in keyof Value]: Value[Key] } : never;
const CONSTRAINT_POOL_SHAPE_V1 = Symbol("caneConstraintPoolShapeV1");

type BufferedPoseOperationV1 =
  | { operation: "replaceBoneLocal"; boneId: string; local: MutableBoneLocalV1 }
  | { operation: "patchBoneLocal"; boneId: string; patch: MutableBonePatchV1 }
  | { operation: "addBoneLocal"; boneId: string; delta: MutableBoneAdditiveV1 }
  | {
    operation: "patchConstraint";
    constraintId: string;
    parameters: RuntimeConstraintOverrideV1;
    [CONSTRAINT_POOL_SHAPE_V1]?: string | null;
  };

/**
 * Reusable ordered writer for one-frame pose operations.
 *
 * The active `operations` array and operation records are retained across
 * `clear()` calls. A stable operation shape therefore stops allocating after
 * warm-up. The buffer itself is not consumed or cleared by RuntimePlayerV1;
 * callers decide when to reuse it.
 */
export class RuntimePoseModifierBufferV1 implements RuntimePoseModifiersV1 {
  readonly #pool: BufferedPoseOperationV1[] = [];
  readonly operations: readonly RuntimePoseModifierOperationV1[];
  #activeCount = 0;

  constructor() {
    // An Array Proxy preserves normal readonly-array observation while its
    // logical length can return to zero without truncating the retained pool's
    // backing store. Runtime validation/indexing therefore remains compatible
    // and stable clear/refill cycles do not allocate a new element store.
    this.operations = new Proxy(this.#pool as RuntimePoseModifierOperationV1[], {
      get: (target, property, receiver) => {
        if (property === "length") return this.#activeCount;
        const index = arrayIndexV1(property);
        return index !== null && index >= this.#activeCount
          ? undefined
          : Reflect.get(target, property, receiver);
      },
      has: (target, property) => {
        const index = arrayIndexV1(property);
        return index !== null && index >= this.#activeCount ? false : Reflect.has(target, property);
      },
      ownKeys: (target) => Reflect.ownKeys(target).filter((property) => {
        const index = arrayIndexV1(property);
        return index === null || index < this.#activeCount;
      }),
      getOwnPropertyDescriptor: (target, property) => {
        if (property === "length") {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
          return descriptor === undefined ? undefined : { ...descriptor, value: this.#activeCount };
        }
        const index = arrayIndexV1(property);
        return index !== null && index >= this.#activeCount
          ? undefined
          : Reflect.getOwnPropertyDescriptor(target, property);
      },
      set: () => {
        throw new TypeError("RuntimePoseModifierBufferV1.operations is readonly.");
      },
      deleteProperty: () => {
        throw new TypeError("RuntimePoseModifierBufferV1.operations is readonly.");
      },
    });
  }

  get size(): number {
    return this.#activeCount;
  }

  get empty(): boolean {
    return this.#activeCount === 0;
  }

  clear(): this {
    this.#activeCount = 0;
    return this;
  }

  replaceBoneLocal(boneId: string, local: RuntimeBoneLocalV1): this {
    const index = this.#activeCount;
    let operation = this.#pool[index];
    if (operation?.operation !== "replaceBoneLocal") {
      operation = {
        operation: "replaceBoneLocal",
        boneId,
        local: {
          x: 0,
          y: 0,
          rotationDegrees: 0,
          shearXDegrees: 0,
          shearYDegrees: 0,
          scaleX: 1,
          scaleY: 1,
        },
      };
      this.#pool[index] = operation;
    }
    operation.boneId = boneId;
    operation.local.x = local.x;
    operation.local.y = local.y;
    operation.local.rotationDegrees = local.rotationDegrees;
    operation.local.shearXDegrees = local.shearXDegrees;
    operation.local.shearYDegrees = local.shearYDegrees;
    operation.local.scaleX = local.scaleX;
    operation.local.scaleY = local.scaleY;
    this.#activeCount += 1;
    return this;
  }

  patchBoneLocal(boneId: string, patch: RuntimeBoneLocalPatchV1): this {
    const index = this.#activeCount;
    let operation = this.#pool[index];
    if (operation?.operation !== "patchBoneLocal") {
      operation = {
        operation: "patchBoneLocal",
        boneId,
        patch: emptyBonePatchV1(),
      };
      this.#pool[index] = operation;
    }
    operation.boneId = boneId;
    copyBonePatchV1(operation.patch, patch);
    this.#activeCount += 1;
    return this;
  }

  addBoneLocal(boneId: string, delta: RuntimeBoneLocalAdditiveV1): this {
    const index = this.#activeCount;
    let operation = this.#pool[index];
    if (operation?.operation !== "addBoneLocal") {
      operation = {
        operation: "addBoneLocal",
        boneId,
        delta: emptyBoneAdditiveV1(),
      };
      this.#pool[index] = operation;
    }
    operation.boneId = boneId;
    copyBoneAdditiveV1(operation.delta, delta);
    this.#activeCount += 1;
    return this;
  }

  /** Retains the supplied typed override until this record is overwritten. */
  patchConstraint(constraintId: string, parameters: RuntimeConstraintOverrideV1): this {
    const index = this.#activeCount;
    let operation = this.#pool[index];
    if (operation?.operation !== "patchConstraint") {
      operation = { operation: "patchConstraint", constraintId, parameters };
      this.#pool[index] = operation;
    }
    operation.constraintId = constraintId;
    operation.parameters = parameters;
    operation[CONSTRAINT_POOL_SHAPE_V1] = null;
    this.#activeCount += 1;
    return this;
  }

  setConstraintTarget(constraintId: string, x: number, y: number): this {
    const index = this.#activeCount;
    let operation = this.#pool[index];
    if (operation?.operation !== "patchConstraint"
      || operation[CONSTRAINT_POOL_SHAPE_V1] !== "ik-target") {
      operation = {
        operation: "patchConstraint",
        constraintId,
        parameters: { type: "ik", target: { x: 0, y: 0 } },
        [CONSTRAINT_POOL_SHAPE_V1]: "ik-target",
      };
      this.#pool[index] = operation;
    }
    operation.constraintId = constraintId;
    const parameters = operation.parameters as MutableConstraintOverrideV1<Extract<RuntimeConstraintOverrideV1, { type: "ik" }>>;
    const target = parameters.target as { x: number; y: number };
    target.x = x;
    target.y = y;
    this.#activeCount += 1;
    return this;
  }

  setConstraintMix(constraintId: string, type: RuntimeConstraintV1["type"], mix: number): this {
    const index = this.#activeCount;
    let operation = this.#pool[index];
    const shape = constraintMixPoolShapeV1(type);
    if (operation?.operation !== "patchConstraint"
      || operation[CONSTRAINT_POOL_SHAPE_V1] !== shape) {
      let parameters: RuntimeConstraintOverrideV1;
      switch (type) {
        case "ik":
          parameters = { type, mix: 0 };
          break;
        case "transform":
          parameters = {
            type,
            mixRotate: 0,
            mixX: 0,
            mixY: 0,
            mixScaleX: 0,
            mixScaleY: 0,
            mixShearY: 0,
          };
          break;
        case "path":
          parameters = { type, mixRotate: 0, mixX: 0, mixY: 0 };
          break;
        case "physics":
          parameters = { type, mix: 0 };
          break;
        case "slider":
          parameters = { type, mix: 0 };
          break;
      }
      operation = {
        operation: "patchConstraint",
        constraintId,
        parameters,
        [CONSTRAINT_POOL_SHAPE_V1]: shape,
      };
      this.#pool[index] = operation;
    }
    operation.constraintId = constraintId;
    switch (type) {
      case "ik": {
        const parameters = operation.parameters as MutableConstraintOverrideV1<Extract<RuntimeConstraintOverrideV1, { type: "ik" }>>;
        parameters.mix = mix;
        break;
      }
      case "transform": {
        const parameters = operation.parameters as MutableConstraintOverrideV1<Extract<RuntimeConstraintOverrideV1, { type: "transform" }>>;
        parameters.mixRotate = mix;
        parameters.mixX = mix;
        parameters.mixY = mix;
        parameters.mixScaleX = mix;
        parameters.mixScaleY = mix;
        parameters.mixShearY = mix;
        break;
      }
      case "path": {
        const parameters = operation.parameters as MutableConstraintOverrideV1<Extract<RuntimeConstraintOverrideV1, { type: "path" }>>;
        parameters.mixRotate = mix;
        parameters.mixX = mix;
        parameters.mixY = mix;
        break;
      }
      case "physics": {
        const parameters = operation.parameters as MutableConstraintOverrideV1<Extract<RuntimeConstraintOverrideV1, { type: "physics" }>>;
        parameters.mix = mix;
        break;
      }
      case "slider": {
        const parameters = operation.parameters as MutableConstraintOverrideV1<Extract<RuntimeConstraintOverrideV1, { type: "slider" }>>;
        parameters.mix = mix;
        break;
      }
    }
    this.#activeCount += 1;
    return this;
  }
}

function arrayIndexV1(property: PropertyKey): number | null {
  if (typeof property !== "string" || property.length === 0) return null;
  const index = Number(property);
  return Number.isInteger(index)
    && index >= 0
    && index < 4_294_967_295
    && String(index) === property
    ? index
    : null;
}

function constraintMixPoolShapeV1(type: RuntimeConstraintV1["type"]): string {
  switch (type) {
    case "ik": return "ik-mix";
    case "transform": return "transform-mix";
    case "path": return "path-mix";
    case "physics": return "physics-mix";
    case "slider": return "slider-mix";
  }
}

function emptyBonePatchV1(): MutableBonePatchV1 {
  return {
    x: null,
    y: null,
    rotationDegrees: null,
    shearXDegrees: null,
    shearYDegrees: null,
    scaleX: null,
    scaleY: null,
  };
}

function copyBonePatchV1(target: MutableBonePatchV1, source: RuntimeBoneLocalPatchV1): void {
  target.x = source.x ?? null;
  target.y = source.y ?? null;
  target.rotationDegrees = source.rotationDegrees ?? null;
  target.shearXDegrees = source.shearXDegrees ?? null;
  target.shearYDegrees = source.shearYDegrees ?? null;
  target.scaleX = source.scaleX ?? null;
  target.scaleY = source.scaleY ?? null;
}

function emptyBoneAdditiveV1(): MutableBoneAdditiveV1 {
  return {
    xDelta: null,
    yDelta: null,
    rotationDegreesDelta: null,
    shearXDegreesDelta: null,
    shearYDegreesDelta: null,
    scaleXDelta: null,
    scaleYDelta: null,
  };
}

function copyBoneAdditiveV1(target: MutableBoneAdditiveV1, source: RuntimeBoneLocalAdditiveV1): void {
  target.xDelta = source.xDelta ?? null;
  target.yDelta = source.yDelta ?? null;
  target.rotationDegreesDelta = source.rotationDegreesDelta ?? null;
  target.shearXDegreesDelta = source.shearXDegreesDelta ?? null;
  target.shearYDegreesDelta = source.shearYDegreesDelta ?? null;
  target.scaleXDelta = source.scaleXDelta ?? null;
  target.scaleYDelta = source.scaleYDelta ?? null;
}
