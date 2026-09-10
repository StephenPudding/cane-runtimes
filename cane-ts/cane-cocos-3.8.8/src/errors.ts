export type CaneCocosErrorCodeV1 =
  | "engineUnavailable"
  | "engineVersionMismatch"
  | "engineNotInitialized"
  | "unsupportedBackend"
  | "unsupportedInternalApi"
  | "invalidArgument"
  | "invalidState"
  | "missingResource"
  | "decodeFailed"
  | "dimensionMismatch"
  | "renderContractViolation"
  | "contextLost"
  | "contextRestoreFailed";

export interface CaneCocosErrorDetailsV1 {
  readonly operation: string;
  readonly field?: string;
  readonly entityId?: string;
  readonly url?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly backend?: string;
  readonly cause?: unknown;
}

/** Stable adapter/resource error with machine-readable location metadata. */
export class CaneCocosErrorV1 extends Error {
  readonly code: CaneCocosErrorCodeV1;
  readonly details: CaneCocosErrorDetailsV1;

  constructor(code: CaneCocosErrorCodeV1, message: string, details: CaneCocosErrorDetailsV1) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "CaneCocosErrorV1";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
