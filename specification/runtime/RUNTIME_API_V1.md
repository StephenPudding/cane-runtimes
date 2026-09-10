# Cane Runtime API v1

Status: normative behavioral contract for independent implementations.

This API is a language-neutral object and state-machine contract. Function spelling, ownership
syntax, garbage collection, and async resource loading are language binding concerns. Editing,
undo/redo, AI state, file dialogs, engine ECS, and GPU objects are outside the API.

The exact affine, key sampling, curve, clock, queue, mix, and event algorithms are
[Cane Runtime v1 Core Animation Algorithms](CORE_ANIMATION_ALGORITHMS_V1.md). This document defines
the public object/lifecycle surface; the algorithm document defines its observable evaluation
semantics. Exact attachment geometry, weighted skinning, deform, linked-mesh,
clipping, Atlas, winding, tint, and renderer-color algorithms are
[Cane Runtime v1 Geometry and Render Algorithms](GEOMETRY_RENDER_ALGORITHMS_V1.md).
IK and Transform declaration order, activation, target spaces, analytic/CCD
branches, mapping, degeneracy, and match offsets are
[Cane Runtime v1 IK and Transform Constraint Algorithms](IK_TRANSFORM_ALGORITHMS_V1.md).
Path sampling, Physics fixed-step integration, and Slider animation mapping
are
[Cane Runtime v1 Path, Physics, and Slider Constraint Algorithms](PATH_PHYSICS_SLIDER_ALGORITHMS_V1.md).
The animation-after, constraint-before procedural pose stage added by Runtime
API 1.2 is [Cane Runtime API v1.2 Pose Modifiers](POSE_MODIFIERS_V1.md).
Runtime API 1.3 adds instance-local runtime resources, retained bounds queries,
Physics host-motion semantics, and a Core-owned final-geometry modifier stage;
their language-neutral contract is specified below.

## Capability discovery

An implementation reports:

- implementation name/version;
- supported Runtime JSON, CANEB, atlas, and Runtime API major/minor ranges;
- sorted supported feature names;
- numeric precision (`binary32` is the minimum);
- conformance suite version and digest last passed.

Loading returns immutable data metadata, including generator, document versions,
`requiredFeatures`, and ordered image/audio/font, animation, skin, bone, slot, attachment,
constraint, and event catalogs. It also returns the ordered structured warnings produced while
accepting the input. A missing required feature fails before instance creation.

### Structured load warnings

Warnings describe non-fatal compatibility decisions; they never replace structured errors. The
versioned DTO is:

```text
RuntimeWarningV1 {
  code: RuntimeWarningCodeV1
  operation: string
  message: string
  sectionTag: string | null
}
```

Runtime API v1 warning code `1` is `unknownOptionalCanebSectionIgnored`. A successful CANEB load
emits one warning for each unknown optional section, in section-table order, with operation
`loadCaneb` and the exact four-byte ASCII tag in `sectionTag`. The warning is available both
through the immutable data warning query and its catalog projection. Runtime JSON and CANEB
without ignored optional sections return an empty warning list. Warnings are transient load
metadata and are not inserted into Runtime JSON, CANEB `DATA`, or mutable player state.

Unknown required sections, unsupported required features, malformed data, and unavailable
capabilities remain load failures and produce no partially created `RuntimeData`. Warning
`message` is diagnostic; `code`, `operation`, and `sectionTag` are the stable fields.

### Runtime API feature bits

Feature bits are a `u64` capability/conformance projection. They are independent from the Runtime
JSON `requiredFeatures` string list: a bit can describe mutable player behavior or an API output
invariant that is not document content.

| Bit | Hex | Public name | Related Runtime JSON feature |
| ---: | ---: | --- | --- |
| 0 | `0x00001` | `FEATURE_REGION` | `attachment.region` |
| 1 | `0x00002` | `FEATURE_MESH` | `attachment.mesh` |
| 2 | `0x00004` | `FEATURE_WEIGHTED_MESH` | `mesh.weighted` |
| 3 | `0x00008` | `FEATURE_CLIPPING` | `attachment.clipping` |
| 4 | `0x00010` | `FEATURE_SKINS` | `skin`, `timeline.skin` |
| 5 | `0x00020` | `FEATURE_DEFORM` | `mesh.deform` |
| 6 | `0x00040` | `FEATURE_SEQUENCES` | `attachment.sequence` |
| 7 | `0x00080` | `FEATURE_MULTI_TRACK` | API-only tracks/queues/mixing |
| 8 | `0x00100` | `FEATURE_EVENTS` | `event` |
| 9 | `0x00200` | `FEATURE_FINAL_TINT` | API output invariant |
| 10 | `0x00400` | `FEATURE_TWO_COLOR_TINT` | `tint.two-color` |
| 11 | `0x00800` | `FEATURE_EXACT_AFFINE` | API output invariant |
| 12 | `0x01000` | `FEATURE_IK_CONSTRAINT` | `constraint.ik` |
| 13 | `0x02000` | `FEATURE_TRANSFORM_CONSTRAINT` | `constraint.transform` |
| 14 | `0x04000` | `FEATURE_PATH_CONSTRAINT` | `constraint.path` |
| 15 | `0x08000` | `FEATURE_PHYSICS_CONSTRAINT` | `constraint.physics` |
| 16 | `0x10000` | `FEATURE_SLIDER_CONSTRAINT` | `constraint.slider` |
| 17 | `0x20000` | `FEATURE_POSE_QUERY` | API-only sampled host queries |
| 18 | `0x40000` | `FEATURE_RENDER_GEOMETRY_KIND` | API output invariant |
| 19 | `0x80000` | `FEATURE_DEFORM_INVERSE` | API-only authoring geometry solve |
| 20 | `0x100000` | `FEATURE_SOURCE_GEOMETRY` | stable source-order setup-local/setup-world/sampled/current-world geometry and deform query |
| 21 | `0x200000` | `FEATURE_AUTHORING_OVERRIDES` | atomic authoring-preview override batches |
| 22 | `0x400000` | `FEATURE_PROJECT_RECONCILE` | live immutable-project replacement |
| 23 | `0x800000` | `FEATURE_TRACK_CONTROL` | current/queued track authoring control |
| 24 | `0x1000000` | `FEATURE_SAMPLING_CONTROL` | explicit current-state curve/frame sampling |
| 25 | `0x2000000` | `FEATURE_PHYSICS_ONLY_STEP` | Physics-only fixed-step advance |
| 26 | `0x4000000` | `FEATURE_VERTEX_TARGET_INVERSE` | stable source-vertex world-target inverse |
| 27 | `0x8000000` | `FEATURE_AUTHORED_TRIANGLE_FACING` | per-final-triangle authored/source facing retained across winding normalization |
| 28 | `0x10000000` | `FEATURE_AUTHORING_OVERRIDE_SAMPLING` | atomic authoring-preview overrides preserve explicit curve/frame sampling |
| 29 | `0x20000000` | `FEATURE_VERTEX_POSITION_EDIT_INVERSE` | runtime-owned logical-position to weighted-deform conversion |
| 30 | `0x40000000` | `FEATURE_PATH_CONSTRAINT_POSITION` | owned runtime-solved Path constraint position and extent |
| 31 | `0x80000000` | `FEATURE_PATH_CONSTRAINT_POSITION_INVERSE` | runtime-owned world-target to Path-position inverse |
| 32 | `0x100000000` | `FEATURE_SEQUENCE_STATE_QUERY` | canonical current sequence attachment index |
| 33 | `0x200000000` | `FEATURE_WEIGHT_BIND_POSITION_INVERSE` | world-target to per-influence weight-local position inverse |
| 34 | `0x400000000` | `FEATURE_PHYSICS_CONSTRAINT_RESET` | atomic reset of one Physics constraint |
| 35 | `0x800000000` | `FEATURE_TRANSFORM_CONSTRAINT_MATCH` | runtime-owned Transform constraint Match offsets |
| 36 | `0x1000000000` | `FEATURE_AUTHORING_SNAPSHOT` | one owned coherent authoring projection of the published pose |
| 37 | `0x2000000000` | `FEATURE_TRANSIENT_POSE_MODIFIERS` | API-only one-evaluation bone/constraint modifiers |
| 38 | `0x4000000000` | `FEATURE_RUNTIME_RESOURCES` | API-only instance-local image/atlas/attachment/skin overlay |
| 39 | `0x8000000000` | `FEATURE_RUNTIME_BOUNDS` | API-only retained AABB, polygon, and hit queries |
| 40 | `0x10000000000` | `FEATURE_PHYSICS_HOST_MOTION` | API-only root-motion/history policy |
| 41 | `0x20000000000` | `FEATURE_FINAL_GEOMETRY_MODIFIERS` | API-only ordered final-geometry stage |

