# Cane Runtime API v1.2 Pose Modifiers

Status: normative behavioral contract for Runtime API 1.2.

This document defines the game-facing procedural-pose stage shared by every
independent Cane runtime. It adds no Runtime JSON, CANEB, Atlas, editor, or
renderer data. A modifier is host input for exactly one evaluation and is
consumed by the renderer-neutral Core.

The authoritative frame pipeline is:

```text
setup pose
  -> animation tracks
  -> persistent overrides
  -> transient pose modifiers
  -> constraints / physics
  -> final world matrices
  -> final geometry and RenderPacket
```

An engine adapter may submit modifiers and consume the resulting frame. It
must not repeat any stage or edit final matrices, vertices, tint, UVs, winding,
or draw order.

## 1. Capability and compatibility

Runtime API 1.2 adds `FEATURE_TRANSIENT_POSE_MODIFIERS` (bit 37,
`0x2000000000`). Implementations that do not advertise this bit may continue
to expose the Runtime API 1.0/1.1 surface. Existing `apply`, `advance`, and
sampling behavior is exactly the empty-modifier case.

The feature is API-only. Runtime Format remains 1.0 and no document feature
name is added. A project does not need to opt in because no modifier is stored
in immutable project data.

## 2. Language-neutral input

All numbers are finite IEEE-754 binary32 values. Bindings may accept their
native number type, but validate and narrow each input to a finite binary32
before changing player state.

```text
RuntimeBoneLocalPatchV1 {
  x?: f32
  y?: f32
  rotationDegrees?: f32
  shearXDegrees?: f32
  shearYDegrees?: f32
  scaleX?: f32
  scaleY?: f32
}

RuntimeBoneLocalAdditiveV1 {
  xDelta?: f32
  yDelta?: f32
  rotationDegreesDelta?: f32
  shearXDegreesDelta?: f32
  shearYDegreesDelta?: f32
  scaleXDelta?: f32
  scaleYDelta?: f32
}

RuntimePoseModifierOperationV1 =
  | { operation: "replaceBoneLocal", boneId, local: RuntimeBoneLocalV1 }
  | { operation: "patchBoneLocal", boneId, patch: RuntimeBoneLocalPatchV1 }
  | { operation: "addBoneLocal", boneId, delta: RuntimeBoneLocalAdditiveV1 }
  | { operation: "patchConstraint", constraintId,
      parameters: RuntimeConstraintOverrideV1 }

RuntimePoseModifiersV1 {
  operations: RuntimePoseModifierOperationV1[]
}
```

Missing patch/delta fields leave that channel unchanged. JSON `null` and a
missing field both project to an absent optional value where a binding uses
nullable option fields. Unknown fields are rejected by strict protocol
decoders.

`replaceBoneLocal` replaces all seven local channels. `patchBoneLocal`
replaces only present channels. `addBoneLocal` reads the result of all earlier
stages and operations, then computes every present field with one binary32
addition:

```text
result = f32(f32(current) + f32(delta))
```

This applies to translation, rotation, shear, and scale deltas. Scale is
deliberately additive, not multiplicative. Hosts use patch/replace to set an
absolute or negative scale. A non-finite result fails the whole operation.
Angles are not wrapped by the modifier stage.

`patchConstraint` uses the existing typed constraint override union and its
existing value ranges. For IK this includes a world-space Cane target and
mix/bend/compress/stretch/softness. The constraint ID and tagged kind must
match. It changes only the sampled parameters used by the imminent solve.

Operations execute in declaration order. Repeated targets are observable and
sequential; there is no last-write canonicalization. This makes a patch after
an additive operation different from the reverse order.

## 3. Evaluation operations

Bindings expose equivalent forms of:

```text
applyWithModifiers(modifiers, sampling = authored) -> RuntimeFrameV1
advanceWithModifiers(deltaSeconds, modifiers, sampling = authored)
  -> RuntimeStepV1 / RuntimeFrameV1
```

The Rust reference returns its existing `RuntimeStepV1` from advance and the
published frame remains available from the player. A TypeScript binding may
return the frame from its established `advance` convenience form and expose a
step-returning alias. This return-shape difference does not change evaluation
semantics.

For each operation, Core performs exactly one animation sample and exactly one
constraint/geometry solve. `advanceWithModifiers(d, m)` is one atomic
`update(d)` followed by one modifier-aware apply; it must not call public
`update` and public `apply` in a way that samples or solves twice.

An empty batch is bit-equivalent to the corresponding legacy operation. A
modifier never enters project data, persistent overrides, animation state,
the absolute-sample baseline, or the next evaluation.

`sampleAt` replays intermediate physics steps as already specified. Pose
modifiers, when a binding exposes `sampleAtWithModifiers`, apply only to the
final requested sample, never to intermediate replay steps. This operation is
not required for the 1.2 capability bit.

## 4. Precedence and lifetime

The local input to the first transient operation is the sampled pose after:

1. setup restoration and skin resolution;
2. all active animation tracks and mixes;
3. persistent host/authoring overrides.

