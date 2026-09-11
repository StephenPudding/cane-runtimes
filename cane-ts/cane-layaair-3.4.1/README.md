# @cane-runtime/layaair-3.4.1

**English** | [简体中文](README.zh-CN.md)

Production-oriented Cane Runtime adapter for exactly LayaAir 3.4.1. It renders the final
`@cane-runtime/core` frame through LayaAir's WebGL/WebGPU `Mesh2D` paths and exposes Spine-style character
control without duplicating animation, constraints, Physics, clipping, tint, or attachment
geometry in the adapter.

The package is private and `UNLICENSED`; it is not published to npm. `layaair` is an exact
`3.4.1` peer and is never bundled. The public npm package with that name does not distribute
3.4.1, so use the official LayaAir 3.4.1 SDK/IDE engine. Development is pinned to official commit
`f368b43098fe6bde7b961546114e71907c5f8a98`.

## Engine prerequisites

For the IDE, use the prebuilt `.layapkg` and saved Cane Bot project from
[Releases](https://github.com/StephenPudding/cane-runtimes/releases).
The [IDE guide](docs/EDITOR_WORKFLOW.md) covers resource import, scene drag/drop,
Inspector settings, preview, dependency recovery and game builds. No MCP or
manual Runtime compilation is required.

1. Load the official `laya.core.js`, then select one exact 3.4.1 driver:
   - WebGL: load `laya.webgl_2D.js`.
   - WebGPU: load `shader_compiler_web.js`, `nagabind.js`, then `laya.webgpu_2D.js`; keep
     `shader_compiler_web.wasm` and `nagabind_bg.wasm` beside their loader scripts.
2. Call and await `Laya.init(...)` before constructing `CaneLayaRuntime` or GPU resources.
3. Use WebGL or WebGPU. Native/modern API, NoRender, and unknown backends return a
   structured `unsupportedBackend` error instead of pretending to be equivalent.

## Minimal ESM use

```ts
import {
  CaneLayaRuntime,
  CaneLayaSchedulerV1,
  loadCaneLayaAssetV1,
} from "@cane-runtime/layaair-3.4.1";

await Laya.init(1280, 720);

const canvas = document.querySelector("canvas");
const asset = await loadCaneLayaAssetV1("/characters/spineboy.caneb", {
  ...(canvas instanceof EventTarget ? { contextTarget: canvas } : {}),
});
const player = asset.data.createPlayer({ executionMode: "performance" });
const character = new CaneLayaRuntime({
  player,
  textures: asset.textures,
  autoUpdate: false,
  validationMode: "once",
});

character.setAnimation(0, "idle", true);
Laya.stage.addChild(character);

const scheduler = new CaneLayaSchedulerV1();
scheduler.add(character); // one Laya.Timer listener can update many characters

// Teardown order: stop scheduling/rendering before releasing shared resources.
scheduler.remove(character);
character.destroy(false);
await asset.destroy();
```

Use `executionMode: "strict"` when retained immutable frame DTOs and maximum validation are more
important. Performance mode reuses ephemeral Core frame storage; consume it synchronously and copy
anything that must survive the next write. Both modes retain transactional failure rollback.

## What is implemented

- Runtime JSON and CANEB loading, inline/URL Atlas documents, direct images, Atlas pages, relative
  URLs, host resolvers and a `Laya.Loader` resolver;
- concurrent shared leases, reference counting, dimension validation, transactional rollback,
  unload and deterministic destruction;
- Region, Mesh, Weighted Mesh, Deform, Linked Mesh, Sequence, draw order, visibility and Core
  clipping;
- light/dark tint, alpha, straight/PMA metadata, sRGB/linear metadata, and normal/additive/
  multiply/screen material states;
- one retained `Mesh2D`/`Shader3D` projection for WebGL and WebGPU, explicit
  upload/draw/batch/clipping/follower statistics, and no node per attachment;
- official-Spine-style four-byte alignment for odd Uint16 WebGPU uploads without changing the
  logical draw count or allocating on stable frames;
- transient/persistent Bone and constraint control, tracks and mixing, skin/attachment switching,
  dynamic Image/Atlas/Attachment/Skin resources, Physics host motion and final geometry modifiers;
- typed lifecycle/authored-event listeners, Bounds and draw-order hit tests;
- full-affine Bone followers and draw-order-aware Slot objects before/after an attachment, including
  attachment visibility, Slot alpha and inherited clipping;
- manual update, per-instance automatic update, or one `CaneLayaSchedulerV1` for many instances.

The adapter consumes one published Core frame. It never samples animation or solves constraints on
its own. `lastApplyStats` exposes both adapter work and Core's
`animationSamples / constraintGeometrySolves / framesPublished` counters.

## Coordinates and followers

Cane is X-right/Y-up; Laya is X-right/Y-down. The adapter applies the reflection exactly once at
the GPU/mount boundary and reverses triangle winding once. Bone and Slot mounts preserve arbitrary
affine columns, including two-axis shear, reflection and negative scale; they do not use LayaAir
3.4.1's lossy `Sprite.transform = Matrix` decomposition.

- `getBonePosition` returns the Bone origin in this Runtime's Laya-local coordinates.
- `boneToGlobal` accepts a Cane Bone-local point and returns a Laya global point.
- `globalToBone` accepts a Laya global point and returns a Cane Bone-local point.
- `addBoneObject` follows the final Core Bone matrix without another solve.
- `addSlotObject` inserts a foreign `Laya.Sprite` into attachment draw order. Use
  `setAttachment(slot, null)` to hide an attachment; `clearAttachment(slot)` removes the host
  override and returns control to setup/animation state.

## Browser bundle

Prebuilt releases contain both `dist/esm/cane-layaair-3.4.1.js` and
`dist/iife/cane-layaair-3.4.1.min.js`, plus matching Core/adapter npm tarballs and
TypeScript declarations. The separate editor `.layapkg` adds JSON/CANEB import,
the serializable Cane Skeleton component and Inspector preview.

The ESM file is self-contained except for the official LayaAir engine. Load the
engine first, then import this file directly, or use the package's
`@cane-runtime/layaair-3.4.1/browser` entry. It exports the adapter API and the
`Core` namespace without browser import maps or a separate Core download.

`dist/iife/cane-layaair-3.4.1.min.js` embeds Cane Core plus this adapter, but not LayaAir. Load the
exact engine first; the bundle then exports `globalThis.CaneLaya`, with Core available as
`CaneLaya.Core`. Missing Laya produces an immediate descriptive error.

For an npm-based consuming project, install both supplied tarballs together:

```sh
npm install ./cane-runtime-core-0.1.0.tgz ./cane-runtime-layaair-3.4.1-0.1.0.tgz
```

No Runtime compilation is needed. The optional npm peer prevents the installer
from downloading an unrelated engine package; the official 3.4.1 engine must
still be supplied by the host/IDE. Use the engine SDK's declarations for `Laya`.

## Renderer loss

The Runtime then sets `renderContextLost`, and GPU projection is
suspended while Core may continue advancing once per frame. Official LayaAir 3.4.1 does not
recreate all engine-owned WebGL resources or a lost WebGPU device in place. While the old engine
remains active, Cane returns structured `contextRestoreFailed` data. The safe recovery is to
recreate the Laya engine/runtime realm (normally a page or game-view reload); no false in-place
success is reported.

## Building from source

See [source build instructions](../../docs/BUILDING.md).
