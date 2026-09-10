# Cocos Creator 3.8.8 adapter API

以下名称均由 `@cane-runtime/cocos-3.8.8` 导出。Core 底层类型仍从
`@cane-runtime/core` 导入。

## 资源与纹理

```ts
const asset = await loadCaneCocosAssetV1("characters/hero.caneb", {
  resolver: new CocosBundleResourceResolverV1(resources),
  atlases: ["characters/hero-atlas.json"],
  preloadTextures: true,
  contextTarget: game.canvas,
});
```

- `loadCaneCocosAssetV1` 按后缀读取 CANEB 或 Runtime JSON。
- `createCaneCocosAssetFromCanebV1` 与 `createCaneCocosAssetFromJsonV1` 接受宿主数据。
- `CocosAssetManagerResourceResolverV1`、`CocosBundleResourceResolverV1` 或自定义
  `CaneCocosResourceResolverV1` 可接 CDN、Bundle、加密包或小游戏资源系统。
- `CocosTextureStore.preloadData(data)` 加载所有 direct image 与 Atlas page，并核验实际
  解码尺寸；`preload(packet)` 只加载当前 RenderPacket 使用的纹理。
- `register(descriptor, texture, options)` 绑定宿主创建的 `Texture2D`；`ownership: "store"`
  会把销毁责任交给 Store。
- 并发加载被合并，共享 lease 在最后一个 Store 释放后才销毁。加载与尺寸核验失败会回滚
  整个事务。
- `unload` 和 `destroy` 异步、幂等。WebGL context 恢复重新解码纹理；WebGPU device loss
  会暂停角色并产生结构化终止错误，因为 Creator 3.8.8 不能原位重建整个 device。

`CaneSkeletonDataAsset` 是 Creator 可序列化资源包装；其 `runtimeJson`/`runtimeBinary`、
`atlasAssets`、`textureKeys` 和 `textures` 由编辑器资源引用组成，`instantiate()` 返回独立
`CaneCocosAssetV1` lease。

## 组件与帧所有权

`CaneSkeleton` 是正式 `UIRenderer`：

- `initialize()` 使用已分配的 `skeletonData`；`load(url, options)` 走程序化资源路径；
- `runtime` 是 `CaneCocosRuntime | null`，`runtimePlayer` 是底层 `RuntimePlayerV1 | null`；
- `autoUpdate`、`updateWhenInvisible`、`timeScale`、`performanceMode` 和 `cacheMode` 控制更新；
- `manualUpdate(dt)` 执行一次 Core advance；`applyCurrentFrame()` 只重投影当前帧；
- `enableBatch` 决定是否把完整组件世界仿射烘焙进顶点；
- `colorEffectAsset` 接收 Creator 导入并编译的 `cane-runtime-color.effect`；Native 必须在
  `initialize()`/`load()` 前赋值，Web 也建议赋值以保持三端完全相同的颜色路径；
- Node 事件 `CaneSkeleton.EventType.READY` 与 `ERROR` 报告初始化结果。

`CaneCocosRuntime` 可用于自定义宿主。它必须接收 `asset`，或同源的 `player + textures`；
投影器永远只消费 `player.currentFrame`。正常游戏帧只能调用 `update` 或 `applyPose` 其中之一，
以保持 `sample / solve / publish = 1 / 1 / 1`。

## 动画、姿势和约束

```ts
hero.setAnimation(0, "run", true, 0.12);
hero.addAnimation(0, "idle", true, 0);
hero.clearTrack(0);
hero.setMix("run", "shoot", 0.08);

hero.setBonePosition("hand", 10, 4);
hero.setBoneRotation("head", -8);
hero.patchBoneLocal("weapon", { rotationDegrees: 12 });
hero.addBoneLocal("torso", { x: 2, rotationDegrees: 3 });
hero.setConstraintTarget("aim-ik", x, y);
hero.setConstraintMix("aim-ik", 1);
```

非 Persistent 的 Bone/constraint 操作是下一次 Core 求值的一帧 modifier，不改工程或 setup
数据。`setBoneLocalPersistent`/`clearBoneLocalPersistent` 与
`setConstraintPersistent`/`clearConstraintPersistent` 管理跨帧覆盖。