Bits 0–16 are Runtime API 1.0. Bits 17–36 and their operations or output
invariants are additive
Runtime API 1.1 capabilities. Bit 37 and its operations are the additive
Runtime API 1.2 capability. Bits 38–41 and their operations are additive
Runtime API 1.3 capabilities. Bits not listed above are zero. A candidate
rejects a conformance request that requires an unknown or unsupported bit; it
never silently masks it.

## Immutable data and mutable instance

`RuntimeData` owns one validated skeleton definition and may be shared by instances. It never
contains decoded GPU textures or mutable playback state.

`SkeletonInstance` owns:

- local/world pose and deform buffers;
- active skins;
- host bone, Region, draw-order, attachment, slot-tint, vertex-deform, and constraint overrides;
- animation tracks, queues, mixes, and clocks;
- stateful constraints and physics environment;
- an instance-local image/atlas/attachment/skin resource overlay;
- persistent final-geometry modifiers and retained bounds-query storage;
- pending lifecycle and user events;
- the most recent immutable frame snapshot.

Instances never mutate `RuntimeData`. Two fresh instances given the same operations produce equal
frames and events.

## Required operations

Every language binding exposes equivalent operations:

- load Runtime JSON or CANEB and attach validated atlas documents;
- validate a complete catalog of decoded direct-image and atlas-page dimensions before host
  rendering;
- inspect versions, features, metadata, and catalogs;
- create, clone-configuration, and fully reset an instance;
- set active skins;
- create/copy/merge/dispose detached Runtime Skin builders and atomically install or remove
  instance-local images, atlases, attachments, and skins;
- acquire and release external decoded resources through renderer-neutral texture descriptors;
- set/clear a slot attachment override;
- set/clear a final host slot tint override;
- set/clear supported runtime constraint parameters;
- atomically set/clear persistent bone-local, Region-pose, draw-order, vertex-deform, slot, and
  constraint authoring-preview overrides;
- apply one ordered transient bone replace/patch/additive and typed constraint
  patch batch for exactly one evaluation;
- set, queue, fade to empty, and clear animations by track;
- inspect and atomically edit/remove owned queued entries;
- configure default/pair mixes and per-track replace/additive options;
- set absolute animation time, track time/range/end/current mix/rate/loop, and threshold options;
- set and query the exact signed root transform, and set the physics environment;
- `update(deltaSeconds)`, sampling-aware `apply()`, `seek(timeSeconds)`, and deterministic
  `sampleAt(timeSeconds, fixedStepSeconds)`;
- modifier-aware `applyWithModifiers` and atomic `advanceWithModifiers` without
  a second animation sample or constraint/geometry solve;
- set persistent and apply one-evaluation final-geometry modifiers without a second animation
  sample or constraint solve;
- move or teleport the root with an explicit Physics history policy;
- advance stateful Physics without advancing animation clocks or queues;
- query an owned current track state, sampled constraint state/diagnostic,
  runtime-solved Path constraint position/extent, and its runtime-owned
  world-target inverse;
- query runtime-owned Transform constraint Match offsets and atomically reset
  one Physics constraint's solver history;
- query exact sampled bone-local channels/inheritance mode and Region-local channels;
- write current final attachment AABBs/polygons into retained storage and perform point,
  segment, and bounds hit tests in final draw order;
- query stable source-order setup, sampled, world, and deform vertex buffers;
- query current sampled slot state, canonical sequence attachment index, Point
  world pose, and Path, BoundingBox, or Clipping world geometry by stable ID;
- capture one owned authoring snapshot containing the current Frame and all
  catalog-ordered authoring query projections from that same published pose;
- translate a weighted Mesh's current world vertices into owned deform values by using the
  runtime's normative inverse-deform algorithm;
- map one stable source vertex world target to a complete owned deform patch for Mesh, Path,
  BoundingBox, or Clipping attachments;
- map one weighted source vertex world target to one owned bone-local position
  per existing influence when editing setup weights;
- replace immutable project input while reconciling compatible playback and host state;
- read an immutable frame and drain incremental events.

