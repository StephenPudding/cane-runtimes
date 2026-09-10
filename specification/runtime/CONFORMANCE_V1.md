# Runtime Conformance Protocol v1

The Runtime Conformance Protocol lets an independently implemented Cane runtime prove compatible
behavior by exchanging files and JSON over ordinary process boundaries. A candidate does not link
the Rust runtime, `runtime-api`, or `runtime-capi`.

The active suite is `1.8.0` under `fixtures/runtime-conformance/v1`. It requires Runtime API v1.3,
`FEATURE_POSE_QUERY`, `FEATURE_TRANSIENT_POSE_MODIFIERS`, `FEATURE_RUNTIME_RESOURCES`,
`FEATURE_RUNTIME_BOUNDS`, `FEATURE_PHYSICS_HOST_MOTION`, and
`FEATURE_FINAL_GEOMETRY_MODIFIERS`. Runtime API, Runtime JSON,
CANEB, Atlas JSON, project format, C ABI, and this protocol have independent version domains.

## Public files

- `manifest.json`: ordered cases, operations, runtime requirements, tolerances, and SHA-256
  bindings;
- `schema/manifest.schema.json`: manifest and operation schema;
- `schema/request.schema.json`: candidate work-request schema;
- `schema/expected.schema.json`: normalized success/error outcome schema;
- `schema/result.schema.json`: candidate result schema;
- `inputs/`: public Runtime JSON, CANEB, Atlas JSON, and malformed public inputs;
- `expected/`: hash-pinned outcomes.

Paths and hashes identify immutable case bytes. Compatible cases and operations may be appended in
protocol v1. Changing field meaning, coordinate/color conventions, comparison rules, or path
semantics requires a new protocol major.

## Request

Generate a request with:

```text
cargo run -p cane-runtime-conformance -- emit-request
```

The command emits `cane.runtime-conformance/request/v1` JSON containing:

- suite version and exact manifest SHA-256;
- required Runtime API wire schema, major/minimum minor, and feature bits;
- only required cases, in manifest order;
- public Runtime JSON/CANEB input plus Atlas JSON resource paths and hashes;
- an ordered, versioned `operations` array for each case;
- single-result-document transport, exact case set, two repetitions, finite-number rule, and
  fingerprint requirements.

The candidate must reject an unsupported request/suite, Runtime API requirement, operation, or
required feature before execution. It must hash every input and resource before use.

### Portable paths

Protocol paths are UTF-8 strings using `/`. They must be relative, contain no drive prefix,
backslash, colon, control character, empty component, `.` component, or `..` component.

`baseDir` alone may be `"."`. Resolve it relative to the request file's directory, or relative to
the candidate process working directory for stdin. After joining, verify that the resolved target
remains below the resolved base; symlink-aware hosts should canonicalize both paths.

## Language-neutral operations

`operations` is the normative Runtime API command stream. The v1 union covers:

- default and per-animation mixing;
- set, queue, clear, seek, and options for animation tracks;
- active skin stack;
- slot attachment and final-tint overrides;
- IK, transform, path, physics, and slider constraint overrides;
- root transform, physics environment, and physics reset;
- persistent Bone local overrides plus ordered one-evaluation Bone replace/patch/additive and
  transient constraint/IK target modifiers;
- ordered instance-local Image/Atlas/Attachment/Skin overlay transactions and overlay clearing;
- explicit root-transform Physics host-motion modes and optional per-constraint targeting;
- persistent/transient deterministic final-geometry modifiers and combined pose-plus-geometry
  evaluation;
- separate state `update` and frame `apply`, combined `advance`, deterministic `sampleAt`, and full
  reset;
- owned `querySlotState`, `queryPointAttachmentPose`, and retained bounds observations, plus
  explicit runtime-resource ID, bounds-hit, evaluation-count, and geometry-stat assertions and
  structured expected-error
  variants that allow later queries to prove a failed query was atomic.

Fields use JSON names and units from `schema/manifest.schema.json`; no Rust type layout or FFI is
part of the protocol. Operations execute strictly in array order against a fresh player for each
repetition. All lifecycle and authored events produced by operations are accumulated in emission
order. `update` advances clocks and captures crossed events without publishing an intermediate
frame. `apply` publishes the current evaluated frame without advancing clocks or emitting new
time-crossing events. `advance(delta)` is equivalent to `update(delta)` followed by `apply()`.
`sampleAt` reconstructs deterministic animation state at the requested time.

## Case execution

For every requested case, in order:

1. verify input and resource SHA-256;
2. decode Runtime JSON or CANEB into the same Runtime API model;
3. attach declared Atlas JSON resources;
4. create fresh runtime state;
5. execute every public operation in order and retain emitted events;
6. emit normalized model digest, player time, bones, skins, events, ordered query observations,
   and RenderPacket, or a structured error;
7. repeat from fresh state exactly twice and report identical fingerprints.

