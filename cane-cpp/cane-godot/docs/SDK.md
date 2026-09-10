# Data discovery, snapshots and detached skins

These GDScript bindings project the independent C++ Core. Queries return owned data or
the last published pose without evaluation, mesh uploads or event delivery. Query failure
returns an empty value (or `null` for a scalar/object) and sets `get_last_error()`; success
clears that error. Player mutations use the existing boolean/error-signal transaction path.

## Discover loaded data

Static `CaneSkeletonData.get_capabilities()` reports implementation identity, precision,
JSON/CANEB/Atlas/API version ranges, feature names/bits and the last passed Core suite. `supports_feature(name)` checks a runtime feature. Core suite identity does not certify
an engine installation. Loaded resources expose:

- `get_metadata()`: format/API versions, generator, skeleton ID/name/reference scale and required features.
- `get_catalog(kind)`: ordered `{id, name, type}` dictionaries. Kinds: `atlas`, `image`,
  `audio`, `font`, `bone`, `slot`, `attachment`, `constraint`, `skin`, `event`, `animation`.
- `get_catalog_definition_json(kind, id)`: full Core definition as a JSON string, preserving
  exact 64-bit integers. Godot's JSON parser may round integers through floating point;
  retain the original string or use an integer-preserving parser when editing definitions.
- `get_load_warnings()`: ordered `{code, operation, section_tag, message}`; `code` is a
  Core string such as `unknownOptionalCanebSectionIgnored`.
- `get_texture_resources()`: decoded source texture descriptors, including dimensions,
  sampling and resolved paths. The skeleton's method returns its effective instance resources.

Invalid catalog kinds, missing IDs and pre-load queries return structured errors. All
returned dictionaries, arrays and packed buffers can be retained or edited independently.

## Published state and sampling

`get_slot_state(id)` / `get_slot_states()` include empty and non-renderable Slots, final
draw indices, nullable attachment key/ID and final `{light, dark, alpha}` tint. RGB channels
are byte triplets; null dark tint differs from black. `get_sequence_index(attachment_id)`
reads the published Region/Mesh sequence index, including setup selection. Unknown IDs
and attachments without sequences fail.

`update(delta_seconds)` advances clocks, queues and events without publishing a pose. `apply_with_sampling(sampling)` publishes it; `advance_with_sampling(delta, sampling)`
updates and publishes atomically. `sample_at_with_sampling(seconds, fixed_step_seconds,
sampling)` performs absolute replay with events returned by `get_replay_events()`. Sampling accepts `frame_step_seconds` (positive or null) and `stepped` (boolean), as in
the existing modifier APIs. Invalid values or unknown keys fail transactionally.

`get_authoring_snapshot()` captures one coherent, owned Core snapshot with `frame`,
`bone_local_states`, `slot_states`, `constraint_states`, `point_attachment_poses`,
`attachment_geometries`, `vertex_attachment_source_geometries` and
`path_constraint_positions`. Its frame contains complete final render descriptors,
tint, affine, vertices, UVs, indices and authored triangle facing. `sequence_u64` is the
exact decimal unsigned sequence; `sequence` is its normal Godot integer projection.

Snapshot coordinates remain **Core X-right/Y-up**, with counterclockwise angles. Matrix buffers use `[a, b, c, d, tx, ty]`, explicitly named `core_matrix` where applicable. Vertices, source geometry and path queries retain Core coordinates. Convenience
`Transform2D`/follower queries already convert to Godot Y-down; convert snapshot data
once when using it directly in a Godot canvas.

## Atomic authoring operations

`set_authoring_overrides(operations, sampling = {})` applies one ordered Core batch with
one evaluation/publication. Later operations win. Failure preserves player and rendered
state. Existing Bone, Region, vertex and constraint operations remain available; added
operation shapes are:

```gdscript
{"op":"set_draw_order", "slot_ids":PackedStringArray(["back", "front"])}
{"op":"clear_draw_order"}
{"op":"set_attachment", "slot_id":"back", "attachment_id":null}
{"op":"clear_attachment", "slot_id":"back"}
{"op":"set_tint", "slot_id":"front", "tint":{"light":[255,200,128], "dark":null, "alpha":0.8}}
{"op":"clear_tint", "slot_id":"front"}
```

Draw order contains every Slot ID once. Null attachment hides a Slot; clearing restores
animation/skin resolution. Tint replaces the whole tint, defaulting omitted channels to
white, alpha 1 and no dark tint. RGB accepts Array/PackedByteArray triplets of byte integers. `set_slot_tint(id, tint)` and `clear_slot_tint(id)` are single-operation equivalents.

## Detached skins

```gdscript
var skin := CaneRuntimeSkin.new()
assert(skin.initialize("outfit", "My outfit"))
assert(skin.set_attachment("hat", "hat", "hat-red"))
assert($CaneSkeleton.install_skin(skin))
assert($CaneSkeleton.set_skins(PackedStringArray(["outfit"])))
skin.dispose() # The installed owned snapshot survives.
```

Initialize once via `initialize(id, name = null, export_skin = false)` or
`copy_from_json(json, id, name = null)`. `copy_skin(id, name = null)` creates an independent
builder. Methods include `rename`, `set_export`, `set_attachment`, `remove_attachment`,
`add_bone`, `remove_bone`, `add_constraint`, `remove_constraint`, `merge_skin`, `merge_json`,
`clear`, `get_snapshot_json` and `get_id`. Detached references are validated against the
effective project on installation. Core owns merge, validation and resolution semantics.

`get_attachment(slot_id, name)` returns `{found, attachment_id}`: present/null is an
explicit hidden mapping, while `found = false` means absent. Removal of an absent entry
returns false with no error. `dispose` is idempotent for initialized builders; disposed
builders reject reuse. `is_disposed` reports that state. Disposal before initialization
does not create a builder. Installation copies a snapshot and does not activate its ID.

## Configuration cloning

`clone_configuration()` returns a detached `CaneSkeleton` Node owned by the caller. Add
it to a viewport with HDR 2D enabled, or `free()` it. It shares immutable loaded assets
and copies Core skins/resources, root/host policy, mix settings and modifiers. Tracks,
queues, clocks, events and Physics history start fresh; the source remains unchanged. `automatic` is copied; Node2D transforms, children/followers and other scene settings are new.

Custom geometry Callables follow Godot target lifetime rules. The clone's callback scope
protects the clone against deletion during evaluation, including after the original node
is freed. The Callable's own target must remain alive; capturing a scene object does not
extend that object's lifetime.

Use `queue_free()` for scene deletion from a callback. Immediate `free()` is rejected
and Core state rolls back, but Godot's native Node PREDELETE can already have detached
the node or deleted scene children before `cancel_free()` takes effect. Scene changes
made by host callbacks are not Core transactions; reattach a surviving node explicitly.
