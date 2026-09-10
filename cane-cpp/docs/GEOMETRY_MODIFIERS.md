# Final geometry modifiers

`cane/geometry_modifiers.hpp` supplies typed deterministic jitter, radial wave and bounded custom callbacks. They run inside Core after animation, pose overrides/modifiers, constraints, deformation, clipping, Atlas projection and tint composition, immediately before the owned render packet is published. Godot and other renderer adapters consume that result directly.

```cpp
cane::GeometryModifiers effects{{
    {cane::DeterministicJitter{77, 0.015, 0.01, 2}, {{"region-normal"}, {}}}
}};
player.set_geometry_modifiers(effects); // Copies the configuration and publishes it.
auto step = player.advance(delta_seconds);
player.clear_geometry_modifiers();
```

`apply_with_geometry_modifiers` and `advance_with_geometry_modifiers` add an owned copy of a transient list for that evaluation. `apply_with_frame_modifiers` / `advance_with_frame_modifiers` accept both a pose list and a geometry list. Each ordinary evaluation samples, solves and publishes once. Persistent effects run first, in order; transient effects then run in order. Empty attachment/Slot filters match all; two nonempty filters are intersected. Targets must exist, and duplicate, empty or NUL-containing IDs are rejected.

The next ordinary evaluation, configuration clone or absolute replay does not retain transient effects. Persistent effects are copied by `clone_configuration`, cleared by `reset`, and returned by value from `query_geometry_modifiers`. Modifying an input or query result cannot edit the installed configuration. Custom closure captures retain their normal C++ ownership semantics; the host owns any captured references and must keep them alive.

Jitter uses unsigned 32-bit seed/draw/vertex/tick mixing; tick is `floor(time * frequency)` modulo 2^32. Frequency is non-negative. Radial wave uses world-space center, radial/angular amplitudes, a positive wavelength, phase, speed and optional radius falloff; negative speed is allowed. Parameters must be finite. All writes round to binary32; output overflow fails validation rather than publishing an infinite vertex.

## Bounded custom callbacks

```cpp
cane::GeometryModifiers effects{{
    {cane::CustomGeometryModifier{[](cane::GeometryEditor editor, const cane::GeometryModifierContext&) {
        for (std::uint32_t i = 0; i < editor.vertex_count(); ++i)
            editor.add_position(i, {2, 0});
        editor.set_light_tint({255, 220, 200}, 0.8f);
    }}, {{"region-normal"}, {}}}
}};
auto frame = player.apply_with_geometry_modifiers(effects);
```

The context records the target publication sequence/time, persistent/transient list and index within that list. Callbacks run in operation order, then packet attachment order. The copyable editor exposes attachment/Slot IDs, draw index, vertex count, bounded optional position/UV reads, position/UV writes and light/dark tint. It does not expose topology, texture identity, blend state or source transforms for mutation. Position/UV reads outside the vertex range return `nullopt`; writes return `invalidArgument`.

Editor copies expire at the end of their specific callback, including an exceptional exit. A retained handle throws `invalidState`, even while a later callback is active. Reads of the player's already-published frame are allowed during a callback. Mutating, draining, cloning or moving that player is rejected. An independent player may still run. As with other synchronous C++ member calls, the host must not destroy the current player during its callback.

Previously non-degenerate triangles must keep their sign and nonzero area after all effects. A failed callback, non-finite output, collapsed or inverted triangle aborts the complete candidate: clocks, events, Physics history, persistent configuration and old frames remain unchanged. Arbitrary callback exceptions become a structured `internal` error; `cane::Error` retains its code and is reframed to the public operation. Host side effects performed inside a callback cannot be rolled back by Core.

`frame.geometry_modifier_stats()` / `player.last_geometry_modifier_stats()` return owned operation, attachment-visit, position-write, UV-write and tint-write counts. Queries and `update` leave the previous publication's counts unchanged. Absolute replay runs persistent effects at each intermediate evaluation and reports geometry counts for the final packet; evaluation counters separately include all samples/solves.

## Ownership

Effects write into the packet builder's unpublished owned buffers, retaining only baseline triangle areas for validation. They do not make a second full copy of vertex/UV buffers. Empty lists allocate no modifier scratch. The full player can reuse a packet owner only after all published owners release it; retained frames and packets remain unchanged. The separate vector-taking stage creates an immutable shared owner for the transferred vector.
