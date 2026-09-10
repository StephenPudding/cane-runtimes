# Constraint controls and current-state queries

`<cane/runtime_player.hpp>` exposes renderer-neutral typed controls for IK, Transform, Path, Physics and Slider. An engine adapter calls these controls and consumes the resulting final packet. It must not calculate target conversions, apply constraints, or build a second pose.

```cpp
cane::IkConstraintOverride ik;
ik.target = cane::Point{55, 18};
ik.mix = 1.0f;
player.set_constraint_override("ik-main", ik);

auto state = player.query_constraint_state("ik-main");
const auto& sampled = std::get<cane::IkConstraintParameters>(state.sampled_parameters);
if (const auto* diagnostic = std::get_if<cane::IkConstraintDiagnostic>(&state.diagnostic)) {
    // Inspect diagnostic->residual or diagnostic->saturated.
}

player.clear_constraint_override("ik-main");
```

## Override semantics

Each override field is optional. Setting an override replaces the entire installed patch for that constraint; omitted fields take their sampled animation/setup values on the next evaluation. Caller-owned patches are copied. Clearing restores authored behavior. Configuration clones retain patches without sharing mutable storage, and reset clears them.

Overrides apply after animation/host pose channels and before declaration-ordered solvers. They are part of the same atomic player transaction as clocks, events, Physics history and Frame publication. A wrong kind, invalid scalar/range, missing identity, allocation failure, or failed evaluation leaves the previous observable state intact.

An explicit IK target point disables the authored target-bone route for that installed patch. A later replacement without a target point restores the bone route. Finite target coordinates include zero. IK mix is in `[0,1]`, softness is non-negative, and booleans preserve explicit false. Transform offsets and all six mixes are finite and may extrapolate. Path offsets/position/spacing are finite and its mixes are in `[0,1]`.

Physics axis contributions, inertia, damping and mix are in `[0,1]`; limit/strength are non-negative; mass is positive; wind/gravity are signed finite values. Host FPS is a positive `uint32_t`. Sampled Physics FPS is reported as `double` so the API preserves both the format's authored binary32 rate and an exact host u32 rate, including 4,294,967,295. Integration converts the rate to binary32 when computing the normative step. Slider source/time offsets, time scale, manual time and mix are finite; negative mixes and time scales are legal. `range_max` is non-negative inspection metadata and does not clamp mapped time.

## Sampled state and diagnostics

`query_constraint_state` returns an owned value containing the stable ID, closed kind, a complete parameter variant, optional resolved Slider time, and a diagnostic variant. `std::monostate` means no diagnostic. IK at zero mix still reports its unsolved residual and zero iterations; an inactive constraint reports no diagnostic. Transform, Path, Physics and Slider diagnostics retain the solver's selected residuals, steps, offsets and mapped/resolved times.

Queries read the last published pose. Calling `update` alone changes clocks but does not change query results until `apply` or `advance` publishes. Queries do not publish, advance clocks, emit/drain events, mutate Physics history or solve another animation. Returned values remain valid after later operations; mutating a copy cannot affect the player. Numeric outputs are checked for finiteness and diagnostic counts for u32 bounds. Unknown IDs, unavailable state and wrong query kinds produce structured `cane::Error` values.

## Path position and Transform Match

```cpp
auto path = player.query_path_constraint_position("path-main");
float position = player.query_path_constraint_position_for_world_target(
    "path-main", cane::Point{20, 40});
cane::PathConstraintOverride edit;
edit.position = position;
player.set_constraint_override("path-main", edit);

auto offsets = player.query_matched_transform_constraint_offsets("transform-main");
player.set_constraint_override("transform-main", offsets.to_override());
```

Path queries use the currently selected Path attachment, its deformation, weights, full affine pose, authored position mode and the Core's forward/inverse tables. Forward output includes the point, tangent, distance, path length, endpoints and closed flag. Missing or degenerate target geometry is an explicit failure. Open extrapolation and closed wrapping follow the same sampler as the solver.

Transform Match runs the Core's canonical routing algorithm on detached published state. Local/world routing and reflections remain in Core. Noncanonical routing and singular inverses are unavailable; non-finite computed offsets fail. The query itself changes nothing. Installing its returned patch is a separate transactional mutation and replaces any existing patch, so include desired mix fields when they must remain overridden.

These public APIs are covered by native development checks and the complete locked conformance protocol. Use [atomic authoring](AUTHORING.md) to stage constraint patches with other host edits in one publication, and [independent Physics advancement](PLAYER.md) to integrate without advancing playback.