`beforeConstraints(listener)` 在动画与持久覆盖之后、约束之前收到 pose editor，适合瞄准、
look-at、后坐力与程序 IK；`afterConstraints(listener)` 观察最终帧。两者均返回 unsubscribe，
Runtime 销毁时也会自动解除。

Skin/Attachment 接口为 `setSkin`、`setAttachment`、`clearAttachment`。传
`setAttachment(slot, null)` 表示持久隐藏；`clearAttachment(slot)` 则归还给动画/setup。

## 事件、动态资源、Physics 与 Bounds

`onEvent(listener)` 监听全部事件；`onEvent("start" | "interrupt" | "end" | "dispose" |
"complete" | "user", listener)` 提供类型收窄。事件直接来自 Core 的确定性发布顺序。

动态资源通过 `attachmentFactory`、`createRuntimeSkin`、`copyRuntimeSkin` 和
`RuntimeResourceTransactionV1` 创建并用 `applyRuntimeResources` 原子安装。也可使用
`install/removeRuntimeImage`、`Atlas`、`Attachment`、`Skin` 便捷方法。新图像须先在
`CocosTextureStore` 登记；Core 事务失败时宿主应撤销对应纹理绑定。

`jitterGeometry`、`radialWaveGeometry`、`modifyGeometry` 是一帧 final-geometry modifier；
Persistent 版本通过 `setPersistentGeometryModifiers` 管理。Cocos 只上传修改后的 Core 顶点。

Physics/宿主运动包括 `setRootTransform`、`setRootPosition`、`setRootRotation`、
`teleportRoot`、`setPhysicsEnvironment`、`setPhysicsInertia`、`resetPhysicsConstraint` 和
`resetPhysics`。

Bounds 提供 `queryBounds`、`containsPoint`、`writePointHits`、`intersectsSegment`、
`writeSegmentHits`，以及组件的 global-point/global-segment 便捷方法。`write*` 形式允许宿主
复用输出数组。

## 坐标与场景对象

Cane 与 Cocos 2D 都是 X-right/Y-up，不做 Y 反转。组件帮助函数会把完整 Node world matrix
应用一次：

- `getBonePosition`：角色本地空间 Bone 原点；
- `boneToLocal` / `localToBone`：Bone 与角色本地空间；
- `boneToGlobal` / `globalToBone`：Bone 与 Cocos 世界空间；
- `boneToWorld` / `worldToBone`：上述 Cocos 世界空间转换的 Spine 风格同义 API；
- `getBoneMatrix`：Core 最终完整仿射。

`addBoneObject`/`removeBoneObject` 让 Node 跟随最终 Bone；`addSlotObject`/
`removeSlotObject` 可把 Node 插在目标 attachment 前或后。Slot options 支持 attachment
visibility 过滤、Slot alpha 与 `clipping: "inherit" | "none"`。Web 通过受控 `UI.walk`
插入，Native 通过 `SUB_NODE` draw info 插入，均遵守 Core draw order且不会触发第二次求值。

## 调度、缓存和统计

组件默认由唯一 `CaneSkeletonSystem` 更新；低层多个 Runtime 可共享
`CaneCocosSchedulerV1`。稳定帧热路径复用几何、batch-range、submission 与统计存储；
`CaneCocosFrameTimeWindowV1.snapshot()` 只在报告时分配。

`lastApplyStats` 提供 Core CPU、adapter CPU、attachment/vertex/index、上传字节、重分配、
draw、自然/Slot/clipping 切分、followers、缓存命中以及严格的 sample/solve/publish 计数。

REALTIME 每次显式 `applyCurrentFrame()` 都强制重投影；PRIVATE_CACHE 与 SHARED_CACHE 会复用
本实例当前已发布帧的投影。SHARED_CACHE 不跨角色共享动画 Frame；全局 Texture lease 和静态
VB accessor 由适配器独立共享。三种模式都不会跳过 Core 动画求值，因此事件、modifier 和
Physics 保持同一语义，也不会因共享缓存泄漏实例状态。

## 错误

适配器失败使用 `CaneCocosErrorV1`，包含稳定 `code` 和
`details.operation/field/entityId/url/expected/actual/backend/cause`。Core 数据与控制错误保持
`RuntimeErrorV1`。不支持的 backend 或 3.8.8 内部接口变化会显式失败，不会回退为假成功。
