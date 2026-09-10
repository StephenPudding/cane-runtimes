# Migrating from Runtime API 1.2 to 1.3

Runtime API 1.3 is additive. Existing 1.2 player, pose modifier, track, event,
Bone/Slot, and renderer code remains valid. Runtime JSON, CANEB, and Atlas stay
at Format 1.0 and require no re-export.

Before using the additions, check Runtime API minor 3 and the corresponding
capability bits returned by `runtimeApiInfoV1()` or
`runtimeCapabilitiesV1()`.

## Instance-local resources

Dynamic resources are an overlay on one player. They never mutate the shared
`RuntimeDataV1` or another instance. Build a detached Skin, stage all related
resources, then publish them as one atomic transaction:

```ts
import {
  CaneRuntimeControllerV1,
  RuntimeResourceTransactionV1,
} from "@cane-runtime/core";

const controller = new CaneRuntimeControllerV1(player);
const skin = controller.createRuntimeSkin({ id: "runtime-loadout" })
  .setAttachment("weapon-slot", "rifle", "runtime-rifle");

const rifle = controller.attachments.copy(sourceRifle, {
  id: "runtime-rifle",
  imageId: "runtime-rifle-image",
});

const changes = new RuntimeResourceTransactionV1()
  .upsertImage(runtimeRifleImage)
  .upsertAttachment(rifle)
  .upsertSkin(skin);

controller.applyRuntimeResources(changes); // validates and publishes once
controller.setSkin("runtime-loadout");
skin.dispose(); // installed snapshot remains valid
```

`removeImage`, `removeAtlas`, `removeAttachment`, and `removeSkin` remove only
overlay entries; a same-ID shared entry becomes visible again. `clearRuntimeResources()` returns the instance to its shared project. A bad
reference, geometry, Atlas relation, or rebuilt frame rolls back the complete
transaction.

## Bounds without another evaluation

Use retained storage on hot paths and the owned snapshot only on cold paths:

```ts
import { RuntimeBoundsV1 } from "@cane-runtime/core";

const bounds = new RuntimeBoundsV1();
player.writeBounds(bounds, {
  includeRenderGeometry: true,
  includeBoundingBoxes: true,
});

const frontmost = bounds.containsPoint(worldX, worldY);
const rayHit = bounds.intersectsSegment(x1, y1, x2, y2);
```

Queries consume the already-published final pose, retain capacity when the
same output is reused, and do not sample animation or solve constraints. Coordinates are Cane world X-right/Y-up. `CanePixiRuntime.bounds` provides
Pixi-local and Pixi-global Y-down conversion helpers.

## Physics-aware host motion

Root changes now state what happens to existing Physics history:

```ts
player.setRootTransform(nextRoot, { physicsMode: "move" });
player.setRootTransform(spawnRoot, { physicsMode: "teleport" });
player.setRootTransform(parentedRoot, {
  physicsMode: "preserveInertia",
  constraintId: "cape-physics",
});
player.setRootTransform(stoppedRoot, { physicsMode: "clearInertia" });
```

`move` lets Physics react to ordinary movement. `teleport` resets selected
history at the destination. `preserveInertia` transports history and velocity
through the full affine delta. `clearInertia` transports the current offset
but clears lag/velocity. The operation publishes once and is transactional.

## Core-owned final geometry

Persistent geometry effects run first; transient effects run once on the next
successful apply/advance. Both execute after constraints, deform and clipping
inside Core:

```ts
controller.setPersistentGeometryModifiers({
  operations: [{
    type: "deterministicJitter",
    attachmentIds: ["energy-field"],
    seed: 42,
    amplitudeX: 0.25,
    amplitudeY: 0.15,
  }],
});

controller.radialWaveGeometry({
  type: "radialWave",
  attachmentIds: ["energy-field"],
  centerX: 0,
  centerY: 0,
  radialAmplitude: 0.2,
  angularAmplitudeDegrees: 0.1,
  wavelength: 24,
});
controller.advance(1 / 60);
```

Custom callbacks receive a bounded geometry editor. They cannot change
topology, texture identity, draw order, or blend state. Non-finite output,
collapsed/inverted triangles, or an exception rolls back the whole frame. Engine adapters must render the resulting packet unchanged.

## PixiJS integration additions

Load CANEB or Runtime JSON, referenced Atlas documents, and shared texture
leases with `PIXI.Assets`:

```ts
import { Assets } from "pixi.js";
import {
  CanePixiAssetV1,
  CanePixiRuntime,
} from "@cane-runtime/pixi-v8";

const asset = await Assets.load<CanePixiAssetV1>({
  alias: "hero",
  src: "/hero/hero.caneb",
});
const character = new CanePixiRuntime({
  player: asset.data.createPlayer({ executionMode: "performance" }),
  textures: asset.textures,
});

character.addSlotObject("weapon-slot", muzzleEffect, {
  placement: "after",
  followAttachmentVisibility: true,
  inheritSlotAlpha: true,
  clipping: "inherit",
});
```

`getSlotObject`, `querySlotObject`, `writeSlotObjects`, and bulk/single removal
manage followers without disturbing attachment draw order. Bone and Slot
followers use full affine matrices. `CanePixiDebugViewV1` can visualize Bones,
Bounds, clipping, draw order and batch segments. Texture stores support
shared `PIXI.Assets` leases, rollback, unload, WebGL context restoration, and
WebGPU device-loss/replacement signals.

Import the adapter before `Application.init()` so Pixi registers the Cane
render pipes. WebGL and WebGPU preserve the shader color contract. Canvas2D is
an explicit geometry/alpha/clipping fallback and does not claim exact RGB,
two-color, or linear-light tint parity; see [COMPATIBILITY.md](COMPATIBILITY.md).

## Performance and ownership reminders

- `strict` returns independently owned frozen DTOs.
- `performance` returns ephemeral reused Frame/RenderPacket storage; consume it
  synchronously and copy only values that must outlive the next mutation.
- Reuse `RuntimeBoundsV1`, `RuntimePoseModifierBufferV1`, and
  `RuntimeGeometryModifierBufferV1` on stable hot paths.
- Dynamic resource changes, snapshots, convenience queries, topology changes,
  and error paths are cold/feature-proportional allocation paths.
- A successful API 1.3 conformance result does not by itself certify renderer
  pixels or matched Spine performance.
