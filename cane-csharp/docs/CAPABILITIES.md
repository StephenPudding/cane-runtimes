# Core capabilities and default loading

```csharp
RuntimeCapabilities info = RuntimeCapabilities.Current;
bool acceptsApi = info.RuntimeApi.Contains(1, 3);
bool acceptsDeform = info.SupportsRuntimeFeature("mesh.deform");

RuntimeData data = RuntimeData.FromJson(runtimeJson, new RuntimeLoadOptions {
    AtlasJson = atlasDocumentsById
});
```

`RuntimeCapabilities.Current` is immutable. Its version ranges, read-only feature
list, API feature bits and `LastPassedConformance` describe this independent Core. Querying them does not load files, create an instance or use Unity.

`ImplementationVersion` identifies the Core package version. The Core behavior
checks compare it with the UPM manifest and the compiled NuGet assembly's
informational version. Unity packaging also rejects mismatched Core/Unity
manifests, dependency versions and runtime metadata before creating archives.

Runtime JSON, CANEB and Atlas accept version 1.0. Runtime API accepts 1.0 through
1.3, inclusive. The 22 sorted Runtime document feature names are the same list
used by validation. `ApiFeatureBits` contains bits 0 through 41 of the separate
Runtime API contract and leaves unknown bits zero. Geometry and sampled channels
use binary32; exact event integers and clock arithmetic retain their separately
specified types.

Known features load by default. `AllowUnverifiedFeatures` remains available for
source compatibility and has no effect. Neither value bypasses unknown required
features, missing declarations, unsupported versions or resource validation. Instance resource overlays follow the same rules and preserve immutable source
catalogs. Atlas documents and decoded texture observations remain host inputs
where the resource contract requires them.

`LastPassedConformance` identifies the Suite 1.8.0 manifest and all 95 complete
Core outcomes, passed twice from fresh state in each of two candidate processes. Current source, binary and package hashes are checked separately by the build. This metadata does not certify Unity rendering, performance or the complete SDK.
