import type { RuntimeLoadWarningV1 } from "../contracts.js";
import { RuntimeErrorV1 } from "../errors.js";

const OPERATION = "loadCaneb";
const MAGIC = [0x43, 0x41, 0x4e, 0x45, 0x42, 0x0d, 0x0a, 0x1a] as const;
const HEADER_SIZE = 32;
const SECTION_ENTRY_SIZE = 32;
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_STRINGS = 1_000_000;
const MAX_STRING_BYTES = 512 * 1024 * 1024;
const MAX_SINGLE_STRING_BYTES = 16 * 1024 * 1024;
const MAX_CONTAINER_ITEMS = 16_777_216;
const MAX_NESTING = 256;
const U64_MAX = 0xffff_ffff_ffff_ffffn;

export interface DecodedCanebV1 {
  readonly document: unknown;
  readonly warnings: readonly RuntimeLoadWarningV1[];
}

interface SectionV1 {
  readonly tag: string;
  readonly flags: number;
  readonly offset: number;
  readonly length: number;
}

interface DenseRecordV1 {
  readonly kind: number;
  readonly denseIndex: number;
  readonly stableId: string;
}

export function decodeCanebV1(input: ArrayBuffer | ArrayBufferView): DecodedCanebV1 {
  const bytes = bytesOf(input);
  if (bytes.byteLength > MAX_FILE_SIZE) fail("resourceLimit", "file", "CANEB exceeds the 2 GiB v1 limit.");
  if (bytes.byteLength < HEADER_SIZE) fail("malformedInput", null, "CANEB header is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (bytes[index] !== MAGIC[index]) fail("malformedInput", "magic", "Invalid CANEB magic.");
  }
  const major = view.getUint16(8, true);
  const minor = view.getUint16(10, true);
  if (major !== 1 || minor !== 0) {
    fail("unsupportedVersion", "formatVersion", `CANEB ${major}.${minor} is unsupported.`);
  }
  if (view.getUint8(12) !== 1) fail("malformedInput", "byteOrder", "CANEB must use little-endian byte order.");
  if (view.getUint8(13) !== 0 || view.getUint16(14, true) !== HEADER_SIZE) {
    fail("malformedInput", "header", "Invalid CANEB header flags or size.");
  }
  const sectionCount = view.getUint32(16, true);
  if (sectionCount < 1 || sectionCount > 64 || view.getUint32(20, true) !== HEADER_SIZE) {
    fail("malformedInput", "sectionTable", "Invalid CANEB section table declaration.");
  }
  const totalSize = view.getBigUint64(24, true);
  if (totalSize !== BigInt(bytes.byteLength)) fail("malformedInput", "totalFileByteSize", "CANEB byte size does not match its header.");
  const tableEnd = checkedAdd(HEADER_SIZE, sectionCount * SECTION_ENTRY_SIZE, "sectionTable");
  if (tableEnd > bytes.byteLength) fail("malformedInput", "sectionTable", "CANEB section table is truncated.");

  const sections: SectionV1[] = [];
  const warnings: RuntimeLoadWarningV1[] = [];
  let previousTag: Uint8Array | null = null;
  for (let index = 0; index < sectionCount; index += 1) {
    const base = HEADER_SIZE + index * SECTION_ENTRY_SIZE;
    const tagBytes = bytes.subarray(base, base + 4);
    if ([...tagBytes].some((byte) => byte < 0x20 || byte > 0x7e)) {
      fail("malformedInput", `sections[${index}].tag`, "CANEB section tag must contain four printable ASCII bytes.");
    }
    if (previousTag !== null && compareBytes(previousTag, tagBytes) >= 0) {
      fail("malformedInput", `sections[${index}].tag`, "CANEB section tags must be unique and ascending.");
    }
    previousTag = tagBytes;
    const tag = String.fromCharCode(...tagBytes);
    const flags = view.getUint32(base + 4, true);
    if ((flags & ~1) !== 0) fail("malformedInput", `sections[${index}].flags`, "Unknown CANEB section flag bits.");
    const offset64 = view.getBigUint64(base + 8, true);
    const length64 = view.getBigUint64(base + 16, true);
    const decodedLength64 = view.getBigUint64(base + 24, true);
    if (decodedLength64 !== length64 || offset64 % 8n !== 0n) {
      fail("malformedInput", `sections[${index}]`, "CANEB v1 sections must be uncompressed and eight-byte aligned.");
    }
    const end64 = offset64 + length64;
    if (end64 > U64_MAX) fail("malformedInput", null, "CANEB section range overflow");
    if (offset64 < BigInt(tableEnd) || end64 > BigInt(bytes.byteLength)) {
      fail("malformedInput", null, "CANEB section extends beyond the file");
    }
    const offset = Number(offset64);
    const length = Number(length64);
    const previous = sections[sections.length - 1];
    if (previous !== undefined && offset < previous.offset + previous.length) {
      fail("malformedInput", `sections[${index}]`, "CANEB sections overlap.");
    }
    sections.push({ tag, flags, offset, length });
    if (tag !== "DATA" && tag !== "IDMP" && tag !== "STRS") {
      if ((flags & 1) !== 0) fail("unsupportedFeature", tag, `Required CANEB section '${tag}' is unsupported.`, tag);
      warnings.push({
        code: "unknownOptionalCanebSectionIgnored",
        operation: OPERATION,
        message: `unknown optional CANEB section \`${tag}\` was ignored`,
        sectionTag: tag,
      });
    }
  }
  assertZeroPadding(bytes, tableEnd, sections);
  const dataSection = exactlyOne(sections, "DATA");
  const idmpSection = exactlyOne(sections, "IDMP");
  const stringsSection = exactlyOne(sections, "STRS");
  const strings = decodeStrings(slice(bytes, stringsSection), stringsSection.offset);
  const document = new ValueDecoder(slice(bytes, dataSection), strings, dataSection.offset).decode();
  const denseRecords = decodeDenseMap(slice(bytes, idmpSection), strings, idmpSection.offset);
  validateDenseMap(document, denseRecords);
  return { document, warnings };
}

