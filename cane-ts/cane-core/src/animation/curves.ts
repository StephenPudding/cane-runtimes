import type {
  RuntimeCurvePropertyNameV1,
  RuntimeCurveV1,
  RuntimeSimpleCurveV1,
} from "../contracts.js";
import { f32, f32Add, f32Mul, f32Sub } from "../math/f32.js";

export const NO_CONTRIBUTION_V1: unique symbol = Symbol("cane.runtime.no-contribution");
export type RuntimeSampleV1<T> = T | typeof NO_CONTRIBUTION_V1;

const GROUPED_LAST_KEYS_CACHE = new WeakMap<object, readonly unknown[]>();

export interface RuntimeTimedCurveKeyV1 {
  readonly time: number;
  readonly curve: RuntimeCurveV1;
}

export function selectPropertyCurveV1(
  curve: RuntimeCurveV1,
  property: RuntimeCurvePropertyNameV1,
): RuntimeSimpleCurveV1 {
  if (curve === null || typeof curve === "string" || curve.type !== "properties") {
    return curve;
  }
  if (Object.prototype.hasOwnProperty.call(curve.properties, property)) {
    return curve.properties[property] ?? null;
  }
  return curve.default;
}

export function sampleCurveValueV1(
  curve: RuntimeSimpleCurveV1,
  progress: number,
  from: number,
  to: number,
  options: { readonly angular?: boolean; readonly forceStepped?: boolean } = {},
): number {
  // Keep this scalar hot path as one explicit binary32 kernel. The public
  // helpers remain useful elsewhere, but crossing their generic call sites for
  // every animated channel forces V8 to materialize transient HeapNumbers.
  const p = Math.fround(Math.min(Math.max(Math.fround(progress), 0), 1));
  const start = Math.fround(from);
  const end = Math.fround(to);
  if (p <= 0) return start;
  if (p >= 1) return end;

  let sampled: number;
  if (options.forceStepped === true || curve === "stepped") {
    sampled = start;
  } else if (curve === null || curve === "linear") {
    sampled = interpolateLinear(start, end, p, options.angular === true);
  } else if (curve.type === "bezier") {
    const percentage = sampleBezierPercentage(curve.cx1, curve.cy1, curve.cx2, curve.cy2, p);
    sampled = interpolateLinear(start, end, percentage, options.angular === true);
  } else {
    sampled = sampleValueBezier(curve.cx1, curve.dy1, curve.cx2, curve.dy2, p, start, end);
    if (options.angular === true) {
      sampled = Math.fround(
        start + wrapDegreesV1(Math.fround(Math.fround(sampled) - start)),
      );
    }
  }
  return Math.fround(sampled);
}

export function sampleContinuousKeysV1<K extends RuntimeTimedCurveKeyV1>(
  keys: readonly K[],
  time: number,
  property: RuntimeCurvePropertyNameV1,
  value: (key: K) => number,
  options: { readonly angular?: boolean; readonly forceStepped?: boolean } = {},
): RuntimeSampleV1<number> {
  if (keys.length === 0) return NO_CONTRIBUTION_V1;
  const sampleTime = f32(time);
  const groups = groupedLastKeys(keys);
  const first = groups[0];
  if (first === undefined || sampleTime < first.time) return NO_CONTRIBUTION_V1;

  const currentIndex = lastKeyIndexAtOrBefore(groups, sampleTime);
  const current = groups[currentIndex];
  if (current === undefined) return NO_CONTRIBUTION_V1;
  const next = groups[currentIndex + 1];
  if (sampleTime === current.time || next === undefined) return f32(value(current));

  const denominator = f32Sub(next.time, current.time);
  if (denominator === 0) return f32(value(current));
  const progress = f32(f32Sub(sampleTime, current.time) / denominator);
  return sampleCurveValueV1(
    selectPropertyCurveV1(current.curve, property),
    progress,
    value(current),
    value(next),
    options,
  );
}

/**
 * Samples an interleaved numeric array after locating its key interval once.
 * Even and odd components may select different property curves (for example,
 * x/y deform components), but each curve's time transform is prepared once.
 */
