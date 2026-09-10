# @cane-runtime/pixi-v8

**English** | [简体中文](README.zh-CN.md)

High-performance PixiJS v8.18.1 adapter over `@cane-runtime/core`. It never samples animation or reapplies attachment transforms: Core supplies final world vertices, UVs, triangle order, tint and blend metadata.

Use the WebGL or WebGPU backend for the complete shader color path. Canvas2D has explicit tint and compositing limits; see the [renderer capability matrix](../../docs/COMPATIBILITY.md).

## Default batch path

`CanePixiRuntime` extends Pixi's `Container` and composes one or more internal `CanePixiBatchView` segments around Slot objects. It is the production-oriented path. Import this package before `Application.init(...)` so its `cane-v1` WebGL/WebGPU render pipe and batcher are registered before Pixi creates the renderer.

The path provides:

- one Pixi scene node per Cane instance;
- persistent attachment records; Core-generated indices are borrowed through a weak mutation revision, while foreign packets use retained typed staging;
- renderer-local batch elements retained by attachment record, so cached skin/sequence attachments are reused instead of reconstructed on every switch;
- direct borrowing of Core position and UV arrays, with the single Y-axis conversion performed while Pixi packs its shared Buffer;
- a 24-byte all-one-color layout, a 28-byte two-color-capable layout, and a device-derived texture count per batch with an eight-texture fallback;
- cross-instance batching when texture capacity, blend state and render order permit;
- one-color and two-color tint in linear-light math;
- sRGB/linear and straight/premultiplied source declarations;
- `normal`, exact-alpha `add-npm`, `multiply`, and `screen` Pixi blend mapping;
- validation policies `once` (default), `always`, and `none`;
- logical Buffer-upload, topology-repack and isolated draw-call counters.
- renderer pipeline priming that keeps Pixi WebGPU's first custom geometry binding distinct from
  the built-in batch geometry cache;
- an official Pixi Canvas pipe that preserves Core geometry/UV/alpha/clipping while explicitly
  declining shader-only light/dark and linear-light parity.

```ts
import { Application, Assets } from "pixi.js";
import { RuntimeDataV1 } from "@cane-runtime/core";
import {
  CanePixiRuntime,
  CanePixiAssetV1,
  CanePixiSchedulerV1,
  PixiTextureStore,
} from "@cane-runtime/pixi-v8";

// Package import above registers the render pipe before renderer creation.
const app = new Application();
await app.init({ canvas, preference: "webgpu" });

const data = RuntimeDataV1.fromJson(runtimeJson, {
  atlases: atlasDocuments,
});
const player = data.createPlayer({ executionMode: "performance" });
player.setAnimation({ trackIndex: 0, animationId: "idle", looping: true });

// caneBatch is the default and preserves source bytes for the Cane shader.
const textures = new PixiTextureStore({
  baseUrl: "/assets/",
  pipeline: "caneBatch",
});
await textures.preloadData(data);

const character = new CanePixiRuntime({
  player,
  textures,
  autoUpdate: false,
  validationMode: "once",
});
app.stage.addChild(character);

// One listener and deterministic iteration order for all Cane instances.
const scheduler = new CanePixiSchedulerV1({
  ticker: app.ticker,
  measureFrameTime: true,
});
scheduler.add(character);
```

For one-call asset ownership, the package registers CANEB and Runtime JSON with
`PIXI.Assets` at import time:

```ts
const asset = await Assets.load<CanePixiAssetV1>({
  alias: "hero",
  src: "/assets/hero.caneb",
});
const player = asset.data.createPlayer({ executionMode: "performance" });
const character = new CanePixiRuntime({ player, textures: asset.textures });
// Later: await Assets.unload("hero");
```

## Optional classic-browser bundle

`pnpm run build` also emits `dist/iife/cane-pixi-v8.min.js`. It embeds the complete
`@cane-runtime/core` implementation and the Pixi adapter, but deliberately keeps PixiJS external. Load the matching PixiJS global first; the bundle then installs its Assets and renderer extensions
and exposes `globalThis.CanePixi`. The embedded renderer-neutral API is available as
`CanePixi.Core`.

```html
<script src="/vendor/pixi.min.js"></script>
<script src="/vendor/cane-pixi-v8.min.js"></script>
<script>
  (async () => {
    const app = new PIXI.Application();
    await app.init({ resizeTo: window, preference: "webgl" });
    document.body.appendChild(app.canvas);

    const asset = await PIXI.Assets.load({
      alias: "hero",
      src: "/assets/hero.caneb",
    });
    const player = asset.data.createPlayer({ executionMode: "performance" });
    const hero = new CanePixi.CanePixiRuntime({
      player,
      textures: asset.textures,
    });
    app.stage.addChild(hero);
    hero.setAnimation(0, "idle", true, 0.2);
  })();
</script>
```