class ValueDecoder {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  readonly #strings: readonly string[];
  readonly #baseOffset: number;
  #cursor = 0;

  constructor(bytes: Uint8Array, strings: readonly string[], baseOffset: number) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#strings = strings;
    this.#baseOffset = baseOffset;
  }

  decode(): unknown {
    const value = this.#value(0);
    if (this.#cursor !== this.#bytes.length) this.#error("DATA contains trailing bytes.");
    return value;
  }

  #value(depth: number): unknown {
    if (depth > MAX_NESTING) fail("resourceLimit", "DATA", "CANEB DATA nesting exceeds 256.");
    const tag = this.#u8();
    switch (tag) {
      case 0x00: return null;
      case 0x01: return false;
      case 0x02: return true;
      case 0x03: {
        const value = zigzagDecode(this.#varuint());
        if (value >= 0n) this.#error("Non-negative CANEB integers must use the unsigned token.");
        return safeSignedInteger(value, this.#absoluteOffset());
      }
      case 0x04: return safeUnsignedInteger(this.#varuint(), this.#absoluteOffset());
      case 0x05: {
        this.#require(4);
        const value = this.#view.getFloat32(this.#cursor, true);
        this.#cursor += 4;
        if (!Number.isFinite(value)) fail("nonFinite", "DATA", "CANEB DATA contains a non-finite f32.");
        if (Number.isInteger(value) && !Object.is(value, -0)) this.#error("Integral CANEB numbers must use an integer token.");
        return value;
      }
      case 0x06: {
        this.#require(8);
        const value = this.#view.getFloat64(this.#cursor, true);
        this.#cursor += 8;
        if (!Number.isFinite(value)) fail("nonFinite", "DATA", "CANEB DATA contains a non-finite f64.");
        if (Number.isInteger(value) && !Object.is(value, -0)) this.#error("Integral CANEB numbers must use an integer token.");
        if (Object.is(Math.fround(value), value)) this.#error("Exactly representable CANEB numbers must use the f32 token.");
        return value;
      }
      case 0x07: return this.#string(this.#varuint());
      case 0x08: {
        const count = this.#count();
        const output: unknown[] = [];
        for (let index = 0; index < count; index += 1) output.push(this.#value(depth + 1));
        return output;
      }
      case 0x09: {
        const count = this.#count();
        const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
        let previousIndex = -1;
        for (let index = 0; index < count; index += 1) {
          const keyIndex = safeIndex(this.#varuint(), this.#strings.length, "DATA object key");
          if (keyIndex <= previousIndex) this.#error("CANEB DATA object keys must be unique and ascending.");
          previousIndex = keyIndex;
          const key = this.#strings[keyIndex];
          if (key === undefined) this.#error("CANEB DATA object key index is invalid.");
          output[key] = this.#value(depth + 1);
        }
        return output;
      }
      default:
        this.#error(`Unknown CANEB DATA token 0x${tag.toString(16).padStart(2, "0")}.`);
    }
  }

  #count(): number {
    const count = safeIndex(this.#varuint(), MAX_CONTAINER_ITEMS + 1, "DATA container count");
    if (count > MAX_CONTAINER_ITEMS) fail("resourceLimit", "DATA", "CANEB container exceeds the item limit.");
    return count;
  }

  #string(index: bigint): string {
    const position = safeIndex(index, this.#strings.length, "DATA string reference");
    const value = this.#strings[position];
    if (value === undefined) this.#error("CANEB DATA string index is out of range.");
    return value;
  }

  #varuint(): bigint {
    let value = 0n;
    let shift = 0n;
    for (let byteIndex = 0; byteIndex < 10; byteIndex += 1) {
      const byte = this.#u8();
      const payload = BigInt(byte & 0x7f);
      if (byteIndex === 9 && payload > 1n) this.#error("CANEB varint exceeds u64.");
      value |= payload << shift;
      if ((byte & 0x80) === 0) {
        if (byteIndex > 0 && payload === 0n) this.#error("CANEB varint is not shortest-form.");
        return value;
      }
      shift += 7n;
    }
    this.#error("CANEB varint is invalid.");
  }

  #u8(): number {
    this.#require(1);
    const value = this.#bytes[this.#cursor];
    this.#cursor += 1;
    if (value === undefined) this.#error("CANEB DATA is truncated.");
    return value;
  }

  #require(length: number): void {
    if (this.#cursor + length > this.#bytes.length) this.#error("CANEB DATA is truncated.");
  }

  #absoluteOffset(): number {
    return this.#baseOffset + this.#cursor;
  }

  #error(message: string): never {
    fail("malformedInput", `byteOffset:${this.#absoluteOffset()}`, message);
  }
}

