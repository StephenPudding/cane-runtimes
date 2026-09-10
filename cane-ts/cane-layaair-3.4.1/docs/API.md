# LayaAir 3.4.1 adapter API

All names below are exported by `@cane-runtime/layaair-3.4.1`. Core types and low-level controls
remain available from `@cane-runtime/core` or from `CaneLaya.Core` in the IIFE build.

## Assets and textures

```ts
const asset = await loadCaneLayaAssetV1("/rigs/hero.caneb", {
  // Optional URL or inline Atlas overrides. Automatic Runtime references are otherwise used.
  atlases: ["hero/hero.atlas.json"],
  resolver: new LayaLoaderResourceResolverV1(Laya.loader),
  contextTarget: document.querySelector("canvas")!,
});
```

- `loadCaneLayaAssetV1(url, options)` detects `.caneb`; other URLs are decoded as Runtime JSON.
- `createCaneLayaAssetFromCanebV1(bytes, options, sourceUrl?)` and
  `createCaneLayaAssetFromJsonV1(document, options, sourceUrl?)` accept host-provided data.
- A `CaneLayaResourceResolverV1` receives stable `runtime`, `atlas`, or `texture` requests and may
  return URL-fetched, packaged, encrypted, CDN, or mini-game resources.
- `LayaTextureStore.preloadData(data)` loads all direct images and Atlas pages, including inactive
  skins and sequence frames. `preload(packet)` loads only packet textures.
- `register(descriptor, texture, { ownership, restore })` binds a host-created `Laya.Texture2D`. `ownership: "store"` transfers destruction responsibility; the default remains external.
- `unload(descriptor?)` and `destroy()` are asynchronous and idempotent. Shared leases are released
  only after the last store is destroyed.
- `bindRendererLifecycle(canvas?)` observes `webglcontextlost/restored` for WebGL or the current
  `GPUDevice.lost` promise for WebGPU. `bindContextLifecycle(canvas)` remains as a compatibility
  alias. Pass the rendering canvas as `contextTarget` while loading an asset to install this
  automatically.

Atlas-page URLs are resolved relative to their Atlas document, not blindly relative to the Runtime
document. Decoded direct-image and Atlas-page dimensions are checked against Core metadata before
an asset is committed.

## Runtime construction and frame ownership

```ts
const runtime = new CaneLayaRuntime({
  asset,                         // creates a player, or pass player + textures explicitly
  playerOptions: { executionMode: "strict" },
  autoUpdate: false,
  updateWhenInvisible: false,
  validationMode: "once",       // "always" | "once" | "none"
  measureCpuTime: true,
});
```

- `update(deltaSeconds)` advances Core once and projects the resulting frame once.
- `applyPose()` applies pending transient modifiers without advancing time, then projects once.
- `applyCurrentFrame()` only reprojects the already-published frame; it never samples or solves.
- `pause()`, `resume()`, `paused`, `timeScale`, `autoUpdate`, and `timer` control instance updates.
- `player` exposes the authoritative `RuntimePlayerV1`; `controller` exposes the lower-level
  `CaneRuntimeControllerV1` facade.

Do not use `applyCurrentFrame()` as another animation tick. A normal game frame should call exactly
one of `update` or `applyPose`, yielding Core `sample / solve / publish = 1 / 1 / 1`.

## Character control

Transient calls are consumed by the next Core evaluation and do not alter project/setup data:

```ts
runtime.setBonePosition("hand", 12, 4);
runtime.setBoneRotation("head", -8);
runtime.patchBoneLocal("weapon", { rotationDegrees: 15 });
runtime.addBoneLocal("torso", { x: 2, rotationDegrees: 3 });
runtime.setConstraintTarget("aim-ik", pointerX, pointerY);
runtime.setConstraintMix("aim-ik", 1);
runtime.applyPose();
```

Persistent variants remain until cleared:

```ts
runtime.setBoneLocalPersistent("root", localPose);
runtime.setConstraintPersistent("aim-ik", { type: "ik", mix: 0.65 });
runtime.clearBoneLocalPersistent("root");
runtime.clearConstraintPersistent("aim-ik");
```

`beforeConstraints(listener)` receives the animation-after `RuntimePoseEditorV1`; it is the normal
place for per-frame aim, look-at, recoil, IK target and constraint-mix changes. `afterConstraints`
observes the final frame. Both return unsubscribe functions and are removed automatically when the
Runtime is destroyed.

Animation/skin/attachment helpers are:

