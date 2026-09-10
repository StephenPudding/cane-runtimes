# Published Slot queries

`RuntimePlayer.QuerySlotStates()` returns an owned read-only collection in the
complete sampled Slot order, including empty, inactive and non-renderable Slots. It constructs the list in O(number of Slots), without evaluating animation,
publishing a frame or draining events. `QuerySlotState(id)` retains its existing
single-Slot behavior.

`QuerySlotBonePose(id)` returns the immutable `BonePose` of the Slot's owner from
the published frame. This includes the complete affine matrix and local-pose data even if the Slot has no attachment. A missing
Slot raises `NotFound` with operation `querySlotBonePose` and the requested ID.

These additive SDK conveniences do not alter normalized `SlotState` fields or
the locked frame schema. Queries after `Update()` read the previous publication
until `Apply()`; previously retained values stay valid. A render packet's dense
attachment `DrawIndex` is not the complete Slot order index.

Unity integration of host Slot
content remains a separate adapter task.