function decodeStrings(bytes: Uint8Array, baseOffset: number): string[] {
  if (bytes.length < 8) fail("malformedInput", "STRS", "CANEB STRS section is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  if (count > MAX_STRINGS) fail("resourceLimit", "STRS", "CANEB string count exceeds 1,000,000.");
  if (view.getUint32(4, true) !== 0) fail("malformedInput", "STRS.reserved", "CANEB STRS reserved field must be zero.");
  const offsetCount = count + 1;
  const blobStart = checkedAdd(8, offsetCount * 4, "STRS");
  if (blobStart > bytes.length) fail("malformedInput", "STRS", "CANEB STRS offset table is truncated.");
  const blobLength = bytes.length - blobStart;
  if (blobLength > MAX_STRING_BYTES) fail("resourceLimit", "STRS", "CANEB string bytes exceed 512 MiB.");
  const offsets: number[] = [];
  for (let index = 0; index < offsetCount; index += 1) offsets.push(view.getUint32(8 + index * 4, true));
  if (offsets[0] !== 0 || offsets[offsets.length - 1] !== blobLength) {
    fail("malformedInput", "STRS.offsets", "CANEB STRS boundary offsets are invalid.");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const output: string[] = [];
  let previousBytes: Uint8Array | null = null;
  for (let index = 0; index < count; index += 1) {
    const start = offsets[index];
    const end = offsets[index + 1];
    if (start === undefined || end === undefined || start > end || end > blobLength) {
      fail("malformedInput", `STRS.offsets[${index}]`, "CANEB STRS offsets are invalid.");
    }
    if (end - start > MAX_SINGLE_STRING_BYTES) fail("resourceLimit", `STRS[${index}]`, "CANEB string exceeds 16 MiB.");
    const encoded = bytes.subarray(blobStart + start, blobStart + end);
    if (previousBytes !== null && compareBytes(previousBytes, encoded) >= 0) {
      fail("malformedInput", `STRS[${index}]`, "CANEB strings must be unique and sorted by UTF-8 bytes.");
    }
    previousBytes = encoded;
    let value: string;
    try {
      value = decoder.decode(encoded);
    } catch (error) {
      throw new RuntimeErrorV1("invalidUtf8", OPERATION, "CANEB STRS contains invalid UTF-8.", {
        field: `byteOffset:${baseOffset + blobStart + start}`,
        cause: error,
      });
    }
    if (value.includes("\0")) fail("malformedInput", `STRS[${index}]`, "CANEB strings must not contain NUL.");
    output.push(value);
  }
  return output;
}

function decodeDenseMap(bytes: Uint8Array, strings: readonly string[], baseOffset: number): DenseRecordV1[] {
  if (bytes.length < 8) fail("malformedInput", "IDMP", "CANEB IDMP section is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  if (view.getUint32(4, true) !== 0) fail("malformedInput", "IDMP.reserved", "CANEB IDMP reserved field must be zero.");
  if (8 + count * 16 !== bytes.length) fail("malformedInput", "IDMP", "CANEB IDMP byte length is invalid.");
  const records: DenseRecordV1[] = [];
  let previousKind = 0;
  let previousIndex = -1;
  for (let index = 0; index < count; index += 1) {
    const offset = 8 + index * 16;
    const kind = view.getUint16(offset, true);
    const denseIndex = view.getUint32(offset + 4, true);
    const stringIndex = view.getUint32(offset + 8, true);
    if (kind < 1 || kind > 12 || view.getUint16(offset + 2, true) !== 0 || view.getUint32(offset + 12, true) !== 0) {
      fail("malformedInput", `byteOffset:${baseOffset + offset}`, "CANEB IDMP record is invalid.");
    }
    if (kind < previousKind || (kind === previousKind && denseIndex <= previousIndex)) {
      fail("malformedInput", `IDMP[${index}]`, "CANEB IDMP records must be unique and sorted.");
    }
    if (kind !== previousKind && denseIndex !== 0 || kind === previousKind && denseIndex !== previousIndex + 1) {
      fail("malformedInput", null, "CANEB IDMP dense indices must begin at zero without gaps");
    }
    const stableId = strings[stringIndex];
    if (stableId === undefined) fail("malformedInput", `IDMP[${index}].stableId`, "CANEB IDMP string index is out of range.");
    records.push({ kind, denseIndex, stableId });
    previousKind = kind;
    previousIndex = denseIndex;
  }
  return records;
}

function validateDenseMap(document: unknown, actual: readonly DenseRecordV1[]): void {
  const root = objectValue(document);
  const expected: DenseRecordV1[] = [];
  const skeleton = objectValue(root.skeleton);
  addExpected(expected, 1, [skeleton], "skeletonId");
  addExpected(expected, 2, arrayValue(root.atlases), "atlasId");
  addExpected(expected, 3, arrayValue(root.images), "imageId");
  addExpected(expected, 4, arrayValue(root.audios), "audioId");
  addExpected(expected, 5, arrayValue(root.fonts), "fontId");
  addExpected(expected, 6, arrayValue(root.bones), "id");
  addExpected(expected, 7, arrayValue(root.slots), "id");
  addExpected(expected, 8, arrayValue(root.attachments), "id");
  addExpected(expected, 9, arrayValue(root.constraints), "id");
  addExpected(expected, 10, arrayValue(root.skins), "id");
  addExpected(expected, 11, arrayValue(root.events), "id");
  addExpected(expected, 12, arrayValue(root.animations), "id");
  if (expected.length !== actual.length) fail("validationFailed", "IDMP", "CANEB dense map record count does not match DATA.");
  const seenByKind = new Map<number, Set<string>>();
  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index];
    const found = actual[index];
    if (wanted === undefined || found === undefined
      || wanted.kind !== found.kind || wanted.denseIndex !== found.denseIndex || wanted.stableId !== found.stableId) {
      fail("validationFailed", `IDMP[${index}]`, "CANEB dense map does not match DATA declaration order.");
    }
    const seen = seenByKind.get(found.kind) ?? new Set<string>();
    if (seen.has(found.stableId)) fail("validationFailed", `IDMP[${index}]`, "CANEB dense map repeats a stable ID.");
    seen.add(found.stableId);
    seenByKind.set(found.kind, seen);
  }
}

function addExpected(output: DenseRecordV1[], kind: number, values: readonly unknown[], idKey: string): void {
  for (let index = 0; index < values.length; index += 1) {
    const object = objectValue(values[index]);
    const stableId = object[idKey];
    if (typeof stableId !== "string") fail("validationFailed", "DATA", `CANEB DATA object is missing '${idKey}'.`);
    output.push({ kind, denseIndex: index, stableId });
  }
}

function exactlyOne(sections: readonly SectionV1[], tag: string): SectionV1 {
  const matches = sections.filter((section) => section.tag === tag);
  if (matches.length !== 1 || matches[0] === undefined) {
    fail("malformedInput", "sectionTable", `CANEB requires exactly one '${tag}' section.`);
  }
  return matches[0];
}

function assertZeroPadding(bytes: Uint8Array, tableEnd: number, sections: readonly SectionV1[]): void {
  let cursor = tableEnd;
  for (const section of sections) {
    const expectedOffset = align8(cursor);
    if (section.offset !== expectedOffset) {
      fail("malformedInput", "sectionTable", "CANEB sections must use minimal eight-byte alignment.");
    }
    for (let index = cursor; index < expectedOffset; index += 1) {
      if (bytes[index] !== 0) fail("malformedInput", `byteOffset:${index}`, "CANEB alignment padding must be zero.");
    }
    cursor = section.offset + section.length;
  }
  if (cursor !== bytes.length) {
    fail("malformedInput", "sectionTable", "CANEB contains bytes outside every declared section.");
  }
}

function align8(value: number): number {
  const padding = (8 - value % 8) % 8;
  return checkedAdd(value, padding, "sectionAlignment");
}

function bytesOf(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new RuntimeErrorV1("invalidArgument", OPERATION, "Expected ArrayBuffer or ArrayBufferView.", { field: "input" });
}

function slice(bytes: Uint8Array, section: SectionV1): Uint8Array {
  return bytes.subarray(section.offset, section.offset + section.length);
}

function checkedAdd(left: number, right: number, field: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < left) fail("resourceLimit", field, "CANEB size arithmetic overflow.");
  return result;
}

