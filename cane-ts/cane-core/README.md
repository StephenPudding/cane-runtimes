# @cane-runtime/core

**English** | [简体中文](README.zh-CN.md)

Pure, renderer-neutral Cane Runtime Core written in TypeScript and consumable by JavaScript and TypeScript hosts.

The current `0.1.0` source implements the Cane Runtime API 1.3 surface. It contains strict Runtime JSON/CANEB/Atlas loading, animation state and sampling, final Region/Mesh/clipped geometry, skins, sequences, all five constraint families, persistent host overrides, transient per-frame pose modifiers, inverse authoring queries, project reconciliation, instance-local dynamic resources, retained Bounds, Physics host motion, Core-owned final-geometry modifiers, and strict or reusable frame publication.

`runtimeCapabilitiesV1()` advertises Runtime API minor 3 and feature bits 38–41. Known supported features do not require `allowUnverifiedFeatures`; unknown required features are rejected. The capability query also exposes the Core reference-suite identity separately from renderer capabilities.

The public flow is:

```ts
const data = RuntimeDataV1.fromJson(json, {
  atlases,
});
const player = data.createPlayer({ executionMode: "performance" });
player.setAnimation({ trackIndex: 0, animationId: "idle", looping: true });
const frame = player.advance(1 / 60);
```

`frame.renderPacket` contains final world geometry and final tint. A host must never apply `sourceAffine` to those vertices again.

Skin attachment lookup treats the first declared Skin as the default fallback. When a non-empty selected Skin stack omits it, Core evaluates that default immediately before the selected stack without adding it to `activeSkinIds`/`sampledSkinIds` or Skin-member activation. An empty stack remains the explicit skinless/setup-only state. Path constraints retain authored bone-list sampling order but commit final driven worlds parent-first, so child-first chains cannot be overwritten by later ancestor propagation.

`strict` is the default and publishes independently owned, deeply frozen DTOs. `performance` is for a trusted synchronous renderer: it caches grouped animation keys, uses binary key/path-distance lookup, and reuses animation-layer/event storage, sampling state, deform interpolation arrays, persistent override storage, Bone matrices, IK/Transform/Path/Physics workspaces, render inputs, attachments, frames, and packets. Core-generated normalized index arrays carry a weak, non-DTO mutation revision so TypeScript adapters can skip a duplicate per-frame index scan. Returned performance DTOs are ephemeral and may change on the next mutating call. Emitted events, mixing chains, clipping, deform-shape changes, Slider resampling, topology changes, convenience queries, explicit snapshots, and errors remain feature-proportional allocation paths; see [../../docs/PERFORMANCE.md](../../docs/PERFORMANCE.md).

Important API groups:

- `RuntimeDataV1.fromJson(...)` / `fromCaneb(...)`, the frozen `catalog`, `validateDecodedTextureCatalog(...)` and the split-list `validateDecodedTextureSizes(...)`;
- track, queue, mix, range, empty-animation, update/apply/advance/seek and event operations;
- ordered transient Bone replace/patch/additive and constraint changes between animation sampling and the single constraint solve;
- persistent overrides, `beforeConstraints`/`afterConstraints`, stable Bone/Slot/Constraint handles, and typed lifecycle/user event listeners;
- `RuntimeSkinBuilderV1`, `RuntimeAttachmentFactoryV1`, `RuntimeResourceTransactionV1`, instance isolation and full transaction rollback;
- retained `RuntimeBoundsV1` AABB/polygon/point/segment/bounds queries over the current final pose;
- root `move`/`teleport`/`preserveInertia`/`clearInertia` policies and all/per-constraint Physics reset;
- ordered persistent/transient deterministic or custom final-geometry modifiers with topology validation and write statistics;
- pose, geometry, sequence, path, Physics and Transform Match queries;
- atomic authoring overrides and inverse vertex/weight/deform helpers;
- `replaceProject(...)`, `reconcileProject(...)`, `cloneConfiguration()` and immutable frame snapshots.

`advance(...)` is the JavaScript convenience API and returns the newly published frame. `advanceWithSampling(...)` returns a `RuntimeStepV1` compatible with the reference Runtime API shape; read its published frame from `player.frame`.

See [Runtime API 1.2 migration](../../docs/MIGRATION_RUNTIME_API_1_2.md) for pose-control and Spine-style facade changes, [Runtime API 1.3 migration](../../docs/MIGRATION_RUNTIME_API_1_3.md) for shared SDK additions, and [compatibility policy](../../docs/COMPATIBILITY.md) for version guarantees.

## Building from source

See [source build instructions](../../docs/BUILDING.md).