The 95-case required matrix covers base skeleton and inheritance, shear/negative scale/reflection,
nested non-uniform transforms with rotation, light/dark tint, draw order and all blends, Region/
Mesh/weighted deform, skin and attachment switching, all five constraint kinds, the complete
geometry/render groups required by `GEOMETRY_RENDER_ALGORITHMS_V1.md`, linear/stepped/Bezier and
key-boundary rules, forward/reverse/zero-duration events, multi-track/mixing/queue behavior,
two-page and trimmed/rotated Atlas mapping, JSON/CANEB equality, structured non-fatal warnings,
explicit sRGB/linear and straight/premultiplied texture semantics, the normative
setup/animation/persistent/transient/constraints/world/render pipeline, ordered Bone operations,
transient IK targets, expiry, rollback, the `update`/`apply`
publication boundary and `advance` equivalence, sampled slot/Point world-pose queries under
general shear and reflection, query-error atomicity, exact resource boundaries with atomic
rollback, and structured malformed/truncation/bounds/index/duplicate-ID/unknown-feature errors.
The six Runtime API 1.3 additions cover instance overlay install/clear,
affine/reflected Bounds queries and hit order, all four Physics host-motion
modes, persistent-plus-transient final geometry, and the combined
animation/pose/IK/geometry pipeline with explicit one-sample/one-solve/one-publish
assertions.

Suite 1.8.0 corrects the constant-speed Path oracle to use the four-step
coarse length, ten-step local parameter lookup, exact cubic point/tangent, and
atomic pre-constraint world snapshot defined by Path Algorithms v1. This is a
compatibility correction to the existing Path operation and adds no Runtime
API field or file-format dependency.

## Successful outcome

`status: "ok"` contains:

- `modelSha256`: canonical compact Runtime JSON digest;
- `timeSeconds`: finite non-negative time of the last published frame (so it deliberately remains
  unchanged after `update` until `apply`);
- `bones`: ordered world matrices and diagnostic pose values;
- `activeSkinIds` and `sampledSkinIds`;
- `events`: ordered lifecycle and authored events with track/animation identity and stable
  `audioId` references;
- `attachmentGeometries`, `slotStates`, `pointAttachmentPoses`, and `boundsSnapshots`: owned
  observations in query
  operation order; slot state includes the sampled active attachment, final sampled slot tint,
  attachment key, and draw index, while Point poses are world-space X/Y/rotation values;
- `renderPacket`: normalized renderer-neutral output;
- `exactFingerprint`: lowercase runner-local SHA-256 over the complete normalized state.

The RenderPacket declares X-right/Y-up coordinates, top-left UV origin, sRGB tint, and straight
alpha. Attachments are ordered by `drawIndex` and contain:

- slot, attachment, image, direct-path or Atlas/page/region identity, explicit texture color/alpha
  semantics, source z-index, and blend mode;
- final light RGB bytes, alpha, optional final dark RGB, and matching `twoColor`;
- diagnostic `sourceAffine` as `a,b,c,d,tx,ty`;
- final world-space XY, normalized page UVs, indices, one
  `authoredTriangleFacing` value per final triangle, and `counterClockwise`
  GPU front face.

Hosts consume these values directly. They must not recalculate tint, Atlas UVs, weighted deform,
affine transforms, reflection, authored/source facing, or triangle winding.
Negative-determinant source transforms are permitted; final indices are
normalized so world triangles remain CCW while per-triangle facing captured
before normalization remains unchanged. General affine shear is tested without
relying on rotation/scale decomposition.

Every output number must be finite. Vertex and UV arrays have equal even length, indices form
triangles and remain in range, `authoredTriangleFacing.length` equals
`indices.length / 3`, UVs are in `[0,1]`, and `twoColor` is true exactly when
final dark RGB exists. A negative signed triangle area is invalid; exact
zero-area triangles retain their index order and report `edgeOn` as specified
by Geometry and Render Algorithms v1.

## Error outcome

`status: "error"` contains non-zero numeric `code`, non-empty `operation`, nullable `field`,
nullable `entityId`, and informational `message`.

Verification compares `code`, `operation`, `field`, and `entityId` exactly. Message wording may be
localized and is non-normative. Required negative cases cover truncated CANEB, section
out-of-bounds, invalid dense index, duplicate stable ID, and an unknown required feature.

## Results and fingerprints

A candidate emits one `cane.runtime-conformance/result/v1` JSON document with:

- exact suite version and manifest SHA-256;
- non-empty runner ID, kind, and version;
- observed Runtime API version, wire schema, and supported feature bits;
- exactly one result for every requested case, in order;
- exactly two identical `repetitionFingerprints` per case.

For success, both repetition fingerprints equal `exactFingerprint`. Fingerprints prove bit-exact
repeatability within one runtime; cross-runtime conformance compares normalized fields using
manifest tolerances and deliberately ignores differing runner-local fingerprint algorithms.

The protocol specifies neither executable name nor implementation language. Candidates may use
files or stdin/stdout. The verifier accepts at most 64 MiB for one result.

## Verification and exit codes

```text
cargo run -p cane-runtime-conformance -- verify
cargo run -p cane-runtime-conformance -- verify-result result.json
cargo run -p cane-runtime-conformance -- verify-result - < result.json
```

Verification checks strict JSON decoding, schema/suite identity, manifest binding, Runtime API
requirements, exact case order/completeness, current input/resource hashes, two-run determinism,
finite normalized output, and every hash-pinned expected outcome.

- `0`: success;
- `1`: suite/verifier infrastructure failure;
- `2`: invalid command-line usage;
- `3`: malformed, stale, unsafe, incomplete, or non-deterministic result;
- `4`: structurally valid result differs from runtime requirements or expected behavior.

`external/protocol_fixture_runner.py` is a standard-library Python transport fixture. It verifies
hashes and operation transport, then replays expected outcomes. It is not an independent Runtime
JSON/CANEB implementation and cannot be cited as such.
