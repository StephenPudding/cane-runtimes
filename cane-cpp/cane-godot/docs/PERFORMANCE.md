# Godot performance diagnostics

The adapter consumes one final Core packet per publication. A draw retains its
material state and only sends changed uniforms to Godot. Shader changes initialize
all uniforms; texture RID, tint (including absent versus black dark tint), alpha
mode and independent filtering/wrapping changes remain observable. Each successful
publication still validates resources and uploads final geometry in packet order. On Forward+ and other linear canvases, adjacent Normal or Add attachments with identical texture RID, light/dark tint,
alpha, color space, PMA and sampling state share a triangle-array submission. The adapter copies Core's final positions/UVs and rebases indices; it does not
weld vertices, change triangle order or evaluate geometry. Batches stop at 65,536
vertices and at game-content Slot boundaries, including empty and clipped Slots. Multiply/Screen still copy the destination before each triangle, preserving
self-overlap. This optimization does not change Core evaluation or skip frames.

Compatibility uses an sRGB canvas even with HDR 2D in Godot 4.5–4.7. It requires a
destination copy for every group of disjoint triangles to preserve linear blend
math and display the correct colors. Groups preserve packet order, material and
Slot boundaries and contain at most 64 triangles, bounding CPU overlap checks.
Self-overlapping geometry starts a new group. `unbatched_draws` on this backend
counts triangles, while `backbuffer_copies` equals `draws`. Prefer Forward+ when
many animated instances or heavily overlapping meshes make these copies costly.

`get_render_stats()` exposes per-publication `material_parameter_writes` and
`material_shader_changes`, alongside `core_usec`, `upload_usec`, draw/triangle/
backbuffer counts and cumulative `packet_uploads`. `unbatched_draws` reports the
equivalent per-attachment/per-special-triangle count before merging. Adding,
removing or rebinding Slot content can repack a retained publication; these
operations increment `layout_uploads`. `geometry_uploads` is the sum of both
counters. Stable queries and refreshes change none of them. A normal Advance
prepares current Slot boundaries before upload, so it uploads only once.

Godot 4.5 starts a separate batch for each polygon command in both its
[RenderingDevice backend](https://github.com/godotengine/godot/blob/4.5-stable/servers/rendering/renderer_rd/renderer_canvas_render_rd.cpp#L2361)
and [Compatibility backend](https://github.com/godotengine/godot/blob/4.5-stable/drivers/gles3/rasterizer_canvas_gles3.cpp#L990). Combining final geometry before submission reduces those commands while keeping
the engine's existing shader, color and CanvasItem lifecycle paths.
