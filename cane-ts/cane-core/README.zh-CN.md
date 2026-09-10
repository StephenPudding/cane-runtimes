# @cane-runtime/core

[English](README.md) | **简体中文**

使用 TypeScript 编写、不依赖具体渲染器的 Cane Runtime Core，可供 JavaScript 和 TypeScript 宿主使用。

当前 `0.1.0` 源码实现了 Cane Runtime API 1.3 接口，包括严格的 Runtime JSON/CANEB/Atlas 加载、
动画状态与采样、最终 Region/Mesh 及裁剪后几何、皮肤、序列、全部五类约束、持久宿主覆盖、
逐帧临时姿势修改器、创作参数反向查询、工程状态协调、实例独立的动态资源、可复用 Bounds、
Physics 宿主运动、由 Core 执行的最终几何修改器，以及严格或可复用的帧发布方式。

`runtimeCapabilitiesV1()` 声明 Runtime API 次版本 3 和功能位 38–41。已知支持的功能无需设置
`allowUnverifiedFeatures`；未知的必需功能会被拒绝。能力查询还会单独提供 Core 参考测试套件的标识，
它与渲染器能力是不同的信息。

基本调用流程如下：

```ts
const data = RuntimeDataV1.fromJson(json, {
  atlases,
});
const player = data.createPlayer({ executionMode: "performance" });
player.setAnimation({ trackIndex: 0, animationId: "idle", looping: true });
const frame = player.advance(1 / 60);
```

`frame.renderPacket` 包含最终世界坐标几何与最终颜色。宿主不得再次将 `sourceAffine` 应用到这些顶点。

查找皮肤附件时，第一个声明的 Skin 作为默认回退皮肤。当非空的选中皮肤栈没有包含它时，Core 会在选中栈之前
计算默认皮肤，但不会将其加入 `activeSkinIds`/`sampledSkinIds`，也不会因此激活默认皮肤的成员。
空栈仍明确表示无皮肤、仅使用初始设置的状态。Path 约束保留创作时指定的骨骼列表采样顺序，
但按父骨骼优先的顺序提交最终世界变换，避免子骨骼在前的链被之后的祖先变换传播覆盖。

默认的 `strict` 模式发布具有独立所有权、深度冻结的 DTO。`performance` 模式面向可信的同步渲染器：
缓存分组后的动画关键帧，对关键帧和路径距离执行二分查找，并复用动画层与事件存储、采样状态、变形插值数组、
持久覆盖存储、骨骼矩阵、IK/Transform/Path/Physics 工作区、渲染输入、附件、帧和渲染数据包。
Core 生成的规范化索引数组附带弱关联的修改版本，该版本不属于 DTO，供 TypeScript 适配器跳过重复的逐帧索引扫描。
性能模式返回的 DTO 是临时数据，下一次修改状态的调用可能改变它们。事件生成、混合链、裁剪、变形数据形状变化、
Slider 重采样、拓扑变化、便捷查询、显式快照和错误对象仍可能按所用功能分配内存；详见
[性能与所有权说明](../../docs/PERFORMANCE.md)。

主要 API 分组：

- `RuntimeDataV1.fromJson(...)` / `fromCaneb(...)`、冻结的 `catalog`、
  `validateDecodedTextureCatalog(...)`，以及使用分开列表的 `validateDecodedTextureSizes(...)`。
- 轨道、队列、混合、播放范围、空动画、update/apply/advance/seek 和事件操作。
- 在动画采样与单次约束求解之间，按顺序执行临时骨骼替换、补丁、叠加和约束修改。
- 持久覆盖、`beforeConstraints`/`afterConstraints`、稳定的 Bone/Slot/Constraint 句柄，以及带类型的生命周期和用户事件监听器。
- `RuntimeSkinBuilderV1`、`RuntimeAttachmentFactoryV1`、`RuntimeResourceTransactionV1`、实例隔离和完整事务回滚。
- 基于当前最终姿势的可复用 `RuntimeBoundsV1`，支持 AABB、多边形、点、线段和包围范围查询。
- 根节点 `move`/`teleport`/`preserveInertia`/`clearInertia` 策略，以及全部或指定约束的 Physics 重置。
- 按顺序执行的持久或临时最终几何修改器，支持确定性内置效果、自定义效果、拓扑验证和写入统计。
- 姿势、几何、序列、路径、Physics 和 Transform Match 查询。
- 原子的创作参数覆盖，以及顶点、权重和变形的反向计算辅助方法。
- `replaceProject(...)`、`reconcileProject(...)`、`cloneConfiguration()` 和不可变帧快照。

`advance(...)` 是 JavaScript 便捷接口，返回新发布的帧。`advanceWithSampling(...)` 返回与参考 Runtime API
结构一致的 `RuntimeStepV1`；通过 `player.frame` 读取其发布的帧。

[Runtime API 1.2 迁移指南](../../docs/MIGRATION_RUNTIME_API_1_2.md)介绍姿势控制和 Spine 风格外观接口的变化，
[Runtime API 1.3 迁移指南](../../docs/MIGRATION_RUNTIME_API_1_3.md)介绍共享 SDK 的新增内容，
[兼容性策略](../../docs/COMPATIBILITY.md)说明版本保证。

## 从源码构建

请参阅[源码构建说明](../../docs/BUILDING.md)。
