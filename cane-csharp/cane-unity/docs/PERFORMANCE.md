# Unity rendering and performance

`CaneMeshProjection` batches adjacent final attachments when their decoded texture
resource, blend mode and exact final tint agree. Resource identity includes the
sampler, color space and source alpha contract. Different inputs split the batch;
attachments are never reordered to increase batching. Core remains responsible
for pose sampling, constraints, clipping, final vertices, UVs and tint.

Each batch uploads one shared vertex/UV buffer. Its complete draw and individual
attachment slices use disjoint index ranges, following Unity's
[submesh contract](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Mesh.SetSubMesh.html). The complete index range is duplicated only when a batch contains more than one
attachment. This trades index storage for one upload and immediate, allocation-free
selection of already uploaded slices. The index format changes to 32 bits when a
batch exceeds 65,535 vertices. Mesh buffers and lists are reused between frames.

`AttachmentCount` counts final Core attachments. `DrawCount` counts nonempty GPU
batches for a complete packet without Slot insertions. `RecordRange(first,length)`
continues to take **attachment indices**, including empty ranges. If an insertion
divides a batch, the recorder submits its precomputed attachment slices on either
side. Consequently Slot insertions may require more commands than `DrawCount`. Vertex and triangle counters count source packet geometry once, excluding the
duplicate index storage used for range selection.

Core, upload and rendering costs depend on the animation and host workload. Render counters describe the submitted packet; they do not measure GPU time or
window presentation. [Core ownership](../../docs/PERFORMANCE.md) defines retained-frame behavior.