export function sampleContinuousArrayKeysV1<K extends RuntimeTimedCurveKeyV1>(
  keys: readonly K[],
  time: number,
  value: (key: K) => readonly number[],
  output: number[],
  evenProperty: RuntimeCurvePropertyNameV1,
  oddProperty: RuntimeCurvePropertyNameV1,
  forceStepped = false,
): boolean {
  if (keys.length === 0) return false;
  const sampleTime = f32(time);
  const groups = groupedLastKeys(keys);
  const first = groups[0];
  if (first === undefined || sampleTime < first.time) return false;

  const currentIndex = lastKeyIndexAtOrBefore(groups, sampleTime);
  const current = groups[currentIndex];
  if (current === undefined) return false;
  const currentValues = value(current);
  const next = groups[currentIndex + 1];
  if (sampleTime === current.time || next === undefined) {
    copySampledArrayV1(currentValues, output);
    return true;
  }

  const denominator = f32Sub(next.time, current.time);
  if (denominator === 0) {
    copySampledArrayV1(currentValues, output);
    return true;
  }
  const progress = f32(f32Sub(sampleTime, current.time) / denominator);
  const nextValues = value(next);
  sampleArrayChannelV1(
    selectPropertyCurveV1(current.curve, evenProperty),
    progress,
    currentValues,
    nextValues,
    output,
    0,
    forceStepped,
  );
  sampleArrayChannelV1(
    selectPropertyCurveV1(current.curve, oddProperty),
    progress,
    currentValues,
    nextValues,
    output,
    1,
    forceStepped,
  );
  return true;
}

/** Samples a small fixed component vector after one shared key-interval lookup. */
export function sampleContinuousComponentArrayKeysV1<K extends RuntimeTimedCurveKeyV1>(
  keys: readonly K[],
  time: number,
  value: (key: K) => readonly number[],
  output: number[],
  properties: readonly RuntimeCurvePropertyNameV1[],
  forceStepped = false,
): boolean {
  if (keys.length === 0) return false;
  const sampleTime = f32(time);
  const groups = groupedLastKeys(keys);
  const first = groups[0];
  if (first === undefined || sampleTime < first.time) return false;
  const currentIndex = lastKeyIndexAtOrBefore(groups, sampleTime);
  const current = groups[currentIndex];
  if (current === undefined) return false;
  const currentValues = value(current);
  const next = groups[currentIndex + 1];
  if (sampleTime === current.time || next === undefined) {
    copySampledArrayV1(currentValues, output);
    return true;
  }
  const denominator = f32Sub(next.time, current.time);
  if (denominator === 0) {
    copySampledArrayV1(currentValues, output);
    return true;
  }
  const progress = f32(Math.min(Math.max(f32(f32Sub(sampleTime, current.time) / denominator), 0), 1));
  const nextValues = value(next);
  if (progress <= 0 || forceStepped) {
    copySampledArrayV1(currentValues, output);
    return true;
  }
  if (progress >= 1) {
    copySampledArrayV1(nextValues, output);
    return true;
  }
  let previousCurve: RuntimeSimpleCurveV1 | undefined;
  let hasPreviousCurve = false;
  let preparedMode: 0 | 1 | 2 | 3 = 0;
  let preparedProgress = progress;
  let preparedValueCurve: Extract<RuntimeSimpleCurveV1, { readonly type: "bezier-value" }> | null = null;
  for (let component = 0; component < output.length; component += 1) {
    const property = properties[component];
    if (property === undefined) {
      output[component] = f32(currentValues[component] ?? 0);
      continue;
    }
    const curve = selectPropertyCurveV1(current.curve, property);
    if (!hasPreviousCurve || curve !== previousCurve) {
      previousCurve = curve;
      hasPreviousCurve = true;
      preparedValueCurve = null;
      if (curve === "stepped") {
        preparedMode = 0;
      } else if (curve === null || curve === "linear") {
        preparedMode = 1;
        preparedProgress = progress;
      } else if (curve.type === "bezier") {
        preparedMode = 1;
        preparedProgress = sampleBezierPercentage(curve.cx1, curve.cy1, curve.cx2, curve.cy2, progress);
      } else {
        preparedValueCurve = curve;
        if (monotonicX(curve.cx1, curve.cx2)) {
          preparedMode = 2;
          preparedProgress = solveMonotonicX(progress, curve.cx1, curve.cx2);
        } else {
          preparedMode = 3;
        }
      }
    }
    const from = currentValues[component] ?? 0;
    const to = nextValues[component] ?? 0;
    if (preparedMode === 0) {
      output[component] = f32(from);
    } else if (preparedMode === 1) {
      output[component] = interpolateLinear(from, to, preparedProgress, false);
    } else if (preparedMode === 2 && preparedValueCurve !== null) {
      output[component] = f32(cubic(
        from,
        from + preparedValueCurve.dy1,
        to + preparedValueCurve.dy2,
        to,
        preparedProgress,
      ));
    } else if (preparedValueCurve !== null) {
      output[component] = sampleValueBezier(
        preparedValueCurve.cx1,
        preparedValueCurve.dy1,
        preparedValueCurve.cx2,
        preparedValueCurve.dy2,
        progress,
        from,
        to,
      );
    } else {
      output[component] = f32(from);
    }
  }
  return true;
}

