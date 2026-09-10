export const RuntimeErrorCodeV1 = Object.freeze({
  invalidArgument: 1,
  invalidUtf8: 2,
  invalidJson: 3,
  validationFailed: 4,
  notFound: 5,
  invalidState: 6,
  unsupportedVersion: 7,
  resourceLimit: 8,
  unsupportedFeature: 9,
  missingResource: 10,
  malformedInput: 11,
  nonFinite: 12,
  missingReference: 13,
  internal: 255,
} as const);

export type RuntimeErrorNameV1 = keyof typeof RuntimeErrorCodeV1;
export type RuntimeErrorCodeNumberV1 = (typeof RuntimeErrorCodeV1)[RuntimeErrorNameV1];

export interface RuntimeErrorJsonV1 {
  readonly code: RuntimeErrorCodeNumberV1;
  readonly name: RuntimeErrorNameV1;
  readonly operation: string;
  readonly field: string | null;
  readonly entityId: string | null;
  readonly message: string;
}

export class RuntimeErrorV1 extends Error {
  readonly code: RuntimeErrorCodeNumberV1;
  readonly runtimeName: RuntimeErrorNameV1;
  readonly operation: string;
  readonly field: string | null;
  readonly entityId: string | null;

  constructor(
    name: RuntimeErrorNameV1,
    operation: string,
    message: string,
    options: {
      readonly field?: string | null;
      readonly entityId?: string | null;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "RuntimeErrorV1";
    this.code = RuntimeErrorCodeV1[name];
    this.runtimeName = name;
    this.operation = operation;
    this.field = options.field ?? null;
    this.entityId = options.entityId ?? null;
  }

  toJSON(): RuntimeErrorJsonV1 {
    return {
      code: this.code,
      name: this.runtimeName,
      operation: this.operation,
      field: this.field,
      entityId: this.entityId,
      message: this.message,
    };
  }
}

export function runtimeError(
  name: RuntimeErrorNameV1,
  operation: string,
  message: string,
  field?: string | null,
  entityId?: string | null,
): RuntimeErrorV1 {
  return new RuntimeErrorV1(name, operation, message, {
    field: field ?? null,
    entityId: entityId ?? null,
  });
}
