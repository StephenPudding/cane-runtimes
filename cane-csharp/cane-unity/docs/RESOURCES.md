# Unity runtime resources

`CaneSkeleton.ApplyRuntimeResources` installs Core's ordered image, Atlas,
attachment and skin changes together with their decoded Unity resources. Use it
on the Unity main thread after `Initialize`. `ClearRuntimeResources` restores the
original resources and pixels without resetting the player's animation clocks,
queues, replay baseline or Physics history.

```csharp
var image = RuntimeImageResource.Direct(
    "outfit", "Outfit", "costumes/outfit.png", 128, 128);
var changes = new RuntimeResourceChanges().UpsertImage(image);

// Fetch/decompress bytes before this call if the host needs asynchronous I/O.
// Core retains resource declarations; Unity owns its decoded Texture2D objects.
skeleton.ApplyRuntimeResources(changes, resource =>
    resource.Kind == TextureResourceKind.Direct && resource.ImageId == "outfit"
        ? outfitPngBytes
        : null);

// Only unchanged installed overlays can reuse pixels by returning null.
skeleton.ApplyRuntimeResources(new RuntimeResourceChanges()
    .UpsertAttachment(attachment)
    .UpsertSkin(skin));
skeleton.SetSkins(new[] { skin.Id });

skeleton.ClearRuntimeResources();
```

The image must have the declared decoded dimensions. Core validates all native
definitions and cross-references; the adapter never evaluates a second pose,
reconstructs UVs, applies source affine or composes tint. Resources in one batch
may reference each other. The final ordered transaction controls acquisition, so
an earlier definition overwritten in that batch is never decoded.

## Byte resolver and complete catalogs

The resolver is a synchronous `Func<RuntimeTextureResource, byte[]>`. It receives
the final Core descriptor for every effective direct-image or Atlas-page overlay,
including resources unused by the current frame. Direct textures use `ImageId`;
Atlas pages use `(AtlasId, PageId)`. `Path`, `AtlasPath`, dimensions, color space,
alpha mode and sampling fields are Core declarations, not absolute host paths. The host chooses how to obtain bytes from files, Addressables or another store.

- Non-null bytes always decode a fresh texture, even when the stable ID, path and
  complete native definition match the installed one. This supports replacing
  pixels without changing a resource declaration.
- Null bytes, or an omitted resolver, reuse an existing overlay's texture only
  when that overlay's complete native definition is unchanged. A new or changed
  overlay with no supplied bytes fails with `MissingResource`.
- Resources outside the resulting texture overlays retain the original source
  texture. Their resolver is not called. Removing an image/Atlas overlay or
  clearing all overlays therefore restores the original pixels, even if a prior
  replacement had an identical declaration and different pixels.
- Atlas overlays include both the reference and full native Atlas JSON. Supply
  bytes for every page of a new or changed Atlas. Attachment/skin changes that
  still refer to an original Atlas reuse that Atlas's existing pages.

`skeleton.QueryTextureResources()` returns Core's immutable full effective
catalog, including unused direct images and Atlas pages. Use
`skeleton.Player.QueryRuntimeResources()` for independently owned installed native
definitions. Retaining either query cannot change the player or its texture cache.

## Commit, failure and ownership

Core creates one candidate frame and calls the adapter before committing it. Unity resolves all textures, verifies the full observed dimensions in Core, and
prepares a separate mesh/material projection. Only after those stages succeed
does it replace the component's current asset/projection and deliver one frame
notification. Refreshing or rendering that frame does not evaluate or upload it
again. Incremental events are drained once; replay events remain separate.

A validation, decode, resolver or GPU preparation exception rejects the
transaction and releases the temporary resources. The previous frame, resource
catalog, textures, projection, playback and pending events remain installed. Same-player/component mutation from a resolver is rejected. Exceptions from
`FramePublished` or `AnimationEvent` handlers occur after successful publication
and do not roll it back; handlers should schedule further mutations after the
current call returns. File/directory-not-found errors become `MissingResource`;
other unexpected provider exceptions become Core's `Internal` error.

Each decoded texture has its own reference count. Skeletons hold a current asset
lease and an original source lease; sharing unchanged textures adds individual
texture references rather than retaining all intermediate assets. Closing the
public `CaneAsset` handle after initialization does not release resources still
used by its skeletons. Disposing a public handle is final for new initialization;
existing skeletons can still replace and clear their resources.

Disabling a component releases its GPU projection and retains player/texture
state. Resource changes while disabled still acquire and validate textures, but
defer mesh/material creation until render after re-enable. Destruction releases
both asset leases. Unity object destruction is immediate outside Play mode and
uses Unity's deferred destruction during Play mode. Do not externally destroy
textures owned by the asset.

Use these component operations for resource changes. Calling resource mutation
directly on `Player` or through general `Mutate` bypasses engine acquisition. Direct Core project replacement also needs a matching `CaneAsset` integration;
resource transactions reject a source-data mismatch and require `Initialize`
with that asset. Use [project reconciliation](PROJECT_RECONCILIATION.md)
for live project replacement with preserved compatible state.

`LastCoreMicroseconds`, `LastResourceMicroseconds` and `LastUploadMicroseconds`
separate candidate evaluation, resource acquisition/validation and projection
preparation for a successful transaction. `Projection.PacketUploads` accumulates
across replacements while a projection remains active; disabling releases that
projection, and a new one starts a fresh upload count.
