# Cane native Godot runtime

**English** | [简体中文](README.zh-CN.md)

Use [installation](docs/INSTALLATION.md) for the native Windows x64 extension
and [the source build guide](../../docs/BUILDING.md) for its exact dependencies.

The [public SDK guide](docs/SDK.md) covers data/capability discovery, owned snapshots,
sampling, atomic authoring batches, detached skin builders and configuration cloning.

This GDExtension targets ordinary Godot 4.5 without .NET. `CaneSkeletonData` owns immutable C++ Core data and decoded engine textures. `CaneSkeleton` owns one native Core player, emits owned event dictionaries, and uploads the published final packet to child CanvasItems in packet order. No animation, constraint, clipping, deformation, Atlas UV, or authored tint evaluation is duplicated in the adapter.

## Rendering contract

[Performance diagnostics](docs/PERFORMANCE.md) describe material-state reuse,
per-publication upload counters and final-geometry batching.

Enable `Viewport.use_hdr_2d` (also available with Godot 4.5 Compatibility) so compositing occurs in linear space. The adapter checks this requirement. It flips final vertex Y exactly once and leaves the supplied UVs and triangle order intact. Atlas trim, rotation, clipping and diagnostic `sourceAffine` are already resolved by Core.

Texture color space and straight/PMA metadata select shader decoding. Light/dark tint bytes are converted from sRGB for shader math; present-black dark tint remains distinct from no two-color tint. Explicit texel sampling preserves separate Atlas min/mag filtering and U/V clamp/repeat/mirror rules.

Normal blending uses Godot's premultiplied-alpha pipeline. Add compensates for Godot's `SRC_ALPHA` factors by submitting `(Cs/sqrt(As), sqrt(As))`, yielding the required `Cs+Cd, As+Ad` without a destination copy. Multiply and Screen read the current linear destination RGB immediately before each triangle, then submit a corrected source to the native premultiplied pipeline. Native blending preserves destination alpha; this does not rely on the Alpha of Forward+'s screen-copy texture. Per-triangle RGB copies preserve self-overlapping meshes.

Resource loads are staged, dimension-validated by Core, and committed only after all referenced textures decode. Existing players retain their original immutable asset snapshot if the Resource is reloaded. Textures, materials and CanvasItem RIDs stay outside Core and are released by their owning adapter objects.

Core's [load plan](../docs/LOADING.md) supplies ordered decode requests before data
completion, including direct images with omitted width, height or both. No size is
guessed by the adapter.

## Current scripting interface

[Final geometry modifiers](docs/GEOMETRY_MODIFIERS.md) expose native jitter,
radial waves and bounded synchronous script callbacks after final clipping/tint. Persistent and transient operations, UV/tint edits and combined pose/geometry
submission preserve Core transaction boundaries and publication ownership.

[Transient pose modifiers](docs/POSE_MODIFIERS.md) apply ordered per-frame Bone
and constraint edits, with optional fixed-frame/stepped sampling, through one
Core evaluation. They expire on the next ordinary evaluation.

[Constraint controls and queries](docs/CONSTRAINTS.md) expose all five Core
constraint kinds, diagnostics, Path forward/inverse queries and Transform Match. Constraint patches can join atomic Bone/Region pose batches in one evaluation.

[Host pose and Physics controls](docs/HOST_CONTROLS.md) expose complete local
Bone/Region overrides, ordered atomic pose batches, root transforms, explicit
Physics motion/environment/reset controls, independent Physics advancement and
owned pose queries. These values keep Core coordinates and use one evaluation.

[Animation tracks and queues](docs/PLAYBACK.md) expose Core mixing configuration,
replace/additive overlays, range/time/speed/threshold controls, queued-entry edits,
empty fades and owned playback queries.

[Runtime resource transactions](docs/RESOURCES.md) support ordered image, Atlas,
attachment and skin upserts/removals, explicit engine file acquisition and original
resource restoration. The Core pre-commit callback validates textures and prepares
hidden draws before the adapter swaps visible resources.

[`CaneBone2D`](docs/BONE_FOLLOWERS.md) follows a published bone's complete affine
matrix, including reflection, shear, singular animated scale and host transforms. Its ordinary Godot children can contain sprites, particles, hit shapes or other
game nodes. Registered followers update before public frame/event notifications;
following and engine transform changes never sample Core or upload its packet.

- `CaneSkeletonData.load_files(runtime_file, atlas_files)` supports JSON/CANEB and Atlas documents (the legacy third boolean remains accepted and has no effect); `get_last_error()` returns structured failures.
- `CaneSkeleton.skeleton_data`, `automatic`, `play`, `queue`, `advance`, `apply`, `sample_at`, `set_skins`, `set_attachment`, `clear_attachment`, `clear_track`, `reset` control the native player.
- `runtime_event`, `frame_updated`, and `runtime_error` signals contain owned values. Reentrant mutation during publication signals, including initial data assignment, is rejected. Setup assignment publishes one notification; unchanged render refreshes and scene re-entry do not publish another frame.
- `sample_at` preserves replay events separately from incremental `runtime_event` notifications. `get_replay_events()` returns a deep owned copy of the last successful replay batch; a failed replay leaves it unchanged. Packet snapshot positions remain Core X-right/Y-up; `get_bone_transform` converts a published bone matrix to Godot local coordinates for followers.
- Native C++ hosts can access the underlying public Core through `native_player()`. Use `refresh_render()` to project a frame the Core already published; use `apply()` only when an evaluation is needed, such as after Core `update()`.

Godot sources used to check the host contract: [CanvasItem shaders](https://docs.godotengine.org/en/4.5/tutorials/shaders/shader_reference/canvas_item_shader.html), [HDR 2D Viewports](https://docs.godotengine.org/en/4.5/classes/class_viewport.html#class-viewport-property-use-hdr-2d), and [Godot 4.5 GLES3 blend state](https://github.com/godotengine/godot/blob/4.5-stable/drivers/gles3/rasterizer_canvas_gles3.cpp).

[`CaneSlot2D`](docs/SLOT_NODES.md) inserts ordinary game content at complete sampled Slot boundaries, follows the published owner matrix and preserves hidden Slot order.

[`CanePoint2D`](docs/POINT_FOLLOWERS.md) follows complete published Point transforms, with explicit named/selected visibility. Bone and Point followers share their coordinate, scheduling and lifecycle implementation.

## Building from source

See [source build instructions](../../docs/BUILDING.md).
