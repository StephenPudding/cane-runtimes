# Cane C++ runtime family

**English** | [简体中文](README.zh-CN.md)

This family independently implements the native C++ Core used by the ordinary Godot 4 GDExtension. It targets Cane Runtime Format 1.0 and Runtime API 1.3. Core production code has no C#, TypeScript, Rust, C ABI, editor, Bevy, or Godot dependency. The Godot adapter in `cane-godot` consumes final Core packets.

## Core and Godot integration

The C++17 Core owns JSON/CANEB and Atlas loading, animation tracks/queues/mixing,
all five constraint families, Physics, skins and deform, clipping, final packets,
instance resources, retained Bounds, queries and transactional player state. It publishes owned results without an engine or managed runtime dependency.

See [loading](docs/LOADING.md), [player controls](docs/PLAYER.md),
[constraints](docs/CONSTRAINTS.md), [geometry](docs/VERTEX_GEOMETRY.md), and
[resources](docs/RESOURCES.md) for the public contracts. The [native Godot adapter](cane-godot/README.md) exposes Core controls through
GDScript and projects final packets. Its [installation guide](cane-godot/docs/INSTALLATION.md)
describes source installation and platform requirements.

## Data and ownership

[Prepared external-resource loading](docs/LOADING.md) exposes owned decode requests before completed `RuntimeData`. Direct image dimensions remain optional until the host decodes pixels; completion validates the full observed catalog and leaves existing assets unchanged on failure. The Godot loader uses this Core path for JSON and CANEB.

[Instance resources](docs/RESOURCES.md) provide ordered image/Atlas/attachment/skin replacement, detached builders and atomic validation/evaluation. Resource transactions preserve compatible live clocks, queues, event cursors, host overrides and Physics history while retained frames and other players continue to own their original data.

The root repository remains a multi-language container, not a CMake workspace. Only this family is a CMake project. JSON for Modern C++ 3.12.0 is a private transport dependency; public headers do not expose its types. The adjacent notice records the upstream version, license and source hashes. See [dependency provenance](third_party/nlohmann/README.md).

## Atlas metadata

```cpp
#include <cane/atlas.hpp>

auto atlas = cane::AtlasData::from_json(atlas_json_utf8);
atlas.validate_image_ids(runtime_image_ids);
atlas.validate_decoded_page_sizes(decoded_pages);
const auto& region = atlas.region_for_image("image-body");
const auto& page = atlas.pages()[region.page_index];
```

`AtlasData` owns immutable metadata, which remains valid after the input buffer is released. Copies share that immutable data; references into a catalog remain valid while its owning data is retained. Loading verifies native page names, portable paths, closed modes, unique identities, bounds and source trim, four declared UV pairs, and non-overlapping page allocations including edge-extension texels. The overlap check uses an O(n log n) sweep with half-open rectangles, so touching edges remain legal.

Image-catalog validation is separate because an Atlas document alone cannot resolve Runtime image IDs. Decoded-page validation requires every page exactly once and rejects dimensions that disagree with actual decoded resources. Texture I/O belongs to the host. `RuntimeData` connects Atlas regions to the complete image catalog and verifies resource ownership and paths during loading.

Atlas UVs are copied in declared source-corner order. The Godot adapter uploads Core's final UVs, geometry and tint without rebuilding them. Native metadata loading remains separate from engine texture acquisition and playback.

## Owned Runtime data

[Catalog and texture queries](docs/CATALOGS.md) expose document versions, generator
identity, complete native declarations and owned decoded-resource descriptors. They include unused Atlas pages, preserve exact integers and optional fields, and
read the current effective data without animation evaluation.

```cpp
#include <cane/runtime_data.hpp>

cane::RuntimeLoadOptions options;
options.atlas_json.emplace("atlas-hero", atlas_json_utf8);
auto data = cane::RuntimeData::from_json(runtime_json_utf8, options);
// Alternatively: cane::RuntimeData::from_caneb(caneb_bytes, options).
data.validate_decoded_texture_sizes(decoded_texture_facts);
const auto& bones = data.bones();
const auto& animations = data.catalog(cane::RuntimeCatalogKind::animation);
```

