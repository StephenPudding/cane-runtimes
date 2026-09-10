# Cane TypeScript runtimes

**English** | [简体中文](README.zh-CN.md)

The TypeScript workspace contains four production packages:

- [Core](cane-core/README.md): decoding, validation, animation, constraints and final packets.
- [PixiJS v8](cane-pixi-v8/README.md): PixiJS 8.18.1 resources, rendering and scheduling.
- [LayaAir 3.4.1](cane-layaair-3.4.1/README.md): exact-version WebGL/WebGPU adapter.
- [Cocos Creator 3.8.8](cane-cocos-3.8.8/README.md): exact-version web/native adapter.

Adapters consume Core output and never repeat animation or constraint evaluation. Core's default strict mode publishes owned frozen values. Performance mode returns
reusable frame/packet data that the host must consume before the next mutation.

See [building from source](../docs/BUILDING.md), [compatibility](../docs/COMPATIBILITY.md),
[Runtime API 1.2 migration](../docs/MIGRATION_RUNTIME_API_1_2.md) and
[Runtime API 1.3 migration](../docs/MIGRATION_RUNTIME_API_1_3.md).
