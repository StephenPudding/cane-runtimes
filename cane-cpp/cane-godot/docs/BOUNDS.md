# Retained bounds and hit testing

`CaneBounds` is a native `RefCounted` buffer over C++ Core's retained bounds
and hit storage. Reuse it across frames with `CaneSkeleton.write_bounds`:

```gdscript
var bounds = CaneBounds.new()

func query_click(global_point: Vector2):
    if not skeleton.write_bounds(bounds):
        return skeleton.get_last_error()
    var local = skeleton.to_local(global_point)
    return bounds.contains_point(Vector2(local.x, -local.y))
```

All bounds coordinates are Core world coordinates (X right, Y up), including
the Core root pose and excluding Godot node/ancestor transforms. The conversion
above accounts for engine transforms once. Core owns bounds, polygon and hit
math; the adapter never reconstructs authoritative geometry.

## Write options and lifetime

`skeleton.write_bounds(bounds, options = {})` reads the published frame and
returns `bool`. Options are strict booleans:

| Option | Default | Effect |
| --- | --- | --- |
| `include_render_geometry` | true | Include final Region/Mesh vertices after deform, clipping and Atlas trimming in the aggregate AABB. |
| `include_bounding_boxes` | true | Include selected Bounding Box polygons in the AABB and exact collision queries. |
| `include_transparent` | false | Include zero-alpha render attachments; this does not filter collision boxes. |

Render geometry contributes to the display AABB; exact polygon hits use selected
authored Bounding Boxes. Transparent image padding is not a pixel collision
mask. Empty bounds have `empty: true` and zero coordinates/extents.

Writing bounds does not advance animation/Physics, solve constraints, publish,
upload, or consume events. It is allowed during frame notifications. Bounds
remain unchanged until explicitly rewritten, including after the source node
advances, changes data or is destroyed. `get_frame_sequence()` identifies the
publication most recently written into this buffer.

Core retains polygon, vertex and hit capacity. Godot dictionaries, arrays and
packed arrays returned by queries are owned copies and allocate as needed;
editing or retaining them cannot mutate the buffer. Native borrowed pointers
are never exposed to GDScript.

## Queries

| Method | Result |
| --- | --- |
| `get_snapshot()` | Owned `{frame_sequence, aabb, polygons}`. |
| `get_aabb()` | `{empty, min_x, min_y, max_x, max_y, width, height}` in Core space. |
| `get_polygons()` | Selected Bounding Box polygons in back-to-front complete Slot order. |
| `get_polygon(attachment_id)` | Selected polygon or `{}` when absent. |
| `contains_point(core_point)` | Frontmost Bounding Box hit or `{}`. |
| `intersects_segment(core_start, core_end)` | Frontmost intersected Bounding Box, not the nearest crossing. |
| `get_point_hits(core_point)` | All hits in front-to-back order. |
| `get_segment_hits(core_start, core_end)` | All intersected boxes in front-to-back order. |
| `aabb_contains_point(core_point)` | Inclusive aggregate rectangle test. |
| `aabb_intersects_segment(core_start, core_end)` | Inclusive rectangle/segment test. |
| `aabb_intersects_bounds(other)` | Inclusive aggregate rectangle overlap. |
| `intersects_bounds(other)` | Exact polygon overlap after the AABB test, including concavity, containment and boundary contact. |

Hits contain `slot_id`, `attachment_id` and `draw_index`. Polygons additionally
contain owned `world_vertices_xy: PackedFloat32Array`. Draw indices include
hidden/non-renderable Slots and therefore differ from emitted draw indices.

## Failures

Inspect the skeleton's `get_last_error()` after a failed write and the bounds
object's `get_last_error()` after a failed query. Null outputs/other bounds,
unknown options, wrong boolean types, invalid IDs or non-finite coordinates
are rejected. Failed dictionary queries return `{}`; failed bool/all-hit queries
return `null`, distinct from a successful false/empty result. These read-side
operations do not emit runtime error signals. Core write failures also record
their diagnostics on the bounds object and preserve its last successful data.
See [native bounds semantics](../../docs/BOUNDS.md).