Data copies share immutable owned storage. Input buffers and options may be released after loading. Resource catalogs preserve declaration order; linked geometry and deform owners are resolved independently. Optional CANEB section warnings remain separate from native document data. Supply only declared Atlas identities. Optional decoded facts must cover every direct image and every Atlas page exactly once, including unused pages. Direct images with omitted dimensions require those facts at load time; source JSON fields are not rewritten.

Animation compilation resolves IDs once, merges paired/scalar axes even across separate records, and stores typed scalar, vector, discrete, event and order channels without JSON references. Bone axis streams select `x/y` property curves; Region scale fields select `scale_x/scale_y`. Events preserve every equal-time declaration and exact signed 64-bit payloads. Physics reset triggers remain crossing edges, so a later same-time false key cannot erase a true trigger. Vector sampling accepts caller-owned scratch storage. The source document is retained for catalog, persistence and overlay operations. Known required features load by default; unknown features are always rejected.

## Private evaluation pipeline

Loading also compiles slot tints, all attachment geometry, skin mappings/memberships and all five constraint definitions into owned typed data. Per-frame pose evaluation does not read JSON. Layers compose bone/Region transforms, rounded color bytes, alpha, sparse constraint parameters, both deform spaces, attachment/skin selection, complete/folder draw order and all seven sequence modes. The first declared Skin is the default regardless of its name; implicit fallback changes attachment resolution without activating fallback-owned bones or constraints.

Common vertex evaluation handles unweighted positions and mixed explicit/bind-inverse weighted coordinates for Mesh, Path, Bounding Box and Clipping sources. Zero-weight influences retain their deform offset positions; positive influences are normalized by their actual total. Linked meshes use separate geometry/deform owners while retaining the displayed attachment's slot, image and tint. Region source quads use the selected sequence image's full dimensions. Point poses retain the complete bone/attachment affine transform.

`Pose` is an internal mutable workspace, not a public frame or a partial public player. Solvers update the same matrices consumed by geometry; the engine consumes only final packets after clipping, Atlas projection and publication.

## Native constraint evaluation

IK implements one-bone and two-bone analytic paths, CCD fallback, both bend directions, compression/stretch, all three scale-Y policies, softness, exact-zero activation and residual diagnostics. Its reusable workspace avoids allocating chain/rotation scratch during repeated CCD evaluation. Transform implements local/world and absolute/relative modes, unclamped property mixes, ordered property routing, clamp defaults, exact canonical Match queries, and selected-axis residuals.

World writes preserve the complete matrix and refresh descendants immediately. Applied local reconstruction covers all five inheritance modes; when a singular inverse or degenerate axis prevents reconstruction, the world result remains authoritative and the last valid local pose remains available. Loading rejects Transform targets within the driven subtree and duplicate mapping sources/targets.

Path uses already-deformed world control points, a four-subdivision coarse length table and independent ten-subdivision forward lookup, authored setup-length parameterization with a 24-subdivision fallback, and a separate 24-subdivision inverse projection. Open extrapolation uses the raw endpoint handles; closed wrapping and degenerate segments follow exact comparisons. All driven bones read one unchanged world snapshot, stage their results, then commit in skeleton order. Non-driven descendants refresh once, and unrelated earlier constraint results remain intact.

Slider samples the target clip through the same typed layer evaluator. Its six source properties distinguish applied local values from world values with the host root removed exactly once. Manual time, sourced clamping, negative wrapping, zero/tiny duration, extrapolating mixes and post-resolution fixed-frame/stepped sampling remain separate branches. Target sampling changes later sampled constraints without entering another solver pass; it does not advance an animation clock or emit target events.

Physics implements fixed-step translation, rotation, shear and scale integration, all scale-Y policies, environment vectors, signed host scale, and the aggregate one-million-substep limit. Raw animation time controls reset-key crossings while quantized sample time controls elapsed integration. Histories are instance-owned, preserve full affine host motion, and support selected reset/teleport/preserve-inertia/clear-inertia policies. Transport validates every selected history before commit. A common declaration-order dispatcher invokes all five solvers once over the same pose and budget. The public player owns the transaction and shares the aggregate budget across every constraint and replay step.

## Final render packets

The internal `geometry::PacketBuilder` reads one solved `Pose` and returns the public immutable `RenderPacket`. It never samples or solves animation. Packet copies retain independently owned immutable storage; a later successful or failed build cannot change earlier packets. The public player owns the builder and transacts pose, clocks, host state, solver history, events and publication together.

