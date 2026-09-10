# Atomic authoring and published-pose snapshots

These renderer-neutral APIs belong to `cane::RuntimePlayer`. Include
`<cane/runtime_player.hpp>`; the owned request and result types are also available
in `<cane/authoring_overrides.hpp>` and `<cane/authoring_snapshot.hpp>`.

## Ordered edits with one publication

```cpp
cane::AuthoringOverrides edits;
edits.operations.emplace_back(cane::SetBoneLocalOverride{
    "root", {{10, 20, 15, 1, 1, 0, 0}, std::nullopt}});
edits.operations.emplace_back(cane::SetSlotAttachmentOverride{
    "weapon", std::nullopt}); // Hide this slot.
auto frame = player.set_authoring_overrides(edits);

// Resume the slot's animation/skin selection in a later transaction.
player.set_authoring_overrides({{cane::ClearSlotAttachmentOverride{"weapon"}}});
```

`AuthoringOperation` is a `std::variant` of set/clear operations for bone local
pose/inheritance, Region pose, complete slot draw order, source vertex deformation,
slot attachment, slot tint and typed constraint parameters. IDs and buffers are
owned values. The player copies installed values; later changes to a caller's
request do not change the player.

Operations stage in declaration order, with the last operation for a target
winning. Each operation must be valid even when a later operation replaces it. Draw order must contain every slot exactly once. Setting a slot attachment ID,
setting `std::nullopt` to hide the slot, and clearing the override are distinct. A constraint set replaces that constraint's entire installed optional patch;
omitted fields resume their sampled animation/setup values. Linked mesh edits
use the Core's resolved deform owner and canonical conversion rules.

The compatibility method `set_authoring_overrides(edits)` uses authored sampling. Use `set_authoring_overrides_with_sampling(edits, sampling)` to retain an explicit
stepped, fixed-frame or fixed-frame-stepped preview mode. Sampling uses exactly the
same rules as `apply(sampling)`.

The complete request stages on a detached player state, then samples once, solves
once, builds the packet and publishes once. Empty batches also publish once. Playback clocks, queues, the replay baseline and pending events remain intact. Any invalid ID, kind, scalar, buffer, sampling option, callback or evaluation
failure rolls back the entire transaction, including Physics and frame sequence. Batches are bounded to one million operations. Single-operation override methods
use the same validation and transaction path, retaining their public error names.

## One coherent read

```cpp
auto snapshot = player.query_authoring_snapshot();
auto sequence = snapshot.frame.sequence();
// All collections below describe this exact publication.
for (const auto& slot : snapshot.slot_states) {
    // Inspect selected attachment, slot tint and sampled draw index.
}
```

`AuthoringSnapshot` owns its frame and query collections. Bones, slots and
constraints contain every catalog entry in catalog order. Point poses contain
every Point attachment. `attachment_geometries` contains Path, Bounding Box and
Clipping geometry; `vertex_attachment_source_geometries` contains Mesh, Path,
Bounding Box and Clipping sources in `vertex_positions` space. Path position
queries preserve constraint catalog order and omit only temporarily unresolved
Path constraints that report `invalid_state`.

The query reads the already-published pose. An `update` without a subsequent
publication does not change it. It performs no animation sampling, constraint
solve, Physics integration, event consumption or frame publication. Retained
snapshots remain valid after later mutations. Every other subquery failure fails
the whole snapshot with operation `queryAuthoringSnapshot`, retaining the failed
field and entity identity. The player's state is unchanged on success or failure.
