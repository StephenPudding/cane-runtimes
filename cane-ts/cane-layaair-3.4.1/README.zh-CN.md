# @cane-runtime/layaair-3.4.1

[English](README.md) | **简体中文**

面向生产使用、严格适配 LayaAir 3.4.1 的 Cane Runtime 适配器。它通过 LayaAir 的 WebGL/WebGPU
`Mesh2D` 路径渲染 `@cane-runtime/core` 的最终帧，并提供 Spine 风格的角色控制接口。
适配层不会重复实现动画、约束、Physics、裁剪、颜色或附件几何计算。

该包保持私有和 `UNLICENSED` 状态，尚未发布到 npm。`layaair` 是严格指定为 `3.4.1` 的 peer 依赖，
不会被打包到适配器中。同名公开 npm 包不提供 3.4.1，因此需要使用官方 LayaAir 3.4.1 SDK/IDE 引擎。
使用的官方提交固定为 `f368b43098fe6bde7b961546114e71907c5f8a98`。

## 引擎前置条件

1. 加载官方 `laya.core.js`，然后选择一个 3.4.1 驱动。WebGL 加载 `laya.webgl_2D.js`；
   WebGPU 依次加载 `shader_compiler_web.js`、`nagabind.js`、`laya.webgpu_2D.js`，
   并将 `shader_compiler_web.wasm` 和 `nagabind_bg.wasm` 放在对应加载脚本旁边。
2. 创建 `CaneLayaRuntime` 或 GPU 资源前，调用并等待 `Laya.init(...)` 完成。
3. 使用 WebGL 或 WebGPU。Native/modern API、NoRender 和未知后端会返回结构化的
   `unsupportedBackend` 错误。

## 最小 ESM 用法

```ts
import {
  CaneLayaRuntime,
  CaneLayaSchedulerV1,
  loadCaneLayaAssetV1,
} from "@cane-runtime/layaair-3.4.1";

await Laya.init(1280, 720);

const canvas = document.querySelector("canvas");
const asset = await loadCaneLayaAssetV1("/characters/spineboy.caneb", {
  ...(canvas instanceof EventTarget ? { contextTarget: canvas } : {}),
});
const player = asset.data.createPlayer({ executionMode: "performance" });
const character = new CaneLayaRuntime({
  player,
  textures: asset.textures,
  autoUpdate: false,
  validationMode: "once",
});

character.setAnimation(0, "idle", true);
Laya.stage.addChild(character);

const scheduler = new CaneLayaSchedulerV1();
scheduler.add(character); // one Laya.Timer listener can update many characters

// Teardown order: stop scheduling/rendering before releasing shared resources.
scheduler.remove(character);
character.destroy(false);
await asset.destroy();
```

需要保留不可变帧 DTO 并执行最严格验证时，使用 `executionMode: "strict"`。性能模式会复用临时 Core 帧存储；
请同步使用数据，并复制需要保留到下一次写入之后的内容。两种模式都支持事务失败回滚。

## 已实现的功能

- 加载 Runtime JSON 和 CANEB、内联或 URL Atlas 文档、独立图片和图集页面；支持相对 URL、宿主资源解析器及 `Laya.Loader` 解析器。
- 并发共享资源租约、引用计数、尺寸验证、事务回滚、卸载和确定性销毁。
- Region、Mesh、Weighted Mesh、Deform、Linked Mesh、Sequence、绘制顺序、可见性和 Core 裁剪。
- 明暗双色着色、alpha、straight/PMA、sRGB/linear 元数据，以及 normal/additive/multiply/screen 材质状态。
- WebGL 和 WebGPU 共用可复用的 `Mesh2D`/`Shader3D` 投影，提供上传、绘制、批次、裁剪和跟随器统计，无需为每个附件创建节点。
- WebGPU 中奇数个 Uint16 的上传采用与官方 Spine 适配器相同的四字节对齐方式，不改变逻辑绘制次数，也不在稳定帧中分配内存。
- 临时或持久的骨骼与约束控制、轨道和混合、皮肤与附件切换、动态 Image/Atlas/Attachment/Skin 资源、Physics 宿主运动和最终几何修改器。
- 带类型的生命周期和创作事件监听器、Bounds，以及按绘制顺序进行的命中测试。
- 保留完整仿射变换的骨骼跟随器，以及位于附件前后的 Slot 对象，支持附件可见性、Slot alpha 和继承裁剪。
- 手动更新、每实例自动更新，或由一个 `CaneLayaSchedulerV1` 更新多个实例。

适配器使用一个已经发布的 Core 帧，不自行采样动画或求解约束。`lastApplyStats` 同时提供适配器工作量，
以及 Core 的 `animationSamples / constraintGeometrySolves / framesPublished` 计数。

## 坐标与跟随器

Cane 的坐标为 X 向右、Y 向上；Laya 的坐标为 X 向右、Y 向下。适配器仅在 GPU/挂载边界进行一次反射，
并反转一次三角形绕序。Bone 和 Slot 挂载保留任意仿射矩阵列，包括双轴错切、反射和负缩放，
不会使用 LayaAir 3.4.1 中会丢失信息的 `Sprite.transform = Matrix` 分解。

- `getBonePosition` 返回骨骼原点在当前 Runtime 的 Laya 局部坐标系中的位置。
- `boneToGlobal` 将 Cane 骨骼局部点转换为 Laya 全局点。
- `globalToBone` 将 Laya 全局点转换为 Cane 骨骼局部点。
- `addBoneObject` 跟随最终 Core 骨骼矩阵，不再次求解。
- `addSlotObject` 将外部 `Laya.Sprite` 插入附件绘制顺序。`setAttachment(slot, null)` 隐藏附件；
  `clearAttachment(slot)` 移除宿主覆盖，将控制权交回初始设置或动画状态。

## 浏览器脚本包

`dist/iife/cane-layaair-3.4.1.min.js` 内嵌 Cane Core 和本适配器，不包含 LayaAir。
先加载指定版本的引擎，再加载脚本包；后者导出 `globalThis.CaneLaya`，其中 Core 位于 `CaneLaya.Core`。
缺少 Laya 时会立即给出明确错误。

## 渲染上下文丢失

上下文丢失后，Runtime 设置 `renderContextLost` 并暂停 GPU 投影，Core 仍可继续每帧推进一次。
官方 LayaAir 3.4.1 不能就地重建所有引擎拥有的 WebGL 资源或已丢失的 WebGPU 设备。
旧引擎仍在运行时，Cane 返回结构化的 `contextRestoreFailed` 数据。恢复方式是重新创建 Laya 引擎和运行时环境，
通常通过重新加载页面或游戏视图完成；适配器不会错误地报告就地恢复成功。

## 从源码构建

请参阅[源码构建说明](../../docs/BUILDING.md)。
