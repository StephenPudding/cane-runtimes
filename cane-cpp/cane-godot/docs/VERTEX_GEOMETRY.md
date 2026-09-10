# Source geometry and deformation in GDScript

`CaneSkeleton` projects the native Core's source, deform and inverse APIs. Mesh, Path, Bounding Box and Clipping source indices remain stable before
clipping, Atlas projection and rendering batches. All math stays in Core.

## Coordinates, buffers and errors

All numbers and `Vector2` values below use Core coordinates: X right, Y up. World points include the Core root, excluding Godot node/ancestor transforms. Convert a Godot global target with `var p = skeleton.to_local(global_point)`
then pass `Vector2(p.x, -p.y)`. Source positions and influence offsets retain
their attachment/bone local coordinate spaces.

Buffers returned as `PackedFloat32Array` or `PackedVector2Array` are owned. Retaining or editing them cannot modify the player. Input buffers accept
`Array` of finite numbers, `PackedFloat32Array` and `PackedFloat64Array`. Numbers must fit binary32; bool/string elements and null buffers are rejected. Source indices must be non-negative integers, not floats or bools. Core checks
their range against the source geometry.

Queries read the published pose without sampling, solving, publishing,
uploading, moving clocks/Physics, or consuming events. Failed dictionary
queries return `{}`; failed buffer queries return `null`. Read
`get_last_error()` immediately. Query failures emit no `runtime_error`. Writes return `bool`, emit structured errors on failure and preserve the prior
player state. Each successful edit commits one complete Core publication.

## API

| Method | Meaning |
| --- | --- |
| `get_vertex_source_geometry(id, deform_space = "vertex_positions")` | Source buffers, current deform, kind and resolved ownership. |
| `get_attachment_geometry(id)` | Non-renderable Path/Bounding Box/Clipping world points, kind and nullable Path `closed`; Meshes use the source query or final packet. |
| `get_vertex_deform_for_world_target(id, source_vertex_index, core_target_world, deform_space = "vertex_positions", current_values = null)` | Complete deform reaching one target without committing. Null uses the published deform; an explicit complete buffer preserves untouched entries. |
| `get_vertex_weight_local_positions_for_world_target(id, source_vertex_index, core_target_world)` | One bone-local target per declared influence, including zero weights, preserving order. |
| `get_vertex_weighted_offsets_after_position_edit(id, current_offsets, before_positions, after_positions)` | Add a logical position edit to existing influence detail through Core bind inverses. |
| `get_translated_weighted_mesh_deform(id, deform_space, core_world_delta)` | Translate all current world vertices of a fully weighted Mesh/linked Mesh. |
| `set_vertex_deform_override(id, deform_space, values)` | Copy, validate and atomically publish a complete persistent deform. |
| `clear_vertex_deform_override(id)` | Restore animation/setup sampling for the resolved deform owner. |

Spaces are exactly `vertex_positions` (complete absolute source positions)
and `weighted_influence_offsets` (one XY pair per declared influence). Unweighted attachments reject offset space.

The source dictionary contains `attachment_id`, `source_attachment_id`,
`deform_attachment_id`, `kind` (`mesh`, `path`, `bounding_box`, `clipping`),
`fully_weighted`, `deform_space`, `setup_vertices_xy`,
`setup_world_vertices_xy`, `sampled_vertices_xy`, `world_vertices_xy` and
`deform_values`. Setup world points use current solved bones without deform. The inverse result contains both attachment identities, `deform_space`, and
`values`. Source ownership and deform ownership are distinct for linked meshes.

```gdscript
var patch = skeleton.get_vertex_deform_for_world_target(
    "body", 4, target, "weighted_influence_offsets")
if not patch.is_empty():
    skeleton.set_vertex_deform_override(
        patch.attachment_id, patch.deform_space, patch.values)
```

Overrides persist through playback/replay and reach Path constraints before
solving. Inheriting linked meshes affect their resolved deform owner;
independent linked meshes keep their own overrides. Reset clears them. Singular forward geometry remains valid; a required singular inverse fails
explicitly. Tiny finite determinants use Core's precise inverse rules.

## Atomic pose batches

`set_pose_overrides` accepts `set_vertex` and `clear_vertex` alongside Bone,
Region and constraint operations. The ordered batch publishes once or rolls
back; duplicate targets use the last operation:

```gdscript
skeleton.set_pose_overrides([
    {"op": "set_vertex", "attachment_id": "body",
     "deform_space": "vertex_positions", "values": complete_positions},
    {"op": "clear_vertex", "attachment_id": "cape"}
])
```

See [native Core semantics](../../docs/VERTEX_GEOMETRY.md).