Clipping follows final slot order, replacement without nesting, and inclusive end slots. Deterministic convex hull/ear clipping, convex intersection and concave inverse subtraction carry source UVs through intersections. Regions enter clipping with their full source quad. Atlas trim runs afterward in source UV space, preserving in-range topology and mapping declared rotated page corners with binary64 intermediates. Empty results omit a draw and later indices remain contiguous.

Each packet declares final world XY, page UVs, ordered indices, closed texture identity, final tint and blend, and one authored-facing value per triangle before CCW normalization. Clipped Regions always use `mesh_triangles`. Singular or non-projectable source matrices produce identity diagnostics while finite world geometry remains visible. Triangle-area overflow fails before publication. The output limit is exactly 65,536 vertices per attachment; scratch buffers are retained across evaluations.

## Event traversal and owned publication

The internal event collector consumes compiled event keys and caller-supplied raw clock intervals. It preserves forward/reverse half-open ownership, equal-time declaration order, one-time range-start initialization, exact-zero and tiny-positive duration, non-loop reverse reentry, and every crossed loop completion. Outgoing authored events use a strict threshold at each crossing; completion is never suppressed by that threshold. Wall offsets remain binary64 through sorting, followed by track index, outgoing-to-incoming entry order, boundary retirement phases and entry-local order.

The playback owner must first run the complete operation through a counting sink, then replay the validated transaction through a collecting sink with that exact count. Lifecycle and authored events share the exact one-million limit; replay can supply its remaining budget. An impossible loop count is rejected before iteration. The collector accepts a borrowed entry and returns a proposed cursor value without mutating it. Public `EventBatch` owns every identifier and payload, including exact signed 64-bit integers, after the source data and compiled keys are released.

Cycle counting searches actual binary32 boundary ownership before iterating, so quotient rounding cannot consume a nonexistent completion from the remaining budget.

## Native playback state

`animation::Playback` owns independent track clocks, queues and ordered-pair mix configuration. Each track keeps a flat oldest-to-newest mixing chain, avoiding recursive traversal and destruction. Clocks preserve signed looping time, non-looping tails, frozen/reverse rates, animation subranges, track ends and unscaled mix progress. Large updates split at queue, end and mix boundaries in binary64; queue promotion wins a tied track end and preserves overflow. Removed mixing entries stop advancing at their completion boundary and retire newest first. Queued identities survive promotion so the public player addresses the same entry in its configuration baseline.

The mixer applies oldest outgoing layers before incoming layers and lower tracks before higher tracks. Per-entry alpha, typed structural property ownership, lower-track ownership, hold-previous, empty-chain fades, additive composition and outgoing attachment/order thresholds remain separate. Property and chain scratch storage is reused across evaluations.

The public player first counts events on a detached candidate, then collects the exact count and evaluates the complete candidate before one non-throwing state swap. Failed evaluation preserves the prior clocks, baseline, host state, Physics history, events and immutable Frame.

## Public player

See [player API and ownership](docs/PLAYER.md) for loading, playback, fixed-step replay, event consumption, current-pose queries and host overrides. `update` advances clocks and pending events without publishing; `apply` publishes the current pose; `advance` combines both transactionally. Absolute replay starts from the configuration baseline with fresh Physics history and returns replay events without modifying incremental pending events. Fixed-step endpoints preserve adjacent binary32 key times. Reset clears playback and host configuration while retaining installed resources; configuration cloning preserves host overrides and mix settings without copying playback clocks or history.

## Public constraints

Typed optional overrides cover IK, Transform, Path, Physics and Slider; sampled parameter records, solver diagnostics, Path forward/inverse position queries, and canonical Transform Match are exposed through the player. See [constraint controls and queries](docs/CONSTRAINTS.md). Host-editable settings are instance-owned sampled values; definitions retain only immutable identity, membership and routing data. An explicit IK point takes precedence over its authored target bone for that installed patch, and replacing/clearing the patch restores the appropriate sampled target behavior.

[Published Slot queries](docs/SLOT_QUERIES.md) expose complete sampled order and owner bone poses without evaluation.

[Point and bone activity queries](docs/POINT_QUERIES.md) expose full affine and published selection/activity without adding normalized wire fields.

## Building from source

See [source build instructions](../docs/BUILDING.md).
