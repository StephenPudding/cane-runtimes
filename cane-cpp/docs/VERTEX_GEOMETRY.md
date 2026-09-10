# Source geometry and deformation

The public `cane/vertex_geometry.hpp` values and `RuntimePlayer` operations cover Mesh, Path, Bounding Box and Clipping attachments. All results own their buffers. Geometry and inverse math live in Core; an engine adapter uploads the final RenderPacket without implementing another deformation system.

## Inspect the current source pose

```cpp
auto source = player.query_vertex_attachment_source_geometry("mesh-body");
// All four buffers use the same source vertex order.
// source.setup_vertices_xy: authored attachment-space points.
// source.setup_world_vertices_xy: undeformed points through the current solved bones.
// source.sampled_vertices_xy: current logical attachment-space positions.
// source.world_vertices_xy: current deformed world positions.
```

These are source vertices before clipping and Atlas trimming, so their indices remain stable even when emitted render topology changes. `setup_world_vertices_xy` includes weights, bind inverses, current solved bone matrices and the host root transform. It cannot generally be reconstructed from the packet's diagnostic `source_affine`.

`source_attachment_id` identifies the ultimate linked Mesh geometry parent; `deform_attachment_id` identifies the independent resolved deform owner. The displayed attachment retains its own identity and owning slot. `fully_weighted` reports whether every source vertex has declared influences. Zero-weight influences retain their buffer positions.

Choose `VertexDeformSpace::weighted_influence_offsets` to read canonical influence-local offsets instead of absolute `vertex_positions`. Every weighted source has a complete offset pair per influence in source vertex/influence declaration order. Unweighted geometry rejects offset space. For weighted geometry, sampled logical positions are the positive-weight mean of the influence offsets converted back through their bind linear transforms, added to setup positions. Arbitrary distinct influence offsets contain more information than this logical position projection; retain offset space when editing such detail.

## Build and commit an inverse edit

```cpp
cane::VertexWorldTarget request;
request.attachment_id = "mesh-body";
request.source_vertex_index = 4;
request.target_world = {12.0f, 7.0f};
request.current_deform = cane::PlayerCurrentDeform{
    cane::VertexDeformSpace::weighted_influence_offsets};

auto patch = player.vertex_attachment_deform_for_world_target(request);
player.set_vertex_deform_override(patch.attachment_id, patch.space, patch.values);
```

The inverse query returns a complete owned buffer and does not commit it. `PlayerCurrentDeform` uses the published sampled deformation; `ExplicitVertexDeform{space, values}` uses a caller-supplied complete buffer. The requested source vertex's XY pair or complete influence slice is updated; all other entries in the chosen space are preserved. The target is resolved through full bone affines and bind inverses, including reflection and shear.

`set_vertex_deform_override` copies and validates the complete buffer, converts weighted positions into canonical influence offsets, and publishes atomically. It resolves linked deform ownership before storing the override. Setting an inheriting child therefore overrides its resolved ancestor's deform; an independent linked child retains its own override. The override persists across sampling and configuration cloning. `clear_vertex_deform_override` restores animation/setup sampling for that owner, and `reset` clears every override. Inputs, old frames and query results never alias mutable player storage.

## Other owned inverse operations

- `translate_weighted_mesh_deform(id, space, world_delta)` returns a complete deform that moves every current world vertex by the same delta; it accepts fully weighted Meshes and linked Meshes.
- `vertex_attachment_weight_local_positions_for_world_target(id, source_vertex_index, target_world)` returns one bone-local target per declared influence, preserving order and zero-weight entries. This is setup-weight authoring data; it is not a live deform override.
- `vertex_attachment_weighted_deform_offsets_after_position_edit(id, current_offsets, before_positions, after_positions)` adds a logical position edit to existing influence offsets, using only bind linear terms for deltas. Unedited influence detail is retained.

All queries read the already-published pose. An `update` without `apply` does not change what they observe. Queries do not sample animation, solve constraints again, advance clocks, publish a frame, consume events or mutate Physics history. A host override is applied before constraint evaluation, so Path constraints see the same overridden source geometry as packet construction.

## Errors

Unknown IDs return `not_found`; unsupported kinds, spaces, source indices and wrong buffer sizes return `invalid_argument`; non-finite inputs or produced values return `non_finite`. A required inverse with a zero or non-finite determinant returns `invalid_state`. Finite nonzero determinants are not rejected by an arbitrary epsilon; direct division avoids overflowing a reciprocal for tiny determinants. Singular forward geometry still remains authoritative. Every failed edit leaves the entire player unchanged.
