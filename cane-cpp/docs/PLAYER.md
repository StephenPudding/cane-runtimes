# Native player API and ownership

This is the current development API, not a declaration that the complete Runtime API 1.3 SDK or Godot integration is finished. Load `RuntimeData` with required Atlas and decoded-resource inputs, then create one player per independent instance. Known features load by default; [capability discovery](CAPABILITIES.md) reports the supported contract.

```cpp
#include <cane/runtime_player.hpp>

cane::RuntimePlayer player(data);
player.set_animation(0, "run", true);
(void)player.drain_events(); // Handle the start notification here if needed.

auto step = player.advance(1.0f / 60);
auto frame = player.frame();
for (const auto& draw : frame.render_packet().attachments()) {
    // Upload draw.world_vertices_xy, draw.uvs, draw.indices and final tint.
    // Resolve the declared texture; preserve the packet's attachment order.
}
auto pending = player.drain_events();
// Handle pending.events(). The step.events batch contains the same newly
// emitted notifications; choose one consumption path to avoid duplicates.
```

## Publication and errors

Construction evaluates setup pose, constraints and a complete packet before returning sequence 1. Frames are immutable owned values; retain a `RuntimeFrame` while holding references into it. Copies can outlive the player. Query DTOs and event batches own their values. `data()` borrows the current effective immutable handle. It is stable through ordinary playback, but successful project/resource replacement can invalidate the reference; copy the handle to retain it independently. Players are movable, not copyable. Different instances can run independently; synchronize concurrent access to the same instance.

Fallible calls throw `cane::Error` with an operation and structured error fields. A failed mutation preserves clocks, queue identities, configuration baseline, host overrides, Physics history, pending events and published frame. Event traversal first preflights the complete operation before collecting; evaluation and allocation happen before the state swap.

Whole-model loading errors use the public document field `$` and preserve their precise source location in diagnostic text. Required-feature, resource/Atlas, and resource-limit failures retain their specific structured fields. The native wire-operation projection maps absolute `sampleAt` to the public `seek` alias, including the protocol's `seek` error domain. Both native absolute-replay entry points remain available.

`update(delta)` changes clocks and pending events but leaves the published frame and current-pose queries untouched. `apply(sampling)` publishes from the current clocks without advancing them. `advance(delta, sampling)` combines both in one transaction. Pose-affecting configuration edits evaluate before publication; mix-duration table edits only change configuration.

`advance_physics(delta)` independently advances Physics by a finite non-negative delta, evaluates the current animation pose and publishes exactly once. Playback clocks, queues, replay baseline and pending events remain unchanged; the returned event batch is empty. A zero delta still publishes once and reports `changed == false`. The normal aggregate Physics substep budget applies, and any failure rolls back all state. Later normal playback starts its Physics accounting at the current animation clock, without billing the independent delta again.

## Replay and clocks

`sample_at(time, fixed_step, sampling)` and `seek` rebuild from the configuration baseline, using fresh Physics history. They replace the live playback state only after all steps succeed. They return replay events without appending to or draining incremental pending events. Zero-time replay still evaluates and publishes a frame without initializing an event cursor. Fixed-step endpoints retain the requested binary32 endpoint, including exact keys and their immediately adjacent values.

Raw clocks, event crossings and published time are separate from fixed-frame or stepped pose sampling. Playback supports multiple tracks, pair/default mix durations, empty entries, queuing, per-entry options, animation subranges, ends, frozen/reverse clocks, and queued edits. Configuration edits follow persistent entry identity across promotion; they do not capture an unrelated advanced clock into the replay baseline.

Each call has separate one-million limits for emitted events, replay steps, and aggregate Physics substeps. Budget failure is atomic. These are bounded correctness limits, not engine performance claims.

## Queries and host configuration

Current-pose queries return bone matrices/local state/inheritance, Region poses, sampled slot state, Point attachment full affine poses, and deformed Path/Bounding Box/Clipping world geometry. Queries read the last published pose without resampling, solving constraints, changing events or incrementing sequence. Slot draw indices include hidden and non-renderable slots in the sampled slot order; packet draw indices count emitted attachments only.

Host controls currently cover skin IDs, root transform, bone local/inheritance override, Region pose override, complete slot order, slot attachment override, final slot tint override, all five typed constraint overrides, Physics environment and host-motion/reset policies. A null attachment override hides the slot; clearing the override restores authored selection. Root and bone host transforms may be singular where permitted by the API. Bone animation scales may be finite zero or negative. Setup bone and Region scale validation remains non-zero.

`clone_configuration()` retains source/effective immutable data, the resource overlay, host configuration and mix tables, then evaluates a fresh sequence-1 setup instance with no playback, pending events or Physics history. `reset()` clears playback and host overrides while retaining installed resources, then publishes the current effective setup at the next sequence. Use `clear_runtime_resources()` to explicitly remove resources.

See [constraint controls and queries](CONSTRAINTS.md) for sampled parameter/diagnostic variants, Path projection and canonical Transform Match, [source geometry and deform edits](VERTEX_GEOMETRY.md) for owned source-order geometry and inverse operations, [one-evaluation pose modifiers](POSE_MODIFIERS.md) for ordered procedural edits and measured evaluation counts, [final geometry modifiers](GEOMETRY_MODIFIERS.md) for Core effects and bounded callbacks, and [retained bounds](BOUNDS.md) for current-frame collision queries. See [atomic authoring and snapshots](AUTHORING.md) for ordered batch edits and coherent published-pose reads, [live project replacement](PROJECT_RECONCILIATION.md) for atomic data/state rebinding and [instance resources](RESOURCES.md) for transactional images, Atlases, attachments and detached skin builders. The Godot adapter must consume the final Core packet and may not recreate animation, constraints, world geometry, UVs or tint.
