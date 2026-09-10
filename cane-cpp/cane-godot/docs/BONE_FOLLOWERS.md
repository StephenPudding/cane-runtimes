# Godot bone followers

`CaneBone2D` is a native `Node2D` that follows one stable bone ID from a
`CaneSkeleton`'s current Core publication. Add ordinary Godot children such as
sprites, particles or collision shapes. This is a host projection of the solved
bone matrix; it performs no animation sampling, constraint solve or geometry
reconstruction.

```gdscript
var mount := CaneBone2D.new()
mount.bone_id = "hand"
skeleton.add_child(mount)
mount.offset_transform = Transform2D(0, Vector2(8, -2))
mount.add_child(weapon)

# A node under a different parent can follow in the same canvas.
var indicator := CaneBone2D.new()
world.add_child(indicator)
indicator.skeleton_path = indicator.get_path_to(skeleton)
indicator.bone_id = "head"
```

An empty `skeleton_path` selects the nearest ancestor `CaneSkeleton`. A nonempty
path resolves explicitly. Once resolved, the binding holds a safe Godot instance
ID until the source becomes unavailable or the path is reassigned. A missing
source is retried without evaluating Core, so a new skeleton at the same path can
restore the binding. Reparenting a follower re-resolves its path from the new
location; set the path again when its relative location changed.

## Transform and scheduling

Bone coordinates use Core X-right/Y-up. The adapter changes basis once to
Godot X-right/Y-down using all six affine coefficients, then postmultiplies
`offset_transform` in Godot bone-local coordinates. It preserves signed scale,
reflection, shear and exact singular animation matrices; there is no rotation /
scale decomposition. An offset can also have zero scale, but must remain finite.

Direct children receive this local transform without inverting the source. Other parents receive the source world transform converted into their own local
space. `top_level` follows the source world transform directly. Source and
follower must share one canvas; cross-viewport/canvas conversion is not inferred. The follower cannot be an ancestor of the skeleton it follows.

Registered followers update before the source's public `frame_updated` and
`runtime_event` notifications, independent of observer connection order. Publication updates cache the bone index but validate its stable ID against the
new frame, so source catalog reordering cannot silently select a different bone. Bound followers need no independent per-frame animation loop or scene path scan.

Source/local and parent/global transform notifications also update following
without advancing animation. Godot queues inherited transform notifications;
they are processed before rendering. Call `refresh_follow()` when a host needs
an explicit synchronous read after changing a separate ancestor's transform. Repeated refreshes read the same publication and do not change its sequence,
events, evaluation statistics or packet upload count.

## Visibility, errors and lifecycle

`follow_visibility` defaults to true and gives this node ownership of its own
`visible` property: it follows source visibility and the published bone's skin
activity, and hides unresolved targets. Set it false to manage node visibility
yourself. A valid inactive bone still has `is_resolved() == true` but is hidden. `follow_enabled = false` pauses following and leaves the current transform and
visibility alone; re-enabling synchronizes immediately.

`refresh_follow()` reports whether a bone resolved. `get_last_error()` returns a
deep owned diagnostic with the code, operation, field and optional entity ID. `follow_error(details)` fires when a refresh encounters a changed error;
`binding_changed(resolved)` signals availability transitions. Invalid/nonfinite
offset setters retain the previous offset. Missing data/bones and a singular
separate parent retain the last finite local transform and hide the node by
default. Restoring a valid source or parent restores following. Zero scale in
the target bone or source itself is valid and is preserved.

Leaving the scene unregisters a follower. Source data clearing, skin changes,
source exit/re-entry and source destruction are observed without retaining a
raw pointer to a destroyed node. Core data, decoded textures and final packet
ownership stay with `CaneSkeleton`; the follower only owns its Godot transform
and binding configuration. Use normal Godot deferred `queue_free()` for objects
being destroyed during callbacks. Reentrant follower property changes during a
binding update are rejected, as are same-source runtime mutations during follower or native visibility callbacks; schedule configuration changes after the callback.

Children use ordinary Godot canvas ordering. This node does not interleave a
weapon between individual skeleton Slots or infer tint for arbitrary children. Use [CaneSlot2D](SLOT_NODES.md) for Slot insertion and [CanePoint2D](POINT_FOLLOWERS.md) for a named Point attachment.

## Godot transform contract

The coordinate/lifecycle bridge uses Godot 4.5's documented
[CanvasItem transform inheritance and notifications](https://docs.godotengine.org/en/4.5/classes/class_canvasitem.html)
and [Node2D full transforms](https://docs.godotengine.org/en/4.5/classes/class_node2d.html).
