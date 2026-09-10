import type {
  RuntimeCustomGeometryModifierV1,
  RuntimeDeterministicJitterModifierV1,
  RuntimeGeometryModifierOperationV1,
  RuntimeGeometryModifiersV1,
  RuntimeRadialWaveModifierV1,
} from "./contracts.js";

type MutableModifierV1<Value> = {
  -readonly [Key in Exclude<keyof Required<Value>, "attachmentIds" | "slotIds">]: Required<Value>[Key]
} & { attachmentIds: string[]; slotIds: string[] };
type MutableJitterV1 = MutableModifierV1<RuntimeDeterministicJitterModifierV1>;
type MutableWaveV1 = MutableModifierV1<RuntimeRadialWaveModifierV1>;
type MutableCustomV1 = MutableModifierV1<RuntimeCustomGeometryModifierV1>;
type BufferedGeometryOperationV1 = MutableJitterV1 | MutableWaveV1 | MutableCustomV1;

/** Reusable writer for transient final-geometry operations. */
export class RuntimeGeometryModifierBufferV1 implements RuntimeGeometryModifiersV1 {
  readonly #pool: BufferedGeometryOperationV1[] = [];
  readonly operations: readonly RuntimeGeometryModifierOperationV1[];
  #activeCount = 0;

  constructor() {
    this.operations = new Proxy(this.#pool as RuntimeGeometryModifierOperationV1[], {
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
        throw new TypeError("RuntimeGeometryModifierBufferV1.operations is readonly.");
      },
      deleteProperty: () => {
        throw new TypeError("RuntimeGeometryModifierBufferV1.operations is readonly.");
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

  deterministicJitter(modifier: RuntimeDeterministicJitterModifierV1): this {
    const index = this.#activeCount;
    let target = this.#pool[index];
    if (target?.type !== "deterministicJitter") {
      target = {
        type: "deterministicJitter",
        seed: 0,
        amplitudeX: 0,
        amplitudeY: 0,
        frequencyHz: 0,
        attachmentIds: [],
        slotIds: [],
      };
      this.#pool[index] = target;
    }
    target.seed = modifier.seed;
    target.amplitudeX = modifier.amplitudeX;
    target.amplitudeY = modifier.amplitudeY;
    target.frequencyHz = modifier.frequencyHz ?? 0;
    copyIdsV1(target.attachmentIds, modifier.attachmentIds);
    copyIdsV1(target.slotIds, modifier.slotIds);
    this.#activeCount += 1;
    return this;
  }

  radialWave(modifier: RuntimeRadialWaveModifierV1): this {
    const index = this.#activeCount;
    let target = this.#pool[index];
    if (target?.type !== "radialWave") {
      target = {
        type: "radialWave",
        centerX: 0,
        centerY: 0,
        radialAmplitude: 0,
        angularAmplitudeDegrees: 0,
        wavelength: 1,
        phaseDegrees: 0,
        speedHz: 0,
        radius: 0,
        attachmentIds: [],
        slotIds: [],
      };
      this.#pool[index] = target;
    }
    target.centerX = modifier.centerX;
    target.centerY = modifier.centerY;
    target.radialAmplitude = modifier.radialAmplitude;
    target.angularAmplitudeDegrees = modifier.angularAmplitudeDegrees;
    target.wavelength = modifier.wavelength;
    target.phaseDegrees = modifier.phaseDegrees ?? 0;
    target.speedHz = modifier.speedHz ?? 0;
    target.radius = modifier.radius ?? 0;
    copyIdsV1(target.attachmentIds, modifier.attachmentIds);
    copyIdsV1(target.slotIds, modifier.slotIds);
    this.#activeCount += 1;
    return this;
  }

  custom(modifier: RuntimeCustomGeometryModifierV1): this {
    const index = this.#activeCount;
    let target = this.#pool[index];
    if (target?.type !== "custom") {
      target = {
        type: "custom",
        apply: modifier.apply,
        attachmentIds: [],
        slotIds: [],
      };
      this.#pool[index] = target;
    }
    target.apply = modifier.apply;
    copyIdsV1(target.attachmentIds, modifier.attachmentIds);
    copyIdsV1(target.slotIds, modifier.slotIds);
    this.#activeCount += 1;
    return this;
  }
}

function copyIdsV1(target: string[], source: readonly string[] | undefined): void {
  const length = source?.length ?? 0;
  target.length = length;
  for (let index = 0; index < length; index += 1) {
    const value = source?.[index];
    if (value !== undefined) target[index] = value;
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
