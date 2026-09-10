# Cane Runtimes

[English](README.md) | **简体中文**

用于加载、计算和渲染 Cane 骨骼动画的独立运行时。
每种语言都有独立实现、不依赖具体渲染引擎的 Core。引擎适配层使用 Core 输出的
最终几何数据、UV、颜色和绘制顺序，并负责引擎资源管理与渲染。

| 语言 | Runtime |
| --- | --- |
| TypeScript | [Core](cane-ts/cane-core/README.zh-CN.md)、[PixiJS](cane-ts/cane-pixi-v8/README.zh-CN.md)、[LayaAir 3.4.1](cane-ts/cane-layaair-3.4.1/README.zh-CN.md)、[Cocos Creator 3.8.8](cane-ts/cane-cocos-3.8.8/README.zh-CN.md) |
| C# | [Core](cane-csharp/README.zh-CN.md)、[Unity](cane-csharp/cane-unity/README.zh-CN.md) |
| C++ | [Core](cane-cpp/README.zh-CN.md)、[Godot 原生 GDExtension](cane-cpp/cane-godot/README.zh-CN.md) |

## 构建与使用

请先阅读[源码构建说明](docs/BUILDING.md)和 [API 与引擎接入指南](docs/README.md)。
Unity 使用配套的 Core 与 Unity 本地 UPM 包。Godot 使用原生 C++ 扩展，无需 C# 或 .NET。
构建所需的引擎 SDK 作为外部依赖，需要另行准备。

## 规范

[格式与算法规范](specification/README.md)定义了 Runtime JSON、CANEB、Atlas 1.0
以及 Runtime API 1.0–1.3。`spec-lock.json` 标识目标规范与参考测试套件的版本，
不代表测试通过报告。另请参阅[架构说明](docs/ARCHITECTURE.md)和[兼容性说明](docs/COMPATIBILITY.md)。

本公开源码仓库包含 Runtime 实现、必要的构建文件、第三方许可证声明和公开文档。
开发测试、性能基准、示例、本地工具、运行报告及进度记录不纳入公开仓库。
该仓库独立于 Cane/Coolbones 编辑器及其 Cargo 构建体系。
