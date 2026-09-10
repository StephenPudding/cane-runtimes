# Cane Unity 运行时

[English](README.md) | **简体中文**

基于独立 C# Core 的 Unity 资源管理和最终数据包渲染适配器。源码面向 Windows 上的 Unity 6000.3+，
包含 Built-in、URP 和 HDRP 集成。请参阅[安装说明](docs/INSTALLATION.md)和[渲染管线](docs/RENDER_PIPELINES.md)。

[运行时工程替换](docs/PROJECT_RECONCILIATION.md)在提交兼容的 Core 状态前，先准备候选纹理、最终数据包投影
和完整 Slot 顺序。

[Bone 与 Point 跟随器](docs/FOLLOWERS.md)通过 Content 变换呈现已发布的完整仿射矩阵，保留错切、反射和零缩放骨骼。
[Slot 内容](docs/SLOT_CONTENT.md)遵循完整的已发布 Slot 顺序，将外部 Mesh/Sprite 渲染器插入完整附件之间。

通过 Package Manager 安装 `cane-core` 和 `cane-unity` 两个本地包，将项目颜色空间设为 **Linear**。
Core 使用 `netstandard2.1` / C# 9，不依赖 Unity 或其他引擎。`Cane.Unity` 仅引用 Core 的公开 API，
以及 Unity 的资源和渲染 API。

```csharp
using Cane.Unity;
using System.Collections.Generic;

// File I/O belongs to the adapter. Atlas IDs, rather than filenames, key this map.
using var asset = CaneAsset.LoadFiles(runtimePath,
    new Dictionary<string, string> { [atlasId] = atlasPath });
var skeleton = gameObject.AddComponent<CaneSkeleton>();
skeleton.Initialize(asset); // Retains its own lease; the caller can dispose its asset handle.
skeleton.Play("run");
Camera.main.gameObject.AddComponent<CaneCameraRenderer>();
```

`CaneAsset.Load` 也接受 Runtime/Atlas 文档和宿主提供的字节解析器，可接入 AssetBundle、Addressables、
StreamingAssets 或其他资源提供方式。它通过 Unity 加载 PNG/JPEG，在 Core 中验证解码尺寸，
并保留原始纹理值，不进行隐式 sRGB 转换。Core 的[加载计划](../docs/LOADING.md)在解码前列出资源，
因此未声明尺寸的独立图片会根据实际像素自动确定大小。字节回调接收 `RuntimeTextureRequest`，
最终描述符来自完整的 `RuntimeData`。声明尺寸及任何显式提供的解码目录必须与实际纹理一致。
验证在资源发布前完成，失败时释放所有暂存纹理。Core 负责解析、完整姿势计算、约束、裁剪、UV、颜色、
动画事件、最终几何和绘制顺序。

`CaneSkeleton.LateUpdate` 将播放器推进一次。`Play`、`Queue`、皮肤和附件设置方法直接投影 Core 已发布的帧，
不再次调用 Apply。其他 Core 公开操作可使用 `Mutate`；需要自定义调度时，可通过 `Player` 访问完整 Core 对象。
资源变化必须使用组件的 `ApplyRuntimeResources` / `ClearRuntimeResources`，使 Core 和解码后的 Unity 资源
一起提交，详见[运行时资源](docs/RESOURCES.md)。`RefreshRender` 仅上传发生变化的已发布帧。
`SampleAt` 单独返回重放事件，与增量 `AnimationEvent` 通知分开。保留的 Core 帧仍拥有独立数据。
禁用组件会释放 GPU 投影资源并保留播放状态，销毁组件会释放资源租约。
运行时资源事务单独保留原始来源租约，并逐一共享未变化的纹理，反复替换不会持续保留过时的资源链。
骨骼矩阵保留完整仿射，包括反射和错切。

Built-in 相机组件在 Unity 普通透明物体通道之后记录所有可见 Cane 骨骼，按 sorting layer、sorting order
和实例标识排序，并保留每个 Core 数据包内部的顺序。它不会将其他 Unity 透明渲染器自动交错到该通道中。
`CaneSkeleton.Record` 和 `CaneMeshProjection.Record` 可将命令缓冲集成到宿主选择的目标和渲染通道。
Slot 内容插入在骨骼完整数据包的顺序中。可选的 URP/HDRP 集成共用相同的记录器；相机配置、通道顺序和支持的 API
见渲染管线指南。

着色器提交线性空间的预乘输出。Normal、Add、Multiply 和 Screen 使用不同的硬件 RGB/alpha 混合因子，
正确处理 alpha 和自身重叠的三角形。来源 sRGB 解码发生在插值前；预乘纹理在应用最终单色或双色着色前
只执行一次反预乘。最终世界坐标 XY 保持不变，Unity 和 Core 均为 Y 向上；仅在纹理采样时，
将 Core 左上角 UV 原点转换为 Unity 解码纹理的左下角原点。不再次应用来源仿射、约束或裁剪。

## 从源码构建

请参阅[源码构建说明](../../docs/BUILDING.md)。
