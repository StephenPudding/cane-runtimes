# Bone and Point followers

`CaneBoneFollower` follows a stable bone ID. `CanePointFollower` follows a named
Point attachment, or the currently selected Point in a Slot when `AttachmentId`
is empty. Both read the current Core publication without sampling animation,
solving constraints, changing events or uploading skeleton geometry.

```csharp
var follower = socketObject.AddComponent<CaneBoneFollower>();
follower.BoneId = "hand";
follower.Skeleton = character;
weapon.transform.SetParent(follower.Content, false);
follower.OffsetPosition = new Vector3(2, 0, 0);
follower.RefreshPose();
```

Place objects under **Content**, the exposed output Transform. The component
creates ordinary `Cane Pose` / `Content` child transforms, stored in serialized
references. Together they represent the complete affine using two rotations and
signed scales. This supports reflection, shear, rank loss, 3D source/follower
parents and 3D offsets; one Unity TRS cannot represent all these matrices. The
component's own Transform remains host-owned. Removing the component preserves
its child scene objects; deleting its GameObject deletes its hierarchy normally. The generated children may be saved in scenes/prefabs and must remain parented
under their owner. Reparenting the source beneath those output children is a cycle
and is rejected. Physics/collider restrictions imposed by Unity are unchanged.

`OffsetPosition`, `OffsetEuler` and `OffsetScale` apply after the Core matrix. `LocalPoseMatrix`, `WorldPoseMatrix` and `AppliedWorldMatrix` are value queries;
the last includes the offset. `IsResolved` identifies a valid target/projection. `LastError` reports missing/wrong-kind targets and invalid engine transforms. Non-finite offsets and singular/unstable follower parents hide Content and retain
the previous transform; fixing the input allows recovery. A singular **bone** is
valid and projects its collapsed matrix normally.

By default `FollowVisibility` hides Content for inactive skin bones/Points. A named Point can remain available when not selected; enable `RequireSelected`
to hide it then. An empty selected Slot or missing/non-Point target is unresolved. Disabled or destroyed sources hide their followers independently of that option. Disabling the follower hides Content and unregisters it; enabling restores binding.

Core publication synchronizes followers before `FramePublished` and animation
events. The component also refreshes late in the frame for host transform/offset
changes. `RefreshRender` synchronizes scene transforms even when no Core frame
changed. Multiple cameras and repeated refreshes do not repeat target queries or
transform writes for an unchanged publication and hierarchy. `PoseReads` and
`TransformWrites` expose actual counts. Invalid missing targets are cached for the
current publication instead of throwing repeatedly during idle refresh.

`PoseUpdated` occurs for a new pose or changed projection. Skeleton/follower
mutation during that callback is rejected before changing configuration. Source
notifications use a retained list snapshot so deleting one follower cannot skip
the others. User callback exceptions are available through `LastError` and hide
the affected Content; Core state remains unchanged. Direct mutations through
`CaneSkeleton.Player` still require host scheduling and `RefreshRender`, as with
the rest of the adapter.

Deleting the source during pose publication or animation-event delivery hides
surviving followers immediately. Remaining notifications for that destroyed
component are suppressed, including resource-transaction event queues. Earlier
owned Core frames remain valid. Arbitrary scene reparenting is not rolled back;
if it deactivates the source, rendering is restored from its retained frame on
reentry without advancing animation.
