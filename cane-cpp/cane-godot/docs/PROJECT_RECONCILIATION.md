# Live project replacement

`CaneSkeleton.replace_project(data, image_files = {}, atlas_page_files = {})`
rebinds an existing player to a loaded `CaneSkeletonData`. `reconcile_project`
is an alias. Both return a Boolean and expose structured errors through
`get_last_error()` and `runtime_error`. Unassigned players and null/unloaded data
are rejected. Setting `skeleton_data` directly keeps its existing reset behavior.

```gdscript
var replacement := CaneSkeletonData.new()
if replacement.load_files("res://hero.caneb", PackedStringArray(["res://hero-atlas.json"])) == OK:
    if not $Hero.replace_project(replacement):
        print($Hero.get_last_error())
```

Core performs [stable-ID reconciliation](../../docs/PROJECT_RECONCILIATION.md). Compatible clocks, mixing, queues, replay baseline, host overrides, Physics
history and resource overlays survive. Missing IDs and incompatible overrides
follow Core's removal rules. Successful replacement updates `skeleton_data`;
it does not reload shared assets or change other players.

Before Core commits, a read-only candidate callback acquires textures, validates
decoded sizes, queries the candidate's complete Slot order and prepares a hidden
final-packet projection. Invalid resources or failed callbacks retain the old
source, clocks, frame, texture references and visible projection. Godot does not
resample animation or compute geometry during preparation.

Non-overlay textures come from the replacement asset's immutable snapshot. Unchanged overlays retain their decoded textures. Optional file maps follow
`apply_runtime_resources`: explicit paths reload installed overlay images or
Atlas pages; unknown IDs and overrides of non-overlay images are rejected. Clearing overlays restores the **new** source asset's textures.

Inside the tree, replacement publishes and uploads once, synchronizes followers
and Slot insertion by stable ID, then emits one `frame_updated`. Missing targets
become unresolved. Empty/new Slots contribute batch boundaries using Core order. Outside the tree, it commits without uploading; reentry projects the retained
frame. Owned replay results remain separate from incremental events.

Script geometry callbacks read the previous publication through the original
node. Reentrant player mutations fail. Arbitrary scene edits made by callbacks
are not undone by project rollback; use deferred deletion as described in
[geometry modifiers](GEOMETRY_MODIFIERS.md).
