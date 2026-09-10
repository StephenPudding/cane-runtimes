# Constraint controls and queries

`CaneSkeleton` exposes the native Core's IK, Transform, Path, Physics and Slider
controls to GDScript. All solver decisions and inverse calculations remain in
Core. Controls and queries use **Core coordinates**: exported pixel units,
X right, Y up and counterclockwise degrees. World points include the Core root
pose; they do not include the additional Godot node/canvas transform.

```gdscript
var ids = skeleton.get_constraint_ids()
var state = skeleton.get_constraint_state("arm-ik")
if not skeleton.set_constraint_override("arm-ik", "ik", {
    "target": Vector2(55, 18), "mix": 1.0
}):
    print(skeleton.get_last_error())
# Clearing restores the sampled animation/setup parameters.
skeleton.clear_constraint_override("arm-ik")
```

`set_constraint_override(id, kind, parameters)` replaces the complete installed
patch for that ID. Kind is one of `ik`, `transform`, `path`, `physics`, `slider`
and must match the data. Omitted fields resume their sampled values; zero and
false remain explicit values. Passing null as a numeric/bool/point field is an
error. Caller dictionaries are copied. A replaced IK patch without `target`
restores the authored target-bone route. Patches persist through playback/replay;
`reset()` removes them. Each set/clear operation publishes and uploads once.

| Kind | Optional parameter keys |
| --- | --- |
| IK | `target` (Core-space Vector2), `mix`, `softness`, `bend_positive`, `compress`, `stretch` |
| Transform | `rotation_degrees`, `x`, `y`, `scale_x`, `scale_y`, `shear_y_degrees`, `mix_rotate`, `mix_x`, `mix_y`, `mix_scale_x`, `mix_scale_y`, `mix_shear_y` |
| Path | `rotation_degrees`, `position`, `spacing`, `mix_rotate`, `mix_x`, `mix_y` |
| Physics | `x`, `y`, `rotate`, `scale_x`, `shear_x`, `limit`, `fps`, `inertia`, `strength`, `damping`, `mass`, `wind`, `gravity`, `mix` |
| Slider | `source_offset`, `time_offset`, `time_scale`, `range_max`, `time`, `mix` |

Numbers must be finite and representable by Core binary32. Bool fields require
actual bools; string coercion and unknown keys fail. Physics host `fps` requires
a Godot integer in 1..4294967295 and retains all bits. Its sampled query field is
a Godot float (binary64), preserving both full u32 host rates and legal authored
fractional rates. Core validates semantic ranges: IK/Path mixes and Physics
contributions use [0,1], softness/limits/strength/range_max are nonnegative, and
mass is positive. Transform and Slider mixes may extrapolate; Slider time scales
may be negative. See [native constraint semantics](../../docs/CONSTRAINTS.md).

## Atomic pose changes

Constraint operations can join Bone and Region changes in `set_pose_overrides`:

```gdscript
skeleton.set_pose_overrides([
    {"op": "set_bone", "bone_id": "target", "local": {"x": 20, "y": 8}},
    {"op": "set_constraint", "constraint_id": "arm-ik", "kind": "ik",
        "parameters": {"mix": 1.0}},
    {"op": "clear_constraint", "constraint_id": "secondary-ik"}
])
```

Operations run in declaration order; later operations replace earlier edits to
the same target. The full array is converted before one Core transaction. A
failed input or solve leaves all prior state, playback, events and publication
unchanged. Success requires one sample/solve/publication and one render upload. Mutations return bool and emit one structured `runtime_error` on failure. Reentrant mutation from frame/event callbacks is rejected without recursive
error notifications; queries are allowed during these callbacks.

## Owned published observations

`get_constraint_ids()` returns the current data's declaration-ordered IDs. `get_constraint_state(id)` returns `constraint_id`, `kind`, complete
`sampled_parameters`, nullable `sampled_slider_time_seconds` and `diagnostic`. The parameter keys match the table. A null diagnostic means no diagnostic was
published; zero-mix IK may still report a residual and zero iterations.

Diagnostic fields are direct copies of Core values:

- IK: `residual`, `threshold`, `mix`, `iterations_used`, `iteration_limit`, `saturated`.
- Transform: `driven_bone_count`, six-element `mixes` (rotate, X, Y, scale X, scale Y, shear Y), nullable translation/rotation/scale/shear residuals.
- Path: `driven_bone_count`, `mix_rotate`, `mix_x`, `mix_y`, nullable translation/rotation/scale residuals.
- Physics: `fixed_steps`, `translation_offset`, `translation_speed`, `rotation_offset_degrees`, `angular_speed_degrees`, `scale_offset`, `scale_speed`, `configured_limit`, nullable `required_limit`, `limit_saturated`.
- Slider: nullable `source_value`, `mapped_time`, `resolved_time`, `duration`, `wrapped`, `clamped`.

`get_path_constraint_position(id)` returns `constraint_id`, Core-space `point`,
`tangent_degrees`, `distance`, `path_length`, `path_start`, `path_end`, `closed`. `get_path_constraint_position_for_world_target(id, core_target_world)` returns
the Core-computed position in the authored fixed/percent mode. A valid result
can be zero; failure returns null. Missing/degenerate selected Path geometry
fails explicitly. Reflection, deformation, weighting, open extrapolation and
closed wrapping stay in the same Core sampler used by playback.

`get_matched_transform_constraint_offsets(id)` returns the six offset keys from
the Transform row, suitable for a new Transform patch. Matching is a read-only
query; install the patch separately and add desired mix fields. Noncanonical
routing or singular target inverses fail instead of fabricating offsets.

Dictionary query failures return an empty dictionary and set `get_last_error()`;
queries do not emit runtime events, resample, advance Physics, publish or upload. Returned dictionaries/arrays are owned and survive later playback. Modifying
them never changes runtime state.
