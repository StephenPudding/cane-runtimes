import type {
  AffineV1,
  RootTransformV1,
  RuntimeBoneV1,
  RuntimePhysicsConstraintV1,
  RuntimePhysicsConstraintDiagnosticV1,
  RuntimePhysicsEnvironmentV1,
} from "../contracts.js";
import { RuntimeErrorV1 } from "../errors.js";
import {
  F32_DEGREES_TO_RADIANS,
  F32_RADIANS_TO_DEGREES,
  f32,
  f32Add,
  f32Div,
  f32Mul,
  f32Sub,
} from "../math/f32.js";

export const MAX_PHYSICS_SUBSTEPS_PER_OPERATION_V1 = 1_000_000;

export const DEFAULT_PHYSICS_ENVIRONMENT_V1: RuntimePhysicsEnvironmentV1 = Object.freeze({
  windX: 1,
  windY: 0,
  gravityX: 0,
  gravityY: 1,
});

export interface RuntimePhysicsBudgetV1 {
  remaining: number;
}

export interface RuntimePhysicsStateV1 {
  reset: boolean;
  ux: number;
  uy: number;
  cx: number;
  cy: number;
  tipX: number;
  tipY: number;
  xOffset: number;
  xLag: number;
  xVelocity: number;
  yOffset: number;
  yLag: number;
  yVelocity: number;
  rotateOffset: number;
  rotateLag: number;
  rotateVelocity: number;
  scaleOffset: number;
  scaleLag: number;
  scaleVelocity: number;
  remaining: number;
}

export interface RuntimePhysicsClockInputV1 {
  readonly animationId: string | null;
  readonly trackTime: number;
  readonly duration: number;
  readonly looping: boolean;
}

export interface RuntimePhysicsClockStepV1 extends RuntimePhysicsClockInputV1 {
  readonly from: number | null;
  readonly delta: number;
  readonly discontinuity: boolean;
}

/** Caller-owned storage for allocation-free clock advancement. */
export interface RuntimePhysicsClockStepScratchV1 {
  animationId: string | null;
  trackTime: number;
  duration: number;
  looping: boolean;
  from: number | null;
  delta: number;
  discontinuity: boolean;
}

export interface RuntimePhysicsApplyResultV1 {
  readonly matrix: AffineV1;
  readonly diagnostic: RuntimePhysicsConstraintDiagnosticV1;
}

type Mutable<T> = { -readonly [Property in keyof T]: T[Property] };

interface RuntimePhysicsStepPlanV1 {
  readonly count: number;
  readonly remaining: number;
}

/** Per-constraint mutable storage used by RuntimePlayer performance mode. */
export interface RuntimePhysicsApplyScratchV1 {
  readonly matrix: Mutable<AffineV1>;
  readonly diagnostic: Mutable<RuntimePhysicsConstraintDiagnosticV1>;
  readonly result: RuntimePhysicsApplyResultV1;
  readonly plan: Mutable<RuntimePhysicsStepPlanV1>;
}

export function createRuntimePhysicsApplyScratchV1(): RuntimePhysicsApplyScratchV1 {
  const matrix: Mutable<AffineV1> = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const diagnostic: Mutable<RuntimePhysicsConstraintDiagnosticV1> = {
    type: "physics",
    fixedSteps: 0,
    translationOffset: 0,
    translationSpeed: 0,
    rotationOffsetDegrees: 0,
    angularSpeedDegrees: 0,
    scaleOffset: 0,
    scaleSpeed: 0,
    configuredLimit: 0,
    requiredLimit: 0,
    limitSaturated: false,
  };
  return {
    matrix,
    diagnostic,
    result: { matrix, diagnostic },
    plan: { count: 0, remaining: 0 },
  };
}

