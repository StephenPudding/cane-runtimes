import { RuntimeErrorV1 } from "./errors.js";

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  // Avoid Object.values(): frame publication walks thousands of nested values
  // and allocating one temporary values array per object creates avoidable GC.
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      deepFreeze(value[index]);
    }
  } else if (!ArrayBuffer.isView(value)) {
    for (const key in value as Record<string, unknown>) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
    }
  }
  // Typed-array element views cannot be frozen in current JavaScript engines.
  if (ArrayBuffer.isView(value)) return value;
  return Object.freeze(value);
}

export function asRuntimeError(
  error: unknown,
  operation: string,
  fallbackMessage: string,
): RuntimeErrorV1 {
  if (error instanceof RuntimeErrorV1) {
    return error;
  }
  return new RuntimeErrorV1("internal", operation, fallbackMessage, { cause: error });
}
