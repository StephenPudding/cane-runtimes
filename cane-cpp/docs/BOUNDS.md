# Retained bounds and hit testing

`RuntimePlayer::write_bounds` reads one already-published frame. It does not advance animation, run constraints or publish another frame. Render bounds use the final Region/Mesh packet vertices after deformation, clipping and Atlas trimming. Selected Bounding Box attachments use Core's existing weighted source-geometry evaluator with the published solved bones.

```cpp
cane::RuntimeBounds bounds;
cane::BoundsHitBuffer hits;

// Reuse these buffers across frames.
player.write_bounds(bounds);
if (const auto* hit = bounds.contains_point({mouse_x, mouse_y})) {
    // hit->attachment_id, hit->slot_id, hit->draw_index
}
bounds.write_segment_hits({-100.0f, 0.0f}, {100.0f, 0.0f}, hits);
for (const auto& hit : hits.hits()) {
    // All Bounding Box hits in front-to-back Slot draw order.
}
```

Coordinates are Cane world coordinates: X right, Y up. Reflection, shear and negative scale are already present in the vertices. Callers do not decompose matrices or apply `source_affine` to them again.

## Options and query meaning

`BoundsOptions` independently controls:

- `include_render_geometry` (default true): include final visible Region/Mesh vertices in the aggregate AABB.
- `include_bounding_boxes` (default true): include currently selected Bounding Box geometry in the AABB and expose it as polygons.
- `include_transparent` (default false): include zero-alpha render attachments in the AABB. This filter applies to render geometry, not selected collision boxes.

`polygons()` is in back-to-front sampled Slot order. Its indices include hidden/non-renderable Slots, matching `query_slot_state`, rather than emitted packet draw indices. `contains_point` and `intersects_segment` return the frontmost Bounding Box hit. `write_point_hits` and `write_segment_hits` return all hits in front-to-back order. Render geometry contributes to the aggregate AABB but does not create implicit collision polygons.

`aabb_contains_point`, `aabb_intersects_segment` and `aabb_intersects_bounds` include their boundaries. `intersects_bounds` rejects disjoint AABBs and then tests actual active polygons, including concave shapes, containment and boundary contact. `polygon_for_attachment` returns the selected polygon or null. An empty result has a zero-sized AABB with zero coordinates and `empty == true`.

## Ownership and reuse

`RuntimeBounds` and `BoundsHitBuffer` retain both published and staging storage. A successful write swaps the complete result into view; a failed write preserves the previous successful output. Lower polygon/hit counts do not discard previously allocated strings or vertex buffers. After both storage banks reach the workload's high-water size, repeated writes and hit queries require no heap allocation.

Polygon views and single-hit pointers borrow from their `RuntimeBounds` and expire on its next successful write, assignment, move or destruction. A `BoundsHitBuffer` owns its hit IDs; rewriting or destroying the source bounds does not invalidate those IDs. Its `hits()` view expires on the buffer's next successful hit write, assignment, move or destruction. Copies own independent storage; moved-from objects remain valid.

Use `bounds.snapshot()`, `hits.snapshot()` or `player.query_bounds(options)` to retain independent owned data beyond subsequent writes. Snapshot allocation is intentional. `frame_sequence()` identifies the source publication; `update` without `apply` leaves bounds observations on the previous frame.

## Failures and development checks

Non-finite query coordinates, source points or produced binary32 AABB extents return `non_finite`; an invalid selected Bounding Box returns `invalid_state`; allocation/index overflow returns `resource_limit`. Queries preserve the player, clocks, notifications, Physics history and evaluation counters on success or failure.