export class RuntimePhysicsStateStoreV1 {
  readonly #states: Map<string, RuntimePhysicsStateV1>;
  readonly #stateIds: string[];
  #animationId: string | null;
  #trackTime: number | null;
  readonly #rootDeltaScratch: MutableRuntimeRootDeltaV1 = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    tx: 0,
    ty: 0,
  };

  constructor(
    states: ReadonlyMap<string, RuntimePhysicsStateV1> = new Map(),
    animationId: string | null = null,
    trackTime: number | null = null,
  ) {
    this.#states = new Map();
    this.#stateIds = [];
    for (const [id, state] of states) {
      this.#states.set(id, { ...state });
      this.#stateIds.push(id);
    }
    this.#animationId = animationId;
    this.#trackTime = trackTime;
  }

  clone(): RuntimePhysicsStateStoreV1 {
    return new RuntimePhysicsStateStoreV1(this.#states, this.#animationId, this.#trackTime);
  }

  /** Copies state into retained records for allocation-free transaction buffers. */
  copyFrom(source: RuntimePhysicsStateStoreV1): this {
    const sourceIds = source.#stateIds;
    let shapeMatches = this.#stateIds.length === sourceIds.length;
    if (shapeMatches) {
      for (let index = 0; index < sourceIds.length; index += 1) {
        if (this.#stateIds[index] !== sourceIds[index]) {
          shapeMatches = false;
          break;
        }
      }
    }

    if (!shapeMatches) {
      for (let index = 0; index < this.#stateIds.length; index += 1) {
        const constraintId = this.#stateIds[index];
        if (constraintId !== undefined && !source.#states.has(constraintId)) {
          this.#states.delete(constraintId);
        }
      }
      this.#stateIds.length = sourceIds.length;
      for (let index = 0; index < sourceIds.length; index += 1) {
        const constraintId = sourceIds[index];
        if (constraintId === undefined) continue;
        this.#stateIds[index] = constraintId;
        if (!this.#states.has(constraintId)) this.#states.set(constraintId, defaultState());
      }
    }

    for (let index = 0; index < sourceIds.length; index += 1) {
      const constraintId = sourceIds[index];
      if (constraintId === undefined) continue;
      const sourceState = source.#states.get(constraintId);
      if (sourceState === undefined) continue;
      let target = this.#states.get(constraintId);
      if (target === undefined) {
        target = defaultState();
        this.#states.set(constraintId, target);
      }
      copyPhysicsStateV1(target, sourceState);
    }
    this.#animationId = source.#animationId;
    this.#trackTime = source.#trackTime;
    return this;
  }

  state(constraintId: string): RuntimePhysicsStateV1 {
    let state = this.#states.get(constraintId);
    if (state === undefined) {
      state = defaultState();
      this.#states.set(constraintId, state);
      this.#stateIds.push(constraintId);
    }
    return state;
  }

  reset(constraintId?: string): boolean {
    if (constraintId === undefined) {
      const cleared = this.#states.size > 0;
      this.#states.clear();
      this.#stateIds.length = 0;
      this.#animationId = null;
      this.#trackTime = null;
      return cleared;
    } else {
      const state = this.#states.get(constraintId);
      if (state === undefined) return false;
      resetPhysicsStateV1(state);
      return true;
    }
  }

  /** Resets simulation records without discontinuing the animation clock. */
  resetSimulation(constraintId?: string): number {
    if (constraintId !== undefined) {
      const state = this.#states.get(constraintId);
      if (state === undefined) return 0;
      resetPhysicsStateV1(state);
      return 1;
    }
    for (let index = 0; index < this.#stateIds.length; index += 1) {
      const constraintIdAtIndex = this.#stateIds[index];
      const state = constraintIdAtIndex === undefined ? undefined : this.#states.get(constraintIdAtIndex);
      if (state !== undefined) resetPhysicsStateV1(state);
    }
    return this.#stateIds.length;
  }

  /**
   * Transports existing world-space histories through a host root delta.
   * The caller performs this on a transaction candidate before evaluation.
   */
  applyHostMotion(
    previous: RootTransformV1,
    next: RootTransformV1,
    mode: "move" | "teleport" | "preserveInertia" | "clearInertia",
    constraintId?: string,
  ): number {
    if (mode === "move") return 0;
    if (mode === "teleport") return this.resetSimulation(constraintId);
    if (mode !== "preserveInertia" && mode !== "clearInertia") {
      throw new RuntimeErrorV1("invalidArgument", "setRootTransform", "Unknown Physics host motion mode.", {
        field: "physicsMode",
        entityId: constraintId ?? null,
      });
    }
    const delta = rootDeltaV1(previous, next, this.#rootDeltaScratch);
    if (constraintId !== undefined) {
      const state = this.#states.get(constraintId);
      if (state === undefined) return 0;
      if (!transformedPhysicsStateFiniteV1(state, delta)) {
        throw new RuntimeErrorV1("nonFinite", "setRootTransform", "Root motion produced non-finite Physics state.", {
          field: "rootTransform",
          entityId: constraintId,
        });
      }
      transformPhysicsStateV1(state, delta);
      if (mode === "clearInertia") clearPhysicsInertiaV1(state);
      return 1;
    }
    for (let index = 0; index < this.#stateIds.length; index += 1) {
      const id = this.#stateIds[index];
      const state = id === undefined ? undefined : this.#states.get(id);
      if (state !== undefined && !transformedPhysicsStateFiniteV1(state, delta)) {
        throw new RuntimeErrorV1("nonFinite", "setRootTransform", "Root motion produced non-finite Physics state.", {
          field: "rootTransform",
          entityId: id ?? null,
        });
      }
    }
    for (let index = 0; index < this.#stateIds.length; index += 1) {
      const id = this.#stateIds[index];
      const state = id === undefined ? undefined : this.#states.get(id);
      if (state === undefined) continue;
      transformPhysicsStateV1(state, delta);
      if (mode === "clearInertia") clearPhysicsInertiaV1(state);
    }
    return this.#stateIds.length;
  }

  advanceClock(
    input: RuntimePhysicsClockInputV1,
    output: RuntimePhysicsClockStepScratchV1 | null = null,
  ): RuntimePhysicsClockStepV1 {
    const changedAnimation = this.#animationId !== input.animationId;
    const movedBackwards = this.#trackTime !== null && input.trackTime < this.#trackTime;
    const discontinuity = changedAnimation || movedBackwards;
    const from = discontinuity ? null : this.#trackTime;
    if (discontinuity) {
      this.#states.clear();
      this.#stateIds.length = 0;
    }
    const delta = discontinuity
      ? Math.max(input.trackTime, 0)
      : Math.max(this.#trackTime === null ? input.trackTime : input.trackTime - this.#trackTime, 0);
    this.#animationId = input.animationId;
    this.#trackTime = input.trackTime;
    const result = output ?? {
      animationId: input.animationId,
      trackTime: input.trackTime,
      duration: input.duration,
      looping: input.looping,
      from,
      delta: f32(delta),
      discontinuity,
    };
    result.animationId = input.animationId;
    result.trackTime = input.trackTime;
    result.duration = input.duration;
    result.looping = input.looping;
    result.from = from;
    result.delta = f32(delta);
    result.discontinuity = discontinuity;
    return result;
  }
}

export function applyPhysicsConstraintV1(
  constraint: RuntimePhysicsConstraintV1,
  deltaSeconds: number,
  referenceScale: number,
  environment: RuntimePhysicsEnvironmentV1,
  state: RuntimePhysicsStateV1,
  bone: RuntimeBoneV1,
  current: AffineV1,
  rootScaleX: number,
  rootScaleY: number,
  budget: RuntimePhysicsBudgetV1,
  scratch: RuntimePhysicsApplyScratchV1 | null = null,
): RuntimePhysicsApplyResultV1 | null {
  if (constraint.mix === 0 || constraint.fps === 0 || !(referenceScale > 0)
    || !Number.isFinite(referenceScale) || !environmentFinite(environment)) return null;
  const delta = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
  const step = f32(1 / constraint.fps);
  const length = Math.max(bone.length, 0);
  const matrix = scratch?.matrix ?? { ...current };
  if (scratch !== null) {
    matrix.a = current.a;
    matrix.b = current.b;
    matrix.c = current.c;
    matrix.d = current.d;
    matrix.tx = current.tx;
    matrix.ty = current.ty;
  }
  const originX = matrix.tx;
  const originY = matrix.ty;
  const previousRemaining = state.remaining;
  const nextRemaining = f32(state.remaining + delta);
  const xEnabled = constraint.x > 0;
  const yEnabled = constraint.y > 0;
  const rotateEnabled = constraint.rotate > 0 || constraint.shearX > 0;
  const scaleEnabled = constraint.scaleX > 0;
  const channelsEnabled = xEnabled || yEnabled || rotateEnabled || scaleEnabled;
  const plan = scratch?.plan ?? { count: 0, remaining: nextRemaining };
  if (!state.reset && channelsEnabled) {
    planSteps(nextRemaining, step, budget, plan);
  } else {
    plan.count = 0;
    plan.remaining = nextRemaining;
  }
  state.remaining = nextRemaining;
  let interpolation = 0;
  let requiredLimit: number | null = 0;
  let limitSaturated = false;

  if (state.reset) {
    state.reset = false;
    state.ux = originX;
    state.uy = originY;
  } else {
    const inertia = clamp(constraint.inertia, 0, 1);
    const xLimit = f32(Math.max(constraint.limit, 0) * delta * Math.abs(rootScaleX));
    const yLimit = f32(Math.max(constraint.limit, 0) * delta * Math.abs(rootScaleY));
    const damping = f32(Math.pow(clamp(constraint.damping, 0, 1), 60 * step));
    const accelerationScale = f32(step / constraint.mass);
    const strength = Math.max(constraint.strength, 0);
    let remaining = state.remaining;

    if (xEnabled || yEnabled) {
      if (xEnabled) {
        const movement = f32((state.ux - originX) * inertia);
        const magnitude = Math.abs(movement);
        if (magnitude > xLimit) limitSaturated = true;
        if (magnitude !== 0 && requiredLimit !== null) {
          const denominator = delta * Math.abs(rootScaleX);
          const candidate = magnitude / denominator;
          requiredLimit = denominator === 0 || !Number.isFinite(candidate)
            ? null
            : Math.max(requiredLimit, candidate);
        }
        state.xOffset = f32(state.xOffset + clamp(movement, -xLimit, xLimit));
        state.ux = originX;
      }
      if (yEnabled) {
        const movement = f32((state.uy - originY) * inertia);
        const magnitude = Math.abs(movement);
        if (magnitude > yLimit) limitSaturated = true;
        if (magnitude !== 0 && requiredLimit !== null) {
          const denominator = delta * Math.abs(rootScaleY);
          const candidate = magnitude / denominator;
          requiredLimit = denominator === 0 || !Number.isFinite(candidate)
            ? null
            : Math.max(requiredLimit, candidate);
        }
        state.yOffset = f32(state.yOffset + clamp(movement, -yLimit, yLimit));
        state.uy = originY;
      }
      if (plan.count > 0) {
        const previousX = state.xOffset;
        const previousY = state.yOffset;
        const wind = f32(referenceScale * constraint.wind);
        const gravity = f32(referenceScale * constraint.gravity);
        const forceX = f32((wind * environment.windX + gravity * environment.gravityX) * rootScaleX);
        const forceY = f32((wind * environment.windY + gravity * environment.gravityY) * rootScaleY);
        for (let index = 0; index < plan.count; index += 1) {
          if (xEnabled) {
            state.xVelocity = f32(state.xVelocity + (forceX - state.xOffset * strength) * accelerationScale);
            state.xOffset = f32(state.xOffset + state.xVelocity * step);
            state.xVelocity = f32(state.xVelocity * damping);
          }
          if (yEnabled) {
            state.yVelocity = f32(state.yVelocity - (forceY + state.yOffset * strength) * accelerationScale);
            state.yOffset = f32(state.yOffset + state.yVelocity * step);
            state.yVelocity = f32(state.yVelocity * damping);
          }
        }
        remaining = plan.remaining;
        state.xLag = f32(state.xOffset - previousX);
        state.yLag = f32(state.yOffset - previousY);
      }
      interpolation = Math.max(1 - remaining / step, 0);
      if (xEnabled) matrix.tx = f32(matrix.tx + (state.xOffset - state.xLag * interpolation) * constraint.mix * constraint.x);
      if (yEnabled) matrix.ty = f32(matrix.ty + (state.yOffset - state.yLag * interpolation) * constraint.mix * constraint.y);
    }

    if (rotateEnabled || scaleEnabled) {
      const axisAngle = Math.atan2(matrix.b, matrix.a);
      const rawTipDeltaX = state.cx - matrix.tx;
      const rawTipDeltaY = state.cy - matrix.ty;
      const tipMagnitudeX = Math.abs(rawTipDeltaX);
      if (tipMagnitudeX > xLimit) limitSaturated = true;
      if (tipMagnitudeX !== 0 && requiredLimit !== null) {
        const denominator = delta * Math.abs(rootScaleX);
        const candidate = tipMagnitudeX / denominator;
        requiredLimit = denominator === 0 || !Number.isFinite(candidate)
          ? null
          : Math.max(requiredLimit, candidate);
      }
      const tipMagnitudeY = Math.abs(rawTipDeltaY);
      if (tipMagnitudeY > yLimit) limitSaturated = true;
      if (tipMagnitudeY !== 0 && requiredLimit !== null) {
        const denominator = delta * Math.abs(rootScaleY);
        const candidate = tipMagnitudeY / denominator;
        requiredLimit = denominator === 0 || !Number.isFinite(candidate)
          ? null
          : Math.max(requiredLimit, candidate);
      }
      const tipDeltaX = clamp(rawTipDeltaX, -xLimit, xLimit);
      const tipDeltaY = clamp(rawTipDeltaY, -yLimit, yLimit);
      let forceCos: number;
      let forceSin: number;
      const rotateMix = (constraint.rotate + constraint.shearX) * constraint.mix;
      if (rotateEnabled) {
        const previousLag = state.rotateLag * Math.max(1 - previousRemaining / step, 0);
        const incoming = Math.atan2(tipDeltaY + state.tipY, tipDeltaX + state.tipX)
          - axisAngle - (state.rotateOffset - previousLag) * rotateMix;
        state.rotateOffset = f32(state.rotateOffset + wrapRadians(incoming) * inertia);
        const forceAngle = (state.rotateOffset - previousLag) * rotateMix + axisAngle;
        forceCos = Math.cos(forceAngle);
        forceSin = Math.sin(forceAngle);
        if (scaleEnabled) {
          const worldLength = length * Math.hypot(matrix.a, matrix.b);
          if (worldLength > 0) state.scaleOffset = f32(state.scaleOffset + (tipDeltaX * forceCos + tipDeltaY * forceSin) * inertia / worldLength);
        }
      } else {
        forceCos = Math.cos(axisAngle);
        forceSin = Math.sin(axisAngle);
        const worldLength = length * Math.hypot(matrix.a, matrix.b)
          - state.scaleLag * Math.max(1 - previousRemaining / step, 0);
        if (worldLength > 0) state.scaleOffset = f32(state.scaleOffset + (tipDeltaX * forceCos + tipDeltaY * forceSin) * inertia / worldLength);
      }
      remaining = state.remaining;
      if (plan.count > 0) {
        const forceX = constraint.wind * environment.windX + constraint.gravity * environment.gravityX;
        const forceY = constraint.wind * environment.windY + constraint.gravity * environment.gravityY;
        const previousRotate = state.rotateOffset;
        const previousScale = state.scaleOffset;
        const lengthScale = length / referenceScale;
        for (let stepIndex = 0; stepIndex < plan.count; stepIndex += 1) {
          if (scaleEnabled) {
            state.scaleVelocity = f32(state.scaleVelocity + (forceX * forceCos - forceY * forceSin - state.scaleOffset * strength) * accelerationScale);
            state.scaleOffset = f32(state.scaleOffset + state.scaleVelocity * step);
            state.scaleVelocity = f32(state.scaleVelocity * damping);
          }
          if (rotateEnabled) {
            state.rotateVelocity = f32(state.rotateVelocity - ((forceX * forceSin + forceY * forceCos) * lengthScale + state.rotateOffset * strength) * accelerationScale);
            state.rotateOffset = f32(state.rotateOffset + state.rotateVelocity * step);
            state.rotateVelocity = f32(state.rotateVelocity * damping);
          }
          if (rotateEnabled && stepIndex + 1 < plan.count) {
            const forceAngle = state.rotateOffset * rotateMix + axisAngle;
            forceCos = Math.cos(forceAngle);
            forceSin = Math.sin(forceAngle);
          }
        }
        remaining = plan.remaining;
        state.rotateLag = f32(state.rotateOffset - previousRotate);
        state.scaleLag = f32(state.scaleOffset - previousScale);
      }
      interpolation = Math.max(1 - remaining / step, 0);
    }
    state.remaining = f32(remaining);
  }

  state.cx = matrix.tx;
  state.cy = matrix.ty;
  const rotationOffset = (state.rotateOffset - state.rotateLag * interpolation) * constraint.mix;
  if (constraint.rotate > 0) rotateMatrix(matrix, rotationOffset * constraint.rotate, false);
  if (constraint.shearX > 0) rotateMatrix(matrix, rotationOffset * constraint.shearX, true);
  if (constraint.scaleX > 0) {
    const scale = 1 + (state.scaleOffset - state.scaleLag * interpolation) * constraint.mix * constraint.scaleX;
    matrix.a = f32(matrix.a * scale);
    matrix.b = f32(matrix.b * scale);
    if (constraint.scaleYMode === "uniform") {
      matrix.c = f32(matrix.c * scale);
      matrix.d = f32(matrix.d * scale);
    } else if (constraint.scaleYMode === "volume") {
      const absolute = Math.abs(scale);
      const scaleY = absolute >= 0.7 ? 1 / absolute : 4 - 3.67347 * absolute;
      matrix.c = f32(matrix.c * scaleY);
      matrix.d = f32(matrix.d * scaleY);
    }
  }
  state.cx = originX;
  state.cy = originY;
  state.tipX = f32(length * matrix.a);
  state.tipY = f32(length * matrix.b);
  if (!stateFinite(state) || !matrixFinite(matrix)) {
    throw new RuntimeErrorV1("nonFinite", "apply", "Physics produced non-finite state.", { entityId: constraint.id });
  }
  const diagnostic = scratch?.diagnostic ?? {
    type: "physics" as const,
    fixedSteps: 0,
    translationOffset: 0,
    translationSpeed: 0,
    rotationOffsetDegrees: 0,
    angularSpeedDegrees: 0,
    scaleOffset: 0,
    scaleSpeed: 0,
    configuredLimit: 0,
    requiredLimit: 0,
    limitSaturated: false,
  };
  diagnostic.fixedSteps = plan.count;
  diagnostic.translationOffset = f32(Math.hypot(state.xOffset, state.yOffset));
  diagnostic.translationSpeed = f32(Math.hypot(state.xVelocity, state.yVelocity));
  diagnostic.rotationOffsetDegrees = f32Mul(state.rotateOffset, F32_RADIANS_TO_DEGREES);
  diagnostic.angularSpeedDegrees = f32Mul(state.rotateVelocity, F32_RADIANS_TO_DEGREES);
  diagnostic.scaleOffset = state.scaleOffset;
  diagnostic.scaleSpeed = state.scaleVelocity;
  diagnostic.configuredLimit = constraint.limit;
  diagnostic.requiredLimit = requiredLimit === null ? null : f32(requiredLimit);
  diagnostic.limitSaturated = limitSaturated;
  if (!diagnosticFinite(diagnostic)) {
    throw new RuntimeErrorV1("nonFinite", "apply", "Physics produced a non-finite diagnostic.", {
      entityId: constraint.id,
    });
  }
  return scratch?.result ?? { matrix, diagnostic };
}

function planSteps(
  initialRemaining: number,
  step: number,
  budget: RuntimePhysicsBudgetV1,
  output: Mutable<RuntimePhysicsStepPlanV1> | null = null,
): RuntimePhysicsStepPlanV1 {
  if (!Number.isFinite(initialRemaining) || !Number.isFinite(step) || step <= 0) {
    throw new RuntimeErrorV1("resourceLimit", "apply", "Physics evaluation would exceed the aggregate fixed-step limit.");
  }
  let remaining = initialRemaining;
  let count = 0;
  while (remaining >= step) {
    if (count >= budget.remaining) {
      throw new RuntimeErrorV1("resourceLimit", "apply", "Physics evaluation would exceed the aggregate fixed-step limit.");
    }
    const next = f32(remaining - step);
    if (next === remaining) {
      throw new RuntimeErrorV1("resourceLimit", "apply", "Physics evaluation would exceed the aggregate fixed-step limit.");
    }
    remaining = next;
    count += 1;
  }
  budget.remaining -= count;
  const result = output ?? { count, remaining };
  result.count = count;
  result.remaining = remaining;
  return result;
}

function defaultState(): RuntimePhysicsStateV1 {
  return {
    reset: true,
    ux: 0, uy: 0, cx: 0, cy: 0, tipX: 0, tipY: 0,
    xOffset: 0, xLag: 0, xVelocity: 0,
    yOffset: 0, yLag: 0, yVelocity: 0,
    rotateOffset: 0, rotateLag: 0, rotateVelocity: 0,
    scaleOffset: 0, scaleLag: 0, scaleVelocity: 0,
    remaining: 0,
  };
}

function copyPhysicsStateV1(target: RuntimePhysicsStateV1, source: RuntimePhysicsStateV1): void {
  target.reset = source.reset;
  target.ux = source.ux;
  target.uy = source.uy;
  target.cx = source.cx;
  target.cy = source.cy;
  target.tipX = source.tipX;
  target.tipY = source.tipY;
  target.xOffset = source.xOffset;
  target.xLag = source.xLag;
  target.xVelocity = source.xVelocity;
  target.yOffset = source.yOffset;
  target.yLag = source.yLag;
  target.yVelocity = source.yVelocity;
  target.rotateOffset = source.rotateOffset;
  target.rotateLag = source.rotateLag;
  target.rotateVelocity = source.rotateVelocity;
  target.scaleOffset = source.scaleOffset;
  target.scaleLag = source.scaleLag;
  target.scaleVelocity = source.scaleVelocity;
  target.remaining = source.remaining;
}

function resetPhysicsStateV1(state: RuntimePhysicsStateV1): void {
  state.reset = true;
  state.ux = 0;
  state.uy = 0;
  state.cx = 0;
  state.cy = 0;
  state.tipX = 0;
  state.tipY = 0;
  state.xOffset = 0;
  state.xLag = 0;
  state.xVelocity = 0;
  state.yOffset = 0;
  state.yLag = 0;
  state.yVelocity = 0;
  state.rotateOffset = 0;
  state.rotateLag = 0;
  state.rotateVelocity = 0;
  state.scaleOffset = 0;
  state.scaleLag = 0;
  state.scaleVelocity = 0;
  state.remaining = 0;
}

interface RuntimeRootDeltaV1 {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

type MutableRuntimeRootDeltaV1 = {
  -readonly [Key in keyof RuntimeRootDeltaV1]: RuntimeRootDeltaV1[Key]
};

function rootDeltaV1(
  previous: RootTransformV1,
  next: RootTransformV1,
  output: MutableRuntimeRootDeltaV1,
): RuntimeRootDeltaV1 {
  const previousRadians = f32Mul(previous.rotationDegrees, F32_DEGREES_TO_RADIANS);
  const previousCosine = f32(Math.cos(previousRadians));
  const previousSine = f32(Math.sin(previousRadians));
  const pa = f32Mul(previousCosine, previous.scaleX);
  const pb = f32Mul(previousSine, previous.scaleX);
  const pc = f32Mul(-previousSine, previous.scaleY);
  const pd = f32Mul(previousCosine, previous.scaleY);
  const determinant = f32Sub(f32Mul(pa, pd), f32Mul(pc, pb));
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new RuntimeErrorV1(
      "invalidState",
      "setRootTransform",
      "Preserving Physics history requires an invertible previous root transform.",
      { field: "rootTransform" },
    );
  }
  const inverseA = f32Div(pd, determinant);
  const inverseB = f32Div(-pb, determinant);
  const inverseC = f32Div(-pc, determinant);
  const inverseD = f32Div(pa, determinant);
  const inverseTx = f32Add(f32Mul(-inverseA, previous.x), f32Mul(-inverseC, previous.y));
  const inverseTy = f32Add(f32Mul(-inverseB, previous.x), f32Mul(-inverseD, previous.y));

  const nextRadians = f32Mul(next.rotationDegrees, F32_DEGREES_TO_RADIANS);
  const nextCosine = f32(Math.cos(nextRadians));
  const nextSine = f32(Math.sin(nextRadians));
  const na = f32Mul(nextCosine, next.scaleX);
  const nb = f32Mul(nextSine, next.scaleX);
  const nc = f32Mul(-nextSine, next.scaleY);
  const nd = f32Mul(nextCosine, next.scaleY);
  output.a = f32Add(f32Mul(na, inverseA), f32Mul(nc, inverseB));
  output.b = f32Add(f32Mul(nb, inverseA), f32Mul(nd, inverseB));
  output.c = f32Add(f32Mul(na, inverseC), f32Mul(nc, inverseD));
  output.d = f32Add(f32Mul(nb, inverseC), f32Mul(nd, inverseD));
  output.tx = f32Add(f32Add(f32Mul(na, inverseTx), f32Mul(nc, inverseTy)), next.x);
  output.ty = f32Add(f32Add(f32Mul(nb, inverseTx), f32Mul(nd, inverseTy)), next.y);
  if (!Number.isFinite(output.a) || !Number.isFinite(output.b)
    || !Number.isFinite(output.c) || !Number.isFinite(output.d)
    || !Number.isFinite(output.tx) || !Number.isFinite(output.ty)) {
    throw new RuntimeErrorV1(
      "nonFinite",
      "setRootTransform",
      "Root motion delta exceeded binary32 range.",
      { field: "rootTransform" },
    );
  }
  return output;
}

function transformedPhysicsStateFiniteV1(
  state: RuntimePhysicsStateV1,
  delta: RuntimeRootDeltaV1,
): boolean {
  return transformedPointFiniteV1(state.ux, state.uy, delta)
    && transformedPointFiniteV1(state.cx, state.cy, delta)
    && transformedVectorFiniteV1(state.tipX, state.tipY, delta)
    && transformedVectorFiniteV1(state.xOffset, state.yOffset, delta)
    && transformedVectorFiniteV1(state.xLag, state.yLag, delta)
    && transformedVectorFiniteV1(state.xVelocity, state.yVelocity, delta);
}

function transformedPointFiniteV1(x: number, y: number, delta: RuntimeRootDeltaV1): boolean {
  return Number.isFinite(transformPointComponentV1(delta.a, delta.c, delta.tx, x, y))
    && Number.isFinite(transformPointComponentV1(delta.b, delta.d, delta.ty, x, y));
}

function transformedVectorFiniteV1(x: number, y: number, delta: RuntimeRootDeltaV1): boolean {
  return Number.isFinite(transformVectorComponentV1(delta.a, delta.c, x, y))
    && Number.isFinite(transformVectorComponentV1(delta.b, delta.d, x, y));
}

function transformPhysicsStateV1(state: RuntimePhysicsStateV1, delta: RuntimeRootDeltaV1): void {
  let x = state.ux;
  let y = state.uy;
  state.ux = transformPointComponentV1(delta.a, delta.c, delta.tx, x, y);
  state.uy = transformPointComponentV1(delta.b, delta.d, delta.ty, x, y);
  x = state.cx;
  y = state.cy;
  state.cx = transformPointComponentV1(delta.a, delta.c, delta.tx, x, y);
  state.cy = transformPointComponentV1(delta.b, delta.d, delta.ty, x, y);
  x = state.tipX;
  y = state.tipY;
  state.tipX = transformVectorComponentV1(delta.a, delta.c, x, y);
  state.tipY = transformVectorComponentV1(delta.b, delta.d, x, y);
  x = state.xOffset;
  y = state.yOffset;
  state.xOffset = transformVectorComponentV1(delta.a, delta.c, x, y);
  state.yOffset = transformVectorComponentV1(delta.b, delta.d, x, y);
  x = state.xLag;
  y = state.yLag;
  state.xLag = transformVectorComponentV1(delta.a, delta.c, x, y);
  state.yLag = transformVectorComponentV1(delta.b, delta.d, x, y);
  x = state.xVelocity;
  y = state.yVelocity;
  state.xVelocity = transformVectorComponentV1(delta.a, delta.c, x, y);
  state.yVelocity = transformVectorComponentV1(delta.b, delta.d, x, y);
}

function clearPhysicsInertiaV1(state: RuntimePhysicsStateV1): void {
  state.xLag = 0;
  state.xVelocity = 0;
  state.yLag = 0;
  state.yVelocity = 0;
  state.rotateLag = 0;
  state.rotateVelocity = 0;
  state.scaleLag = 0;
  state.scaleVelocity = 0;
}

function transformPointComponentV1(
  first: number,
  second: number,
  translation: number,
  x: number,
  y: number,
): number {
  return f32Add(f32Add(f32Mul(first, x), f32Mul(second, y)), translation);
}

function transformVectorComponentV1(first: number, second: number, x: number, y: number): number {
  return f32Add(f32Mul(first, x), f32Mul(second, y));
}

function rotateMatrix(matrix: { a: number; b: number; c: number; d: number }, radians: number, firstOnly: boolean): void {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const a = matrix.a;
  const b = matrix.b;
  matrix.a = f32(cosine * a - sine * b);
  matrix.b = f32(sine * a + cosine * b);
  if (!firstOnly) {
    const c = matrix.c;
    const d = matrix.d;
    matrix.c = f32(cosine * c - sine * d);
    matrix.d = f32(sine * c + cosine * d);
  }
}

function environmentFinite(value: RuntimePhysicsEnvironmentV1): boolean {
  return Number.isFinite(value.windX) && Number.isFinite(value.windY)
    && Number.isFinite(value.gravityX) && Number.isFinite(value.gravityY);
}

function stateFinite(state: RuntimePhysicsStateV1): boolean {
  return Number.isFinite(state.ux) && Number.isFinite(state.uy)
    && Number.isFinite(state.cx) && Number.isFinite(state.cy)
    && Number.isFinite(state.tipX) && Number.isFinite(state.tipY)
    && Number.isFinite(state.xOffset) && Number.isFinite(state.xLag) && Number.isFinite(state.xVelocity)
    && Number.isFinite(state.yOffset) && Number.isFinite(state.yLag) && Number.isFinite(state.yVelocity)
    && Number.isFinite(state.rotateOffset) && Number.isFinite(state.rotateLag) && Number.isFinite(state.rotateVelocity)
    && Number.isFinite(state.scaleOffset) && Number.isFinite(state.scaleLag) && Number.isFinite(state.scaleVelocity)
    && Number.isFinite(state.remaining);
}

function matrixFinite(matrix: AffineV1): boolean {
  return Number.isFinite(matrix.a) && Number.isFinite(matrix.b)
    && Number.isFinite(matrix.c) && Number.isFinite(matrix.d)
    && Number.isFinite(matrix.tx) && Number.isFinite(matrix.ty);
}

function diagnosticFinite(diagnostic: RuntimePhysicsConstraintDiagnosticV1): boolean {
  return Number.isFinite(diagnostic.fixedSteps)
    && Number.isFinite(diagnostic.translationOffset)
    && Number.isFinite(diagnostic.translationSpeed)
    && Number.isFinite(diagnostic.rotationOffsetDegrees)
    && Number.isFinite(diagnostic.angularSpeedDegrees)
    && Number.isFinite(diagnostic.scaleOffset)
    && Number.isFinite(diagnostic.scaleSpeed)
    && Number.isFinite(diagnostic.configuredLimit)
    && (diagnostic.requiredLimit === null || Number.isFinite(diagnostic.requiredLimit));
}

function wrapRadians(value: number): number {
  const full = Math.PI * 2;
  return ((value + Math.PI) % full + full) % full - Math.PI;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
