# Cane C# runtime family

**English** | [简体中文](README.zh-CN.md)

This family is an independent C# implementation of Cane Runtime Format v1 and Runtime API v1.3. The Core is a `netstandard2.1` library with no engine, Rust, FFI, interpreter, or external JSON dependency. Unity integration belongs in `cane-unity` and must consume final Core render packets.

## Core and Unity integration

The Core owns loading and validation, animation tracks/queues/mixing, constraints,
Physics, skins and deform, clipping, final render packets, instance resources,
queries and transactional player state. Animation keys support zero bone scale
while setup bone and Region scales retain their format validation rules.

See [loading](docs/LOADING.md), [constraints and playback](docs/CONSTRAINTS_AND_PLAYBACK.md),
[geometry and resources](docs/GEOMETRY_AND_RESOURCES.md), and
[project replacement](docs/PROJECT_RECONCILIATION.md) for the public contracts.
[Unity installation](cane-unity/docs/INSTALLATION.md) describes the engine packages
and host setup.

## Data and ownership

[Prepared external-resource loading](docs/LOADING.md) separates immutable decode requests from completed `RuntimeData`. Hosts can decode direct images with omitted width or height, then supply the full observed catalog before publishing. Unity uses this path without guessing image sizes.

Installed resources are immutable values; a player's effective catalog is an instance overlay over `SourceData`. Unity/GPU objects cannot enter those values. Geometry callbacks execute in Core through a bounded editor; attempts to change the same player recursively fail atomically.

Feature declarations are checked against actual model usage. Resource transactions include added feature requirements, accept verified features by default, and retain original CANEB warning metadata.

## Core usage

[Capability discovery](docs/CAPABILITIES.md) exposes supported versions, the immutable feature list, API bits and the last passed Core suite digest. Known features load by default; unknown features and unsupported versions always fail:

```csharp
var data = RuntimeData.FromJson(runtimeJson, new RuntimeLoadOptions {
    AtlasJson = atlasDocumentsById
});
var player = data.CreatePlayer();
player.SetAnimation(animationId, looping: true);
player.Advance(deltaSeconds);
RenderPacket packet = player.Frame.RenderPacket;
```

The host resolves textures from packet descriptors and uploads final world XY, UVs, indices, light/dark tint and declared blend mode in packet order. It must not apply `SourceAffine` to those vertices, recalculate atlas UVs or tint, or run another constraint/deform/modifier pass. Core world coordinates are X right/Y up and UV origin is top left. Retained frames are independently owned; retained `RuntimeBounds` views expire on the next write into that same bounds object, while `Snapshot()` returns an owned result.

Bounds queries reject a binary32 width or height overflow with `NonFinite` (`aabb.width` or `aabb.height`), even when all source vertices remain finite. Such a read failure leaves the player's publication and playback unchanged. As with other failed writes, discard the contents of the supplied bounds buffer until a successful rewrite.

Players are single-writer objects. Data and published immutable frames can be shared. `Update` advances state without publishing; `Apply` publishes without advancing animation clocks. Failed evaluations preserve the prior frame, tracks, Physics history, overlay and pending events. `CloneConfiguration` starts without tracks, queues, events or solver history.

See [geometry, authoring, and resource APIs](docs/GEOMETRY_AND_RESOURCES.md) and [constraints, snapshots, and playback controls](docs/CONSTRAINTS_AND_PLAYBACK.md) for the public contracts. The NuGet package includes these guides plus project reconciliation and capability discovery.

[Published Slot queries](docs/SLOT_QUERIES.md) expose complete sampled order and owner bone poses without evaluation.

[Point and bone activity queries](docs/POINT_QUERIES.md) expose full affine and published selection/activity without adding normalized wire fields.

[Core performance and ownership](docs/PERFORMANCE.md) describes compiled skins,
private pose/rendering workspaces and immutable channel sharing. Published
frames remain independently owned; animation and resource changes can allocate.

## Building from source

See [source build instructions](../docs/BUILDING.md).
