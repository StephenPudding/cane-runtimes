# Migrating to Runtime API 1.2

Runtime API 1.2 adds a programmatic pose stage without changing Runtime Format v1, CANEB v1, or Atlas v1. Existing Runtime API 1.1 assets remain valid. The new evaluation order is normative:

```text
setup pose
  -> animation tracks
  -> persistent overrides
  -> transient per-frame pose modifiers
  -> beforeConstraints hooks
  -> constraints / physics
  -> final world matrices
  -> render packet
  -> afterConstraints observers
```

Core remains the only animation, constraint, physics, tint, and final-geometry authority. Renderer adapters consume the published frame and must not solve it again.

## Loading existing assets

No asset migration is required. A validated API 1.2 implementation no longer needs the temporary `allowUnverifiedFeatures` opt-in for the features covered by Suite 1.6.0.

```ts
import { RuntimeDataV1 } from "@cane-runtime/core";

const data = RuntimeDataV1.fromCaneb(canebBytes, { atlases: [atlasJson] });
const player = data.createPlayer({ executionMode: "performance" });
```

Use the default `strict` mode when independently owned, frozen frame DTOs are more important than steady-frame allocation. Use `performance` for a real-time renderer; its frame, packet, Bone, attachment, and event storage is ephemeral and may be reused by the next mutating Player call.

## Low-level Player migration

The existing `RuntimePlayerV1` API remains supported. Queue all one-frame changes and evaluate exactly once:

```ts
import { RuntimePoseModifierBufferV1 } from "@cane-runtime/core";

const modifiers = new RuntimePoseModifierBufferV1();

function update(deltaSeconds: number, aimX: number, aimY: number) {
  modifiers.clear()
    .patchBoneLocal("head", { rotationDegrees: 8 })
    .addBoneLocal("weapon", { xDelta: 2 })
    .setConstraintTarget("aim-ik", aimX, aimY)
    .setConstraintMix("aim-ik", "ik", 1);

  const frame = player.advanceWithModifiers(deltaSeconds, modifiers);
  renderer.consume(frame.renderPacket);
}
```

The modifier buffer is not consumed by Player; `clear()` is controlled by the caller. A stable operation shape reuses its records after warm-up. Each successful `advanceWithModifiers` performs one animation sample, one constraint/geometry solve, and one frame publication. A rejected batch commits neither clock state nor a partial pose.

Persistent overrides survive later evaluations and run before one-frame modifiers:

```ts
player.setBoneLocalOverride("weapon", {
  x: 0,
  y: 0,
  rotationDegrees: 0,
  shearXDegrees: 0,
  shearYDegrees: 0,
  scaleX: -1,
  scaleY: 1,
});

// This frame sees persistent scaleX=-1, then adds 12 degrees transiently.
player.applyWithModifiers({
  operations: [{
    operation: "addBoneLocal",
    boneId: "weapon",
    delta: { rotationDegreesDelta: 12 },
  }],
});

// The additive change expires; the persistent override remains.
player.apply();
player.clearBoneLocalOverride("weapon");
```

For several persistent authoring overrides, prefer one atomic `applyAuthoringOverrides({ operations })` call instead of several setters that each rebuild a frame.

## Spine-style convenience facade

`CaneRuntimeControllerV1` is a thin facade over one Player. Its stable Bone, Slot, and constraint handles do not own or solve a second skeleton.

```ts
import { CaneRuntimeControllerV1 } from "@cane-runtime/core";

const character = new CaneRuntimeControllerV1(player);
const head = character.queryBone("Head");
const optionalWeapon = character.findBone("weapon");

character.setAnimation(0, "idle", true, 0.15);
character.addAnimation(0, "shoot", false, 0);

head.setPosition(4, 2).setRotation(10);
optionalWeapon?.addLocal({ rotationDegreesDelta: -3 });
character.setConstraintTarget("aim-ik", aimX, aimY);
character.setConstraintMix("aim-ik", 1);

const frame = character.advance(deltaSeconds);
```

