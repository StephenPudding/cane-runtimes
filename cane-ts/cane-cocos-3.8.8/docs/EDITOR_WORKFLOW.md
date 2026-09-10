# Cane in Cocos Creator

For **Cocos Creator 3.8.8**. The prebuilt extension needs no Node.js, pnpm or
manual Cane compilation. Creator still compiles game scripts and builds games.

## Install

Download the Creator 3.8.8 extension ZIP from
[Cane Releases](https://github.com/StephenPudding/cane-runtimes/releases).
Close the project and extract the `cane-runtime` folder into its `extensions`
directory, so `extensions/cane-runtime/package.json` exists. Open the project
with Creator 3.8.8 and wait for import. The `cane-runtime` asset mount contains
the runtime, declarations and color Effect.

Install one copy per project. Core and the adapter are bundled; do not also
register them from another script package. Keep project asset `.meta` files,
and retain the script/Effect `.meta` files included in every release when
upgrading so saved references remain stable.

## Import and configure

1. Export Cane **Runtime JSON or CANEB**, Atlas JSON and images. Copy the whole
   set into `assets`, preserving relative paths. Editor project files are not
   Runtime exports. Unrelated JSON files keep Creator's ordinary importer.
2. Place the imported `CaneSkeletonDataAsset` under a `Canvas` in a 2D scene.
   It creates a node with `CaneSkeleton`. Alternatively add the component to
   a node with `UITransform` and assign the data asset.
3. Select an animation, ordered skins, loop and speed in the component
   Inspector. Later skins override matching attachments from earlier skins.
   An empty animation uses the setup pose.
4. Use the preview buttons or time in seconds. Save the scene. Resource,
   animation, skin, loop and speed settings persist; preview time and playback
   state are transient and do not create animation keys.

Textures, Atlas data and the color Effect are imported as dependencies. Move
the complete asset directory through Creator to preserve UUIDs. Source changes
trigger reimport. A missing dependency reports its path; restoring the file
triggers import again.

## Game scripts and builds

Import from `db://cane-runtime/cane-runtime.mjs` in Creator scripts. The extension
includes the corresponding TypeScript declarations. Await `hero.initialize()`
before using a referenced `CaneSkeleton`, then call methods such as
`hero.setAnimation(0, 'idle', true)` or `hero.onEvent('user', handler)`.
Use animation IDs/names present in your export. Saved settings are applied on
initialization; unchanged settings do not restart programmatic playback.

The full component example is in the
[Chinese guide](EDITOR_WORKFLOW.zh-CN.md). The [API](API.md) also covers direct
URL/Bundle/host loading. Disable and re-enable a node for pooling; use
`node.destroy()` to release the component's player and resource leases.

Add the saved scene to Creator's build list. Web Desktop supports WebGL and
the platform's WebGPU option. Windows Native requires Creator's normal C++
game toolchain, with no additional Cane native library to compile. The imported
color Effect is included through the dependency graph.

The supported editor is 3.8.8. Platform coverage is WebGL, WebGPU and Windows
x64/GLES3; other versions and native platforms need their own validation.
See [backend boundaries](BACKENDS.md), including the WebGPU device-loss limit.
