# Replacing resources on a live skeleton

`CaneSkeleton.apply_runtime_resources(changes, image_files = {}, atlas_page_files = {})`
applies an ordered batch to one player. Other nodes sharing its `CaneSkeletonData`
retain their own resource snapshot. Each operation is a Dictionary:

| operation | fields in addition to `operation` |
| --- | --- |
| `upsertImage`, `upsertAttachment`, `upsertSkin` | `json`: complete native declaration as a String |
| `upsertAtlas` | `reference_json`: native Atlas reference String; `atlas_json`: Atlas document String |
| `removeImage`, `removeAtlas`, `removeAttachment`, `removeSkin` | `id`: stable resource ID |

Core validates declarations, composes skins/attachments, reconciles live state and
builds the final frame. Repeated IDs follow batch order. Removed overlay entries
reveal the original resource. New direct images need dimensions in their resource
declaration; the decoded image must match them.

```gdscript
var image = {"imageId":"shirt", "name":"Shirt", "path":"shirt.png",
    "mimeType":"image/png", "width":256, "height":128}
var ok = skeleton.apply_runtime_resources([
    {"operation":"upsertImage", "json":JSON.stringify(image)}
], {"shirt":"res://costumes/blue-shirt.png"})
if not ok:
    print(skeleton.get_last_error())
```

`image_files` maps direct-image IDs to actual engine file paths. `atlas_page_files` maps Atlas IDs to Dictionaries of page IDs and actual file
paths. File overrides must identify resources in the resulting overlay. Explicit
files bypass Godot's resource cache so a same-path reload can acquire new pixels. Unchanged installed bindings are reused when no file override is supplied.

By default, a new direct path resolves beside the original Runtime file. Atlas
pages resolve beside their Atlas reference; an unchanged original reference keeps
the actual Atlas directory supplied to `load_files`. For assets stored elsewhere,
supply explicit file maps. Core performs no file I/O.

The adapter acquires the complete effective texture catalog, asks Core to validate
decoded sizes, and prepares hidden GPU draws in Core's pre-commit callback. Only
after all preparation succeeds does it commit the player, decoded resources and
visible projection. A successful in-tree batch evaluates, uploads and notifies
once. Rejection preserves Core state, resources and visible pixels. Rendering
outside the scene is deferred until re-entry.

`clear_runtime_resources()` restores the original decoded asset, including when
an overlay reused the original image ID and declaration but supplied different
pixels. It uses the same validation/commit path. `reset()` keeps installed runtime
resources and resets playback; clearing the overlay is a separate operation.

`get_runtime_resources()` returns owned Arrays of native JSON Strings for images,
Atlas reference/document pairs, attachments and skins. `get_texture_resources()`
returns owned effective texture identities, declared paths, resolved engine files,
dimensions, pixel/color/alpha metadata, filters and wrapping. Queries do not evaluate animation. Native
hosts changing resource identities should use the adapter transaction; a direct
Core mutation does not acquire engine textures.