An implementation may offer a combined `advance(delta)` equal to `update(delta)` followed by
`apply()`. `apply()` never advances time or emits time-crossing events.
`applyWithSampling` and `advanceWithSampling` select authored curves, forced
stepped curves, fixed-frame sampling, or fixed-frame forced-stepped sampling
without asking a host to resample keys. `advancePhysics(delta)` consumes the
same bounded Physics fixed-step budget and publishes one frame while leaving
all animation clocks, queues, and events unchanged.

Instance creation is a fallible atomic operation. It evaluates and publishes the complete setup
frame before returning the instance. If constraints, resources, geometry limits, or frame
construction fail, creation returns the structured error and no half-valid instance or empty
placeholder frame is observable.

`reset()` clears tracks, queues, overrides, pending events, deform, physics history, and sampled
state, then restores setup pose and default skin. Configuration cloning copies skins, overrides,
mix configuration, root transform, and physics environment but not clocks, events, or solver
history.

`replaceProject(newProject)` (also exposed as `reconcileProject`) is atomic. It preserves valid
track entries, queued entries, mixes, track options, active skins, root transform, physics
environment, and persistent overrides; references or shape-dependent deforms that are no longer
compatible are dropped. Animation durations and catalog references are rebound to the new
immutable input. It evaluates and publishes exactly one new frame. Any evaluation, constraint,
resource, or packet failure leaves the old project, player state, events, and frame unchanged.

`clearTracks` and `resetPhysics`, like every other configuration operation,
return success or a structured error. They are not best-effort void
operations.

Transform constraint `mixRotate`, `mixX`, `mixY`, `mixScaleX`,
`mixScaleY`, and `mixShearY` setup values, sampled timeline values, and host
overrides accept every finite binary32 value. Negative values reverse the
property contribution and values above one extrapolate; implementations do
not clamp them to `[0,1]`. IK and Path mixes, Physics unit controls, track
alpha, and event/attachment/draw-order thresholds retain their separately
specified unit-interval validation.

## Evaluation order

`apply()` is deterministic and performs:

1. restore setup local pose, setup slots, setup draw order, setup attachments, setup constraints;
2. apply host skins and setup attachment resolution;
3. apply tracks in ascending track index, including active cross-fades;
4. apply animated skin and attachment selection;
5. apply persistent host overrides in canonical order: bone local, Region pose, draw order, slot
   attachment, slot tint, vertex deform, then constraint parameters;
6. apply ordered transient per-frame bone and constraint modifiers;
7. compute unconstrained world transforms;
8. solve constraints in declaration order, updating dependent world transforms according to each
   constraint-family algorithm specification;
9. resolve linked meshes, weights, deform, clipping, final draw order, and final attachment tint;
10. apply persistent then transient final-geometry modifiers in declaration order, validating
    finite output, immutable topology, and non-collapsed/non-inverted source triangles;
11. publish the immutable RenderPacket and Frame.

Hash-map iteration and worker scheduling must not change any observable order.

## Time, loops, and events

Time is seconds. Inputs reject NaN and infinity. Runtime API v1 `update` and `advance` require a
finite, non-negative delta; a negative delta is `invalidArgument`. Reverse playback uses a negative
track `timeScale`; mix progress still advances by the non-negative, unscaled delta.

For animation duration `D > 0`:

- non-looping sample time is clamped to `[0,D]`;
- looping pose time is the possibly-negative raw track time's Euclidean remainder in `[0,D)`;
- a looping raw clock crossing any positive or negative integer multiple of `D` emits one
  completion in crossing order;
- a non-looping forward clock completes when it reaches `D`, while a reverse clock completes when
  it reaches `0`; reverse crossing of `D` alone is not a completion.

For `D == 0`, pose time is always zero and no repeated completion is generated.

Forward event intervals are `(previousTime,currentTime]`; reverse intervals are
`[currentTime,previousTime)`, emitted in reverse timeline order. Looping splits the interval at
each boundary. Equal-time events retain declaration order forward and reverse declaration order
backward, except that a new entry's one-time initialization events retain declaration order in
both directions. Exact boundary phase and non-looping reverse behavior are defined by the core
algorithm specification.

The previous endpoint is excluded. Thus looping raw time `0 -> -epsilon` does not cross the zero
boundary; it may only produce the new-entry initialization events. At a crossed forward loop
boundary the exact order is time-`D` authored keys, `complete`, then time-zero authored keys.
Reverse uses the exact inverse order. Event-time equality is exact binary32 equality (`+0 == -0`);
there is no event-time epsilon.

One operation globally merges events by its binary64 wall-clock crossing offset. Ties use ascending
track index, oldest `mixingFrom` through incoming entry, then the entry-local boundary/declaration
order. Queue promotion occurs only while moving forward across its delay. These rules make one
large update and the concatenation of any equivalent partition produce the same ordered events.

`update` appends incremental events to the drain queue. `sampleAt` returns events for its
configuration-baseline interval but neither inserts them into nor discards the incremental queue.
Repeating an absolute sample repeats the same returned events.

Absolute sampling resets stateful constraints and replays fixed steps from a configuration
baseline. `fixedStepSeconds` is finite and greater than zero. A request requiring more than
1,000,000 replay samples fails with `resourceLimit`.

Physics has an independent aggregate limit of exactly 1,000,000 fixed
substeps per `apply`, `advance`, `seek`, or `sampleAt`. The count is shared by
all active Physics constraints and, for absolute sampling, by the baseline and
every replay evaluation. Exactly 1,000,000 is allowed; requiring another
substep fails atomically with `resourceLimit`.

An `update`, `advance`, or absolute sample that would emit more than 1,000,000
new lifecycle and user events likewise fails atomically with `resourceLimit`.
This event count is preflighted before allocating or publishing the batch and
includes `complete`. Replay samples, Physics substeps, and emitted events have
separate budgets; passing one limit does not increase another.

## Key and curve sampling

Keys are ordered by `(time,declarationOrder)`. Before the first key, a channel leaves the setup or
lower-track value unchanged. At an exact time shared by multiple keys, the last declared key wins.

- Linear uses `v0 + (v1-v0)*p`.
- Stepped returns `v0`.
- Cubic Bezier solves
  `x(u)=B(0,cx1,cx2,1,u)=p` for `u in [0,1]`, then returns
  `B(0,cy1,cy2,1,u)`.

