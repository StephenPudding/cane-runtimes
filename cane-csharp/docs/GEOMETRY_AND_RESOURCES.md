# Geometry, authoring, and resource APIs

`ApplyRuntimeResources(changes, validate)` and `ClearRuntimeResources(validate)`
accept an optional synchronous `Action<RuntimeData, RuntimeFrame,
RuntimeResourceSnapshot>`. It sees the immutable candidate before commit, allowing
a host to acquire textures, validate decoded dimensions and prepare rendering. Throwing rejects the whole transaction, including clocks, Physics, pending events
and resource state. The callback runs once without another evaluation; reentrant
mutation/clone of the source player is rejected. Returned data/frame/snapshot
objects may be retained. Host handles stay outside Core and must be released by
the host when preparation fails. Commit staged host handles only after success.

`RenderAttachment.SourceZIndex` is `long`, preserving authored signed 64-bit Slot
order without truncation or floating-point conversion. Packet `DrawIndex`
remains the dense rendering index. Adapters follow the final packet order.

These APIs operate on independent `Cane.Core` data. Engine adapters consume the final `Frame.RenderPacket`; they do not compute a second animation, constraint, weighting, deformation, atlas, or clipping result.

## Published pose and source geometry

`QueryBoneLocal`, `QueryBoneTransformMode`, and `QueryBoneLocalState` return exact sampled channels and inheritance, not decompositions of world matrices. `QueryRegionAttachmentPose` returns Region local channels. `QueryRootTransform` preserves the supplied signed scales and complete rotation value. `QuerySequenceIndex` returns the canonical index for a sequence attachment.

`QueryVertexAttachmentSourceGeometry(attachmentId, space)` supports Mesh, Path, BoundingBox, and Clipping attachments. Its owned result contains:

| Property | Meaning |
| --- | --- |
| `AttachmentId` | Requested attachment |
| `SourceAttachmentId` | Resolved linked-Mesh geometry source |
| `DeformAttachmentId` | Resolved linked-Mesh deform owner |
| `SetupVerticesXy` | Immutable local source positions |
| `SetupWorldVerticesXy` | Source positions through the current solved bones and weights, without vertex deform |
| `SampledVerticesXy` | Logical source positions after current deformation |
| `WorldVerticesXy` | Current solved source vertices with deformation |
| `DeformValues` | Complete current buffer in the requested `VertexDeformSpace` |
| `FullyWeighted` | Whether every source vertex has weight influences |

Every position array uses stable source order. These are independent of render topology, which may change under clipping or atlas trimming. Weighted influence offsets contain one XY pair per influence in source vertex/influence order. Logical positions contain one XY pair per source vertex; projecting arbitrary distinct influence offsets into logical positions can lose information. Use `WeightedInfluenceOffsets` when preserving those independent offsets is required.

All queries read the already-published pose. After `Update`, they continue to describe the old frame until `Apply` publishes the updated pose. Queries do not advance or resample animation, publish a frame, consume events, or change Physics history. Returned arrays are read-only and remain valid after later player changes.

## Inverse edits

Core owns the inverse conversion. A host supplies its desired point in Core world coordinates:

```csharp
VertexDeform patch = player.VertexAttachmentDeformForWorldTarget(
    attachmentId, sourceVertexIndex, targetWorld,
    VertexDeformSpace.WeightedInfluenceOffsets);

player.SetAuthoringOverrides(new RuntimeAuthoringOverrides()
    .SetVertexDeform(patch.AttachmentId, patch.Space, patch.Values));
```

Omitting `currentDeform` starts from the published player deform. Supplying that argument provides a complete explicit buffer. The result changes only the addressed logical XY pair or complete influence slice and preserves other entries. The inverse query itself does not install the patch.

Additional operations are:

- `TranslateWeightedMeshDeform`: solves every current world vertex of a fully weighted Mesh after applying one world-space delta, in either deform space.
- `VertexAttachmentWeightLocalPositionsForWorldTarget`: returns one bone-local target for each influence of an addressed weighted source vertex, in influence order.
- `VertexAttachmentWeightedDeformOffsetsAfterPositionEdit`: applies a complete logical position edit while preserving existing distinct influence offsets.

Unknown IDs, unsupported attachment kinds, invalid indices or buffer shapes, singular transforms, and non-finite values produce structured `RuntimeException` failures. No failed query changes the player. In accordance with Geometry and Render Algorithms section 13, finite non-zero inverse determinants are accepted even below binary32 epsilon; a non-finite result still fails. Inverse queries use division directly rather than constructing a potentially overflowing reciprocal.

