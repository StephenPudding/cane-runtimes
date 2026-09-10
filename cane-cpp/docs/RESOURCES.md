# Instance resources

Both `apply_runtime_resources` and `clear_runtime_resources` have an overload with
a synchronous `RuntimeResourceValidation` callback. It receives immutable
candidate data, frame and overlay before the source player commits. A host can
acquire textures, call `validate_decoded_texture_sizes`, and prepare hidden draws. Throwing rejects the complete transaction. The callback executes once, does not
cause another evaluation, and cannot mutate or clone the source player. Copy a
data/frame/overlay value to retain it beyond the callback; do not retain references
to the callback parameters. Host resources remain outside Core. Commit the staged
host handles after success, and release them on failure. An empty callback uses
the ordinary Core-only transaction.

`RuntimePlayer` owns an ordered overlay of images, Atlas reference/document pairs, attachments and skins. The original `RuntimeData` stays immutable and can be shared by other players. Upserting a stable ID replaces that declaration only in this player. Removing an overlay ID reveals the original declaration, or removes the entry when it exists only in the overlay. IDs remain case sensitive.

```cpp
#include <cane/runtime_player.hpp>

auto attachment = cane::RuntimeAttachmentFactory::region(R"({
  "id":"runtime-hat", "name":"Hat", "slotId":"head-slot",
  "imageId":"hat-image", "x":0, "y":12, "rotation":0,
  "scaleX":1, "scaleY":1
})");
auto image = cane::RuntimeImageResource::direct(
    "hat-image", "Hat", "costumes/hat.png", 128U, 96U);
cane::RuntimeSkinBuilder skin("runtime-costume");
skin.set_attachment("head-slot", "head-placeholder", "runtime-hat");
cane::RuntimeResourceChanges changes{{image, attachment, skin.snapshot()}};
(void)player.apply_runtime_resources(changes);
player.set_skins({"runtime-costume"});

auto retained = player.query_runtime_resources();
skin.clear(); // Does not alter the installed skin or retained values.
(void)player.clear_runtime_resources();
```

The example requires an existing `head-slot` and its authored `head-placeholder`; resource operations do not add bones, slots or animations. JSON is the serialization boundary for native Runtime Format values. The attachment factory accepts Region, Mesh, Path, Point, Bounding Box and Clipping properties, including weights, linked meshes and image sequences. `RuntimeAttachmentResource::copy` can replace its ID, name and slot while preserving the other fields. Public values never expose the JSON library or mutable internal objects.

## Transactions and compatibility

Operations are staged in order. Replacing an existing overlay ID retains its position; remove followed by upsert appends it. The last operation for an ID wins. An empty valid transaction still publishes exactly one frame. A transaction is bounded to 1,000,000 operations.

Core composes the complete effective project from the immutable source and overlay, then runs its normal model, Atlas, dimension, reference, geometry, weight, skin and animation validation. Resource feature requirements are added to the effective declaration while source requirements remain intact. Known features load by default; unknown features are rejected by the same validation used for initial loading. Original CANEB load warnings are retained. A texture whose ID, path, MIME type and declared dimensions remain compatible can retain dimensions resolved by the source loader. A changed path needs declared dimensions; it cannot inherit stale decoded facts.

The live and replay-baseline track entries are rebound to the effective immutable clips without changing identities, times, mixing chains, queues, options or event cursors. Compatible host overrides and Physics history survive. Skins, Region overrides and deformation are rebound by stable ID when overlay-only catalog indices move. Removed or incompatible attachment overrides are cleared; an explicit hidden-slot override remains. Deform compatibility requires the same vertex layout, canonical owner and ordered influence identities. Persistent geometry modifier filters must still resolve: clearing resources can fail if a filter refers to an overlay-only attachment.

The candidate evaluates once before one implementation swap commits resources, configuration, clocks, history, events and frame together. Invalid references, incompatible filters, geometry failures, callback failures and allocation failures leave the old instance published and usable. During a candidate geometry callback, read-only queries on the original player still see its previous frame/data. Reentrant mutation, move, clone or event drain of that player is rejected.

`clone_configuration()` copies the source/effective data handles and owned overlay alongside host configuration and mix tables, with no playback clocks, events or Physics history. `reset()` retains the overlay, clears playback and host configuration, and restores the current effective setup pose. `clear_runtime_resources()` preserves compatible configuration and playback. It drops removed selected skin IDs; it does not select the original default skin automatically.

## Ownership and engine resources

`query_runtime_resources()` returns owned catalog vectors of immutable values. Editing those vectors, replacing request entries, changing/disposal of a detached skin builder, and subsequent player operations cannot mutate retained snapshots or frames. The skin builder supports rename/export, ordered mapping upsert/query/remove, copy, merge, unique required bone/constraint membership, clear, snapshot and dispose. Mapping lookup distinguishes absent entries from an explicit null attachment.

`data()` is a borrowed reference to the current effective immutable handle. It remains stable through ordinary playback operations, but a successful project/resource transaction may invalidate that reference. Copy `RuntimeData effective = player.data()` to retain it independently. A copied handle and already-returned frames remain valid after resource changes or player destruction.

Core only emits immutable final packet texture descriptors. The engine adapter owns image decoding, file/network access, GPU allocation, asynchronous acquisition and matching release. It must validate decoded texture facts, preserve the returned packet order and consume final geometry/UVs/tint.

## Evidence