For a value Bezier, the Y controls are `from+dy1` and `to+dy2`; unlike a
normalized percent curve this can overshoot equal endpoints. X controls for
both forms are any finite values. The core algorithm specification defines
the exact derivative-based monotonic test, the bounded 24-iteration reference
solve, and the fixed ten-segment fallback when X is not monotonic. A
mathematically equivalent monotonic solver is allowed when conformance output
satisfies the suite tolerance; the non-monotonic branch and segment-selection
order are observable and must match.

A `properties` curve selects a simple curve by canonical property name before
sampling. An explicit null override is linear; absence uses the optional
default and then linear. Bundles are one level deep and use the closed
property vocabulary in Runtime Model v1. Rotation and shear key interpolation
follows the shortest signed angular delta. Runtime JSON v1 has no
accumulated-turn channel.

Discrete attachments, skins, inheritance modes, draw order, sequence modes, and event channels are
stepped.

## Tracks and mixing

Track zero is evaluated first; higher tracks apply afterward. `alpha` and all thresholds are
required to be in `[0,1]`; an out-of-range Runtime API input is rejected.

`queryTrackState(trackIndex)` is a read-only query. It returns null when the
track has no current entry; otherwise it returns an owned `RuntimeTrackStateV1`
containing the stable animation ID, animation/track clocks and range, delay,
track end, time scale, alpha, loop and blend modes, mix clock/progress, event,
attachment, and draw-order thresholds, `holdPrevious`, and the queued-entry
count. Every returned binary32 scalar is finite, all exposed counts fit u32,
and unit fields remain in `[0,1]`. A `trackIndex` above 4095 returns
`invalidArgument`, operation `queryTrackState`, field `trackIndex`.

`queryTrackCount()` returns the number of allocated track slots and
`defaultMixSeconds()` returns the current validated default cross-fade.
`queryQueuedEntries(trackIndex)` returns an owned array in queue order. Each
entry contains its track/queue indices, nullable animation ID, delay, mix
duration, and loop flag; a null animation ID is an empty fade-out entry.
Queries do not publish a frame or drain events.

Runtime API 1.1 exposes the controls used by an animation mixer:

- `setAnimationTime` sets primary-track absolute animation time and accounts
  for a non-zero animation-range start; it is not an alias for raw track time;
- `setTrackAnimationRange` sets `[start,end]` or null to restore the full
  animation, while `setTrackEnd` sets a finite lifetime or null for unbounded;
- `setTrackMixDuration` edits the current entry's active mix;
- `setEmptyAnimation` fades the current entry to empty, and
  `queueEmptyAnimation` appends a fade-out entry;
- `setQueuedEntryOptions` atomically edits delay, mix duration, and/or looping,
  and `removeQueuedEntry` removes exactly one queue index and emits Dispose.

Every mutation validates all supplied fields before commit, evaluates on a
detached player, and publishes exactly one immutable frame. A missing current
or queued entry, invalid range, non-finite value, solver failure, or packet
failure leaves clocks, queues, events, frame sequence, and the published frame
unchanged.

Replace blend interpolates from the value already produced by lower tracks toward the sampled
value. Additive blend adds the sampled delta from the property's setup value, scaled by alpha.
Scale uses the same linear setup-relative delta as other ordinary scalars; it is not
multiplicative. Rotation/shear use signed angular deltas.

During a mix of duration `M`:

- `M == 0` switches immediately; negative durations are invalid;
- progress is `clamp(mixTime/M,0,1)`;
- every entry retains its own alpha; incoming alpha is multiplied by its progress, while outgoing
  properties use the per-property fade rules in the core algorithm specification;
- outgoing event, attachment, and draw-order application use their declared thresholds;
- completion disposes the outgoing entry exactly once.

Outgoing authored events test `crossingMixProgress < eventThreshold` independently at each event's
wall-clock crossing offset. They do not use the final progress of a large update. Attachment and
draw-order thresholds remain final-pose application decisions.

Queue delay, hold-previous behavior, and per-property conflict resolution use the exact algorithms
in the core animation specification. A runtime may not advertise the `FEATURE_MULTI_TRACK` Runtime
API capability bit until the complete required multi-track conformance matrix passes. Runtime API
1.0 has no empty-animation or queue-edit operations; these are additive
`FEATURE_TRACK_CONTROL` operations in 1.1. There is no `animation.mix`
Runtime JSON `requiredFeatures` name in v1 because tracks and mixing are
mutable player operations rather than serialized document content.

## Frame and RenderPacket

The frame is an owned immutable snapshot. Later instance updates do not change it.

It contains:

- monotonically increasing frame sequence and sampled time;
- complete bone world affine matrices;
- configured and finally sampled skin IDs;
- ordered render attachments.

Events are operation results, not frame state. `update`, `advance`, `seek`, and `sampleAt` return
the events produced by that operation; incremental playback also appends its events to the
drainable queue. `apply` emits no time-crossing events. An immutable frame therefore remains
independent from when a host drains or retains event batches.

The only authoritative 2D transform is:

```text
x_world = a*x_local + c*y_local + tx
y_world = b*x_local + d*y_local + ty
```

`[a,b,c,d,tx,ty]` may contain arbitrary shear, nonuniform scale, and reflection. Derived
rotation/scale values, when a binding exposes them for convenience, are non-normative and cannot be
used to reconstruct rendering.

Each render attachment contains:

- slot and attachment IDs;
- final `geometryKind`, either `regionQuad` or `meshTriangles`;
- `imageId`, atlas/page/region identity, or an explicit unatlased image reference;
- texture color-space and alpha-mode semantics for both direct and atlas-backed sources;
- final world-space `verticesXY`, final page `uvs`, and triangle `indices`;
- one `authoredTriangleFacing` value per final triangle, captured from final
  world geometry before winding normalization;
- normalized blend mode and GPU front-face/winding declaration;
- final light RGB bytes, alpha, optional dark RGB bytes;
- the complete source affine matrix for diagnostics and consumers that need it.

`authoredTriangleFacing` is ordered by final triangle ordinal and has exactly
`indices.length / 3` values: `towardViewer`, `awayFromViewer`, or `edgeOn`.
It preserves the authored/source-facing result after clipping, deformation,
skinning, and Atlas trim have produced final world triangles but before their
indices are normalized to CCW. It is not the GPU `frontFace` declaration.
Hosts copy it directly and never derive it from normalized indices or
`sourceAffine`. Authored backface culling retains only `towardViewer`
triangles; every submitted retained triangle still uses the separately
declared `frontFace:"counterClockwise"`.

