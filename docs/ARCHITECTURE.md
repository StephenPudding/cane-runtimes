# Runtime architecture

## Language boundaries

Each language owns one independent Core and its engine adapters:

- `cane-ts/cane-core`: TypeScript Core; PixiJS, LayaAir and Cocos adapters are sibling packages.
- `cane-csharp/cane-core`: independent managed Core; Unity integration is in `cane-unity`.
- `cane-cpp/cane-core`: independent native Core; Godot integration is in `cane-godot`.

Language Cores share the [specification](../specification/README.md), not an FFI
implementation or a dependency on the editor/Rust runtime.

## Core ownership

Core owns decoding and validation, animation sampling, tracks and mixing,
affine transforms, constraints and Physics, skins and deformation, clipping,
resource overlays, queries, final tint and final render geometry. Player state
and published-frame ownership follow the Runtime API contract. Required unknown
features fail explicitly.

## Engine ownership

Adapters load and release engine resources, map coordinates once, upload final
vertices/UVs/indices, apply the declared color and blend contract, preserve draw
order, and integrate engine lifecycle and scheduling. They must not resample
animation, solve constraints or reconstruct authoritative geometry or colors.
Core must not depend on engine objects, editor tools or authoring state.

## Rendering and compatibility

TypeScript adapters consume the same Core packet. Independent language Cores
target the same specified output. GPU sampling and precision remain backend
properties; [compatibility limits](COMPATIBILITY.md) are documented separately.
Format, API, package and engine versions are separate compatibility domains.
The specification lock identifies a target and does not certify a build.

Runtime source builds do not require development tests, benchmarks or examples.
Build prerequisites and commands are in [BUILDING.md](BUILDING.md).