## Atomic authoring batches

`RuntimeAuthoringOverrides` is an ordered builder with set/clear operations for bone locals, Region poses, complete draw order, vertex deform, slot attachment, slot tint, and typed constraint parameters. Input buffers and constraint parameter documents are copied. Duplicate targets use the last staged operation. Inherited linked meshes write and clear their resolved deform owner.

```csharp
var edits = new RuntimeAuthoringOverrides()
    .SetBoneLocal(boneId, boneLocal)
    .SetRegionPose(regionId, regionLocal)
    .SetSlotAttachment(slotId, null); // Persistently hide this slot.

player.SetAuthoringOverridesWithSampling(
    edits, new SamplingOptions(stepped: true, framesPerSecond: 30));
```

`ClearSlotAttachment` resumes normal animation/skin selection. `SetSlotAttachment` with null hides it. Draw order must contain every slot exactly once. Deform overrides are complete buffers, not sparse patches.

`SetAuthoringOverrides` uses authored interpolation. `SetAuthoringOverridesWithSampling` preserves the requested authored, stepped, fixed-frame, or fixed-frame-stepped mode for that publication. A successful batch samples and solves once and publishes exactly one frame. Sampling validation, every edit, the solve, and final-geometry callbacks must all succeed before committing. Failure preserves configuration, frame sequence, clocks, Physics state, and pending notifications.

## Catalogs and external texture validation

`RuntimeData.QueryCatalog()` exposes native format/API versions, generator, skeleton metadata, required features, warnings, and all eleven declaration-ordered catalogs. Entries expose stable ID, name, optional kind, and `ToJson()` for the complete native definition. This is immutable metadata; it is not a replacement evaluator. A player's effective `Data` catalog includes its instance-local resource overlay, while `SourceData` and previously retained catalogs remain unchanged.

`Warnings` and the catalog's warning list preserve accepted unknown optional CANEB sections in section-table order, including through resource replacement, configuration cloning and restoration of shared resources. Warning code, operation, and section tag are stable. Warnings are never inserted into the native model or serialized resource definitions.

Loading validates that every used attachment, weight/deform, constraint, tint, blend, skin, event and timeline feature is declared in `requiredFeatures`. `AllowUnverifiedFeatures` is retained for source compatibility and has no effect; verified features load by default and unknown features always fail. Resource transactions union the source declarations with features used by the effective resource document. Removing overlay-only resources removes their additional feature requirements. Retained source and effective catalogs keep their own immutable declarations, and resource operations use the same supported-feature validation as initial loading.

`QueryTextureResources()` returns direct images once each and every atlas page once each, including pages unused by the current frame. Descriptors contain dimensions, path, color space, alpha mode, pixel format, min/mag filters, UV wrapping, and atlas identity/reference path where applicable. Resolve paths according to the exported asset layout; do not key resources by basename alone. Atlas samplers preserve the declared settings; direct images use linear filtering and clamp wrapping.

After decoding resources, supply the complete set to `ValidateDecodedTextureCatalog` before installing GPU resources:

```csharp
var decoded = new List<DecodedTextureDimensions>();
// The host decodes files using descriptors from data.QueryTextureResources().
// Add Direct(imageId, width, height) or AtlasPage(atlasId, pageId, width, height).
data.ValidateDecodedTextureCatalog(decoded);
```

The catalog validator rejects missing, duplicate, undeclared, non-positive, and mismatched dimensions. It performs no I/O and retains no engine object. These checks supplement the renderer's complete packet/binding validation.

If exported direct-image metadata omits width or height, pass the host's complete decoded resource facts while loading JSON or CANEB:

```csharp
var data = RuntimeData.FromJson(runtimeJson, new RuntimeLoadOptions {
    AtlasJson = atlasDocuments,
    DecodedTextures = decodedDimensions
});
```

`DecodedTextures` must include every direct image and atlas page once. Declared dimensions must match; omitted direct dimensions are resolved from those facts. The input list is copied and the authored catalog is preserved, including omitted fields. Without decoded facts, direct dimensions must be declared. Resource overlays and configuration clones retain resolved dimensions for the same image/path; changing the path cannot reuse those old facts. An overlay with explicit new dimensions still requires host-side decoded validation before GPU installation.
