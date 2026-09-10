# @cane-runtime/cocos-3.8.8

**English** | [简体中文](README.zh-CN.md)

Cane Runtime adapter for exactly **Cocos Creator 3.8.8**. The package remains
`private: true` and `UNLICENSED`. It depends on Creator's virtual `cc` module
and does not bundle a second Cocos Engine.

## Install and open an example

Download the Creator 3.8.8 extension from the release, extract its `cane-runtime`
folder into your project's `extensions`, and reopen the project. Core, the adapter,
the color Effect and type declarations are prebuilt; users do not need Node.js
or a separate Runtime compilation step.

Import the Runtime JSON/CANEB, Atlas JSON and images together, preserving relative
paths. Drag the skeleton resource under a 2D Canvas, choose animation, skins,
loop and speed in the Inspector, and use Play preview. Save the scene, then run
or build it with Creator. The companion Cane Bot example contains a saved scene,
four animations, two skins and original redistributable artwork.

See the [editor workflow](docs/EDITOR_WORKFLOW.md) or its
[Chinese version](docs/EDITOR_WORKFLOW.zh-CN.md). The APIs below are also available
for programmatic loading and character control.

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

## Prebuilt Creator extension

The editor extension bundles Core, the adapter, declarations and color Effect.
Install it in `extensions/cane-runtime`, import Cane JSON/CANEB with its Atlas
and images, then configure a `CaneSkeleton` in a 2D scene. See
[installation and editor workflow](docs/EDITOR_WORKFLOW.md) or the
[Chinese guide](docs/EDITOR_WORKFLOW.zh-CN.md). Imported assets reference their
Effect automatically; the manual Effect setup above applies to programmatic loading.

Creator scripts using the extension import from
`db://cane-runtime/cane-runtime.mjs`. Do not install a second runtime copy.

## Building from source

See [source build instructions](../../docs/BUILDING.md).
