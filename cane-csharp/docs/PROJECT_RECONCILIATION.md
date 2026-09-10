# Replacing a live project

`RuntimePlayer.ReplaceProject(RuntimeData)` atomically adopts new immutable data. `ReconcileProject` is an alias with the same behavior and `replaceProject` error domain. Load and validate the replacement before submitting it:

```csharp
RuntimeData replacement = RuntimeData.FromJson(newRuntimeJson, loadOptions);
RuntimeFrame retained = player.Frame;
RuntimeFrame current = player.ReplaceProject(replacement);
```

Success publishes exactly one complete frame, with one animation sample and one constraint/geometry solve. `SourceData` becomes the new immutable input; `Data` is that input with the player's existing resource overlay applied. Other players and retained frames, resource snapshots and data handles remain unchanged. The operation is intended for explicit asset replacement, outside the ordinary frame loop.

`Reset` restores the current effective setup, clears playback, host pose overrides, pending events and solver history, and retains installed resources. Clearing the resource overlay is an explicit separate operation. This remains true after project replacement; reset does not switch back to an earlier source project.

## State reconciliation

- Bone, Region, Slot, skin, constraint and deform references resolve by stable ID. Reordering a catalog does not move overrides to a different object. Missing references and mismatched attachment/constraint kinds are dropped. Explicit null Slot selections continue to hide their Slots.
- A complete draw-order override survives only when the replacement has the same complete set of Slot IDs. Otherwise the new authored/animated order applies.
- Valid live entries, outgoing mixes, queues, entry identities, options, default/pair mix configuration and the absolute-replay baseline survive. A removed active animation drops its track and dependent queue. Removed outgoing entries cut off their older mixing ancestry; missing queued animations and pair mixes are removed.
- Elapsed track time, including completed loops, remains absolute. A range covering the whole previous clip follows the new clip duration. An explicit subrange clamps both endpoints to the new duration; a collapsed range is a valid constant-time sample. Replacement itself emits no lifecycle or crossing events. Already pending owned events remain available from `DrainEvents`, even if their old animation is absent from the new catalog.
- Root transforms, Physics environment and persistent geometry modifiers survive. Compatible Physics history follows constraint ID and its driven bone ID. Removing or changing that body discards its old history; the usual primary-animation/time-reset rules still apply.
- Deforms survive only when attachment kind, resolved deform ownership, vertex count and ordered per-vertex influence bone IDs remain compatible. Equal total buffer lengths do not establish compatibility. This also applies to runtime resource replacement.
- Installed images, Atlases, attachments and skins keep overlay precedence. `ClearRuntimeResources` reveals the new base input; `CloneConfiguration` uses that same new base without copying live clocks or solver history.

## Failure and ownership

Core composes and validates the effective resource catalog, reconciles host state, validates persistent modifier filters, evaluates, then commits. A missing resource, invalid filter, constraint/geometry failure or callback exception retains the entire previous project, playback state, events and publication. Persistent modifiers with missing attachment filters cause failure; they are not silently disabled. Callback attempts to mutate the original player are rejected before commit.

Resource overlays are validated as a complete catalog. An overlay referring to a Slot, bone or image removed by the replacement can therefore reject replacement. Clear or replace those overlay entries explicitly before trying the new project. Engine textures remain owned by the adapter and must be prepared for the new Core descriptors; replacing Core data alone does not load engine resources.

## Host preparation before commit

The overload `ReplaceProject(data, Action<RuntimeProjectPreview>)`, also available
through `ReconcileProject`, calls the host once after evaluating the candidate
and before committing it. `RuntimeProjectPreview` contains immutable `SourceData`,
effective `Data`, final `Frame`, the installed `Resources` snapshot and complete
ordered `SlotStates`, including empty and non-renderable Slots. It exposes no
mutable player. Its owned values may be retained after success or rejection.

The original player's queries still observe its previous publication while the
host prepares textures, buffers or other bindings. Same-player mutation, cloning
and draining events are rejected during this callback. Success commits the exact
validated Frame without another evaluation. Throwing retains source/effective
data, resources, clocks, Physics, pending events and the old Frame. Runtime errors
preserve their code, field and entity identity under `replaceProject`; allocation
errors become `ResourceLimit` and other host exceptions become `Internal`.

Preparation is synchronous. Core cannot roll back arbitrary host side effects;
adapters should stage resources privately, release candidates on failure and
publish them only after the operation returns successfully. Unity uses this gate through
[CaneSkeleton.ReplaceProject](../cane-unity/docs/PROJECT_RECONCILIATION.md).
