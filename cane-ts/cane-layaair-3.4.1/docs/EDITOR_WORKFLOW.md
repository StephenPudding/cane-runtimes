# LayaAir IDE workflow

**English** | [简体中文](EDITOR_WORKFLOW.zh-CN.md)

Use exactly **LayaAir IDE 3.4.1**. Download the Cane LayaAir editor `.layapkg`
and the Cane Bot example ZIP from [GitHub Releases](https://github.com/StephenPudding/cane-runtimes/releases).
Core and the renderer are supplied as JavaScript with TypeScript declarations.
The IDE compiles the component and editor extension automatically; no npm install,
Runtime build, MCP connection, or account for Cane is needed.

## Install and open the example

1. Open a 2D project in the IDE. Use **Tools → Import Resource Package**, select
   the Cane `.layapkg`, and import every entry into `assets/Cane`. Let the IDE
   finish its automatic script compilation, then reopen the scene if needed.
2. Alternatively, extract the complete Cane Bot example ZIP and open its `.laya`
   project. It includes the package and original sample assets.
3. Open `Scene.ls`. Select either Cane Bot node. Its **Cane Skeleton** component
   exposes data, animation, skin, loop, speed, play on awake, and editor preview.
4. Enable **Preview** to animate in Scene view, or use **Preview Run** to play the
   game. Disable Preview to stop editor playback immediately.

Install one copy per project. Keep it at `assets/Cane`; this is a resource package,
not a Package Manager installable package. Do not load a second browser bundle
alongside it. Back up your project before importing an update over that folder.

## Import your animation

Export **Cane Runtime JSON or CANEB**, together with its Atlas JSON and images.
Copy them under `assets/resources`, retaining the exported relative directory
structure. Cane project/authoring JSON and Spine JSON are not Runtime inputs.

The importer recognizes Cane JSON without changing unrelated JSON assets. Expand
the source asset to find its generated `.caneasset` data. Drag either the source
or generated data into the Scene view or hierarchy. A Sprite with a Cane Skeleton
component is created automatically. You can also add **Cane → Cane Skeleton** to
a Sprite and assign the generated data in its Data field.

Choose animation and skin, set a nonnegative speed, and save the scene or prefab.
The data field uses an engine resource reference; settings survive reopening the
project. Preview is an editor setting and is stripped from games. Play on awake
controls game playback separately.

An empty Skin field uses the exported `default` skin when present. Modular
characters such as Mix-and-Match may have an intentionally empty default skin;
choose a base skin and combine additional skins through the Runtime API as needed.

## Dependencies and changes

Keep the engine-generated `.meta` files with their assets in version control.
Rename or move resources through the IDE to preserve their IDs. Reimport tracks
the skeleton, Atlas and texture dependencies and refreshes loaded previews.
Generated raw texture subassets preserve the exported pixels; engine auto-atlas
and texture trimming cannot change Cane's UV or alpha interpretation.

A failed import reports the source and missing/invalid dependency. Restore the
file and reimport the source if necessary. Invalid data is not silently replaced
by an old successful import. Generated `.caneasset` and `.canetex` files are
managed outputs, not files to edit manually.

## Script control

```ts
import { CaneSkeleton } from "../assets/Cane/CaneSkeleton";

// Adjust the import relative to this script's location.
const skeleton = node.getComponent(CaneSkeleton);
await skeleton.ready;
if (!skeleton.runtime) throw new Error(skeleton.status);
skeleton.animation = "run";
skeleton.loop = true;
skeleton.speed = 1;
skeleton.playOnAwake = true;
const unsubscribe = skeleton.runtime.onEvent(event => console.log(event));
// Call unsubscribe when the listener's owner is disposed.
```

The node emits `cane-ready` and `cane-error`. `ready` settles after the current
load; inspect `status`/`runtime` to distinguish success from a reported error.
Changing Data safely cancels earlier loads. Instances share immutable data and
textures while retaining independent players. Destroying a node releases its
lease without destroying another instance's resources.

## Build and compatibility

Use **File → Build and Publish → Web** with the project's WebGL or WebGPU driver.
The build includes generated data and texture dependencies through engine asset
links. Serve the build over HTTP; WebGPU needs a supported browser and secure
context (localhost qualifies). TypeScript Core targets ES2022 and uses BigInt;
use a modern browser. An ES2015 compiler target cannot make it an ES2015 runtime.

The supported renderer paths are WebGL and WebGPU on exact 3.4.1. Native, NoRender,
Canvas2D and mini-game targets are not certified by this package. The official
rendererless CLI can import, serialize and build scenes, but cannot display
previews. See [backend details](../README.md#engine-prerequisites) for renderer
and device-loss limitations. Editor and game playback use the same Core player;
preview redraw requests do not perform a second animation evaluation.
