# Implementing an Independent Cane Runtime

This guide defines the required architecture for a new language runtime. It does not require Rust,
the Cane editor, C ABI, Bevy, or an engine plugin.

Implement the data layer from [Runtime Model v1](../formats/RUNTIME_MODEL_V1.md),
[Runtime JSON v1](../formats/RUNTIME_JSON_V1.md), and
[CANEB v1](../formats/CANEB_V1.md), rather than from Rust source code.
Implement affine inheritance, timeline sampling, clocks, tracks, queues,
mixing, and event boundaries from the normative
[Core Animation Algorithms v1](CORE_ANIMATION_ALGORITHMS_V1.md).
Implement attachment vertices, weighted skinning, deform, linked meshes,
clipping, Atlas projection, winding, tint, and renderer color from the
normative
[Geometry and Render Algorithms v1](GEOMETRY_RENDER_ALGORITHMS_V1.md).
Implement IK and Transform scheduling, activation, target spaces, analytic and
CCD solving, property mapping, degeneracy, descendant propagation, and match
offsets from the normative
[IK and Transform Constraint Algorithms v1](IK_TRANSFORM_ALGORITHMS_V1.md).
Implement Path world-curve sampling, Physics fixed-step state and budgets, and
Slider source/time mapping and recursion barriers from the normative
[Path, Physics, and Slider Constraint Algorithms v1](PATH_PHYSICS_SLIDER_ALGORITHMS_V1.md).

## Required layers

1. **Format layer**
   - Parse and validate `Hero.json` and `Hero.caneb` into the same immutable data model.
   - Parse `Hero-atlas.json`.
   - Return ignored unknown optional CANEB section tags in the decode report so the data layer can
     expose Runtime API v1 structured warnings without parsing the binary twice.
   - Reject unsupported versions/features and unsafe resource paths before allocation.
2. **Data layer**
   - Preserve stable public IDs and build private dense indexes.
   - Preserve ordered structured load warnings in immutable data/catalog metadata; never insert
     them into the runtime document or mutable instance.
   - Keep event audio references as stable `audioId` values; resolve resource paths only through the
     audio catalog.
   - Resolve hierarchy, skins, linked meshes, constraints, and timelines without name lookup.
3. **Instance layer**
   - Own mutable pose, tracks, mixes, skins, overrides, constraints, event queues, and deform state.
   - Keep animation clocks separate from the last published immutable frame.
   - Never mutate immutable skeleton data.
4. **Evaluation layer**
   - `update(deltaSeconds)` advances clocks and queues crossed events without publishing a frame.
   - `apply()` evaluates setup pose, animations, constraints, world transforms, skin/attachment
     resolution, and deformation, then publishes one frame without advancing time or emitting
     time-crossing events.
   - A convenience `advance(deltaSeconds)` must be observably equal to `update(deltaSeconds)`
     followed by `apply()`.
   - Expose current-pose Path, BoundingBox, and Clipping world geometry by
     stable attachment ID through the owned Runtime API query DTO. Reuse the
     same weights/deform projection used by constraint and render evaluation;
     the query must not mutate clocks, events, frames, or Physics history.
5. **Render-packet layer**
   - Produce ordered geometry, `imageId`/atlas mapping, blend mode, complete affine matrix, and
     already-composed final light/dark tint.
   - Apply clipping, Atlas source trim, UV mapping, and CCW normalization
     exactly once according to the geometry/render specification.
6. **Host/engine adapter**
   - Load textures/audio, convert coordinates/color once, upload geometry, and issue draw calls.
   - Do not implement animation, tint composition, constraints, or skin resolution.
7. **Conformance adapter**
   - Accept the public conformance request protocol and return result JSON.

## Package ownership

A C# runtime may be packaged with Unity integration, a TypeScript runtime with PixiJS integration,
and a C++ runtime with Godot/Unreal adapters, but their core data/evaluation modules remain
engine-independent. Sharing source inside one language is allowed. Linking all languages to the
Rust reference implementation is not a conforming independent-runtime architecture.

## Recommended implementation order

1. JSON parser, feature discovery, setup pose, Region render packets.
2. CANEB parser and JSON/CANEB model-equality tests.
3. separate `update`/`apply`, immutable frame publication, bone timelines, curves, loops, events,
   draw order, and skins.
4. meshes, weights, deform, clipping, sequences, and atlas remapping.
5. IK and Transform from their normative
   [constraint algorithm specification](IK_TRANSFORM_ALGORITHMS_V1.md), then
   Path, Physics, and Slider from their normative
   [constraint algorithm specification](PATH_PHYSICS_SLIDER_ALGORITHMS_V1.md).
6. multiple tracks, queues, replace/additive mixing, absolute sampling, and
   non-renderable attachment-geometry queries.
7. engine adapter and pixel tests in addition to packet conformance.

At every step, advertise only feature names whose required Golden Fixtures pass.

Instance construction itself is fallible: build the setup frame on private working state and
return no instance if initial evaluation fails. Do not expose a player whose first frame is an
empty error placeholder.

## Renderer rules

- Treat `[a,b,c,d,tx,ty]` as authoritative. Use it directly or bake it into vertices.
- Never reconstruct final tint from slot or attachment source values.
- Preserve packet order.
- Resolve atlas regions by `imageId`.
- Treat direct textures as explicitly sRGB with straight alpha; do not infer host defaults.
- Respect atlas color space and alpha mode; do not premultiply twice.
- Preserve determinant sign and winding under reflection.

Screenshots alone are not conformance evidence. Packet tests detect semantic differences hidden by
particular shaders; pixel tests detect host rendering differences not visible in packet data. A
production adapter should have both.

## Release compatibility declaration

Every released runtime publishes:

- runtime implementation and package version;
- supported Runtime JSON, CANEB, atlas, and Runtime API major/minor versions;
- supported feature names;
- most recent conformance suite version and fixture digest passed;
- supported engine/library versions for adapters;
- numeric precision and platform limitations.

“Supports Cane v1” without this matrix is not a compatibility declaration.