```ts
runtime.setAnimation(0, "run", true, 0.15);
runtime.addAnimation(0, "idle", true, 0);
runtime.clearTrack(0);
runtime.clearTracks();
runtime.setSkin("winter");
runtime.setAttachment("weapon", "sword");
runtime.setAttachment("weapon", null); // explicit persistent hide
runtime.clearAttachment("weapon");     // remove override; animation/setup owns it again
```

Typed events preserve Core event payloads:

```ts
const stopComplete = runtime.onEvent("complete", event => {
  console.log(event.trackIndex, event.animationId);
});
const stopUser = runtime.onEvent("user", event => {
  console.log(event.eventId, event.integerValue, event.stringValue);
});
```

## Dynamic resources and final geometry

Use `attachmentFactory`, `createRuntimeSkin`, `copyRuntimeSkin`, and a
`RuntimeResourceTransactionV1` to install Image/Atlas/Attachment/Skin changes atomically in Core. Register any new texture descriptor in `LayaTextureStore`, then roll it back if the Core resource
transaction fails.

`jitterGeometry`, `radialWaveGeometry`, and `modifyGeometry` queue one-frame final-geometry
modifiers. `setPersistentGeometryModifiers` and `clearPersistentGeometryModifiers` control the
persistent layer. Laya only uploads the resulting Core vertices; it does not run those modifiers.

## Physics host motion

```ts
runtime.setRootPosition(x, y, { physicsMode: "move" });
runtime.teleportRoot({ x, y, rotationDegrees: 0, scaleX: 1, scaleY: 1 }, "teleport");
runtime.setPhysicsInertia("cape-physics", 0.8);
runtime.resetPhysicsConstraint("cape-physics");
runtime.resetPhysics();
```

The available host-motion policies are `move`, `teleport`, `preserveInertia`, and `clearInertia`. `setPhysicsEnvironment` forwards the complete Core Physics environment.

## Coordinates, Bounds, and scene objects

- `getBonePosition(name, out?)`: Runtime-local Laya point at the Bone origin.
- `boneToGlobal(name, caneBonePoint?, out?)`: Cane Bone-local to Laya global.
- `globalToBone(name, layaGlobalPoint, out?)`: Laya global to Cane Bone-local.
- `addBoneObject` / `removeBoneObject`: exact final-Bone follower.
- `addSlotObject` / `removeSlotObject`: attachment-order insertion with `placement`, attachment
  visibility filters, Slot alpha, and `clipping: "inherit" | "none"`.
- `bounds`: retained Core Bounds facade with local/global AABB, point hit, segment hit and draw-order
  result methods.

Follower mounts do not trigger a Core evaluation. In performance-sensitive code, supply reusable
`Laya.Point` output arguments and use `writeSlotObjects(output, slot?)` rather than allocating
query arrays each frame.

## Scheduler and diagnostics

```ts
const scheduler = new CaneLayaSchedulerV1({ measureFrameTime: true });
scheduler.add(hero).add(enemy);
// Or disable autoUpdate and call scheduler.update(deltaSeconds) from the host loop.
```

The scheduler owns one `Laya.Timer.frameLoop` callback regardless of instance count and prunes
destroyed runtimes. `runtime.lastApplyStats` reports active attachments/vertices/indices, upload
bytes, uploads, Mesh rebuilds, draw and isolated-draw counts, natural/Slot-object/clipping splits,
clipping writes, followers, CPU timing, and Core `1 / 1 / 1` counters. `scheduler.stats()` aggregates cold-path
totals; `frameTimes.snapshot()` allocates a reporting snapshot outside the hot loop.

## Errors and backend limits

Adapter/resource failures use `CaneLayaErrorV1` with a stable `code` plus `details.operation`,
`field`, `entityId`, `url`, `expected`, and `actual` where applicable. Core validation/control
failures remain `RuntimeErrorV1`.

Exact LayaAir 3.4.1 WebGL and WebGPU are supported. `assertCaneLayaWebRendererV1()` accepts those
two drivers; `detectCaneLayaBackendV1()` and `caneLayaBackendCapabilitiesV1()` expose the actual
selection and advertised matrix. The legacy `assertCaneLayaWebGlV1()` remains strict and should be
used only when an application intentionally requires WebGL.

The adapter uses public `Mesh2D`/`Mesh2DRender`/`Shader3D` APIs and lets LayaAir's selected
`LayaGL` device and 2D pass factories compile/upload for the backend. LayaAir 3.4.1 cannot recreate all engine resources in place after real WebGL or WebGPU loss, so
hosts must recreate the engine/runtime realm rather than treating a context event or device-loss
signal as full recovery. Native/modern API, NoRender and unknown backends remain rejected.
