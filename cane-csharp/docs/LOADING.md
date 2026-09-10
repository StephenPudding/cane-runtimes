# Preparing and completing external resource loading

Use `RuntimeData.FromJson` / `FromCaneb` when dimensions are already available. Use `RuntimeLoadPlan` to discover image resources before engine or asynchronous
decoding:

```csharp
RuntimeLoadPlan plan = RuntimeLoadPlan.FromJson(runtimeJson, options);
var observed = new List<DecodedTextureDimensions>();
foreach (RuntimeTextureRequest request in plan.TextureRequests) {
    // The host resolves request.Path and decodes its pixels. Missing direct
    // dimensions are nullable DeclaredWidth / DeclaredHeight, never guessed.
    // Append the actual dimensions and retain engine objects outside Core.
}
RuntimeData data = plan.CreateData(observed);
```

The plan owns the parsed input, a copy of supplied Atlas documents and immutable
requests. It validates transport, versions, features and resources during
preparation. It is not playable Runtime data: complete model and resource
validation must succeed in `CreateData` before a host publishes the asset.

Requests list every direct image in image catalog order, then all Atlas pages in
Atlas/page declaration order, including unused resources. Direct paths resolve
beside the Runtime file; Atlas page paths resolve beside the actual supplied Atlas
file. Requests preserve Core color, alpha, filter and wrap declarations. Engine
objects and file I/O remain in the host.

Completion requires one observation for every resource and rejects missing,
duplicate, undeclared, non-positive or contradictory dimensions. Existing image
declarations and any catalog supplied in the original load options must agree with
the observed pixels. Failures use operation `completeLoad`; the plan and existing
data/players remain unchanged. Omitted authored fields stay omitted. A plan can be
retried or completed repeatedly without sharing mutable playback state. CANEB load
warnings remain ordered, immutable metadata in both the plan and completed data.

Unity's `CaneAsset.LoadFiles` now decodes before completing the Core data, so it
also accepts exports with omitted direct dimensions. `CaneAsset.Load` byte
callbacks receive `RuntimeTextureRequest`; callers using an explicitly typed
`Func<RuntimeTextureResource, byte[]>` should update its parameter type. The adapter
keeps staged textures private until validation succeeds and releases them on
failure. Its stored final texture descriptors still come from completed Core data.
