# Unity editor workflow

**English** | [简体中文](EDITOR_WORKFLOW.zh-CN.md)

## Install and import

1. Install the paired `com.cane.runtime.core` and `com.cane.runtime.unity` packages through Package Manager.
2. Copy the exported Cane Runtime JSON or CANEB, Atlas JSON and images into `Assets`, preserving their relative paths.
3. Wait for import. The Cane file becomes a draggable prefab containing `CaneSkeletonData`, raw textures and four blend materials.
4. Drag it into the Hierarchy or Scene. Choose an animation, skin, loop setting and playback speed in the `CaneSkeleton` Inspector.
5. Click **Configure Cane rendering for this scene**, or use **Tools → Cane → Configure scene rendering**. Setup selects Linear color space and configures the current rendering pipeline.

Automatic JSON selection only applies to files whose `format` is `cane-runtime` or `cane-atlas`. Other JSON importers remain unchanged.
JSON in `Assets/StreamingAssets` remains available for file-based loading. The importer consumes **Cane export formats**.

## Rendering and preview

The **Skins** list combines skins in order; later skins override earlier
attachments. Add, remove or reorder entries to build an outfit. The ordered
selection is saved per instance. Older scenes using `InitialSkin` still load;
the Inspector can transfer that setting into `InitialSkins`.

- Built-in: setup adds `CaneCameraRenderer` to scene cameras, creating an orthographic camera if needed. An editor-only pass draws Scene view previews.
- URP: setup enables `CaneRendererFeature` on Renderer Data assets referenced by the current Pipeline Asset.
- HDRP: setup enables Custom Pass support and adds a global Cane Custom Pass Volume that draws before post-processing.

See [render pipeline integration](RENDER_PIPELINES.md) for version constraints and pass behavior. Save the project, scene and renderer assets changed by setup.

In edit mode, use **Play preview**, **Pause**, or the time slider. The preview uses Core playback, skin, constraint and event APIs.
Additional camera renders and Scene view repaints do not advance animation. Preview time is transient; game playback starts from the saved animation, skin, loop and speed settings.

## Dependencies and reimport

Instances share immutable skeleton data and Unity textures. Each instance has its own player and final-geometry cache.
Unity tracks source JSON/CANEB, Atlas and image changes and regenerates imported resources. Stable subasset identifiers retain scene references, while compatible resource updates preserve playback state.
Move exported files and their relative dependencies together when reorganizing directories. Import logs or the Inspector identify missing images, Atlases, animations and skins.

Imported scenes retain textures and materials through Unity asset references, so game builds include the dependencies without accessing the original editor source paths.
Unity compiles C# packages normally; users do not need to build Core or the Runtime separately.

## Runtime code

```csharp
using Cane.Unity;

public class Character : UnityEngine.MonoBehaviour
{
    public CaneSkeleton Skeleton; // Assign the configured scene component.
    void Start()
    {
        Skeleton.Play("run", loop: true);
        Skeleton.AnimationEvent += value => UnityEngine.Debug.Log(value.Name);
    }
}
```

`Initialize`, `CaneAsset.LoadFiles` and byte-based loading remain available for dynamic resource providers.
See the [runtime README](../README.md) and [load plans](../../docs/LOADING.md).
