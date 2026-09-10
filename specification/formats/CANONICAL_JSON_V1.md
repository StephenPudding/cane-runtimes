# Cane Canonical JSON v1

Status: normative for Cane Format v1 deterministic writers.

This profile defines the bytes used by canonical Runtime JSON, Atlas JSON, and `project.cane`
writers. A reader accepts semantically valid non-canonical JSON unless the containing operation
explicitly requires canonical build artifacts. Duplicate object keys and non-finite numbers are
always invalid.

## Encoding

- UTF-8 without BOM.
- Exactly one LF (`0a`) follows the root value.
- Compact output has no other whitespace.
- Pretty `project.cane` output uses two ASCII spaces per nesting level, LF line endings, and the
  same terminal LF.
- Array order is never changed by canonicalization.
- Runtime JSON and Atlas JSON object members are ordered by unsigned UTF-8 bytes of their keys at
  every depth.
- `project.cane` uses this fixed root order:
  `format`, `formatVersion`, `requiredFeatures`, `projectId`, `name`, `settings`, `images`,
  `audios`, `fonts`, `skeletons`, `extensions`. Nested project objects use unsigned UTF-8 key
  order.

## Strings

Strings are JSON strings over Unicode scalar values:

- `"` and `\` use `\"` and `\\`;
- U+0008, U+0009, U+000A, U+000C, and U+000D use `\b`, `\t`, `\n`, `\f`, and `\r`;
- other U+0000 through U+001F values use a six-byte lowercase `\u00xx` escape;
- `/` is not escaped;
- other scalar values are emitted as their shortest UTF-8 sequence, not `\u` escapes;
- lone UTF-16 surrogates are impossible because input is valid UTF-8.

Format-specific NFC/path rules apply before this encoding. General display names and opaque IDs
are not silently normalized by the canonical writer.

## Numbers

Schema integer fields use base-10 integer notation with no leading zero, no `+`, and `-` only for a
negative value.

Schema `f32` fields are first converted exactly to IEEE 754 binary64; schema `f64` fields retain
their binary64 value. The canonical decimal is the shortest finite decimal that round-trips to
that binary64 value using round-to-nearest, ties-to-even. Implementations may use Ryu or Schubfach;
the algorithm is not tied to a programming language.

- lowercase `e` is used when exponent notation is selected;
- a non-negative exponent includes `+`;
- exponent leading zeros are omitted;
- a finite floating value serialized without an exponent contains a decimal point, so `1.0`
  remains distinguishable from integer `1`;
- negative floating zero is `-0.0`;
- NaN and infinities are errors.

Examples after the required binary32-to-binary64 widening:

| Schema value | Canonical token |
| --- | --- |
| `f32(0)` | `0.0` |
| `f32(-0)` | `-0.0` |
| `f32(1)` | `1.0` |
| `f32(0.5)` | `0.5` |
| `f32(0.1)` | `0.10000000149011612` |
| `f32(0.7)` | `0.699999988079071` |

CANEB applies its own integer/f32/f64 token selection after constructing this same logical value;
its binary encoding is defined in `CANEB_V1.md`.

## Determinism boundary

Canonicalization sorts object members only. It does not sort semantic arrays, synthesize missing
defaults, normalize IDs, repair invalid references, or change floating-point values. Those steps
belong to the relevant format model and validator before encoding.

Native build validation re-encodes Runtime JSON, CANEB, and Atlas JSON and compares exact bytes.
Golden fixtures pin both bytes and SHA-256 so another implementation can test its writer.