The packet has already applied skin/attachment selection, draw order, clipping, deformation,
weights, atlas trim/rotation, and reflection winding. Hosts do not repeat those algorithms.
`geometryKind` describes this final emitted representation, not the authored attachment type.
`regionQuad` means the packet contains the direct four-corner projection of an unconverted Region.
`meshTriangles` covers authored Mesh geometry and any attachment converted to general triangles;
in particular, clipping an authored Region produces `meshTriangles`, even when the resulting
vertex count happens to be four. Hosts must not infer the value from the catalog, source attachment
kind, or vertex count.
`MAX_RENDER_ATTACHMENT_VERTICES_V1` is exactly 65,536. Exceeding it while evaluating runtime
clipping or Atlas source trim fails the complete operation atomically with `resourceLimit`;
a legal clip that emits no triangles succeeds and simply omits that draw attachment.
The exact construction order, source-UV clipping, final-tint integer
composition, color-space transfer, premultiplication, and blend equations are
defined by
[Geometry and Render Algorithms v1](GEOMETRY_RENDER_ALGORITHMS_V1.md).

Tint values are straight, unpremultiplied sRGB. Light RGB is the runtime-composed slot × attachment
light color. Alpha is runtime-composed and normalized. `darkRgb: null` disables two-color tint;
present black is different from null.

For a straight sampled texel `T` and two-color tint, before output color-space conversion:

```text
rgb = mix(darkRgb, lightRgb, T.rgb)
alpha = T.a * finalAlpha
```

The renderer converts color space and premultiplies exactly once according to atlas metadata and
its blend pipeline. Direct image sources explicitly report `srgb` plus `straight` in v1; hosts do
not infer defaults from a filename. A one-color packet uses `rgb = T.rgb * lightRgb`.

Atlas documents may be parsed before texture bytes are available. After decoding resources, a
rendering host calls `validateDecodedTextureSizes` with every direct image and every attached atlas
page exactly once. Missing, extra, duplicate, zero-sized, or dimension-mismatched facts are
structured failures. Packet-only conformance runners may use declared dimensions without decoding
GPU resources, but that is not evidence that a host texture upload passed resource validation.

## Read-only current-state and inverse-edit queries

`queryBoneLocal(boneId)` returns exact sampled authoring channels
`x/y/rotationDegrees/shearXDegrees/shearYDegrees/scaleX/scaleY`;
`queryBoneTransformMode` returns the sampled inheritance mode, and
`queryBoneLocalState` returns both in one owned result. These values are not a
decomposition of the world affine matrix. `queryRegionAttachmentPose` likewise
returns the exact sampled local Region channels.

`queryVertexAttachmentSourceGeometry(attachmentId, deformSpace)` supports
Mesh, Path, BoundingBox, and Clipping attachments. Its `setupVerticesXy`,
`setupWorldVerticesXy`, `sampledVerticesXy`, and `worldVerticesXy` arrays
share one stable source-vertex order. `setupWorldVerticesXy` uses the current
solved bones, constraints, weights, and bind inverses while applying no vertex
deform; hosts MUST NOT reconstruct it from `sourceAffine`, which is not
sufficient for a multi-bone weighted attachment. The result also identifies
the resolved linked-Mesh geometry source and deform owner and returns the
current deform in either `vertexPositions` or `weightedInfluenceOffsets`.
RenderPacket geometry is not substituted because clipping and atlas projection
can change topology and vertex identity.

`queryRootTransform()` returns the exact owned
`x/y/rotationDegrees/scaleX/scaleY` host transform supplied to the player.
The scale signs are preserved, so a reflection is never inferred by
decomposing a bone or attachment matrix. The query does not publish a frame.

`queryConstraintState(constraintId)` returns an owned
`RuntimeConstraintStateV1` for the current solved pose:

```text
constraintId
kind
sampledParameters
sampledSliderTimeSeconds | null
diagnostic | null
```

`sampledParameters` is the typed IK, Transform, Path, Physics, or Slider
parameter projection also accepted by the corresponding host override; every
applicable field is populated from `sampled_constraint`. Slider additionally
reports the applied target-animation time from `sampled_slider_time` when the
Slider was active. `diagnostic` is the latest optional solver-owned diagnostic
and is one of the versioned `RuntimeIkConstraintDiagnosticV1`,
`RuntimeTransformConstraintDiagnosticV1`,
`RuntimePathConstraintDiagnosticV1`,
`RuntimePhysicsConstraintDiagnosticV1`, or
`RuntimeSliderConstraintDiagnosticV1` projections. Diagnostics expose finite
residuals, mixes, offsets, speeds, limits, and times, plus bounded u32
iteration/step/driven-bone counts and the corresponding saturation,
wrap/clamp, or optional-value flags. An unavailable diagnostic is null; it
does not make the sampled constraint state unavailable.

An unknown constraint ID returns `notFound`, operation
`queryConstraintState`, and the stable ID as `entityId`. A missing sampled
state, mismatched typed diagnostic, invalid count, or non-finite runtime value
is a structured `invalidState`, `resourceLimit`, or `nonFinite` failure. The
query never evaluates another pose.

`queryMatchedTransformConstraintOffsets(constraintId)` returns finite
`rotationDegrees`, `x`, `y`, `scaleX`, `scaleY`, and `shearYDegrees` values
computed by the runtime's canonical Transform constraint Match algorithm for
the current sampled pose. Hosts must not reproduce the local/world affine
routing. Unknown, non-Transform, non-canonical-routing, and non-finite cases
return structured errors; the query is read-only.

`resetPhysicsConstraint(constraintId)` atomically clears one Physics
constraint's solver history and publishes one rebuilt frame without changing
animation clocks or queues. Its boolean result reports whether live history
was present. Unknown or non-Physics IDs fail without changing the player.

`queryPathConstraintPosition(constraintId)` returns an owned
`RuntimePathConstraintPositionV1`:

```text
constraintId
point { x, y }
tangentDegrees
distance
pathLength
pathStart { x, y }
pathEnd { x, y }
closed
```

The projection is taken from the runtime's current solved Path sampler;
bindings must not reconstruct curves, distance tables, deformation, or
tangents. Every numeric field is finite binary32. An unknown ID returns
`notFound`; a known non-Path constraint returns `invalidArgument`; a Path
constraint without a currently resolvable target Path returns `invalidState`.
The query works on detached runtime state and does not publish a frame, alter
world caches, advance clocks, emit/drain events, or mutate Physics history.

