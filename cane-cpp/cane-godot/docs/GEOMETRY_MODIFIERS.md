# Final geometry effects

`CaneSkeleton` can modify final render vertices, UVs and tint through C++ Core. Effects run after animation, pose edits, constraints, deformation, clipping and
Atlas/tint evaluation, before the owned packet is published. They do not change
Bone poses, authored collision polygons, topology, textures or draw order.

```gdscript
# Persistent, native deterministic jitter. Empty filters match all attachments.
skeleton.set_geometry_modifiers([
    {"kind":"jitter", "parameters":{"seed":77, "amplitude_x":.25,
     "amplitude_y":.125, "frequency_hz":12.}, "attachment_ids":["cape"]}
])
# Later:
skeleton.clear_geometry_modifiers()
```

Both setters return `bool`, evaluate once, publish once and upload once when
inside the scene tree. `get_geometry_modifiers()` returns owned dictionaries;
editing inputs or query results does not change installed configuration. Reset
clears persistent effects. Absolute replay evaluates them at each replay step.

## Operations and submission

| `kind` | `parameters` | Defaults and bounds |
| --- | --- | --- |
| `jitter` | `seed`, `amplitude_x`, `amplitude_y`, `frequency_hz` | All zero. Seed is an integer in 0..4294967295; frequency is nonnegative. |
| `radial_wave` | `center_x`, `center_y`, `radial_amplitude`, `angular_amplitude_degrees`, `wavelength`, `phase_degrees`, `speed_hz`, `radius` | Wavelength defaults to 1 and must be positive; all others default to 0. Radius is nonnegative, with 0 meaning no falloff. Negative speed is supported. |
| `custom` | Use `callback: Callable` directly on the operation, without `parameters`. | A synchronous function accepting `(editor, context)` and returning strict `true` on success. |

Builtin parameters are finite binary64 numbers. Final writes use Core binary32
geometry. All kinds accept `attachment_ids` and `slot_ids` as arrays of strings
or `PackedStringArray`. Empty lists match all; two nonempty lists intersect. IDs must exist and cannot be duplicated or empty. Targets without render geometry
produce no visits. Unknown fields and incompatible types are rejected. `draw_index` is the contiguous position in the render packet; hidden Slots and
collision/clipping attachments do not add render entries.

Persistent operations execute first, then transient operations; each list keeps
declaration order and visits attachments in final packet order. Submit transient
effects with:

```gdscript
skeleton.automatic = false
var effects = [{"kind":"custom", "callback":shift_vertices}]
if not skeleton.advance_with_geometry_modifiers(delta, effects):
    print(skeleton.get_last_error())
```

`apply_with_geometry_modifiers(effects, sampling = {})` evaluates without advancing
time. `advance_with_geometry_modifiers(delta, effects, sampling = {})` advances
and evaluates once. `apply_with_frame_modifiers(pose, effects, sampling = {})` and
`advance_with_frame_modifiers(delta, pose, effects, sampling = {})` also accept
the [transient pose operations](POSE_MODIFIERS.md) in the same Core transaction. Sampling options follow that guide. Do not add another `apply` after these calls. The next ordinary evaluation expires transient geometry; it never accumulates
onto the previous frame. Successful Physics history follows normal Core rules.

## Bounded editor

```gdscript
func shift_vertices(editor: CaneGeometryEditor, context: Dictionary) -> bool:
    # Final Core-world coordinates: X right, Y up, before Godot node transforms.
    for i in range(editor.get_vertex_count()):
        if not editor.add_position(i, Vector2(3, 2)):
            return false
    return true
```

Core creates a separate `CaneGeometryEditor` for each callback. A script-created
instance is inactive. `context` is an owned dictionary containing the target
`sequence`, `time_seconds`, `persistent` bool, and `operation_index` within its
list. Changing it has no runtime effect.

| Editor methods | Result |
| --- | --- |
| `get_attachment_id()`, `get_slot_id()`, `get_draw_index()`, `get_vertex_count()` | Current final attachment metadata, or `null` on failure. |
| `get_position(index)`, `get_uv(index)` | `Vector2`, or `null` for an out-of-range nonnegative uint32 index. Check `get_last_error()` to distinguish failure. |
| `set_position(index, Vector2)`, `add_position(index, Vector2)`, `set_uv(index, Vector2)` | `bool`. Writes outside the current vertex range fail. |
| `set_light_tint(rgb, alpha)`, `set_dark_tint(rgb)`, `clear_dark_tint()` | `bool`. RGB is three strict byte integers in an Array or PackedByteArray. Alpha is a finite number in 0..1. Present black dark tint differs from no dark tint. |
| `get_tint()` | Owned `{light: PackedByteArray, alpha: float, dark: PackedByteArray or null}`. |
| `get_snapshot()` | Owned metadata, `world_vertices_xy` and `uvs` PackedFloat32Arrays, and `tint`. |
| `get_last_error()` | Owned structured error dictionary, empty after a successful access unless this callback already failed. |

The handle expires when its specific callback returns, including failed exits. Retaining it does not prolong access; it stays expired even while another callback
runs. Owned snapshots remain valid. Every editor argument is checked inside the
adapter, including vector and tint inputs. The first failed editor operation is
latched: ignoring its return value or making a later successful call cannot make
partially changed geometry commit.

## Failure and lifecycle

Callbacks must finish synchronously; do not use `await`. Return strict `true` to
accept your writes. False, null, other return types and destroyed Callable targets
reject the transaction. A callback may read the skeleton's previously published
frame and operate on an independent skeleton. Reentrant mutation of its own
skeleton returns false. Query results expose the original Callable for effects
installed through this script API; arbitrary native C++ closures cannot be
converted to a Godot Callable and produce an explicit query error.

Failed callbacks, non-finite vertices/UVs, inverted or collapsed previously
nondegenerate triangles reject the whole candidate. Clocks, event queues, Physics
history, persistent configuration, previous packets and work counters are retained. Inspect `get_last_error()` and the `runtime_error` signal on the skeleton. Argument conversion errors include `geometry_operations[index]` in their field. Use `queue_free()` to release a node after its synchronous evaluation. Immediate
self-deletion is cancelled to keep the active Core player alive and fails that
transaction. Godot's Node predelete can still detach a node and free children;
scene changes and other host side effects are not part of Core rollback. See the
[Godot 4.5 Node lifecycle source](https://github.com/godotengine/godot/blob/4.5-stable/scene/main/node.cpp)
and [Object cancellation mechanism](https://github.com/godotengine/godot/blob/4.5-stable/core/object/object.cpp).

Render [Bounds](BOUNDS.md) include modified final vertices. Exact collision
polygons retain their authored poses. This allows visual effects without silently
changing gameplay collision data.

## Performance and diagnostics

`get_geometry_modifier_stats()` returns persistent/transient operation counts,
attachment visits, vertex writes, UV writes and tint writes for the last published
frame. Queries do not evaluate or upload. Builtins execute directly in native
Core. Custom GDScript effects cross the language boundary for editor calls and
allocate callback contexts/handles; use them for gameplay-specific work with a
measured vertex budget. `get_snapshot()` additionally copies the attachment's
arrays. The bridge is not described as allocation-free.

See [native geometry semantics](../../docs/GEOMETRY_MODIFIERS.md).
