# Cane v1 Versioning and Feature Compatibility

The project document, runtime JSON, runtime binary, atlas JSON, Runtime API, and conformance suite
have independent versions. A value from one domain must never be used to infer another.

| Domain | Format marker | Version field |
| --- | --- | --- |
| authoring project | `cane-project` | `formatVersion` |
| readable runtime | `cane-runtime` | `formatVersion` |
| binary runtime | CANEB magic | binary major/minor |
| native atlas | `cane-atlas` | `formatVersion` |
| runtime behavior | `cane.runtime/v1` | `runtimeApiVersion` |
| conformance protocol | `cane.runtime-conformance/{manifest,expected,request,result}/v1` | `suiteVersion` |

Every format version is `{ "major": u16, "minor": u16 }`. Major changes are incompatible. Minor
changes may add optional fields, optional binary sections, optional feature names, or API
operations whose absence is discoverable. Patch versions belong to implementations and tools, not
serialized format semantics.

A reader accepts only versions inside its advertised `minimumMinor..=maximumMinor` range. The Rust
reference currently advertises exactly 1.0 for Runtime JSON, CANEB, and Atlas JSON, and Runtime API
1.0 through 1.3. It therefore rejects a 1.x data document with `x > 0`, while hosts can discover
the additive Runtime API 1.1 query and authoring-geometry operations through the advertised API
range and feature bits. In particular,
`FEATURE_AUTHORING_OVERRIDE_SAMPLING` distinguishes implementations that can
apply an atomic authoring-preview override batch without losing explicit
stepped or fixed-frame sampling, while
`FEATURE_VERTEX_POSITION_EDIT_INVERSE` identifies the runtime-owned conversion
from logical source-position edits to weighted-influence deform offsets, and
`FEATURE_PATH_CONSTRAINT_POSITION` identifies the owned current Path sampler
position/extent query, `FEATURE_PATH_CONSTRAINT_POSITION_INVERSE` identifies
the matching runtime-owned world-target inverse, and
`FEATURE_SEQUENCE_STATE_QUERY` identifies the canonical current sequence-index
query, and `FEATURE_WEIGHT_BIND_POSITION_INVERSE` identifies the runtime-owned
world-target inverse for editing existing per-influence weight-local positions.
`FEATURE_PHYSICS_CONSTRAINT_RESET` identifies atomic per-constraint Physics
reset, while `FEATURE_TRANSFORM_CONSTRAINT_MATCH` identifies the runtime-owned
Transform constraint Match-offset query, and `FEATURE_AUTHORING_SNAPSHOT`
identifies the owned catalog-ordered authoring projection captured from one
already-published pose. Runtime API 1.1 `FEATURE_SOURCE_GEOMETRY` also includes
`setupWorldVerticesXy`: source-order setup vertices evaluated with the current
solved bones, constraints, weights, and bind inverses but without sampled
vertex deform. Hosts must consume that owned buffer instead of reconstructing
weighted setup-world geometry from a single source affine.
Runtime API 1.2 `FEATURE_TRANSIENT_POSE_MODIFIERS` identifies the ordered,
one-evaluation animation-after/constraint-before bone and constraint modifier
stage defined in [Pose Modifiers](POSE_MODIFIERS_V1.md). This capability is
independent of Runtime Format 1.0 and adds no serialized project field.
Runtime API 1.3 adds four independently discoverable API-only capabilities:
`FEATURE_RUNTIME_RESOURCES` for atomically validated instance overlays,
`FEATURE_RUNTIME_BOUNDS` for retained final-pose bounds and hit testing,
`FEATURE_PHYSICS_HOST_MOTION` for explicit root/history transport, and
`FEATURE_FINAL_GEOMETRY_MODIFIERS` for the ordered transactional Core geometry
stage. These capabilities likewise add no Runtime JSON, CANEB, or Atlas field.
A future reader may raise its maximum after it
implements and tests that minor. Unknown optional CANEB sections can still be
skipped within an advertised version; an unknown required section is always
rejected.

## Required features

Runtime documents contain a sorted, duplicate-free `requiredFeatures` string array. Feature names
use lowercase dotted ASCII, for example `mesh.weighted`, `tint.two-color`, and
`constraint.physics`.

A loader compares the document list with its advertised supported feature set before allocating a
player. Missing names produce `unsupportedRequiredFeature` with the complete missing list. A
runtime must not silently ignore, approximate, or partially load a required feature.

Unknown optional fields may be ignored only when:

- the document major is supported;
- the field is not named by `requiredFeatures`;
- ignoring it cannot change a required field's meaning;
- the relevant format document explicitly marks the containing object as extensible.

Unknown enum values, timeline kinds, required binary sections, blend modes, coordinate modes, and
color modes are always errors.

## Stable compatibility rules

Within a major version:

- existing field meanings, units, defaults, enum values, binary tags, section meanings, feature
  names, and error codes do not change;
- declaration order remains observable where the specification says it is;
- stable IDs remain case-sensitive opaque UTF-8 strings;
- new fields have explicit defaults and cannot make an older valid document invalid;
- a writer targeting an older minor omits only features that are provably unused;
- lossy downgrade is never implicit.

Format support and Runtime API support are reported separately. For example, an implementation may
decode Runtime JSON 1.2 while implementing Runtime API 1.0, provided the document requires no API
feature beyond its advertised set.

## Implementation identity

Runtimes report:

- implementation name and semantic version;
- supported runtime JSON major/minor;
- supported CANEB major/minor;
- supported atlas major/minor;
- supported Runtime API major/minor;
- sorted supported feature names;
- numeric precision policy and conformance suite version last passed.

This metadata is diagnostic and capability data. It is never written into authoring state or used
to change animation results.
