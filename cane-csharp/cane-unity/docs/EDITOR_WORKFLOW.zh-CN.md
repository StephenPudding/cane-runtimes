# Unity 编辑器工作流

[English](EDITOR_WORKFLOW.md) | **简体中文**

## 安装与导入

1. 在 Package Manager 中安装配套的 `com.cane.runtime.core` 和 `com.cane.runtime.unity` 包。
2. 将 Cane 导出的 Runtime JSON 或 CANEB、Atlas JSON 和图片一起复制到工程的 `Assets` 目录，保留导出时的相对路径。
3. 等待 Unity 导入。Cane 文件会显示为可拖入场景的预制体，内部包含 `CaneSkeletonData`、原始纹理和四种混合模式的材质。
4. 将该预制体拖入 Hierarchy 或 Scene，在 `CaneSkeleton` 的 Inspector 中选择动画、皮肤、循环和播放速度。
5. 点击 Inspector 中的 **Configure Cane rendering for this scene**，或执行 **Tools → Cane → Configure scene rendering**。此操作会将项目颜色空间设为 Linear，并配置当前渲染管线。

普通 JSON 文件不会被替换导入器。只有 `format` 为 `cane-runtime` 或 `cane-atlas` 的 JSON 会自动识别。
`Assets/StreamingAssets` 中的 JSON 保留文件形式，方便继续使用代码加载 API。这里的导入格式是 **Cane 导出格式**。

## 渲染与预览

**Skins** 列表按顺序组合皮肤，后面的皮肤覆盖前面的同名附件。可添加、删除或调整顺序，
组合结果随各自的场景实例保存。旧场景的 `InitialSkin` 仍然有效，也可在 Inspector 中转为 `InitialSkins` 列表。

- Built-in：为场景相机添加 `CaneCameraRenderer`；没有相机时创建一个正交相机。Scene 视图有独立的编辑器预览通道。
- URP：为当前 Pipeline Asset 引用的 Renderer Data 添加并启用 `CaneRendererFeature`。
- HDRP：启用 Custom Pass，并为场景添加全局 Cane Custom Pass Volume，在后处理之前绘制。

渲染管线的版本限制和通道行为见[渲染管线说明](RENDER_PIPELINES.md)。设置会修改相应项目、场景或 Renderer Asset，请保存这些资源。

在编辑模式的 Inspector 中点击 **Play preview** 播放，点击 **Pause** 暂停，也可用时间滑块定位。
预览沿用 Core 播放、皮肤、约束和事件逻辑；多相机或 Scene 视图重绘不会重复推进动画。
预览时钟不会保存进场景。运行游戏时，根据保存的动画、皮肤、循环和速度配置重新开始播放。

## 资源与重导入

同一导入资源的多个实例共享不可变骨骼数据和 Unity 纹理，每个实例拥有自己的播放器和最终几何缓存。
修改源 JSON/CANEB、Atlas 或图片后，Unity 会根据导入依赖重新生成资源。稳定的子资源标识用于保持场景引用；兼容的资源更新会保留当前播放状态。
整理目录时，将导出文件及其相对依赖一起移动。缺失图片、Atlas、动画或皮肤会在导入日志或 Inspector 中报告具体错误。

导入后的场景通过 Unity 资源引用保存纹理和材质。构建游戏时，它们随场景依赖打包，播放器无需访问编辑器中的源文件路径。
用 Package Manager 安装源码包时，Unity 正常编译 C# 脚本；使用者不需要单独构建 Core 或 Runtime。

## 在游戏代码中操作

```csharp
using Cane.Unity;

public class Character : UnityEngine.MonoBehaviour
{
    public CaneSkeleton Skeleton; // 指向场景中已经配置的 CaneSkeleton。
    void Start()
    {
        Skeleton.Play("run", loop: true);
        Skeleton.AnimationEvent += value => UnityEngine.Debug.Log(value.Name);
    }
}
```

`Initialize`、`CaneAsset.LoadFiles` 和字节加载接口仍可用于动态资源来源。详情见[运行时 README](../README.zh-CN.md)和[加载计划](../../docs/LOADING.md)。
