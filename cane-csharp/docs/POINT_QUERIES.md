# Point and bone activity queries

`RuntimePlayer.QueryPointAttachmentPose(id)` provides the existing normalized
finite position and rotation together with SDK fields `Matrix`, `SlotId`,
`Active` and `Selected`. `Matrix` is the complete affine transform, preserving
reflection, shear and exact animated zero scales. `Active` is the published
owner bone's skin activity; `Selected` reports whether the Slot currently
resolves to this Point. An active named Point remains queryable when another
attachment is selected or the Slot is hidden.

`QueryBoneActive(id)` reads a bone's published skin activity. An unknown bone
raises `NotFound` under operation `queryBoneActive`, with the requested entity
ID. Bone inheritance can already be read with `QueryBoneTransformMode(id)`. These metadata queries run only when requested; they add no work to publication
for players that do not consume them.

All queries read the current publication, without sampling, changing its
sequence or draining events. `Update()` alone does not make unpublished state
visible. Returned structs contain owned values and remain unchanged across
later skin, selection, resource or animation changes. Point attachments do not
become renderable packet geometry.

Additional SDK fields do not change the normalized Point wire fields. Engine integration must separately preserve the complete
matrix instead of rebuilding it from scalar rotation and scale magnitudes.