Transient operations then execute in their submitted order. Constraints and
Physics consume the modified pose and parameters. The published bone matrices,
attachment geometry, tint, and packet therefore already include their effect.

On the next evaluation Core starts again from setup/animation/persistent
state. A successful or failed transient batch is discarded. Querying a local
bone after a successful modifier-aware evaluation reports the transient local
used for that published frame; the following ordinary `apply()` reports the
unmodified local again.

Persistent overrides remain stored and are never rewritten by a transient
operation. A transient patch/additive operation is applied over their result;
a transient replace wins for that evaluation only.

## 5. Hooks and the Spine-style facade

Language bindings may expose persistent callback registration:

```text
beforeConstraints(callback) -> unsubscribe
afterConstraints(callback) -> unsubscribe
onEvent(callback) -> unsubscribe
```

`beforeConstraints` runs inside the transient stage, after explicit modifier
operations and in callback registration order. Its context can query the
current local channels and append the same replace/patch/add operations or a
typed constraint patch. It cannot publish a frame, advance clocks, edit
project data, or invoke another player mutation. Context and handles are valid
only for that callback invocation.

`afterConstraints` receives the complete candidate final frame in registration
order and is read-only. It cannot change authoritative output. Event listeners
run only after the frame commits, in the exact order of `frame.events`.
Lifecycle and authored user events retain their existing global ordering.

Registering or removing a listener while callbacks are being dispatched takes
effect on the next evaluation/dispatch. Reentrant player mutation fails with
`invalidState`.

A Spine-style convenience surface such as `findBone`, `queryBone`,
`setBonePosition`, `setBoneRotation`, `setAnimation`, `addAnimation`,
`clearTrack`, `setSkin`, `setAttachment`, `setConstraintTarget`, and
`setConstraintMix` is a thin projection over this player. Bone, slot, and
constraint handles contain stable IDs only; they do not own a second pose or
solver. Bindings must document whether a setter creates a persistent override
or appends a transient operation. The canonical TypeScript facade uses
explicit `persistent` and `transient` methods where ambiguity would otherwise
exist.

## 6. Failure and rollback

The complete batch is validated before it can become visible. Missing/empty
IDs, mismatched constraint kinds, invalid ranges, non-finite values/results,
callback failures, solver failures, and RenderPacket failures fail atomically.
In strict mode immutable data, tracks, clocks, queues, Physics history,
persistent overrides, pending events, frame sequence, and the published frame
remain unchanged.

Performance mode may expose an ephemeral frame whose backing memory is valid
only until the next mutating call, but the logical player state and sequence
still obey the same success/failure contract. Implementations may use an
allocation-free checkpoint and restore path or validate before mutating. They
must not weaken modifier validation or let a rejected modifier advance time.

Structured field paths identify the operation index, for example
`modifiers.operations[2].delta.rotationDegreesDelta`. The error's `operation`
is `applyWithModifiers` or `advanceWithModifiers`; an unknown target reports
`notFound`, a kind mismatch reports `invalidArgument`, and an arithmetic
overflow reports `nonFinite`.

## 7. Execution modes and allocation

Strict mode owns and freezes/copies published DTOs according to the existing
binding contract. Performance mode may reuse sampled pose, modifier context,
frame, packet, event, matrix, and validation workspaces. References obtained
from performance-mode frames or hook contexts are ephemeral.

On a stable valid frame, Core-owned performance mode must not allocate merely
because an empty or reused modifier batch is present. A binding can provide a
reusable modifier buffer/writer so a game loop does not construct arrays or
objects each frame. Allocations performed by user callbacks are outside the
runtime guarantee.

Implementations expose a test/diagnostic counter or equivalent instrumentation
capable of proving one animation sample and one constraint/geometry solve for
one modifier-aware evaluation. The counter is diagnostic only and cannot
change runtime output.

## 8. Coordinate contract

Bone locals, IK targets, final matrices, and render vertices remain in Cane's
X-right/Y-up Cartesian space. `RuntimeAffine2V1` maps a point as:

```text
x' = a*x + c*y + tx
y' = b*x + d*y + ty
```

The full affine is authoritative, including shear, negative scale, and
reflection. Engine adapters perform exactly one coordinate projection. A
PixiJS Y-down adapter uses `F = diag(1, -1)` and projects a Cane local-to-world
matrix `M` to `F * M`; when mapping between a Pixi parent and a follower it
uses the inverse parent world matrix rather than decomposing `M`.

## 9. Conformance requirements

The 1.2 feature is not advertised until a hash-pinned suite covers, at
minimum:

- animation plus persistent override plus transient replace/patch/additive;
- transient IK target and mix before solve;
- expiration on the next ordinary apply;
- declaration-order duplicates and binary32 additive results;
- invalid ID/kind/value and arithmetic-overflow rollback;
- full affine, shear, negative scale, and reflection output;
- event order and update/apply/advance equivalence;
- a diagnostic assertion of one sample and one solve.

The fixed suite must pass twice from fresh process/player state for both the
Rust reference and TypeScript candidate before either reports the feature as
conformant.
