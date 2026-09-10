import type { RuntimeFinalTintV1, RuntimeSlotV1 } from "../contracts.js";
import { f32, f32Mul } from "../math/f32.js";

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const RUNTIME_SLOT_TINT_BYTES_V1: unique symbol = Symbol("cane.runtime.slot-tint-bytes.v1");

export interface RuntimeSlotTintBytesV1 {
  readonly lightRgb: [number, number, number];
  darkRgb: [number, number, number] | null;
  /** Retained even while darkRgb is null so two-color animation can resume without allocation. */
  readonly darkStorage: [number, number, number];
}

type RuntimeSlotTintCarrierV1 = RuntimeSlotV1 & {
  [RUNTIME_SLOT_TINT_BYTES_V1]?: RuntimeSlotTintBytesV1;
};

export function isRuntimeColorV1(value: string): boolean {
  return COLOR_PATTERN.test(value);
}

export function decodeRuntimeColorV1(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

export function composeFinalTintV1(
  slotColor: string,
  slotAlpha: number,
  attachmentColor: string,
  attachmentAlpha: number,
  slotDarkColor: string | null,
  output: RuntimeFinalTintV1 | null = null,
  slotTintBytes: RuntimeSlotTintBytesV1 | null = null,
): RuntimeFinalTintV1 {
  const lightRgb = output?.lightRgb as [number, number, number] | undefined ?? [0, 0, 0];
  const slotLight = slotTintBytes?.lightRgb ?? null;
  lightRgb[0] = Math.floor(((slotLight?.[0] ?? colorByte(slotColor, 0)) * colorByte(attachmentColor, 0) + 127) / 255);
  lightRgb[1] = Math.floor(((slotLight?.[1] ?? colorByte(slotColor, 1)) * colorByte(attachmentColor, 1) + 127) / 255);
  lightRgb[2] = Math.floor(((slotLight?.[2] ?? colorByte(slotColor, 2)) * colorByte(attachmentColor, 2) + 127) / 255);
  const alpha = f32Mul(clampUnitF32(slotAlpha), clampUnitF32(attachmentAlpha));
  let darkRgb: [number, number, number] | null = null;
  const sampledDark = slotTintBytes?.darkRgb ?? null;
  if (sampledDark !== null || slotDarkColor !== null) {
    darkRgb = output?.darkRgb as [number, number, number] | null | undefined ?? [0, 0, 0];
    darkRgb[0] = sampledDark?.[0] ?? colorByte(slotDarkColor as string, 0);
    darkRgb[1] = sampledDark?.[1] ?? colorByte(slotDarkColor as string, 1);
    darkRgb[2] = sampledDark?.[2] ?? colorByte(slotDarkColor as string, 2);
  }
  if (output !== null) {
    const mutable = output as {
      lightRgb: readonly [number, number, number];
      alpha: number;
      darkRgb: readonly [number, number, number] | null;
    };
    mutable.lightRgb = lightRgb;
    mutable.alpha = alpha;
    mutable.darkRgb = darkRgb;
    return output;
  }
  return { lightRgb, alpha, darkRgb };
}

export function runtimeSlotTintBytesV1(slot: RuntimeSlotV1): RuntimeSlotTintBytesV1 | null {
  return (slot as RuntimeSlotTintCarrierV1)[RUNTIME_SLOT_TINT_BYTES_V1] ?? null;
}

export function mutableRuntimeSlotTintBytesV1(slot: RuntimeSlotV1): RuntimeSlotTintBytesV1 {
  const carrier = slot as RuntimeSlotTintCarrierV1;
  let result = carrier[RUNTIME_SLOT_TINT_BYTES_V1];
  if (result === undefined) {
    result = createSlotTintBytesV1(slot.color, slot.darkColor);
    installSlotTintBytesV1(carrier, result);
  }
  return result;
}

/** Resets an existing retained cache without creating one for never-animated slots. */
export function resetRuntimeSlotTintBytesV1(slot: RuntimeSlotV1): void {
  const result = runtimeSlotTintBytesV1(slot);
  if (result === null) return;
  writeColorBytesV1(result.lightRgb, slot.color);
  if (slot.darkColor === null) {
    result.darkRgb = null;
  } else {
    writeColorBytesV1(result.darkStorage, slot.darkColor);
    result.darkRgb = result.darkStorage;
  }
}

/** Copies internal sampled tint without sharing mutable arrays between pose layers. */
export function copyRuntimeSlotTintBytesV1(source: RuntimeSlotV1, target: RuntimeSlotV1): void {
  const sourceTint = runtimeSlotTintBytesV1(source);
  const targetTint = runtimeSlotTintBytesV1(target);
  if (sourceTint === null) {
    if (targetTint !== null) resetRuntimeSlotTintBytesV1(target);
    return;
  }
  const output = targetTint === null || targetTint === sourceTint
    ? createSlotTintBytesV1(target.color, target.darkColor)
    : targetTint;
  output.lightRgb[0] = sourceTint.lightRgb[0];
  output.lightRgb[1] = sourceTint.lightRgb[1];
  output.lightRgb[2] = sourceTint.lightRgb[2];
  if (sourceTint.darkRgb === null) {
    output.darkRgb = null;
  } else {
    output.darkStorage[0] = sourceTint.darkRgb[0];
    output.darkStorage[1] = sourceTint.darkRgb[1];
    output.darkStorage[2] = sourceTint.darkRgb[2];
    output.darkRgb = output.darkStorage;
  }
  installSlotTintBytesV1(target as RuntimeSlotTintCarrierV1, output);
}

/** Writes a host tint override into retained Slot-local storage. */
export function setRuntimeSlotTintBytesV1(
  slot: RuntimeSlotV1,
  lightRgb: readonly [number, number, number],
  darkRgb: readonly [number, number, number] | null,
): void {
  const existing = runtimeSlotTintBytesV1(slot);
  const output = existing ?? createSlotTintBytesV1(slot.color, slot.darkColor);
  output.lightRgb[0] = lightRgb[0];
  output.lightRgb[1] = lightRgb[1];
  output.lightRgb[2] = lightRgb[2];
  if (darkRgb === null) {
    output.darkRgb = null;
  } else {
    output.darkStorage[0] = darkRgb[0];
    output.darkStorage[1] = darkRgb[1];
    output.darkStorage[2] = darkRgb[2];
    output.darkRgb = output.darkStorage;
  }
  if (existing === null) installSlotTintBytesV1(slot as RuntimeSlotTintCarrierV1, output);
}

/**
 * The cache is deliberately non-enumerable. Pose projection uses object spread
 * and Object.assign for public slot fields; copying this mutable scratch would
 * alias layers and force copy-on-write allocation on every sampled frame.
 */
function installSlotTintBytesV1(
  carrier: RuntimeSlotTintCarrierV1,
  value: RuntimeSlotTintBytesV1,
): void {
  if (Object.prototype.hasOwnProperty.call(carrier, RUNTIME_SLOT_TINT_BYTES_V1)) {
    carrier[RUNTIME_SLOT_TINT_BYTES_V1] = value;
    return;
  }
  Object.defineProperty(carrier, RUNTIME_SLOT_TINT_BYTES_V1, {
    configurable: true,
    enumerable: false,
    writable: true,
    value,
  });
}

function createSlotTintBytesV1(color: string, darkColor: string | null): RuntimeSlotTintBytesV1 {
  const lightRgb: [number, number, number] = [0, 0, 0];
  const darkStorage: [number, number, number] = [0, 0, 0];
  writeColorBytesV1(lightRgb, color);
  if (darkColor !== null) writeColorBytesV1(darkStorage, darkColor);
  return { lightRgb, darkRgb: darkColor === null ? null : darkStorage, darkStorage };
}

function writeColorBytesV1(output: [number, number, number], value: string): void {
  output[0] = colorByte(value, 0);
  output[1] = colorByte(value, 1);
  output[2] = colorByte(value, 2);
}

function colorByte(value: string, component: number): number {
  const offset = 1 + component * 2;
  return hexNibble(value.charCodeAt(offset)) * 16 + hexNibble(value.charCodeAt(offset + 1));
}

function hexNibble(code: number): number {
  return code <= 57 ? code - 48 : (code & 0xdf) - 55;
}

function clampUnitF32(value: number): number {
  return f32(Math.min(Math.max(f32(value), 0), 1));
}
