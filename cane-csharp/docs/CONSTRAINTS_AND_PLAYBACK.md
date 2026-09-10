# Constraints, snapshots, and playback controls

`RuntimeEvent.IntegerValue` is nullable `long`. Authored key values and inherited
event defaults preserve the entire signed 64-bit range, including values above
the exact binary64 integer range. JSON and CANEB integer tokens are retained
without first converting to `double`; malformed, fractional or out-of-range
signed event values fail at data loading. Numeric animation channels continue
to sample as binary32.

These APIs belong to the renderer-neutral C# Core. Engine adapters consume the resulting frames and queries; they do not solve constraints or rebuild world geometry.

## Sampled constraint state

`QueryConstraintState(id)` returns an immutable `ConstraintState` with the stable ID, kind, typed `SampledParameters`, optional `SampledSliderTimeSeconds`, and optional solver-owned `Diagnostic`. The parameter types are `IkConstraintParameters`, `TransformConstraintParameters`, `PathConstraintParameters`, `PhysicsConstraintParameters`, and `SliderConstraintParameters`.

```csharp
ConstraintState state = player.QueryConstraintState(constraintId);
if (state.Diagnostic is IkConstraintDiagnostic ik)
    Console.WriteLine($"Residual: {ik.Residual}; saturated: {ik.Saturated}");

ConstraintOverride patch = state.SampledParameters.ToOverride();
// Editing this owned builder cannot change the retained query.
player.SetConstraintOverride(constraintId, patch);
```

Inactive or unresolved constraints can have null diagnostics while their sampled parameters remain available. Transform and Path residuals report only enabled properties. Physics counts each conceptual substep once, even when translation and rotation both integrate. Slider time is the resolved target-animation time before optional fixed-frame quantization.

Queries read the published pose. `Update` can advance playback without changing these results; `Apply` publishes the new pose. No query publishes, emits/drains events, changes queues, or integrates Physics.

## Transform Match and Path queries

`QueryMatchedTransformConstraintOffsets(id)` computes six offsets using the current pose and canonical local/world routing. `ToOverride()` turns the result into a host override. Only a legacy Transform or an exact identity property mapping is matchable; custom offsets, routing, scales, or clamping produce a structured failure. This operation uses the constraint inverse threshold (`abs(det) > 2^-23`), which differs from the finite non-zero determinant rule of source-vertex inverse authoring. Reflected sources follow the normative reflection rule.

```csharp
TransformConstraintOffsets offsets = player.QueryMatchedTransformConstraintOffsets(transformId);
player.SetConstraintOverride(transformId, offsets.ToOverride());

PathConstraintPosition position = player.QueryPathConstraintPosition(pathConstraintId);
float authoredPosition = player.QueryPathConstraintPositionForWorldTarget(pathConstraintId, targetWorld);
player.SetConstraintOverride(pathConstraintId,
    new ConstraintOverride("path").Set("position", authoredPosition));
```

Path results include point, tangent in degrees, fixed distance, total length, endpoints, and closed state. The inverse returns the scalar for the constraint's authored fixed/percent mode. It uses the current active Path, deformation, weights, and full affine pose. Core implements the normative 24-subdivision inverse table; forward constant-speed sampling retains its separate ten-segment lookup. Open endpoint rays use actual control handles; exactly zero-length endpoint handles do not invent an extrapolation tangent. Closed paths wrap and have no endpoint rays. Equal-distance inverse candidates preserve declaration order.

Unknown IDs produce `NotFound`, wrong kinds produce `InvalidArgument`, and unavailable geometry/routing produces `InvalidState`. Non-finite runtime results produce `NonFinite`. Failed queries leave the player unchanged.

## Coherent authoring snapshot

A failing subquery fails the complete read with operation `queryAuthoringSnapshot`, retaining its field and entity ID. Only an unresolved Path position reporting `InvalidState` is omitted; all other failures preserve the complete player and fail the snapshot.

`QueryAuthoringSnapshot()` returns one `RuntimeAuthoringSnapshot` containing the current immutable `Frame`, all bone local states, slot states, constraint states, Point poses, non-renderable vertex geometry, source geometry for Mesh/Path/BoundingBox/Clipping, and resolvable Path constraint positions. Collections preserve catalog order. Source geometry uses `VertexPositions` deform space.

All projections describe the same published pose and remain owned after subsequent playback changes. An unresolved Path position is omitted; its constraint state remains included. Other failures fail the complete snapshot. Hosts can share this result between rendering, picking, and authoring tools.

## Animation and queue controls

`SetAnimationTime(seconds)` sets the primary track's absolute animation time, clamping to its animation range and subtracting the range start for raw track time. Other tracks remain unchanged. With no primary entry, it sets detached time. `SetTrackTime` instead sets raw elapsed track time. Neither setter generates time-crossing events.

`SetTrackAnimationRange`, `SetTrackEnd`, `SetTrackMixDuration`, and `SetTrackOptions` edit the current entry. `QueryTrackState` includes range, raw/animation clocks, delay, lifetime, mix state, thresholds, and queued count.

```csharp
player.SetQueuedEntryOptions(trackIndex, queueIndex, new QueuedEntryOptions {
    DelaySeconds = 0.4f,
    MixDurationSeconds = 0.15f,
    Looping = false
});
player.RemoveQueuedEntry(trackIndex, queueIndex);
```

At least one queue option is required. Edited delay and mix duration must be finite and non-negative. Queue queries include both track and queue indices and preserve order. Removal disposes exactly one entry. Empty fade-out entries retain a null animation ID, including lifecycle events. Current-entry and queue edits identify the corresponding configuration-baseline entry after earlier queue entries have promoted; they do not capture advanced clocks into the seek baseline.

Mutations publish one frame only after validation, evaluation, and final geometry callbacks succeed. Failure preserves live state, baseline, frame, Physics history, and pending events. Sequence image selection reduces elapsed steps before narrowing to an index, including long-running loop/reverse/ping-pong playback; it does not impose a signed 32-bit elapsed-step limit.

## Physics-only advancement

`AdvancePhysics(deltaSeconds)` consumes the same bounded Physics substep budget and publishes one frame, without advancing animation/mix clocks, promoting queues, or changing events. It uses authored sampling and updates Physics clock bookkeeping so its explicit delta is not charged again to later ordinary playback. A failure rolls back solver history as well as the frame. `ResetPhysicsConstraint(id)` resets one constraint's live history and publishes once; `Reset()` clears playback and authoring state and builds the setup frame once.

## Fixed-frame sampling

`SamplingOptions.FixedFrame(frameStepSeconds, stepped: false)` accepts the exact positive finite step from the Runtime API. The existing frames-per-second constructor remains available and converts its rate to a step. Both select the nearest frame, with exact halfway values rounded toward positive infinity; they do not round down. Stepped interpolation is an independent option.

```csharp
player.Apply(SamplingOptions.FixedFrame(1f / 30f));
```

Sampling changes evaluated pose time only. Events and Physics reset-key crossings retain raw animation time, including reset keys crossed while the quantized pose time remains unchanged. Physics integration uses elapsed sampled time. Slider diagnostics retain the resolved target time before quantization. Invalid sampling options fail without replacing the published frame.
