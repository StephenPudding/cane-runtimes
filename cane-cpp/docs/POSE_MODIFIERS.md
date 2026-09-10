# One-evaluation pose modifiers

`cane/pose_modifiers.hpp` exposes an ordered, owned `PoseModifiers` buffer. It contains typed `ReplaceBoneLocal`, `PatchBoneLocal`, `AddBoneLocal` and `PatchConstraint` operations. The renderer-neutral player consumes it after setup, animation and persistent overrides, and before constraints, Physics and final geometry.

```cpp
cane::BoneLocalAdditive recoil;
recoil.rotation_degrees_delta = -8.0f;
cane::IkConstraintOverride aim;
aim.target = cane::Point{80.0f, 50.0f};
aim.mix = 1.0f;
cane::PoseModifiers modifiers{{
    cane::AddBoneLocal{"gun", recoil},
    cane::PatchConstraint{"aim", aim}
}};
auto step = player.advance_with_modifiers(delta_seconds, modifiers);
const auto frame = player.frame();
```

`apply_with_modifiers(modifiers, sampling)` publishes without advancing clocks; `advance_with_modifiers(delta, modifiers, sampling)` advances and publishes in one transaction. Both share the existing player's evaluator. An empty batch is equivalent to the corresponding ordinary call. Sampling options retain authored, fixed-frame and stepped behavior.

The seven channels are X, Y, rotation, Scale X/Y and Shear X/Y. Replace supplies every channel. Patch changes only present optional channels. Add reads the result of all previous stages and operations and performs one binary32 addition per present channel; scale deltas are additive, and angles are not wrapped. Repeated targets execute in declaration order. Bone inheritance modes are unchanged by these modifier operations.

Constraint patches use the same five typed override variants and validation as persistent controls. They change sampled parameters for the imminent solve, and successive patches compose. An explicit IK world target takes priority over the authored target bone for this evaluation. Persistent override configuration is retained separately.

The input is not stored by the player. A successful frame contains the transient result; source geometry, bone and constraint queries read that result until the next publication. The next ordinary evaluation restores animation and persistent inputs. Cloning configuration, absolute replay and reset do not retain transient edits. Reusing a modifier buffer is explicit: submit it again for each desired evaluation.

Errors identify the operation index and field, such as `modifiers.operations[1].delta.xDelta`. Empty IDs, unknown targets, constraint kind/range errors, non-finite inputs/results, solver errors and packet errors fail atomically. Clocks, queues, Physics history, pending events, persistent overrides, frame sequence and previously retained frames remain unchanged.

## Evaluation observations

`frame.evaluation_stats()` and `player.last_evaluation_stats()` return owned counters for the last successful publication. Counters are incremented where animation sampling, constraint/geometry solving and publication actually occur. A regular or modifier-aware apply/advance reports `1 / 1 / 1`; absolute replay reports all intermediate samples/solves and its single final publication. Queries and `update` without `apply` leave the previous publication and its counters unchanged. Failed operations do not replace them.

The public-player projection check also executes the four locked pose-modifier operation sequences twice. These checks still do not constitute the complete normalized 95-case conformance protocol.

This API provides typed modifier submission. It composes with [final geometry modifiers](GEOMETRY_MODIFIERS.md), whose bounded callbacks run after the final geometry stage. Pose callback hooks, controllers, dynamic resource overlays, and the Godot adapter remain separate unfinished SDK work.
