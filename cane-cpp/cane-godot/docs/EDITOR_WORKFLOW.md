# Godot editor workflow

[简体中文](EDITOR_WORKFLOW.zh-CN.md)

The Windows x64 addon uses native C++ Core and GDExtension. Install the compiled
addon into an ordinary Godot project; neither .NET nor a C++ compiler is needed.
The `editor/` scripts provide editor integration only.

## Install and import

1. Extract the addon archive into the project so that
   `addons/cane/cane.gdextension`, `addons/cane/bin/cane-godot.dll` and
   `addons/cane/plugin.cfg` exist. Restart Godot when replacing a loaded DLL.
2. Enable **Cane** in **Project → Project Settings → Plugins**. The plugin enables
   HDR 2D in the project and its editor viewport for correct color compositing.
3. Copy the complete Cane Runtime export into the project: JSON or CANEB, its
   atlas JSON files, and all referenced images. Preserve their relative paths.
4. CANEB imports automatically as a scene. For Runtime JSON, choose
   **Project → Tools → Import Cane animation…** and select the JSON. This creates
   a small `.cane` reference beside the original JSON, then imports it as a scene.
   Other JSON files keep their normal Godot behavior.
5. Drag the CANEB or `.cane` resource from the FileSystem dock into a 2D scene.

The imported scene contains a `CaneSkeleton` referencing generated
`CaneSkeletonData`. Godot manages that data resource, its textures and the imported
scene. Do not edit files inside `.godot/imported`.

## Configure and preview

Select the instance. **Animation** selects a clip or setup pose. **Skins** builds
an ordered combination; later skins override earlier attachments. Add, remove
and reorder skins without changing the shared skeleton data. Some exports have
an empty default skin and need a skin selection before anything becomes visible.

**Initial Loop** and **Playback Speed** are saved with the scene. Speed zero pauses
automatic playback. The preview controls play, pause, reset and scrub the same
native Core player used by the game. Preview playback is temporary and stops
when its Inspector controls close; it is not stored in the game scene.

Keep **Automatic** enabled for normal game playback. Disable it when your own
code supplies updates. Manual `advance(delta)` uses the delta you pass; the
serialized speed multiplier applies to automatic and editor-preview updates.
See [playback](PLAYBACK.md) for tracks, mixing, queues and events.

## Reimport and scene references

Source, atlas and image changes trigger reimport. Dependency records live in
Godot's disposable `.godot` cache. Imported data refreshes shared scene references
in place, and native project reconciliation preserves compatible player state.
Malformed data and missing files produce editor errors; restoring a dependency
lets the importer try again.

Move an export directory together with its JSON/CANEB, atlas files, images and
any `.cane` reference. Relative paths inside an export still apply. Moving an
individual image requires updating its exported path as well.

The manual `CaneSkeletonData.load_files` API retains its existing snapshot
semantics: loading that resource again does not silently replace existing
players. Editor imports and serialized resources opt into resource refresh.

## Run and export

Save the scene and run it normally. Use Godot's standard Windows Desktop export
preset and export templates to build a game. Generated skeleton data embeds the
validated Runtime payload and atlas documents; textures remain ordinary Godot
resource dependencies. The native extension is included by Godot's GDExtension
export integration. Editor plugin scripts are excluded from the game.
Both **Export all resources** and **Export selected scenes** include the generated
native skeleton data; no manual include filter for `.godot/imported` is needed.

Only the supplied Windows x64 native library is included in this addon. Other
operating systems and architectures require separately built and validated native
libraries. Custom SubViewports that render Cane must also enable `use_hdr_2d`.
See [installation](INSTALLATION.md) for the supported engine and rendering setup.