export function sampleDiscreteKeysV1<K extends { readonly time: number }, T>(
  keys: readonly K[],
  time: number,
  value: (key: K) => T,
): RuntimeSampleV1<T> {
  const sampleTime = f32(time);
  const selectedIndex = lastKeyIndexAtOrBefore(keys, sampleTime);
  const selected = selectedIndex < 0 ? undefined : keys[selectedIndex];
  return selected === undefined ? NO_CONTRIBUTION_V1 : value(selected);
}

export function wrapDegreesV1(value: number): number {
  const shifted = f32Add(value, 180);
  const modulus = 360;
  const remainder = ((shifted % modulus) + modulus) % modulus;
  return f32Sub(remainder, 180);
}

export function quantizeSampleTimeV1(time: number, frameStepSeconds: number): number {
  const step = f32(frameStepSeconds);
  const ratio = f32(time) / step;
  return f32(Math.floor(ratio + 0.5) * step);
}

function groupedLastKeys<K extends { readonly time: number }>(keys: readonly K[]): K[] {
  const cached = GROUPED_LAST_KEYS_CACHE.get(keys);
  if (cached !== undefined) return cached as K[];
  const result: K[] = [];
  for (const key of keys) {
    const previous = result[result.length - 1];
    if (previous !== undefined && previous.time === key.time) {
      result[result.length - 1] = key;
    } else {
      result.push(key);
    }
  }
  GROUPED_LAST_KEYS_CACHE.set(keys, result);
  return result;
}

