# Unity ownership, prefabs and script reload

`CaneAsset` owns decoded textures and retains them while initialized skeletons use
the asset. The caller can dispose its asset handle after initialization. Every
`CaneSkeleton` owns a separate mutable Core player. Disabling a skeleton releases
its render projection but preserves playback. Enabling and rendering recreates
the projection from that same publication. Destruction releases its source and
effective asset leases and follower bindings.

Core players and `CaneAsset` handles are not Unity-serialized state. A host
component must initialize them after scene loading or script reload, using
`CaneAsset.LoadFiles` or `CaneAsset.Load`. Serialize the asset location, initial
animation and playback options in that host component when creating a prefab.
Runtime clocks are not implicitly serialized into a prefab.

In the Editor, the adapter tracks the textures, meshes and materials it creates
and destroys them before assembly reload. External textures and materials remain
host-owned. Normal resource release removes the registration. The registry and
Editor callbacks are excluded from standalone builds and add no per-frame work.
