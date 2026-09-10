# @cane-runtime/cocos-3.8.8

**English** | [简体中文](README.zh-CN.md)

Cane Runtime adapter for exactly **Cocos Creator 3.8.8**. The package remains
`private: true` and `UNLICENSED`. It depends on Creator's virtual `cc` module
and does not bundle a second Cocos Engine.

`@cane-runtime/core` is authoritative for animation, mixing, bones, constraints,
Physics, deform, clipping, tint and final geometry. This package owns Cocos resources,
lifecycle, coordinates, scene objects, GPU uploads and submission. An ordinary
frame performs one Core sample, one solve and one publication.

## Supported features

- A `CaneSkeleton extends UIRenderer` component and serializable `CaneSkeletonDataAsset`.
- A unified `CaneSkeletonSystem` and manual/shared `CaneCocosSchedulerV1`.
- WebGL, WebGPU and Windows Native, all consuming the same `RuntimeRenderPacketV1`.
- Region, Mesh, Weighted Mesh, Deform, Linked Mesh and Sequence.
- Draw order, Core clipping, attachment visibility and Slot objects before/after attachments.
- Light/dark tint, alpha, straight/PMA and sRGB/linear metadata.
- Normal, additive, multiply and screen blending.
- Bone/Slot followers preserving complete affine transforms, shear, reflection and negative scale.
- Both `boneToWorld/worldToBone` and `boneToGlobal/globalToBone` for Cocos/Spine-style migration.
- CANEB, Runtime JSON, Atlas, direct images and Bundle/URL/host resolvers.
- Shared resource deduplication, reference counting, transactional rollback, unloading,
  WebGL texture restoration and an explicit terminal boundary for WebGPU device loss.
- Spine-style animation, pose, constraint, Skin/Attachment, Physics, Bounds, event and dynamic-resource APIs.
- REALTIME/SHARED_CACHE/PRIVATE_CACHE modes. Caches only reuse the Cocos projection of published
  frames; they do not skip Core evaluation or create a second animation state.

## Minimal use

Import the package in a Creator script and add the component to a node with `UITransform`:

```ts
import { Node, UITransform, resources } from "cc";
import {
  CaneSkeleton,
  CocosBundleResourceResolverV1,
} from "@cane-runtime/cocos-3.8.8";

const node = new Node("Hero");
node.addComponent(UITransform);
const hero = node.addComponent(CaneSkeleton);

await hero.load("characters/hero.caneb", {
  resolver: new CocosBundleResourceResolverV1(resources),
});
hero.setAnimation(0, "idle", true);
```

### Color Effect (required for Native)

Import the package's `cocos-assets/cane-runtime-color.effect` into your Creator
project's `assets` and assign the generated `EffectAsset` to `CaneSkeleton.colorEffectAsset`.
Use the same imported Effect for WebGL, WebGPU and Native so sRGB/linear and straight/PMA
inputs follow identical linear-light color calculations without white fringes on translucent edges.
You can place it at `assets/resources/cane-runtime-color.effect` and assign it with
`resources.load("cane-runtime-color", EffectAsset, ...)` before loading the character.

Without an assigned resource, web platforms can dynamically create an equivalent Effect
from Cocos 3.8.8's built-in Spine Effect. Native pipeline layouts are fixed at build time;
a missing compiled Effect therefore produces an explicit error instead of a silent material fallback.

For a serialized workflow, assign a `CaneSkeletonDataAsset` to `CaneSkeleton.skeletonData`
in Creator. Programmatic URL, `ArrayBuffer` and JSON workflows use `loadCaneCocosAssetV1`,
`createCaneCocosAssetFromCanebV1` and `createCaneCocosAssetFromJsonV1`, respectively.

Character control example:

```ts
hero.setMix("walk", "shoot", 0.15);
hero.setAnimation(0, "walk", true);
hero.addAnimation(0, "idle", true, 0);
hero.setSkin("armored");
hero.setAttachment("weapon", "rifle");

const stopAim = hero.beforeConstraints(pose => {
  pose.setConstraintTarget("aim-ik", pointerX, pointerY);
  pose.setConstraintMix("aim-ik", 1);
});
const stopEvent = hero.onEvent("user", event => console.log(event.name));
```

`autoUpdate` is enabled by default and driven by the single `CaneSkeletonSystem`.
For a host-controlled clock, set `autoUpdate = false` and call `manualUpdate(deltaSeconds)`.
`applyCurrentFrame()` only reprojects the published frame; it does not sample or solve again.

## Exact version and build

Type checking and builds first verify:

- Cocos Creator `3.8.8`.
- Official engine commit `411f98df047c25902f93440d4b22925c2fb65461`.
- `@cocos/creator-types@3.8.8` declaration SHA-256:
  `88fa33fe074ccd5471fb1bea6779a37d025dbf9570a195fc0d9f684a3608dcc9`.

```sh
pnpm --filter @cane-runtime/cocos-3.8.8 typecheck
pnpm --filter @cane-runtime/cocos-3.8.8 build
```

The output is standard ESM and `.d.ts`. Creator's builder resolves `cc`; the adapter
cannot execute independently of Cocos in an ordinary browser or Node environment.

## Building from source

See [source build instructions](../../docs/BUILDING.md).
