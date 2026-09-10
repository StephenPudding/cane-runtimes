# Replacing a live project

Overloads accepting `RuntimeProjectValidation` prepare host resources before
commit. The synchronous callback receives `const RuntimePlayer&` for the fully
evaluated candidate, including complete Slot order and effective resources. Source queries still read the previous publication. Both players reject
mutations during preparation; throw to reject atomically. Owned query results
may be retained, but the candidate reference lasts only for the callback. Standard/unknown host exceptions become `internal` errors in `replaceProject`;
typed Cane errors are preserved.

`RuntimePlayer::replace_project(RuntimeData)` adopts a new immutable input and publishes one complete frame. `reconcile_project` is an alias with the same behavior and `replaceProject` error domain.

```cpp
auto replacement = cane::RuntimeData::from_json(new_json, load_options);
const auto retained = player.frame();
const auto current = player.replace_project(std::move(replacement));
```

Core first composes the existing resource overlay over the replacement, reconciles state by stable ID, validates persistent modifier filters and evaluates a detached candidate. A successful pointer swap commits data, clocks, Physics, host state and publication together. Resource, constraint, geometry or callback failures leave the old project, events and frame unchanged. Replacement performs one animation sample, one constraint/geometry solve and one publication. It belongs outside the ordinary frame loop.

`reset()` restores the current effective setup, clears playback, host pose overrides, pending events and solver history, and retains installed resources. Clearing the resource overlay is an explicit separate operation. This remains true after project replacement; reset does not switch back to an earlier source project.

## Preserved state

- Bone/transform-mode, Region, Slot attachment/tint, skin and typed constraint overrides follow stable IDs, including after catalog reorder. Missing IDs and mismatched kinds are dropped. An explicit hidden Slot remains hidden.
- A complete draw-order override survives only when the new input has the same complete set of Slot IDs; otherwise authored/animated order applies.
- Valid track entries, outgoing mixing ancestry, queued entries, options, mix tables and absolute-replay baseline retain their identities. Removing an active animation drops that track and its dependent queue. Missing outgoing entries cut off older mixing ancestry; missing queued clips and pair mixes are removed.
- Elapsed track times retain completed loops. A range covering the entire prior animation follows the new duration. Explicit subranges clamp to that duration and may collapse to a valid constant-time sample. Replacement generates no lifecycle/crossing events. Previously pending owned events remain drainable, even when the new input no longer contains their animation ID.
- Root transform, Physics environment and persistent geometry modifiers remain installed. Compatible Physics history follows the constraint and driven bone IDs; animation-clock catalog indices also rebind by ID. Changed/missing driven bodies lose their old history. The ordinary primary-animation/time-reset rules still apply.
- Deform compatibility requires matching kind, resolved deform owner, source vertex count and the ordered influence bone IDs for each vertex. Equal total component counts alone are insufficient. Runtime resource replacement uses the same host reconciliation checks.
- Existing image/Atlas/attachment/skin overlays keep precedence over the new source. Clearing resources reveals that new source. A configuration clone retains the new source and overlay without live clocks or solver history.

## Ownership and failures

`source_data()` borrows the current immutable input handle, while `data()` borrows the effective input after resource composition. A successful project/resource replacement can invalidate borrowed references. Copy either `RuntimeData` handle when retaining it. Owned frames, event batches, resource snapshots and copied data remain valid independently of later replacements, other players and player destruction.

The overlay must form a valid complete catalog over the new input. For example, an installed attachment referencing a removed Slot makes replacement fail. Persistent geometry filters referring to removed attachments also fail instead of silently disabling the effect. Clear/update those explicit overrides or resources before replacing an incompatible project. Original-player mutation from a candidate geometry callback is rejected; read queries continue to describe the old publication until commit.

This API does not acquire Godot or other engine textures. Adapters must prepare decoded resources for the new descriptors and coordinate their own resource lifetime with the Core transaction.