function safeIndex(value: bigint, upperExclusive: number, field: string): number {
  if (value >= BigInt(upperExclusive)) fail("malformedInput", field, "CANEB index or count is out of range.");
  return Number(value);
}

function safeUnsignedInteger(value: bigint, offset: number): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("validationFailed", `byteOffset:${offset}`, "CANEB integer is not exactly representable in JavaScript.");
  return Number(value);
}

function safeSignedInteger(value: bigint, offset: number): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    fail("validationFailed", `byteOffset:${offset}`, "CANEB integer is not exactly representable in JavaScript.");
  }
  return Number(value);
}

function zigzagDecode(value: bigint): bigint {
  return (value >> 1n) ^ -(value & 1n);
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a - b;
  }
  return left.length - right.length;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("validationFailed", "DATA", "CANEB DATA root/catalog value has the wrong shape.");
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail("validationFailed", "DATA", "CANEB DATA catalog must be an array.");
  return value;
}

function fail(
  name: "invalidArgument" | "invalidUtf8" | "validationFailed" | "unsupportedVersion" | "resourceLimit" | "unsupportedFeature" | "malformedInput" | "nonFinite",
  field: string | null,
  message: string,
  entityId?: string,
): never {
  throw new RuntimeErrorV1(name, OPERATION, message, { field, entityId: entityId ?? null });
}
