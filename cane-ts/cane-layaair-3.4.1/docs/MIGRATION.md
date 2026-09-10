# Migrating to the Cane LayaAir 3.4.1 adapter

## From direct `@cane-runtime/core` rendering

Keep the existing `RuntimeDataV1`, player options, animation code, modifiers and event listeners. Replace custom texture/triangle upload code with a `LayaTextureStore` and `CaneLayaRuntime`:

```ts
// Before: host loop advanced Core and manually interpreted RenderPacketV1.
const player = data.createPlayer({ executionMode: "performance" });
player.advance(deltaSeconds);
drawPacket(player.currentFrame.renderPacket);

// After: Laya adapter advances the same player and consumes that packet once.
const textures = new LayaTextureStore({ baseUrl: "/characters/" });
await textures.preloadData(data);
const character = new CaneLayaRuntime({ player, textures, autoUpdate: false });
character.update(deltaSeconds);
```

Do not keep the old `player.advance` call as well as `character.update`; that would advance the
character twice. If another system already published the Core frame, call `applyCurrentFrame()` to
upload it without sampling or solving again.

## From `@cane-runtime/pixi-v8`

Core control semantics remain the same. Replace only engine-facing types:

| PixiJS adapter | LayaAir adapter |
| --- | --- |
| `CanePixiRuntime` | `CaneLayaRuntime` |
| `PixiTextureStore` | `LayaTextureStore` |
| `CanePixiSchedulerV1` | `CaneLayaSchedulerV1` |
| `PIXI.Container` follower | `Laya.Sprite` follower |
| `app.stage.addChild(character)` | `Laya.stage.addChild(character)` |
| Pixi ticker delta converted to seconds | `Laya.Timer.delta / 1000`, handled automatically |

```ts
await Laya.init(1280, 720);
const asset = await loadCaneLayaAssetV1("/characters/hero.caneb");
const hero = new CaneLayaRuntime({ asset, autoUpdate: false });
hero.setAnimation(0, "idle", true);
Laya.stage.addChild(hero);
new CaneLayaSchedulerV1().add(hero);
```

Both adapters expose the same conceptual Bone/constraint/track/skin/attachment/resource controls. Do not move engine nodes into Core: use `addBoneObject` and `addSlotObject` in the adapter.

## From a Spine LayaAir integration

The API shape is intentionally familiar, but Cane state remains owned by `RuntimePlayerV1`:

```ts
// AnimationState-like operations
character.setAnimation(0, "walk", true, 0.2);
character.addAnimation(0, "idle", true, 0);
character.clearTrack(0);

// Skeleton/Bone-like operations
character.setSkin("armored");
character.setAttachment("weapon", "sword");
character.setBoneRotation("head", lookDegrees); // transient for the next evaluation

character.beforeConstraints(pose => {
  pose.setConstraintTarget("aim", targetX, targetY);
  pose.setConstraintMix("aim", 1);
});
```

Do not directly mutate final Bone matrices or attachment vertices. Use transient modifiers,
persistent overrides, dynamic resource transactions, or final-geometry modifiers so Core performs
one authoritative solve. `setAttachment(slot, null)` explicitly hides; `clearAttachment(slot)`
clears the persistent override and restores animation/setup ownership.

## Coordinate migration

Authoring and Core points are Cane X-right/Y-up. Laya scene points are X-right/Y-down. Do not negate
Y in application code when using adapter helpers:

```ts
const muzzle = hero.boneToGlobal("gun-tip");          // Laya global point
const aimLocal = hero.globalToBone("shoulder", pointer); // Cane Bone-local point
hero.addBoneObject("gun-tip", particleSprite);
```

The adapter performs the single required reflection, including winding and full affine follower
matrices. Extra host-side Y flips will mirror the result twice.

## Resource and teardown migration

Create one asset/store for characters that should share decoded texture leases. A Runtime does not
take ownership of its asset or texture store. Remove/destroy display runtimes first, then destroy
the asset/store:

```ts
scheduler.remove(hero);
hero.destroy(false); // foreign follower objects are detached, not destroyed
await asset.destroy();
```

For runtime-created images, register the matching `RuntimeTextureV1`, commit Image/Attachment/Skin
objects with `RuntimeResourceTransactionV1`, and unload the texture if the Core transaction fails.

## Browser/IIFE migration

Load the exact LayaAir 3.4.1 scripts first, then `cane-layaair-3.4.1.min.js`. Replace ESM imports
with `CaneLaya.*`; Core exports are under `CaneLaya.Core.*`. The IIFE contains no LayaAir code and
does not create scene/prefab/material resources.

For WebGL, load `laya.core.js` followed by `laya.webgl_2D.js`. For WebGPU, use the official 3.4.1
release order below; both shader compiler WASM files must remain beside their JavaScript loaders:

```html
<script src="laya.core.js"></script>
<script src="shader_compiler_web.js"></script>
<script src="nagabind.js"></script>
<script src="laya.webgpu_2D.js"></script>
<script src="cane-layaair-3.4.1.min.js"></script>
```

Application control code does not change between WebGL and WebGPU. Do not add a second Core update
or a backend-specific geometry pass: LayaAir's selected `LayaGL` device factory owns shader
translation and GPU upload. Cane pads odd Uint16 upload sizes to four bytes internally while the
logical draw count remains unchanged.

LayaAir 3.4.1 cannot fully recreate its WebGL engine or WebGPU device in place. On real renderer
loss, recreate the engine/runtime realm rather than resuming old GPU objects after only a
`webglcontextrestored` event or `GPUDevice.lost` resolution.