`queryPathConstraintPositionForWorldTarget(constraintId, targetWorld)` returns
the finite sampled `position` scalar that makes the Path constraint target the
given finite world-space point. It uses the runtime's authoritative active Path,
position mode, distance table, current deform, and complete affine pose on
detached state. Bindings must not duplicate or approximate that inverse in an
editor or renderer adapter. Unknown, wrong-kind, unavailable, and non-finite
inputs/results use the same structured error and read-only guarantees as
`queryPathConstraintPosition`.

`translateWeightedMeshDeform(attachmentId, space, worldDelta)` accepts
`space:vertexPositions` or `space:weightedInfluenceOffsets`. It takes every
current sampled world vertex of a fully weighted Mesh, adds the same finite
world-space delta, and calls the normative runtime inverse-deform solver for
each stable source vertex. The owned flat binary32 result is in source-vertex
order for `vertexPositions` and source vertex/influence order for
`weightedInfluenceOffsets`. Linked Meshes resolve their source geometry and
deform identity exactly as normal runtime deformation does. A binding MUST
NOT duplicate the weights, bind-inverse, affine, or deform conversion math.

The operation rejects an unknown attachment with `notFound`, a non-Mesh or
unweighted Mesh with `invalidArgument`, malformed/count-overflowing sampled
geometry with `invalidState` or `resourceLimit`, a non-finite input/result
with `nonFinite`, and a singular or otherwise unsolvable inverse projection
with `invalidState`. It performs the solve on detached current-pose state and
does not commit the returned values to the player.

`vertexAttachmentDeformForWorldTarget(request)` is the unified single-vertex
inverse authoring query:

```text
RuntimeVertexWorldTargetV1 {
  attachmentId: id<attachment>
  sourceVertexIndex: u32
  targetWorld: { x: binary32, y: binary32 }
  currentDeform:
    { source: "playerCurrent", space }
    | { source: "values", space, values: binary32[] }
}

RuntimeVertexDeformV1 {
  attachmentId: id<attachment>
  deformAttachmentId: id<attachment>
  space: "vertexPositions" | "weightedInfluenceOffsets"
  values: binary32[]
}
```

`sourceVertexIndex` uses the same stable source order returned by
`queryVertexAttachmentSourceGeometry`; it is not a RenderPacket vertex index.
Mesh, Path, BoundingBox, and Clipping are supported. `playerCurrent` starts
from the player's sampled deform after animation and persistent authoring
overrides. `values` supplies an explicit complete buffer and is validated by
the same runtime deform conversion used when applying an override.

For `vertexPositions`, the returned buffer replaces only the requested
source-vertex XY pair. For `weightedInfluenceOffsets`, the returned buffer
updates the complete influence slice for that source vertex and preserves
all other source-vertex/influence values. Linked Mesh geometry and deform
ownership are resolved exactly as normal sampling does.

The Rust reference dispatches to the runtime's normative Mesh, Path, polygon,
or weighted-offset inverse solver. Independent bindings MUST implement the
same algorithm contract and MUST NOT derive a second host-side weights,
bind-inverse, affine, or deform formula. A target that cannot be inverted
because the current transform is singular or bindings are invalid returns
`invalidState`, field `targetWorld`. An out-of-range stable index or malformed
buffer returns `invalidArgument`; non-finite target/buffer/result values return
`nonFinite`. The operation works on detached state and does not commit the
returned patch, publish a frame, change frame sequence, drain/emit events, or
alter Physics history.

`vertexAttachmentWeightLocalPositionsForWorldTarget(attachmentId,
sourceVertexIndex, targetWorld)` is the corresponding setup-weight authoring
inverse. It supports weighted Mesh, Path, BoundingBox, and Clipping source
vertices and returns one finite `{x,y}` bone-local point per existing
influence, in immutable influence order. The runtime owns all bone-affine
inverse and weighted-target math; host tools must not reimplement it. Weight
eligibility is checked for the addressed source vertex, not through the
attachment-wide `fullyWeighted` source-geometry flag. A target source vertex
with no influences returns `invalidArgument` on `sourceVertexIndex`. Unknown
IDs, unsupported attachments, invalid indices, singular poses, and non-finite
values return structured errors. The query is read-only.

## Slot and non-renderable attachment queries

`querySlotState(slotId)` returns both the current logical attachment key (or
null) and the final resolved attachment ID (or null), plus sampled slot tint
and the zero-based final slot draw-order position:

```text
RuntimeSlotStateV1 {
  slotId: id<slot>
  attachmentKey: string | null
  attachmentId: id<attachment> | null
  tint: RuntimeFinalTintV1
  drawIndex: u32
}
```

`attachmentKey` is the setup/timeline value before Skin placeholder
resolution. `attachmentId` is the final attachment selected after resolving
that key through the current ordered active skins. When this list is non-empty
and omits the first declared/default Skin, attachment lookup evaluates that
default Skin first as an implicit fallback; the fallback is not added to the
reported active or sampled Skin IDs and does not affect Skin member
activation. An explicitly listed default Skin keeps its requested stack
position, while an empty list deliberately disables every Skin mapping. The
two values are intentionally distinct: for a placeholder such as `body`,
`attachmentKey` remains `body` while `attachmentId` can be `body-red` or
`body-blue`. A hidden slot can retain a non-null logical key while an active
Skin resolves it to a null `attachmentId`; an explicit null setup/timeline key
makes both null. The tint is straight, unpremultiplied sRGB and remains the
slot tint; attachment tint composition occurs exactly once when RenderPacket
is built.

`querySequenceIndex(attachmentId)` returns the canonical current zero-based
image index for a Region or Mesh sequence attachment. It returns the validated
setup index when no sequence timeline currently overrides it, otherwise the
runtime-sampled timeline index. Success is always in bounds for the immutable
sequence asset list and representable as `u32`. An unknown attachment returns
`notFound`; an attachment without a sequence returns `invalidArgument`.

`queryPointAttachmentPose(attachmentId)` returns a Point attachment's finite
world-space `x`, `y`, and `rotationDegrees`. It uses the same sampled bone
transforms as the published frame.

`queryAttachmentGeometry(attachmentId)` exposes current-pose geometry needed
by tools, collision systems, and conformance without putting non-renderable
objects into RenderPacket. Its owned result is:

