# Performance modes and ownership

This guide describes the TypeScript Core and PixiJS performance contract,
frame ownership and rendering data flow.

## Runtime modes

`RuntimePlayerV1` defaults to `strict`. Strict mode publishes independently owned, frozen frame DTOs and preserves transactional rollback; those guarantees require allocation and copying.

For a real-time renderer, construct the player with `{ executionMode: "performance" }`. Performance mode reuses animation-layer storage, sampling maps and arrays, Bone matrices, IK chains, Transform/Path/Physics workspaces, iterative reconstruction matrices, persistent-host deform/tint storage, render attachments, frame DTOs, and render packets. Each of the two Frame workspaces also caches Bone rotation/scale projection by the exact binary32 `a/b/c/d` world-matrix values; translation remains live every frame, and a changed linear matrix invalidates only that workspace's entry. Retained Region/Mesh render inputs cache their already validated immutable source geometry or texture source and refresh it when a sequence selects a different `imageId`; the public two-argument render-builder API remains unchanged. Stable animation-mix, sequence-setup, Physics-state, callback-removal, and reset paths retain indexed key/ID storage instead of materializing Map/Set iterators. Transform-mode dispatch keeps the common and inherited-mode affine kernels monomorphic, while curve/blend kernels keep binary32 rounding inside their hot optimization boundary. Final Frame axis lengths and finite IK/CCD vector lengths use binary64 square-root paths; matrix-axis non-finite inputs preserve a `Math.hypot` fallback. Path subdivision tables and samples are rebuilt in retained storage, and cumulative-distance lookup is binary. Returned frames and event lists are ephemeral: a host must consume them before the next mutating player call and copy only values it needs to retain.

The intended low-churn profile is a warmed player with stable tracks, stable persistent overrides, a stable reusable modifier buffer or `beforeConstraints` hook shape, no event crossing, unchanged topology, no clipping output, no Slider resampling, and no changing mix chain. Emitted events, topology/deform-shape changes, clipping, Slider resampling, project/skin changes, convenience queries that return snapshots, explicit snapshots, and error construction are allowed low-frequency or feature-proportional allocation. The current implementation proves stable reuse of the structural frame/packet/attachment buffers, but it does **not** claim zero JavaScript allocation or zero GC: V8 still materializes temporary numeric values in binary32 animation, affine, constraint, and winding arithmetic.

## PixiJS v8 data path

The default `CanePixiRuntime` / `CanePixiBatchView` path installs a PixiJS v8.18.1 custom batcher for WebGL and WebGPU. It:

- keeps one scene-graph node per Cane instance rather than one Mesh node per attachment;
- borrows Core world-position and UV arrays and packs them directly into Pixi's shared interleaved batch buffer;
- borrows Core-generated indices using Core's weak mutation revision, while retaining a typed staging fallback for foreign packets;
- uses a 24-byte interleaved vertex layout for an all-one-color instance and a 28-byte layout when that instance contains two-color tint;
- uses Pixi's cached device capability probe for textures per draw (with a conservative eight-texture fallback) and splits on effective blend mode or instance color shader family;
- supports Runtime one-color/two-color tint, sRGB/linear texture declarations, straight/PMA source declarations, and normal/add/multiply/screen blend metadata in one shader family;
- caches inactive attachment records for skin and sequence reuse;
- reuses renderer-local batch elements with those records and releases them when the intrusive LRU expires;
- exposes logical upload and isolated draw-call estimates without allocating during `apply`.

The default `colorBatching: "instance"` policy mirrors the draw-call-friendly shape of Spine Pixi's instance-level dark-tint selection: if any active attachment needs two-color tint, all attachments in that view use the 28-byte family. `colorBatching: "attachment"` instead uses 24 bytes for individual one-color attachments, but alternating color families can create extra batch breaks. `vertexUploadBytes` reports the selected policy's logical attribute contribution, not GPU-driver traffic. `indexRepackBytes` reports CPU index repacking when structure or normalized winding changes. Renderer-wide draw calls can be lower than `isolatedDrawCalls` because adjacent compatible Cane instances may coalesce in Pixi's batchers.

`CanePixiSchedulerV1` updates many instances through one ticker callback. Its optional frame-time window measures Core advancement plus packet application/packing preparation; renderer submission and GPU time require host/browser instrumentation.
