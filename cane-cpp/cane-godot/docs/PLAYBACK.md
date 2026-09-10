# Godot animation tracks and queues

`CaneSkeleton` exposes the native Core playback controls to ordinary GDScript. Every command returns `bool`. Failures return `false`, retain Core playback and
render publication, store an owned `get_last_error()` dictionary, and emit one
`runtime_error` signal. Reentrant mutation during publication callbacks returns
`false` without recursively emitting another error signal.

These are commands over the existing C++ Core player. The adapter does not
calculate track clocks, blend poses or synthesize lifecycle events.

## Play and transition

```gdscript
# After assigning a loaded CaneSkeletonData:
skeleton.set_default_mix(0.15)
skeleton.set_mix("run", "jump", 0.25)
skeleton.play("run", true)                       # track 0
skeleton.play("aim", true, 1, 0.0)              # track 1, explicit instant mix
skeleton.set_track_options(1, {"alpha": 0.5, "blend": "additive"})
skeleton.queue("jump", 0.0, false, 0, 0.2)
skeleton.queue_empty(0.1, 0.5, 1)                # fade overlay to setup
```

| Method | Meaning |
| --- | --- |
| `play(id, looping=true, track=0, mix_seconds=-1)` | Replace the current entry; `-1` selects pair/default mixing, `0` switches immediately. |
| `queue(id, delay_seconds=0, looping=false, track=0, mix_seconds=-1)` | Queue an entry. The appended mix argument preserves existing four-argument calls. |
| `play_empty(mix_seconds, track=0)` | Crossfade to an empty entry, releasing the previous animation's contribution. |
| `queue_empty(mix_seconds, delay_seconds=0, track=0)` | Queue an empty entry. |
| `set_default_mix(seconds)` | Change the fallback for future transitions. |
| `set_mix(from_id, to_id, seconds)` | Change one animation pair's future transition duration. |
| `set_track_mix_duration(track, seconds)` | Change the current entry's transition duration. |
| `clear_track(track=0)`, `clear_tracks()` | Remove current and queued entries, emitting Core lifecycle events. |

Queue delay follows Core: a positive value is relative to the previous entry's
start; a zero/negative value is resolved from its duration minus the incoming
mix plus that delay, clamped to zero. Query results report the resolved delay. Queueing on an empty track follows Core's immediate-start behavior.

## Track options, time and range

`set_track_options(track, options)` patches only supplied keys. Numeric keys are
`alpha`, `time_scale`, `event_threshold`, `attachment_threshold` and
`draw_order_threshold`. Alpha and thresholds are in `[0, 1]`; `time_scale` is
finite and may be negative for reverse playback or zero for pause. Boolean keys
are `looping` and `hold_previous`; `blend` accepts `"replace"` or `"additive"`. Thresholds and hold behavior are interpreted by Core during mixing.

Options must have string/StringName keys and values of the documented type. Unknown keys, null values, string-to-number coercion, non-finite values and
numbers outside Core's float range are rejected before mutation. A valid empty
track-options dictionary follows Core's no-property-change publication behavior.

| Method | Meaning |
| --- | --- |
| `set_track_time(track, seconds)` | Set nonnegative elapsed track time; animation ranges and looping still apply. |
| `set_animation_time(seconds)` | Set absolute animation time for track 0, clamped to its range; without track 0, update Core's detached animation time. |
| `set_track_animation_range(track, Vector2(start, end))` | Select a nonnegative range within the animation duration. `null`/omitting the range restores the full duration. |
| `set_track_end(track, seconds)` | Retire the entry when elapsed track time reaches the endpoint. `null`/omitting seconds clears the endpoint. |
| `set_queued_entry_options(track, queue_index, options)` | Patch at least one of `delay_seconds`, `mix_duration_seconds` (both nonnegative) or `looping` (bool). |
| `remove_queued_entry(track, queue_index)` | Remove the zero-based pending entry and emit its Core disposal event. |

Current-entry edits require an existing entry. Track indices are Core's
`0..4095`; missing queue entries are errors. Setting time is a direct current-pose
edit; use `sample_at(seconds, fixed_step_seconds)` to reconstruct Physics/history
and replay events from the configured baseline. Replay events remain separate
from incremental `runtime_event` signals.

## Owned state queries

`get_track_state(track=0)` returns an owned dictionary with:

- `track_index`, `animation_id` (null for an empty entry).
- `track_time`, `animation_time`, `animation_start`, `animation_end`,
  `delay_seconds`, `track_end` (null when unset).
- `alpha`, `time_scale`, `looping`, `hold_previous`, `blend`.
- `mix_time`, `mix_duration`, `mix_progress`.
- `event_threshold`, `attachment_threshold`, `draw_order_threshold`,
  `queued_entry_count`.

An unoccupied valid track returns `{}` with an empty last error. Invalid indices
or unassigned data return `{}` with a structured last error. Queries do not emit
`runtime_error`; callers can distinguish absence from failure with that error.

`get_queued_entries(track=0)` returns owned dictionaries containing `track_index`,
`queue_index`, `animation_id` (possibly null), resolved `delay_seconds`,
`mix_duration` and `looping`. An unoccupied valid track returns `[]`.

`get_track_count()` reports allocated track capacity, not active entry count:
playing track 3 yields 4, and clearing entries keeps that capacity until reset. `get_default_mix()` returns the current fallback. Both return zero with a
structured last error if no data is assigned. Successful queries clear the last
error. Retaining or modifying query dictionaries/arrays never changes Core.

Queries can be used in event/frame callbacks. They do not advance clocks,
evaluate pose, upload geometry or drain events. `set_default_mix` and `set_mix`
also do not publish; other playback edits publish exactly once through Core,
update followers/Slot content, then notify callers. Do not call `apply()` again
after a successful pose-affecting command.