The bundle throws a clear startup error when `globalThis.PIXI` is absent. Package metadata points
the `unpkg` and `jsdelivr` fields at this file, while normal npm imports continue to use the
tree-shakeable ESM entry.

Do not negate `character.scale.y`; world Y is converted exactly once by the batcher. A `performance` player publishes ephemeral reused DTOs, so consume a frame immediately and copy only values that must survive the next update.

## Texture and color contract

`PixiTextureStore` has two deliberately incompatible pipelines:

- `caneBatch` is the default. It preserves decoded source bytes and lets the Cane shader interpret Runtime `colorSpace` and `alphaMode`, then emits the representation required by Pixi's blend state.
- `pixiBasic` is only for the legacy `CanePixiView` plus `BasicPixiMeshFactory`. Pixi premultiplies straight-alpha images on upload for its built-in Mesh shader.

A store is rejected if it is paired with the wrong view. Registered or cached textures are also checked for the expected Pixi source alpha mode, preventing the same URL from silently crossing pipelines with incompatible upload semantics.

`preloadData(data)` loads direct images and every Atlas page, applies declared filter/wrap state, and validates decoded dimensions before rendering. `preload(packet)` is available when a host intentionally loads only currently visible resources.

Stores share `PIXI.Assets` leases across instances and unload only after the final owner releases. Partial loads roll back and can be retried. External texture registrations remain host-owned unless
`ownership: "store"` is explicit. `bindRendererContextLifecycle(renderer)` handles WebGL
lost/restored events or WebGPU `device.lost`; retained sources upload lazily after renderer/device
replacement.

## Bone, Slot, clipping, Bounds, and diagnostics

`addBoneObject` follows a final Bone matrix with the complete affine transform. `addSlotObject` inserts one or more foreign Pixi objects immediately before or after a Slot's
current attachment while preserving Cane draw order and exposing the required batch split. Options
control attachment-timeline visibility, an allow-list of visible attachments, inherited Slot alpha,
and Core-authored clipping. `getSlotObject`, `querySlotObject`, `writeSlotObjects`,
`removeSlotObject`, and `removeSlotObjects` provide lookup and lifecycle without exposing internal
mounts.

`getBonePosition`, `boneToGlobal`, and `globalToBone` perform the single Cane Y-up/Pixi Y-down
conversion and preserve shear, reflection, negative scale, and arbitrary Pixi parent transforms. `runtime.bounds` wraps retained Core bounds with local/global AABB, point, and segment helpers; it
never advances Core. `CanePixiDebugViewV1` optionally draws Bones, Bounding Boxes, clipping,
draw-order labels, batch segments, and evaluation/CPU/upload statistics.

Dynamic Skin/Attachment/Image/Atlas transactions, root Physics modes, and final-geometry modifiers
are forwarded to the same Core controller. The adapter reprojects the returned frame but never
performs another sample, constraint solve, clip, or geometry modification.

## Multi-instance and instrumentation

Use `CanePixiSchedulerV1` with runtimes created using `autoUpdate: false`. `scheduler.stats()` returns a cold-path aggregate of active geometry, logical vertex bytes, index repack bytes, and isolated draw estimates. `scheduler.frameTimes.snapshot()` allocates only when a report is requested; recording uses a fixed-capacity typed ring.

`isolatedDrawCalls` is a deterministic estimate for one Cane view. The default `colorBatching: "instance"` policy selects the 28-byte family for the whole view whenever any active attachment needs two-color tint, avoiding intra-character color-family breaks and matching Spine Pixi's instance-level dark-tint strategy. `colorBatching: "attachment"` minimizes individual vertex size but can split alternating one/two-color attachments. Pixi may merge adjacent compatible views, so renderer-wide counters are the authority. `vertexUploadBytes` reports the chosen 24/28-byte logical contribution; it is not a driver-level transfer counter.

Inactive attachment records and their renderer-local batch elements share the same frame-retained lifetime. Returning to a cached skin or sequence page reuses both objects; the intrusive LRU expires old records without scanning the complete cache on every frame.

## Legacy Mesh compatibility path

`CanePixiView` retains one Pixi `Mesh` per attachment for debugging or custom factory integration. The built-in `BasicPixiMeshFactory` accepts only one-color, sRGB, straight-alpha Runtime packets and requires `new PixiTextureStore({ pipeline: "pixiBasic" })`. It does not provide the strict Cane material envelope and does not share the batch path's scene-node or draw-call profile.

See [Runtime API 1.2 migration](../../docs/MIGRATION_RUNTIME_API_1_2.md) for the original game-control API, [Runtime API 1.3 migration](../../docs/MIGRATION_RUNTIME_API_1_3.md) for dynamic resources/Bounds/Physics/final geometry, [compatibility policy](../../docs/COMPATIBILITY.md) for backend limits, and [../../docs/PERFORMANCE.md](../../docs/PERFORMANCE.md) for allocation boundaries and frame ownership.

## Building from source

See [source build instructions](../../docs/BUILDING.md).
