export type CaneLayaErrorCodeV1 =
  | "engineUnavailable"
  | "engineVersionMismatch"
  | "engineNotInitialized"
  | "unsupportedBackend"
  | "invalidArgument"
  | "invalidState"
  | "missingResource"
  | "decodeFailed"
  | "dimensionMismatch"
  | "renderContractViolation"
  | "contextRestoreFailed";

export interface CaneLayaErrorDetailsV1 {
  readonly operation: string;
  readonly field?: string;
  readonly entityId?: string;
  readonly url?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly cause?: unknown;
}

/** Stable adapter/resource error with machine-readable location metadata. */
export class CaneLayaErrorV1 extends Error {
  readonly code: CaneLayaErrorCodeV1;
  readonly details: CaneLayaErrorDetailsV1;

  constructor(code: CaneLayaErrorCodeV1, message: string, details: CaneLayaErrorDetailsV1) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "CaneLayaErrorV1";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
