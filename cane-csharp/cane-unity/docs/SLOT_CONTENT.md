# Slot content

Add `CaneSlot`, assign a skeleton and a stable `SlotId`, and put external renderer
objects under its `Content` Transform. The component follows the published Slot
owner bone through the same full-affine projection as Bone/Point followers.

```csharp
var slot = socketObject.AddComponent<CaneSlot>();
slot.SlotId = "gun";
slot.Skeleton = character;
weapon.transform.SetParent(slot.Content, false);
slot.RefreshContent();
```

`DrawBefore` inserts all renderer content before the Slot's complete attachment;
its default false inserts after it. `HideWhenEmpty` defaults true; false allows
an empty Slot to hold game content. Core's complete sampled Slot order determines
the boundary, including empty and non-renderable Slots. Animated order, host
overrides and resource/data changes use that published order. No attachment is
split inside its triangles, including self-overlapping Multiply/Screen meshes.

Multiple components at the same boundary use `Order`, then scene hierarchy order. Renderer children use sorting layer, sorting order and their hierarchy order. `State` exposes the immutable published Slot ID, selected attachment, full draw
index and final tint. It is null while unresolved. The inherited pose queries,
offsets, visibility control and `LastError` follow the [follower contract](FOLLOWERS.md).

`CaneSkeleton.Record` inserts the external draws between ranges of the already
uploaded final Core packet. [Compatible draw batching](PERFORMANCE.md) retains
attachment boundaries; an inserted renderer splits submission at that boundary. `CaneMeshProjection.RecordRange` also exposes validated
contiguous attachment ranges for custom engine passes. Slot layout changes do not
resample animation or reupload geometry. Complete order is queried once per new
publication when Slot content is present; `SlotOrderReads` exposes that count.

The Built-in camera passes its culling mask to Slot recording. Each child
Renderer retains its own GameObject layer and enabled state. The Slot temporarily
owns `Renderer.forceRenderingOff` to exclude ordinary camera draws, then explicitly
records enabled, active child renderers at the Slot boundary. This prevents double
drawing. Removing, disabling or reparenting components restores original flags;
transferring a renderer between nested Slots retains the original host flag. An originally forced-off renderer remains hidden. While leased, use `enabled` or
child GameObject activity to control visibility. `RefreshContent` updates bindings
after explicit hierarchy edits; LateUpdate and render recording also refresh them. Removing only a Slot component preserves its scene-authored child objects.

Shared materials remain host-owned. `ShaderPass` defaults to zero; invalid or
unsupported materials/passes skip that Slot's complete content and set
`LastRenderError`. Fixing materials allows the next record to recover. `LastRendererDraws` and `ActiveRendererLeases` expose submission/ownership counts.

Use materials appropriate for an unlit 2D command-buffer pass. Core tint and
clipping apply to Cane geometry; external objects retain their own materials and
do not automatically inherit Cane tint or clipping. The camera component runs in
Edit mode as well as Play mode and detaches its command buffer on disable.

MeshRenderer and SpriteRenderer are supported Slot content. CanvasRenderer is not
a Unity Renderer and is not submitted by this component. Skinned and particle
renderers, SortingGroup integration, nested Cane skeleton insertion and Canvas/UI
masks are outside the documented Slot-content support scope. See
[render pipelines](RENDER_PIPELINES.md) for camera integration.
