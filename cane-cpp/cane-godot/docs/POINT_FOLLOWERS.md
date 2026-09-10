# Point followers in Godot

`CanePoint2D` follows a Point attachment by stable attachment ID. Add ordinary
Godot children for muzzle flashes, particles, markers, collision nodes or other
game content. It consumes Core's already-published complete Point matrix and
does not sample animation, solve constraints or rebuild attachment transforms.

```gdscript
var muzzle := CanePoint2D.new()
muzzle.attachment_id = "muzzle-point"
skeleton.add_child(muzzle)
muzzle.offset_transform = Transform2D(0.0, Vector2(4, -2))
muzzle.add_child(effect)
```

Bone and Point followers inherit the common abstract `CaneFollower2D` bridge. `CaneBone2D` retains its existing methods/properties; shared source lifetime,
coordinate conversion, errors, callback protection and publication scheduling
are maintained in one implementation. Instantiate `CaneBone2D` or `CanePoint2D`,
not the abstract base.

Point-specific configuration:

| Property | Meaning |
|---|---|
| `attachment_id` | Stable Point attachment ID, rebound after resource/data replacement. Non-Point and missing IDs produce explicit errors. |
| `require_selected` | Default false: follow the named Point regardless of Slot selection. True additionally requires that the Slot resolves to this attachment when following visibility. |

The shared `skeleton_path`, `offset_transform`, `follow_enabled`,
`follow_visibility`, `is_resolved()`, `get_last_error()`, `refresh_follow()`,
`binding_changed` and `follow_error` follow the
[bone follower contract](BONE_FOLLOWERS.md). A blank path finds the nearest
ancestor skeleton. Explicit paths support separate parents in the same canvas. Direct children preserve singular source matrices without inversion; separate
parents must have a finite invertible transform. Source, bone and offset
reflection/shear are preserved, including exact target zero scales.

Visibility defaults to source visibility and owner bone skin activity. With
`require_selected = true`, it also follows exact attachment selection after
skin mapping. When `follow_visibility = false`, the application owns visibility. The node owns its transform while enabled. A missing target keeps the last
finite transform and hides by default; restoring the target restores following.

`CaneSkeleton.get_point_attachment_ids()` returns an owned effective Point
catalog, including runtime resource additions. `get_point_pose(id)` returns an
owned dictionary with `attachment_id`, `slot_id`, `transform`, `position`,
`rotation_degrees`, `active` and `selected`. Transform, position and angle use
Godot's X-right/Y-down basis. Empty dictionaries indicate query failure; inspect
the skeleton's structured `get_last_error()`. These queries do not publish or
upload a frame. Normalized Core packets remain X-right/Y-up.

Followers synchronize before public frame/event observers. Same-source runtime
mutations attempted from follower/visibility callbacks are rejected while the
binding is being projected. Use normal deferred `queue_free()` for participating
nodes, and schedule configuration changes after binding callbacks.

Point content uses ordinary Godot canvas ordering and materials. Use
[`CaneSlot2D`](SLOT_NODES.md) for interleaving content between skeleton parts. Arbitrary game children do not implicitly acquire Cane clipping or tint shaders.

Godot's full transform contract is documented in
[Node2D](https://docs.godotengine.org/en/4.5/classes/class_node2d.html) and
[CanvasItem](https://docs.godotengine.org/en/4.5/classes/class_canvasitem.html).
