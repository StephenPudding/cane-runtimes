# Cane Runtimes

**English** | [简体中文](README.zh-CN.md)

Independent runtimes for loading, evaluating and rendering Cane skeletal animation.
Each language has its own renderer-neutral Core. Engine adapters consume its final
geometry, UVs, tint and draw order and own engine resources and rendering.

| Language | Runtime |
| --- | --- |
| TypeScript | [Core](cane-ts/cane-core/README.md), [PixiJS](cane-ts/cane-pixi-v8/README.md), [LayaAir 3.4.1](cane-ts/cane-layaair-3.4.1/README.md), [Cocos Creator 3.8.8](cane-ts/cane-cocos-3.8.8/README.md) |
| C# | [Core](cane-csharp/README.md), [Unity](cane-csharp/cane-unity/README.md) |
| C++ | [Core](cane-cpp/README.md), [native Godot GDExtension](cane-cpp/cane-godot/README.md) |

## Build and use

Start with [building from source](docs/BUILDING.md) and the
[API and integration guides](docs/README.md). Unity uses the paired local UPM
packages. Godot uses a native C++ extension and does not require C#/.NET.
Required engine SDKs remain external dependencies.

## Specification

[Format and algorithm specifications](specification/README.md) define Runtime
JSON/CANEB/Atlas 1.0 and Runtime API 1.0–1.3. `spec-lock.json` identifies the target
specification and reference-suite version; it is not a test report.
See [architecture](docs/ARCHITECTURE.md) and [compatibility](docs/COMPATIBILITY.md).

This source repository contains Runtime implementations, required build inputs,
third-party license notices and public documentation. Development tests,
benchmarks, examples, local tools, run reports and progress records are excluded.
It is independent from the Cane/Coolbones editor and its Cargo build graph.
