# Replacing a running Unity skeleton project

Load the replacement as a `CaneAsset` on the Unity main thread, then submit it:

```csharp
using (var replacement = CaneAsset.LoadFiles(runtimePath, atlasPaths))
{
    skeleton.ReplaceProject(replacement);
}
```

`ReconcileProject` is an alias. The component retains its own source-asset lease,
so disposing the caller's handle after success is safe. `Initialize` creates a
fresh player; `ReplaceProject` retains compatible state according to the
[Core project contract](../../docs/PROJECT_RECONCILIATION.md): absolute clocks,
mixes, queues, replay baseline, stable-ID host overrides, active skins, installed
resource overlays and compatible Physics history. Missing/incompatible targets
are reconciled by Core. The adapter does not re-evaluate animation or rebuild
final geometry.

Before Core commits its once-evaluated candidate, Unity prepares the effective
texture catalog, a separate mesh/material projection and complete Slot order. Only successful preparation replaces the live assets and GPU projection. Bone,
Point and Slot followers resolve against the committed frame before frame/event
notifications. Empty and newly introduced Slots are included. A disabled component
adopts the data without a visible projection; re-enabling and refreshing projects
its retained frame.

Base images come from the replacement asset. Unchanged installed image/Atlas
overlays retain their current texture storage. The optional
`Func<RuntimeTextureResource, byte[]>` provider may supply new overlay pixels;
returning null reuses an unchanged installed overlay. It does not replace base
images. Clearing resources afterward reveals the replacement project's images.

Missing/invalid bytes, invalid persistent modifier filters, Core evaluation
failures and rejected callbacks preserve the old project, GPU state, clock,
pending events and publication. Candidate textures and buffers are released. Reentrant component mutation is rejected during preparation and notification. Destroying the source during acquisition aborts its transaction; destroying it
during event delivery stops the remaining queued notifications. Core cannot undo
arbitrary scene changes made by a host callback.

Use the component API instead of calling `skeleton.Player.ReplaceProject`
directly: Core does not load Unity textures or update source-asset ownership. `LastProjectPreparationMicroseconds` excludes mesh upload, separately measured
by `LastUploadMicroseconds`; `LastCoreMicroseconds` measures the Core portion. These diagnostics do not establish a per-frame reload or deployment budget.

Standalone automatic rendering, SRP,
prefab/domain reload, async acquisition and SDK installation remain separate.
