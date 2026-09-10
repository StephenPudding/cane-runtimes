# Cane Unity runtime

**English** | [简体中文](README.zh-CN.md)

Unity resources and final-packet rendering over the independent C# Core. The
source targets Unity 6000.3+ on Windows, with Built-in, URP and HDRP integrations. See [installation](docs/INSTALLATION.md) and [render pipelines](docs/RENDER_PIPELINES.md).

[Live project replacement](docs/PROJECT_RECONCILIATION.md) prepares candidate textures, final-packet projection and complete Slot order before committing compatible Core state.

[Bone and Point followers](docs/FOLLOWERS.md) project complete published affines through Content transforms, including shear, reflection and zero-scale bones. [Slot content](docs/SLOT_CONTENT.md) follows full published Slot order and inserts external Mesh/Sprite renderers between complete attachments.

Install both local packages, `cane-core` and `cane-unity`, through Package Manager. Set the project color space to **Linear**. The source Core is `netstandard2.1` /
C# 9 and has no Unity or other engine dependency. `Cane.Unity` references only
Core's public API and Unity's resource/rendering APIs.

```csharp
using Cane.Unity;
using System.Collections.Generic;

// File I/O belongs to the adapter. Atlas IDs, rather than filenames, key this map.
using var asset = CaneAsset.LoadFiles(runtimePath,
    new Dictionary<string, string> { [atlasId] = atlasPath });
var skeleton = gameObject.AddComponent<CaneSkeleton>();
skeleton.Initialize(asset); // Retains its own lease; the caller can dispose its asset handle.
skeleton.Play("run");
Camera.main.gameObject.AddComponent<CaneCameraRenderer>();
```

`CaneAsset.Load` also accepts runtime/atlas documents and a host byte resolver,
which can use asset bundles, Addressables, StreamingAssets or another resource
provider. It loads PNG/JPEG through Unity, checks decoded dimensions in Core, and
stores raw texture values without an implicit sRGB conversion. The Core
[load plan](../docs/LOADING.md) lists resources before decoding, so omitted direct
image dimensions are resolved automatically from pixels. Byte callbacks receive
`RuntimeTextureRequest`; final descriptors come from completed `RuntimeData`. Declared dimensions and any explicitly supplied decoded catalog must agree with
the observed textures. Validation completes before the asset is published, and
failed loads release all staged textures. Core owns parsing, complete pose evaluation, constraints, clipping, UVs, tint,
animation events, final geometry and draw order.

`CaneSkeleton.LateUpdate` advances its player once. `Play`, `Queue`, skin and
attachment setters project Core's already-published frame without another Apply. Use `Mutate` for other public Core operations; `Player` exposes the complete Core
object for custom scheduling. Resource changes must use the component's
`ApplyRuntimeResources` / `ClearRuntimeResources` methods so Core and decoded
Unity assets commit together; see [runtime resources](docs/RESOURCES.md). `RefreshRender` uploads only a changed publication. `SampleAt` returns replay events separately from incremental `AnimationEvent`
notifications. Retained Core frames remain owned values. Disable releases GPU
projection resources while preserving playback; destruction releases the asset
leases. Runtime resource transactions keep a separate original-source lease and
share unchanged textures individually, so repeated swaps do not retain obsolete
asset chains. Bone matrices preserve the full affine, including reflection and shear.

The built-in camera component records all visible Cane skeletons after Unity's
ordinary transparent pass, ordered by their sorting layer, sorting order and
instance identity, and preserves every Core packet's internal order. It does not
interleave other Unity transparent renderers into that pass. `CaneSkeleton.Record`
and `CaneMeshProjection.Record` provide explicit command-buffer integration for a
host-selected target/pass. Slot content is interleaved within a skeleton's complete
packet order. The optional URP/HDRP integrations use the same recorder; see the
render-pipeline guide for camera setup, pass ordering and supported APIs.

The shader submits linear premultiplied output. Normal, Add, Multiply and Screen
use distinct hardware RGB/alpha blend factors, including correct alpha and
self-overlapping triangles. Source sRGB decode occurs before interpolation;
premultiplied source textures are unpremultiplied once before applying final
one/two-color tint. Final world XY is unchanged (Unity and Core are Y-up), and
only texture sampling flips Core's top-left UV convention to Unity's bottom-left
decoded storage. No source affine, constraints or clipping are applied again.

## Building from source

See [source build instructions](../../docs/BUILDING.md).
