# Published Slot queries

`RuntimePlayer::query_slot_states()` returns an owned `std::vector<SlotState>` in
the complete sampled Slot order, including empty, inactive and non-renderable
Slots. It constructs the list in O(number of Slots), without animation sampling,
constraint solving, geometry construction, publication or event draining. `query_slot_state(id)` retains its existing single-Slot behavior.

`query_slot_bone_pose(id)` returns the owned published `BonePose` of the Slot's
owner. It works when the Slot has no selected or renderable attachment, and
preserves full affine, activity, inheritance and local-pose data. A missing Slot
raises `not_found` with operation `querySlotBonePose` and the requested entity ID.

These are additive SDK conveniences, not fields added to the normalized
`SlotState` or frame contract. Queries after `update()` continue to read the last
published pose until `apply()` publishes. Retained values survive later player
changes. A packet attachment's dense `draw_index` must not be substituted for the
complete Slot `draw_index` when positioning host content.

The Godot adapter consumes these queries for Slot insertion.
