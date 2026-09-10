# Transient pose modifiers

Use `CaneSkeleton.apply_with_modifiers(operations, sampling = {})` or
`advance_with_modifiers(delta_seconds, operations, sampling = {})` for temporary
game-driven poses such as recoil and aiming. Both return `bool`. They submit
owned values to C++ Core after animation and persistent overrides, before the
single constraint/Physics/geometry solve. The adapter only converts arguments
and projects Core's final packet.

```gdscript
func _ready():
    skeleton.automatic = false

func _process(delta):
    var edits = [
        {"op": "add_bone", "bone_id": "gun",
         "delta": {"rotation_degrees_delta": -8.0}},
        {"op": "patch_constraint", "constraint_id": "aim", "kind": "ik",
         "parameters": {"target": Vector2(80, 50), "mix": 1.0}},
    ]
    if not skeleton.advance_with_modifiers(delta, edits):
        print(skeleton.get_last_error())
```

Disable automatic advancement when supplying the frame yourself. Each call
already samples, solves, publishes and uploads once; it needs no extra `apply`. Positions and targets use Core coordinates (X right, Y up), without Godot node
transforms. Bone local translation follows that bone's parent coordinate system.

## Operations

| `op` | Fields | Effect |
| --- | --- | --- |
| `replace_bone` | `bone_id`, `local` | Replace all seven local channels. Omitted channels in `local` default to zero, except scales which default to one. |
| `patch_bone` | `bone_id`, `patch` | Change only supplied channels. |
| `add_bone` | `bone_id`, `delta` | Add each supplied channel delta to the result of prior stages and operations. |
| `patch_constraint` | `constraint_id`, `kind`, `parameters` | Patch sampled parameters for the imminent solve; supports all five constraint kinds. |

Local/patch channels are `x`, `y`, `rotation_degrees`, `scale_x`, `scale_y`,
`shear_x_degrees` and `shear_y_degrees`. Delta names append `_delta` to those
names. Scale deltas are additive; angles are not wrapped. Bone inheritance modes
are preserved. Repeated targets execute in declaration order. Constraint values
use the existing [constraint parameter schema](CONSTRAINTS.md), including a
Core-world `Vector2` IK target. Parameters and IDs retain Core validation.

## Lifetime and sampling

The operations do not become persistent overrides. Current pose/geometry/Bounds
queries and followers observe the resulting publication until another frame is
published. The next ordinary evaluation uses animation and persistent inputs;
submit the modifiers again for each desired frame. Changing the original array
or its dictionaries cannot change an already published result. Reset and
absolute replay do not retain transient operations. Physics history affected
by an actual successful frame follows Core's normal rules; expiry is not a
rewind of already simulated time.

`sampling` accepts `frame_step_seconds` (positive finite seconds or `null`) and
`stepped` (strict bool). The first selects Core's nearest fixed-frame sampling;
the second disables key interpolation. Playback clocks and event traversal
remain continuous. Omitting both is authored sampling; an empty operation list
is equivalent to the corresponding ordinary evaluation with those options.

Wrong field/types, unknown IDs, invalid ranges, non-finite values, solver errors
or output failures reject the whole call. Clocks, queues, pending/replay events,
Physics state, persistent overrides, old packets and publication counters remain
unchanged. `get_last_error()` and `runtime_error` expose the structured failure;
conversion errors include `operations[index]`. Mutation during publication
callbacks is rejected, while queries may read the completed transient frame. Detached nodes may evaluate, and entering the scene projects the same frame.

Owned script submissions allocate their converted buffers.

See [native pose modifier semantics](../../docs/POSE_MODIFIERS.md).
