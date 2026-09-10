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

## Install and use

Engine packages and ready-to-open example projects are distributed through
[GitHub Releases](https://github.com/StephenPudding/cane-runtimes/releases).
Use the installation guide for your engine:

| Engine | Installation |
| --- | --- |
| Unity | Install the paired Core and Unity UPM packages, then import Cane JSON/CANEB and drag the generated prefab into a scene. [Guide](cane-csharp/cane-unity/docs/EDITOR_WORKFLOW.md) |
| Godot 4.7.2, Windows x64 | Extract the precompiled native addon and enable the Cane plugin. Ordinary Godot is supported; C#/.NET is not required. [Guide](cane-cpp/cane-godot/docs/EDITOR_WORKFLOW.md) |
| Cocos Creator 3.8.8 | Extract the prebuilt extension into the project's `extensions` directory, import the animation and place its asset under Canvas. [Guide](cane-ts/cane-cocos-3.8.8/docs/EDITOR_WORKFLOW.md) |
| LayaAir 3.4.1 | Use the exact-version adapter's [runtime integration guide](cane-ts/cane-layaair-3.4.1/README.md). |

Unity, Godot and Creator handle normal game compilation. Installing the engine
packages does not require manually building Cane. The example archives include
original Cane Bot artwork, four animations and two skins; their own READMEs
explain how to open and run the saved scenes.

For runtime development or a custom source build, see
[building from source](docs/BUILDING.md) and the [API guides](docs/README.md).
Engine SDKs are external build dependencies.

## Specification

[Format and algorithm specifications](specification/README.md) define Runtime
JSON/CANEB/Atlas 1.0 and Runtime API 1.0–1.3. `spec-lock.json` identifies the target
specification and reference-suite version; it is not a test report.
See [architecture](docs/ARCHITECTURE.md) and [compatibility](docs/COMPATIBILITY.md).

This source repository contains Runtime implementations, required build inputs,
third-party license notices and public documentation. Development tests,
benchmarks, examples, local tools, run reports and progress records are excluded.
It is independent from the Cane/Coolbones editor and its Cargo build graph.