Bone and constraint convenience setters are transient: the controller collects them, evaluates once in `apply()` or `advance()`, and clears the queue in `finally`. `setSkin` and `setAttachment` are persistent host controls and publish an updated frame immediately. Explicit `setBoneLocalPersistent`, `setConstraintPersistent`, and matching clear methods are available when game state must survive across frames.

## Procedural hooks

Use `beforeConstraints` for continuously computed game pose such as aiming. The editor is valid only during the callback. `writeBone` lets allocation-sensitive code reuse its own output object; `queryBone` returns a convenience snapshot.

```ts
const aim = { x: 0, y: 0 };

const removeAim = player.beforeConstraints((pose) => {
  pose.patchBoneLocal("head", { rotationDegrees: 6 });
  pose.setConstraintTarget("aim-ik", aim.x, aim.y);
  pose.setConstraintMix("aim-ik", 1);
});

const removeObserver = player.afterConstraints((frame) => {
  // Observe final matrices/geometry only. Do not mutate Player here.
  telemetry.sequence = frame.sequence;
});
```

Player mutation is rejected from either hook and from event dispatch. If a hook throws, strict and performance modes both retain the previously committed frame, clocks, pose, physics state, and event queue.

## Typed lifecycle and user events

The listener facade does not consume `frame.events` or `drainEvents()`:

```ts
const removeComplete = character.onEvent("complete", (event) => {
  console.log(event.trackIndex, event.animationId);
});

const removeUserEvent = character.onEvent("user", (event) => {
  console.log(event.eventId, event.name, event.numberValue);
});
```

Listeners run after the new frame is committed, in authoritative event order and then listener registration order.

## PixiJS v8 integration

`CanePixiRuntime` extends `Container` but delegates all evaluation to Core. Its `update()` advances Core once; `applyCurrentFrame()` only reprojects an already-published packet.

```ts
import { Graphics } from "pixi.js";
import { CanePixiRuntime, PixiTextureStore } from "@cane-runtime/pixi-v8";

const textures = new PixiTextureStore({ baseUrl: "/assets/", pipeline: "caneBatch" });
await textures.preloadData(data);

const view = new CanePixiRuntime({
  player,
  textures,
  autoUpdate: false,
  validationMode: "once",
});
app.stage.addChild(view);

const weaponMarker = new Graphics().circle(0, 0, 4).fill(0xffcc66);
view.addBoneObject("gun-tip", weaponMarker);

const muzzleGlow = new Graphics().circle(0, 0, 16).fill({ color: 0xff6600, alpha: 0.4 });
view.addSlotObject("muzzle", muzzleGlow, "before");

app.ticker.add((ticker) => view.update(ticker.deltaMS / 1000));
```

Bone objects receive the final full affine, including shear, reflection, negative scale, and the single Cane Y-up to Pixi Y-down conversion. Slot objects are inserted before or after the selected Slot attachment in authoritative draw order. Their unavoidable Cane batch boundaries are reported by `view.lastApplyStats.slotObjectBatchSplits`.

Coordinate helpers are available in allocating and caller-owned-output forms:

```ts
const pixiLocalOrigin = view.getBonePosition("gun-tip", reusablePoint);
view.boneToGlobal("gun-tip", { x: 5, y: 0 }, reusableGlobalPoint);
view.globalToBone("gun-tip", pointer.global, reusableBonePoint);
```

A singular Bone affine cannot be inverted and causes `globalToBone` to throw a structured `RuntimeErrorV1`.

## Compatibility checklist

- Keep Runtime Format, CANEB, and Atlas files at v1; this release changes Runtime API behavior, not the asset wire format.
- Detect Runtime API 1.2 / transient-pose capability when interoperating with older hosts.
- Do not retain performance-mode frame references across a later Player mutation.
- Do not run animation sampling or constraints in a Pixi/engine adapter.
- Coalesce one-frame Bone and constraint edits into one `apply` or `advance` call.