```text
RuntimeAttachmentGeometryV1 {
  attachmentId: id<attachment>
  kind: "path" | "boundingBox" | "clipping"
  worldVerticesXy: number[]
  closed: boolean | null
}
```

`worldVerticesXy` is a finite, flat world-space XY array in the attachment's
declared control-point/vertex order. For a Path it contains every
incoming-handle, anchor, and outgoing-handle point after the same weights and
deform evaluation used by Path constraints, and `closed` is the Path's
boolean. BoundingBox and Clipping return their evaluated polygon vertices and
use `closed:null`. The operation reuses the normative vertex-attachment
projection; a binding MUST NOT implement a second weights/deform formula.

The attachment need not be selected by its slot. The query resolves it
against the player's current sampled bones and deform state by stable ID. It
does not advance clocks, evaluate a new animation time, publish a frame,
increment frame sequence, emit/drain events, or change Physics history.

An unknown ID returns `notFound` with operation
`queryAttachmentGeometry` and the ID as `entityId`. Region, Mesh, and Point
IDs return `invalidArgument`, field `attachmentId`, because their applicable
public projections are RenderPacket for Region/Mesh and
`queryPointAttachmentPose` for Point. Failure to resolve an otherwise
supported attachment in the current pose returns `invalidState`; non-finite
output returns `nonFinite`. Every success and failure is atomic.

All current-state and inverse-edit query families are read-only: they do not
advance clocks, publish a frame, increment frame sequence, emit/drain events,
commit deform, or mutate Physics history.
Unknown IDs return `notFound` with the operation name and stable ID as
`entityId`; a known object of the wrong kind returns `invalidArgument`.

### Coherent authoring snapshot

`queryAuthoringSnapshot()` returns one owned `RuntimeAuthoringSnapshotV1`
captured from the player's already-published pose:

```text
RuntimeAuthoringSnapshotV1 {
  frame: RuntimeFrameV1
  boneLocalStates: RuntimeBoneLocalStateV1[]
  slotStates: RuntimeSlotStateV1[]
  constraintStates: RuntimeConstraintStateV1[]
  pointAttachmentPoses: RuntimePointAttachmentPoseV1[]
  attachmentGeometries: RuntimeAttachmentGeometryV1[]
  vertexAttachmentSourceGeometries: RuntimeVertexAttachmentSourceGeometryV1[]
  pathConstraintPositions: RuntimePathConstraintPositionV1[]
}
```

Collections preserve immutable catalog order. Bone, slot, and constraint
collections contain every corresponding catalog entry. Point poses contain
every Point attachment. `attachmentGeometries` contains Path, BoundingBox, and
Clipping attachments; `vertexAttachmentSourceGeometries` contains Mesh, Path,
BoundingBox, and Clipping attachments and uses `vertexPositions` deform space.
Path positions contain every currently resolvable Path constraint in constraint
catalog order; a valid Path constraint that temporarily reports
`invalidState` is omitted without discarding the rest of the snapshot.

The operation does not advance or resample animation, publish a frame, consume
events, increment sequence numbers, or mutate Physics history. All included
projections therefore describe the exact pose owned by `frame`. Any query
failure other than the explicitly optional unresolved Path position fails the
whole operation atomically. Hosts share this DTO among rendering, picking, and
authoring overlays instead of issuing independent current-state queries that
could observe different poses.

`vertexAttachmentWeightedDeformOffsetsAfterPositionEdit(attachmentId,
currentWeightedOffsets, beforePositions, afterPositions)` converts a complete
logical source-position edit into a complete owned
`weightedInfluenceOffsets` buffer. All three buffers contain finite binary32
values. Position buffers are equal-length XY pairs in stable source-vertex
order; `currentWeightedOffsets` contains one XY pair per influence in stable
source vertex/influence order. Their exact lengths must match
`queryVertexAttachmentSourceGeometry`.

The operation delegates the weights, bind-inverse, and influence conversion
to the normative runtime algorithm. A host or binding must not reimplement
that math. Unknown attachments return `notFound`; unsupported or malformed
input returns `invalidArgument`; an unavailable runtime conversion returns
`invalidState`; non-finite input or output returns `nonFinite`. Success and
failure are read-only and leave the complete player unchanged.

## Atomic authoring-preview overrides

`setAuthoringOverrides(RuntimeAuthoringOverridesV1)` accepts an ordered batch
of tagged set/clear operations for bone-local pose, Region pose, complete draw
order, vertex deform, slot attachment, slot tint, and typed constraint
parameters. It is the compatibility form and is exactly equivalent to
`setAuthoringOverridesWithSampling(request, authored)`.

`setAuthoringOverridesWithSampling(request, sampling)` accepts the same batch
and one `RuntimeSamplingV1` value. `forceStepped`, `fixedFrame`, and
`fixedFrameStepped` use the same sampling semantics and validation as the
current-state `apply` operation; applying persistent authoring overrides must
not silently restore authored interpolation.

Duplicate targets use deterministic last-operation-wins staging. Draw order
must be an exact permutation of every slot. A slot attachment distinguishes
setting an ID, setting null to hide the slot, and clearing the override to
resume animation/skin selection.

The player validates sampling and stages the complete request on a detached
copy, reapplies animation with that sampling mode, applies all persistent
overrides in canonical evaluation order, solves the pose, builds RenderPacket,
and publishes exactly one frame. Any invalid sampling value, ID, kind, value,
deform shape, solver failure, or packet failure rolls back the entire batch,
including frame sequence and pending events.

Editor gizmos and language bindings use
`vertexAttachmentDeformForWorldTarget` for stable source-vertex edits. They
must not duplicate weights, bind-inverse, affine, or deform inverse
algorithms.

## Runtime API 1.3 shared SDK extensions

### Instance-local runtime resources

`RuntimeResourceSnapshotV1` is an ordered, owned overlay containing Images,
Atlas references/documents, Attachments, and Skins. The overlay belongs to one
player. An overlay entry with the same stable ID replaces the corresponding
shared-project entry for that player; removing the overlay entry reveals the
shared entry again. No resource operation mutates `RuntimeData`, the source
`RuntimeProject`, another player, Runtime JSON, CANEB, or Atlas files.

