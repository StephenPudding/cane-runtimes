# Point and bone activity queries

`RuntimePlayer::query_point_attachment_pose(id)` continues to provide the
normalized finite Point position and rotation. Its owned SDK result also
contains the full authoritative affine matrix, `slot_id`, `active` and `selected`. `active` means the owner bone is enabled by the published skin state; `selected`
means that Slot currently resolves to this exact attachment. A named Point can
remain active and queryable while another attachment is selected.

`query_bone_active(id)` is a read-only convenience for the published bone's skin
activity. It reports `not_found` under operation `queryBoneActive` for an unknown
bone, and does not sample animation or publish a frame.

Queries use the same published pose as rendering, including constraints, host
transforms and exact zero animation scales. The complete Point matrix preserves
reflection and shear; do not reconstruct it from a position and angle. Queries
after `update()` still observe the last publication until `apply()`. Retained
results do not change when the player publishes again, and queries do not drain
events. Point attachments do not enter the render packet.

These SDK fields do not change the language-neutral result schema
or normalized wire Point pose.
