# Unity installation

The source tree contains two local Unity packages:

- `cane-csharp/cane-core/package.json`: engine-neutral Core.
- `cane-csharp/cane-unity/package.json`: rendering, resources, playback and host integration.

In Unity's Package Manager, choose **Install package from disk** and select the
Core manifest first, followed by the Unity manifest. Keep the package directories
at stable paths and keep the two versions matched. The adapter requires Unity
6000.3 or later and declares its Core, image conversion and JSON dependencies.

The public source tree contains Runtime code and guides. Export your animation
from Cane as Runtime JSON or CANEB with its Atlas and images; preserve their
relative resource paths when loading. No sample scene or artwork is installed.

The Built-in renderer is included. For URP or HDRP, install the matching engine
pipeline package and follow [render pipeline integration](RENDER_PIPELINES.md). See [resources](RESOURCES.md), [followers](FOLLOWERS.md), [Slot content](SLOT_CONTENT.md)
and [project replacement](PROJECT_RECONCILIATION.md) for host controls and ownership.

[Source build commands](../../../docs/BUILDING.md) also cover C# Core and direct
compilation against an installed Editor's assemblies.
