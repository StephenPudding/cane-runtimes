# Godot installation

Build the native extension with the pinned Godot 4.5 `godot-cpp` dependency using
the [source build commands](../../../docs/BUILDING.md). This source distribution
targets Windows x64; its extension descriptor does not declare other platforms.

In your Godot project, create this layout:

```text
addons/cane/
  cane.gdextension
  bin/cane-godot.dll
```

Copy the repository's `cane-cpp/cane-godot/cane.gdextension` into `addons/cane/`
and the compiled Release DLL into `addons/cane/bin/`. Restart the editor after
installing or replacing the native binary; the descriptor disables hot reload.

Use ordinary Godot 4.5 or a compatible later engine with the same extension ABI. The DLL includes the independent C++ Core and does not require C# or Mono. Enable **Rendering > Viewport > HDR 2D** for the adapter's color contract. Preserve the relative paths of Cane Runtime JSON/CANEB, Atlas and image resources.

Use [the SDK API](SDK.md) and [playback controls](PLAYBACK.md) from GDScript. See [resources](RESOURCES.md), [Bone followers](BONE_FOLLOWERS.md),
[Slot nodes](SLOT_NODES.md) and [bounds](BOUNDS.md) for integration.