/** Returns the final duplicate at or before time for a validated, sorted timeline. */
function lastKeyIndexAtOrBefore<K extends { readonly time: number }>(keys: readonly K[], time: number): number {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const key = keys[middle];
    if (key !== undefined && key.time <= time) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function interpolateLinear(from: number, to: number, progress: number, angular: boolean): number {
  const start = Math.fround(from);
  const delta = Math.fround(Math.fround(to) - start);
  const resolvedDelta = angular ? wrapDegreesV1(delta) : delta;
  return Math.fround(start + Math.fround(resolvedDelta * Math.fround(progress)));
}

function copySampledArrayV1(source: readonly number[], output: number[]): void {
  for (let index = 0; index < output.length; index += 1) {
    output[index] = f32(source[index] ?? 0);
  }
}

function sampleArrayChannelV1(
  curve: RuntimeSimpleCurveV1,
  progress: number,
  fromValues: readonly number[],
  toValues: readonly number[],
  output: number[],
  parity: 0 | 1,
  forceStepped: boolean,
): void {
  const p = f32(Math.min(Math.max(f32(progress), 0), 1));
  if (p <= 0 || forceStepped || curve === "stepped") {
    copySampledArrayChannelV1(fromValues, output, parity);
    return;
  }
  if (p >= 1) {
    copySampledArrayChannelV1(toValues, output, parity);
    return;
  }

  if (curve === null || curve === "linear") {
    interpolateSampledArrayChannelV1(fromValues, toValues, output, parity, p);
    return;
  }
  if (curve.type === "bezier") {
    const percentage = sampleBezierPercentage(curve.cx1, curve.cy1, curve.cx2, curve.cy2, p);
    interpolateSampledArrayChannelV1(fromValues, toValues, output, parity, percentage);
    return;
  }

  if (monotonicX(curve.cx1, curve.cx2)) {
    const u = solveMonotonicX(p, curve.cx1, curve.cx2);
    for (let index = parity; index < output.length; index += 2) {
      const from = fromValues[index] ?? 0;
      const to = toValues[index] ?? 0;
      output[index] = f32(cubic(from, from + curve.dy1, to + curve.dy2, to, u));
    }
    return;
  }

  sampleSegmentedValueArrayChannelV1(curve, p, fromValues, toValues, output, parity);
}

function copySampledArrayChannelV1(
  source: readonly number[],
  output: number[],
  parity: 0 | 1,
): void {
  for (let index = parity; index < output.length; index += 2) {
    output[index] = f32(source[index] ?? 0);
  }
}

function interpolateSampledArrayChannelV1(
  fromValues: readonly number[],
  toValues: readonly number[],
  output: number[],
  parity: 0 | 1,
  progress: number,
): void {
  for (let index = parity; index < output.length; index += 2) {
    output[index] = interpolateLinear(fromValues[index] ?? 0, toValues[index] ?? 0, progress, false);
  }
}

function sampleSegmentedValueArrayChannelV1(
  curve: Extract<RuntimeSimpleCurveV1, { readonly type: "bezier-value" }>,
  progress: number,
  fromValues: readonly number[],
  toValues: readonly number[],
  output: number[],
  parity: 0 | 1,
): void {
  let lowerU = 0;
  let upperU = 1;
  let previousX = 0;
  let upperX = 1;
  let found = false;
  for (let step = 1; step <= 9; step += 1) {
    const u = step / 10;
    const currentX = cubicUnit(curve.cx1, curve.cx2, u);
    if (currentX >= progress) {
      upperU = u;
      upperX = currentX;
      found = true;
      break;
    }
    lowerU = u;
    previousX = currentX;
  }
  if (!found && previousX === 1) {
    copySampledArrayChannelV1(toValues, output, parity);
    return;
  }
  const segmentMix = upperX === previousX
    ? 1
    : (progress - previousX) / (upperX - previousX);
  for (let index = parity; index < output.length; index += 2) {
    const from = fromValues[index] ?? 0;
    const to = toValues[index] ?? 0;
    const y1 = from + curve.dy1;
    const y2 = to + curve.dy2;
    const lowerY = cubic(from, y1, y2, to, lowerU);
    const upperY = cubic(from, y1, y2, to, upperU);
    output[index] = f32(lowerY + segmentMix * (upperY - lowerY));
  }
}

function sampleBezierPercentage(
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  progress: number,
): number {
  if (monotonicX(cx1, cx2)) {
    const u = solveMonotonicX(progress, cx1, cx2);
    return f32(cubicUnit(cy1, cy2, u));
  }
  return f32(sampleSegmentedX(progress, cx1, cy1, cx2, cy2, 0, 1));
}

function sampleValueBezier(
  cx1: number,
  dy1: number,
  cx2: number,
  dy2: number,
  progress: number,
  from: number,
  to: number,
): number {
  const y1 = from + dy1;
  const y2 = to + dy2;
  if (monotonicX(cx1, cx2)) {
    return f32(cubic(from, y1, y2, to, solveMonotonicX(progress, cx1, cx2)));
  }
  return f32(sampleSegmentedX(progress, cx1, y1, cx2, y2, from, to));
}

function monotonicX(cx1: number, cx2: number): boolean {
  const a = 1 + 3 * cx1 - 3 * cx2;
  const b = 2 * (cx2 - 2 * cx1);
  const c = cx1;
  if (c < 0 || 1 - cx2 < 0) return false;
  if (a > 0) {
    const vertex = -b / (2 * a);
    if (vertex > 0 && vertex < 1 && a * vertex * vertex + b * vertex + c < 0) {
      return false;
    }
  }
  return true;
}

function solveMonotonicX(progress: number, cx1: number, cx2: number): number {
  let low = 0;
  let high = 1;
  let u = progress;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    u = (low + high) * 0.5;
    if (cubicUnit(cx1, cx2, u) < progress) low = u;
    else high = u;
  }
  return u;
}

function sampleSegmentedX(
  progress: number,
  cx1: number,
  y1: number,
  cx2: number,
  y2: number,
  from: number,
  to: number,
): number {
  let previousX = 0;
  let previousY = from;
  for (let step = 1; step <= 9; step += 1) {
    const u = step / 10;
    const currentX = cubicUnit(cx1, cx2, u);
    const currentY = cubic(from, y1, y2, to, u);
    if (currentX >= progress) {
      if (currentX === previousX) return currentY;
      return previousY + ((progress - previousX) / (currentX - previousX)) * (currentY - previousY);
    }
    previousX = currentX;
    previousY = currentY;
  }
  if (previousX === 1) return to;
  return previousY + ((progress - previousX) / (1 - previousX)) * (to - previousY);
}

function cubicUnit(control1: number, control2: number, u: number): number {
  return cubic(0, control1, control2, 1, u);
}

function cubic(from: number, control1: number, control2: number, to: number, u: number): number {
  const inverse = 1 - u;
  return inverse * inverse * inverse * from
    + 3 * inverse * inverse * u * control1
    + 3 * inverse * u * u * control2
    + u * u * u * to;
}
