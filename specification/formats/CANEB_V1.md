# Cane Binary Format v1

Status: normative for major version 1.

The decoded `DATA` tree is specified field-by-field by
[Cane Runtime Model v1](RUNTIME_MODEL_V1.md).

`Hero.caneb` is the compact binary representation of one Cane runtime skeleton. It carries the
same logical document as `Hero.json`; editor state, source paths, undo history, prompts, and engine
objects are forbidden. This format is independent of Rust and may be implemented without using any
Cane library.

Its logical `DATA` tree uses the same field model and numeric values as Runtime JSON. The public
[Cane Canonical JSON v1](CANONICAL_JSON_V1.md) profile defines the equivalent readable bytes and
the model digest used by conformance.

## Integer and byte rules

- All fixed-width integers and IEEE 754 values are little-endian.
- `u8`, `u16`, `u32`, `u64`, `i64`, `f32`, and `f64` have their usual fixed widths.
- Variable unsigned integers use unsigned LEB128 and must use the shortest encoding.
- Variable signed integers are converted with ZigZag and then encoded as unsigned LEB128.
- Booleans are token tags and never C/Rust `bool` memory.
- Offsets are absolute byte offsets from the beginning of the file.
- A writer emits zero for every reserved byte. A reader rejects a nonzero reserved value.
- The maximum v1 file size is 2 GiB. A runtime may enforce a smaller documented application limit.

No native pointer, `usize`, language enum layout, padding, `bincode`, `postcard`, or object-memory
dump is valid CANEB.

## Header

The fixed header is 32 bytes.

| Offset | Type | Value |
| ---: | --- | --- |
| 0 | `u8[8]` | `43 41 4e 45 42 0d 0a 1a` (`CANEB\r\n\x1a`) |
| 8 | `u16` | format major, exactly `1` |
| 10 | `u16` | format minor |
| 12 | `u8` | byte order, exactly `1` for little-endian |
| 13 | `u8` | header flags, exactly `0` in v1.0 |
| 14 | `u16` | header byte size, exactly `32` |
| 16 | `u32` | section count, `1..=64` |
| 20 | `u32` | section-table offset, exactly `32` in v1 |
| 24 | `u64` | total file byte size |

Major versions are incompatible. A reader accepts only the major/minor range it advertises through
Runtime API capability discovery. Within that range, unknown optional sections are skipped and
unknown required sections or required runtime features are rejected. The Rust v1.0 reference
currently advertises and accepts CANEB 1.0 exactly.

## Section table

The header is followed by `sectionCount` entries of 32 bytes:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `u8[4]` | ASCII section tag |
| 4 | `u32` | flags; bit 0 means required, all other bits are zero in v1 |
| 8 | `u64` | aligned section offset |
| 16 | `u64` | stored byte length |
| 24 | `u64` | decoded byte length; equal to stored length in v1 |

Sections are ordered by ascending tag bytes and begin on an eight-byte boundary. Padding is zero.
Ranges must be in bounds, must not overlap the header/table or each other, and duplicate tags are
invalid. Unknown optional sections are skipped. An unknown required section returns
`unsupportedRequiredSection`.

A Runtime API v1 loader preserves each skipped optional tag in its transient structured load
warning report (`unknownOptionalCanebSectionIgnored`, operation `loadCaneb`). This report is not
part of the decoded Runtime Model and is never written into Runtime JSON or CANEB `DATA`.

Version 1 requires exactly one each of:

- `DATA`: the canonical typed document tree.
- `IDMP`: stable-ID to dense-index records.
- `STRS`: the shared UTF-8 string table.

## `STRS`

`STRS` contains:

1. `u32 stringCount`;
2. `u32 reserved`, zero;
3. `stringCount + 1` `u32` byte offsets;
4. one concatenated UTF-8 byte blob.

The first offset is zero and the last equals the blob length. Strings are unique and sorted by
unsigned UTF-8 byte order. Embedded NUL is forbidden. An empty string is allowed and sorts first.
Every string reference in another section is a zero-based dense index into this table.

Limits:

