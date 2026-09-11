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

## 安装与使用

引擎安装包和可直接打开的示例工程通过
[GitHub Releases](https://github.com/StephenPudding/cane-runtimes/releases) 分发。
请选择对应引擎的安装说明：

| 引擎 | 安装方式 |
| --- | --- |
| Unity | 安装配套的 Core 与 Unity UPM 包，导入 Cane JSON/CANEB，再将生成的 Prefab 拖入场景。[使用指南](cane-csharp/cane-unity/docs/EDITOR_WORKFLOW.zh-CN.md) |
| Godot 4.7.2、Windows x64 | 解压预编译原生插件并启用 Cane。支持普通 Godot，无需 C# 或 .NET。[使用指南](cane-cpp/cane-godot/docs/EDITOR_WORKFLOW.zh-CN.md) |
| Cocos Creator 3.8.8 | 将预构建扩展解压到工程的 `extensions` 目录，导入动画后将资源放到 Canvas 下。[使用指南](cane-ts/cane-cocos-3.8.8/docs/EDITOR_WORKFLOW.zh-CN.md) |
| LayaAir 3.4.1 | 通过“工具 → 导入资源包”安装 `.layapkg`，再把 Cane 数据拖入场景。[使用指南](cane-ts/cane-layaair-3.4.1/docs/EDITOR_WORKFLOW.zh-CN.md) |

Unity、Godot、Creator 和 LayaAir 负责正常的游戏编译；安装引擎包无需手动构建 Cane。
示例压缩包包含原创 Cane Bot 素材、四个动画和两套皮肤，包内 README 说明了打开和运行已保存场景的方法。

开发 Runtime 或自行从源码构建时，请阅读[源码构建说明](docs/BUILDING.md)和
[API 指南](docs/README.md)。构建所需的引擎 SDK 作为外部依赖另行准备。

## 规范

[格式与算法规范](specification/README.md)定义了 Runtime JSON、CANEB、Atlas 1.0
以及 Runtime API 1.0–1.3。`spec-lock.json` 标识目标规范与参考测试套件的版本，
不代表测试通过报告。另请参阅[架构说明](docs/ARCHITECTURE.md)和[兼容性说明](docs/COMPATIBILITY.md)。

本公开源码仓库包含 Runtime 实现、必要的构建文件、第三方许可证声明和公开文档。
开发测试、性能基准、示例、本地工具、运行报告及进度记录不纳入公开仓库。
该仓库独立于 Cane/Coolbones 编辑器及其 Cargo 构建体系。
