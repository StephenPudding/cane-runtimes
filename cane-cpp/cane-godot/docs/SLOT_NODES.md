# Slot content in Godot

Add `CaneSlot2D` as a **direct child of `CaneSkeleton`**. Put ordinary Godot nodes
(sprites, polygons, particles, hit shapes or other game content) below it. The node follows the Slot owner's published full bone matrix and inserts its
CanvasItem subtree immediately after that Slot's attachment in sampled order. Set `draw_before` to insert before the complete attachment instead.

```gdscript
var socket := CaneSlot2D.new()
socket.slot_id = "gun"
skeleton.add_child(socket)
socket.add_child(weapon_sprite)
socket.offset_transform = Transform2D(0.0, Vector2(4, -2))
```

Properties and queries:

| Member | Behavior |
|---|---|
| `slot_id` | Stable Core Slot ID, rebound on data replacement. |
| `draw_before` | Default false; controls the whole attachment boundary, including every special-blend triangle. |
| `offset_transform` | Finite Godot-local transform postmultiplied onto the converted bone matrix. |
| `hide_when_empty` | Default true; hide when Core selects no attachment. False allows content on an empty Slot. |
| `follow_enabled` | Default true; false hides and detaches content from packet insertion. |
| `is_resolved()` | Whether the current source and Slot binding are valid. An empty resolved Slot may still be hidden. |
| `get_slot_state()` | Owned dictionary: Slot ID, full draw index, optional attachment key/ID, sampled light/dark RGB bytes and alpha. |
| `get_last_error()` | Owned structured failure; missing sources/IDs and invalid engine settings fail explicitly. |
| `refresh_follow()` | Refresh from the last publication; no Core evaluation. Stable layout requires no geometry upload. |

The node owns its transform and visibility while following. Hide ordinary child
content to control game visibility. Inactive skin bones hide Slot content even
with `hide_when_empty = false`. Colors/materials on host children use ordinary
Godot behavior; sampled two-color Slot tint is exposed for deliberate material
use and is not approximated with `modulate`.

Multiple nodes at the same before/after boundary follow sibling scene order. Compatible attachment draws are merged between occupied Slot boundaries. Adding,
removing or rebinding Slot content can repack the current final packet, counted
as `layout_uploads` rather than another Core publication. `geometry_uploads`
exposes all uploads; unchanged queries/refreshes do not increase it. Animated
order resolves current boundaries before the publication's single upload. `CaneSkeleton.set_draw_order(slot_ids)` and `clear_draw_order()` call Core's
authoring override and publish once. Animated order, hidden Slots, resource
replacement and scene re-entry use Core's complete Slot order, not the dense
rendered-attachment indices. Full reflection, shear and exact animated zero
scales are preserved by `F * M * F` with `F = diag(1, -1)`; no inverse or matrix
decomposition is required.

Keep the Slot node at relative Z zero, not top-level or behind its parent, and
disable skeleton Y sorting. Incompatible settings produce an error on refresh. Normal child Z/top-level/Y-sort rules still apply within Godot: explicitly
placing child content at another Z can override ordinary Slot interleaving. Cane's clipping and tint apply to Cane packet geometry; arbitrary game children
do not automatically acquire Cane clipping masks or two-color shaders.

An identity RenderingServer anchor isolates the insertion index from Godot's
deferred scene-order updates. The Slot node owns that anchor; projections borrow
it. Data clear, reparenting and scene exit detach it before projection release. Resource projection swaps migrate it to the replacement root. Callbacks should
use `queue_free()` for participating scene nodes, as with ordinary Godot nodes. Same-skeleton runtime mutations are rejected while Slot nodes synchronize,
including mutations attempted from ordinary Godot visibility callbacks.

Host semantics were checked against official Godot 4.5
[CanvasItem documentation](https://docs.godotengine.org/en/4.5/classes/class_canvasitem.html),
[RenderingServer documentation](https://docs.godotengine.org/en/4.5/classes/class_renderingserver.html)
and [deferred Viewport order processing](https://github.com/godotengine/godot/blob/4.5/scene/main/viewport.cpp).