`RuntimeResourceChangesV1` applies an ordered list of upsert/remove operations.
Operations are staged in order and a repeated ID is last-operation-wins. The
Core then composes the complete effective project, validates all references,
dimensions, Atlas mappings, geometry, weights, skins, active tracks,
overrides, and persistent geometry-modifier filters, reconciles compatible
live state, and publishes exactly one frame. Any failure rolls back the
resource overlay, clocks, queues, events, Physics history, configuration, and
published frame. `clearRuntimeResources` atomically removes the whole overlay
and returns to shared resources.

A detached Runtime Skin builder supports create, copy, rename, merge, mapping
upsert/query/remove, required Bone/constraint membership, clear, snapshot, and
dispose. Installation always clones its snapshot; mutating or disposing the
builder cannot mutate an installed Skin. The attachment factory creates or
copies every attachment kind representable by Runtime Format v1 and performs
the same stable-ID/basic-shape validation before a transaction is attempted.

An optional `RuntimeExternalResourceResolverV1` is a host-owned acquisition
boundary. Core emits immutable texture source descriptors and the host returns
decoded/engine resources; matching release occurs through the same resolver.
Core never stores or exposes renderer, GPU, DOM, or engine objects. Async
loading, deduplication, device loss, and reference counting are binding or
adapter concerns, not animation semantics.

### Retained bounds and hit testing

`writeBounds(output, options)` reads one already-published final pose and never
samples animation or solves constraints. Reusing the same `RuntimeBoundsV1`
retains polygon and hit-buffer capacity. `queryBounds` is the allocating owned
snapshot convenience form. The result records the source frame sequence, an
aggregate AABB, and active Bounding Box polygons in back-to-front Slot draw
order, all in Cane world coordinates (`x` right, `y` up).

Options independently include final visible Region/Mesh packet geometry,
active Bounding Boxes, and zero-alpha render attachments. Point and segment
queries return the frontmost hit; all-hit variants return front-to-back order.
AABB point/segment/bounds tests are inclusive. Exact bounds-vs-bounds tests
first reject disjoint AABBs and then test active polygons. General affine,
shear, negative scale, and reflection are already present in the published
world vertices and must not be decomposed or reapplied by a host.

### Physics host motion

Every root-transform mutation accepts one `RuntimePhysicsHostMotionModeV1` and
an optional Physics constraint ID. Omitting the ID applies the policy to every
live Physics history. The modes are:

- `move`: keep world histories fixed so the solver reacts to ordinary host motion;
- `teleport`: reset selected histories at the destination while retaining animation clocks;
- `preserveInertia`: transport histories and velocities through the complete old-to-new root
  affine delta;
- `clearInertia`: transport the current offset while clearing lag and velocity channels.

The root transform, selected histories, one constraint/geometry solve, and one
published frame form one transaction. Singular/non-finite affine transport,
an unknown or non-Physics target, or a solver/packet failure rolls back the
whole operation. Pause and seek do not invent host motion. Skin or resource
changes preserve compatible Physics histories unless the caller explicitly
requests reset or reconciliation makes a referenced constraint invalid.

### Final-geometry modifiers

Final-geometry modifiers run inside Core after animation, persistent pose
overrides, transient pose modifiers, constraints, weights/deform, clipping,
draw-order resolution, and base tint composition. Persistent operations run
first in declaration order, followed by the transient operations supplied to
that single evaluation. The built-in deterministic jitter and radial-wave
operations use explicit parameters, seed, published sequence/time, and
attachment/Slot filters. A binding may expose a non-serialized custom callback
through a bounded editor that can only write positions, UVs, and final
light/dark tint.

The stage may not change attachment identity, draw order, vertex/index count,
indices, texture identity, or blend metadata. All output must remain finite;
every previously non-degenerate source triangle must retain its facing and a
non-zero area. A callback exception or validation failure rolls back the
complete frame, state advance, events, Physics history, and all modifier
writes. Transient modifiers are consumed by exactly one successful evaluation
and never enter project data. `RuntimeGeometryModifierStatsV1` reports ordered
operation counts, attachment visits, and position/UV/tint writes. Engine
adapters consume the resulting RenderPacket verbatim and must not run a second
geometry effect stage.

## Errors and atomicity

Public failures include stable code, operation, optional field path, optional entity ID, and a
diagnostic message. Required codes cover malformed input, unsupported version/feature, missing
reference/resource, invalid state, invalid argument, non-finite input, resource limit, and internal
failure.

The language-neutral numeric codes are:

| Code | Name | Meaning |
| ---: | --- | --- |
| 1 | `invalidArgument` | a finite, typed argument violates an operation precondition |
| 2 | `invalidUtf8` | byte input is not UTF-8 where UTF-8 is required |
| 3 | `invalidJson` | JSON tokenization failed |
| 4 | `validationFailed` | a complete decoded model or resource relation is invalid |
| 5 | `notFound` | a requested public object ID does not exist |
| 6 | `invalidState` | the operation is not legal in the current player state |
| 7 | `unsupportedVersion` | a format/API version is outside the advertised range |
| 8 | `resourceLimit` | a specified size, count, nesting, replay, Physics-substep, or geometry-output limit was exceeded |
| 9 | `unsupportedFeature` | a required feature/section/capability is unsupported |
| 10 | `missingResource` | a declared image, atlas, page, audio, or other resource is absent |
| 11 | `malformedInput` | binary/header/token/discriminator input is malformed |
| 12 | `nonFinite` | NaN or infinity was supplied or produced |
| 13 | `missingReference` | a decoded stable-ID reference has no target |
| 255 | `internal` | an implementation failure not attributable to caller data |

`message` is diagnostic and may be localized. Conformance compares `code`, `operation`, `field`,
and `entityId`, not message text.

Physics arithmetic overflow or another non-finite solver result reports
`nonFinite` with the Physics constraint ID in `entityId`. Physics fixed-step
budget exhaustion reports `resourceLimit`.

Load, resource-overlay, root-host-motion, geometry-modifier configuration,
`update`, `apply`, `advance`, `seek`, and `sampleAt` operations are atomic. A
failed operation leaves immutable data, instance clocks/queues/solver state, the published frame,
and pending events unchanged.

Configuration that requires a frame rebuild is evaluated on a working player
copy. Tracks, sample baselines, skins, overrides, root/environment state,
pending events, frame sequence, and the published frame are committed together
only after constraint evaluation and render-packet construction succeed.

## Threading

Immutable data and frames may be shared concurrently. A mutable instance is single-writer; bindings
either document it as not thread-safe or serialize mutation. Global hidden state, current working
directory, locale, and process floating-point mode must not affect evaluation.