- at most 1,000,000 strings;
- at most 512 MiB of string bytes;
- at most 16 MiB in one string.

Invalid UTF-8, unsorted or duplicate strings, invalid offsets, and out-of-range string indices are
errors.

## `DATA`

`DATA` contains exactly one value encoded by the following token grammar. There are no trailing
bytes.

| Tag | Payload |
| ---: | --- |
| `0x00` | null |
| `0x01` | false |
| `0x02` | true |
| `0x03` | ZigZag + unsigned LEB128 `i64` |
| `0x04` | unsigned LEB128 `u64` |
| `0x05` | little-endian finite `f32` |
| `0x06` | little-endian finite `f64` |
| `0x07` | unsigned LEB128 `STRS` index |
| `0x08` | unsigned LEB128 item count, then values |
| `0x09` | unsigned LEB128 member count, then repeated key-string index and value |

Object members are emitted in ascending UTF-8 key order. Duplicate or nonascending keys are
invalid. Writers use integer tokens for integral JSON numbers. A decimal is emitted as `f32` only
when converting it to `f32` and back preserves its value exactly; otherwise it is `f64`. NaN and
infinity are invalid.

After decoding, the root must satisfy Cane Runtime JSON v1 exactly, including:

- `format == "cane-runtime"`;
- `formatVersion.major == 1`;
- supported `requiredFeatures`;
- all reference and numeric validation.

Container nesting is limited to 256 and a single array/object is limited to 16,777,216 entries.

## `IDMP`

`IDMP` starts with `u32 recordCount` and `u32 reserved`, then fixed 16-byte records:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `u16` | object kind |
| 2 | `u16` | reserved, zero |
| 4 | `u32` | declaration-order dense index within the kind |
| 8 | `u32` | stable-ID `STRS` index |
| 12 | `u32` | reserved, zero |

Kinds:

| Value | Kind |
| ---: | --- |
| 1 | skeleton |
| 2 | atlas |
| 3 | image |
| 4 | audio |
| 5 | font |
| 6 | bone |
| 7 | slot |
| 8 | attachment |
| 9 | constraint |
| 10 | skin |
| 11 | event |
| 12 | animation |

Records are sorted by `(kind, denseIndex)`. Dense indices for a present kind begin at zero without
gaps and match declaration order in `DATA`. Stable IDs are unique within a kind. `IDMP` is not a
replacement for stable IDs in `DATA`; it lets implementations allocate dense arrays without
discarding externally visible identity. A mismatch between `IDMP` and `DATA` is
`invalidDenseIndexMap`.

## Canonical output

For one validated runtime model, a canonical writer:

1. serializes the Runtime JSON v1 logical tree with all required fields and specified defaults;
2. sorts object keys for `DATA`;
3. gathers every object key and string value into the sorted unique `STRS`;
4. creates `IDMP` from declaration-order arrays;
5. emits sections in tag order with zero alignment padding;
6. emits shortest LEB128 values and the numeric-token rule above.

The resulting bytes are unique. Repeated exports and input map iteration order must not change any
byte. Golden fixtures publish the whole file and SHA-256 digest.

The reproducible [CANEB v1 Size Report](../audits/CANEB_SIZE_REPORT_V1.md) records the
representative medium-large fixture, exact command, model-equivalence check, and measured
compact-JSON/CANEB byte counts.

## Decoder safety and error codes

A decoder validates sizes before allocating and checked-adds every offset/length. At minimum the
public error model distinguishes:

- `invalidMagic`
- `unsupportedBinaryVersion`
- `unsupportedByteOrder`
- `invalidHeader`
- `invalidSectionTable`
- `unsupportedRequiredSection`
- `resourceLimit`
- `truncatedInput`
- `invalidUtf8`
- `invalidVarint`
- `nonCanonicalEncoding`
- `nonFiniteNumber`
- `invalidDenseIndexMap`
- `invalidRuntimeDocument`
- `unsupportedRequiredFeature`

Malformed data never partially creates a runtime instance. Validation is atomic: either the entire
document is accepted or no externally observable runtime state is produced.
