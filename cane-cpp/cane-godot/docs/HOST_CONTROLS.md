# Host pose and Physics controls

[Source vertex controls](VERTEX_GEOMETRY.md) add `set_vertex` and `clear_vertex`
to the same atomic mixed pose batch.

`CaneSkeleton` accepts gameplay pose overrides through the native C++ player. Controls use **Cane/Core coordinates**: X right, Y up, degrees counterclockwise,
and exported pixel units. These are local authored values, not Godot global
transforms. Godot's `Node2D.transform` remains an additional engine transform. Core evaluates constraints and final geometry; the adapter converts the output
to Godot coordinates only at the established rendering/query boundary.

All mutations return success as `bool`. Failed inputs or Core evaluation preserve
the previous player/publication and emit one owned `runtime_error` dictionary. Reentrant mutation from publication callbacks is rejected without recursively
emitting an error signal. Errors are also available through `get_last_error()`.

## Pose controls

`set_bone_local_override(bone_id, local, transform_mode=null)` replaces a complete
local override. Keys are `x`, `y`, `rotation_degrees`, `scale_x`, `scale_y`,
`shear_x_degrees`, `shear_y_degrees`. Omitted values use identity defaults:
positions/angles zero and scales one. This is not a patch over the previous pose. The optional mode is `normal`, `only_translation`, `no_rotation_or_reflection`,
`no_scale`, or `no_scale_or_reflection`; null leaves inheritance to the authored
and animated value. `clear_bone_local_override(bone_id)` restores that control.

`set_region_pose_override(attachment_id, local)` similarly replaces a Region's
pose using the first five keys, with no shear. Its matching clear method restores
authored/animated attachment pose. Missing IDs and non-Region targets fail. Runtime overrides preserve legal singular and reflected transforms; this does
not relax nonzero scale requirements for setup bones/Region data loading.

Use `set_pose_overrides(operations)` for multiple edits in one transaction:

The same ordered batch also accepts `set_constraint` and `clear_constraint`;
their shapes and five-kind parameter rules are in [constraint controls](CONSTRAINTS.md).

```gdscript
var gun = skeleton.get_bone_pose("gun")["core_local"]
gun["rotation_degrees"] += 15.0
var hand = skeleton.get_bone_pose("front-fist")["core_local"]
hand["x"] += 3.0
var ok = skeleton.set_pose_overrides([
    {"op": "set_bone", "bone_id": "gun", "local": gun},
    {"op": "set_bone", "bone_id": "front-fist", "local": hand},
])
```

Supported operations are `set_bone` (`bone_id`, `local`, optional
`transform_mode`), `clear_bone` (`bone_id`), `set_region` (`attachment_id`,
`local`), and `clear_region` (`attachment_id`). Unknown keys/operations, invalid
types, null numeric values and non-finite/out-of-float-range numbers fail. StringName keys/IDs/modes are accepted. Operations retain declaration order and
the last operation on a target wins. Empty batches follow Core and publish once. The one-million-operation Core limit also bounds bridge staging.

Core commits the batch atomically with **one sample, one constraint solve and
one frame publication**. No earlier edit survives a failed later edit. Followers
and Slot content synchronize before public frame/event callbacks. Individual
pose setters also publish once; do not append another `apply()` call.

`get_bone_pose(id)` returns owned `bone_id`, `core_local`, `transform_mode`,
`active`, and `transform`. The last field is the complete published world matrix
converted to Godot skeleton-local coordinates, matching `get_bone_transform`. `get_region_pose(id)` returns the five Core local values. Queries read the
published pose, which includes sampled constraints; they do not reconstruct it. Queries return `{}` and a structured last error for missing data/invalid IDs,
without emitting error signals. Retained nested dictionaries are independent.

## Root transform and Physics

`set_root_pose(local, physics_motion="move", constraint_id=null)` sets Core's
external root transform from the five Region-style pose keys. It is distinct
from the exported root bone override and from the engine node's transform. `get_root_pose()` reads the owned Core root values.

Physics motion modes are Core's `move`, `teleport`, `preserve_inertia` and
`clear_inertia`. `move` retains the ordinary motion response, `teleport` resets
history, `preserve_inertia` transports history through the root affine delta,
and `clear_inertia` additionally clears velocity/lag. A null target applies to
all Physics constraints; a string selects one. Moving the root still moves the
entire skeleton. Transport requires an invertible previous root; failure keeps
the old state. Teleport can recover from a singular previous root.

`set_physics_environment(values)` replaces Core's four force coefficients:
`wind_x`, `wind_y`, `gravity_x`, `gravity_y`; omitted defaults are `1, 0, 0, 1`. These coefficients preserve Core's force convention, including its Y-force sign;
they are not Godot screen-space vectors. Passing `{}` restores the defaults.

`reset_physics(constraint_id=null)` resets all or one Physics history and publishes
once. Success remains true if that history was already empty; it does not report
Core's previous-history flag. Non-Physics/missing targets fail.

`advance_physics(delta_seconds)` integrates a finite nonnegative Physics delta
and publishes the current animation once. It does **not** advance playback
clocks, queued entries or animation events, and does not replace replay events. A zero delta still publishes once. The normal Core substep budget applies;
failures preserve subsequent Physics history as well as the old frame.
