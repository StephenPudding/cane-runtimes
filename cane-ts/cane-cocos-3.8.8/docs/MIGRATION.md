# 迁移到 Cane Cocos Creator 3.8.8 Runtime

## 从直接渲染 `@cane-runtime/core`

保留现有 RuntimeData、Player 配置、动画、modifier 和事件代码，将自制纹理/三角形提交替换
为 `CaneSkeleton` 或 `CaneCocosRuntime`：

```ts
// 之前：宿主 advance 后自行解释 packet。
player.advance(deltaSeconds);
drawPacket(player.currentFrame.renderPacket);

// 之后：组件统一执行一次 Core 更新和一次 Cocos 投影。
hero.autoUpdate = false;
hero.manualUpdate(deltaSeconds);
```

不要同时保留旧的 `player.advance` 和 `manualUpdate`，否则角色会推进两次。如果其他系统已发布
Core frame，只调用 `applyCurrentFrame()`。

## 从 PixiJS 或 LayaAir Cane Runtime

Core 操纵语义保持一致，仅替换引擎对象：

| Pixi/Laya | Cocos Creator 3.8.8 |
| --- | --- |
| `CanePixiRuntime` / `CaneLayaRuntime` | `CaneSkeleton` / `CaneCocosRuntime` |
| `PixiTextureStore` / `LayaTextureStore` | `CocosTextureStore` |
| adapter scheduler/ticker | `CaneSkeletonSystem` / `CaneCocosSchedulerV1` |
| Container/Sprite follower | Cocos `Node` follower |
| stage child | Canvas/UI hierarchy child |

同一个 CANEB 不需转换。不要把 Cocos Node 放入 Core；Bone/Slot 对象只通过适配器注册。

## 从 Cocos 官方 Spine 组件

API 形态有意保持熟悉，但 Cane 的唯一状态位于 `RuntimePlayerV1`：

```ts
hero.setAnimation(0, "walk", true, 0.2);
hero.addAnimation(0, "idle", true, 0);
hero.clearTrack(0);
hero.setSkin("armored");
hero.setAttachment("weapon", "sword");

hero.beforeConstraints(pose => {
  pose.setConstraintTarget("aim", targetX, targetY);
  pose.setConstraintMix("aim", 1);
});
```

不要直接改最终 Bone matrix 或 attachment 顶点。使用 transient modifier、persistent override、
动态资源事务或 final-geometry modifier，让 Core 只解算一次。Cane cache mode 也只缓存渲染
投影，不改变动画/事件语义。

## 资源迁移

程序化资源使用 `hero.load(url, { resolver })`；Creator Inspector 工作流创建并分配
`CaneSkeletonDataAsset`。CANEB 在 Cocos 项目中可作为 `BufferAsset`，Runtime JSON/Atlas 作为
`JsonAsset`，纹理为 `Texture2D`。

还需把包内 `cocos-assets/cane-runtime-color.effect` 导入项目，并把生成的 `EffectAsset` 赋给
`CaneSkeleton.colorEffectAsset`。Native 的 shader program/layout 只能由 Creator 在构建期
注册，所以这是 Native 必需资源；Web 使用同一资源可确保 WebGL/WebGPU/Native 的 sRGB、PMA
和 two-color 结果一致。不要直接复用 `default-spine-material` 的 fragment 颜色公式，它不符合
Cane Runtime 的颜色元数据契约。

自定义 Bundle/CDN/小游戏加载器实现 `CaneCocosResourceResolverV1`，返回 JSON、ArrayBuffer
或 Cocos Asset。Atlas page 相对其 Atlas 文档解析，而非错误地相对 Runtime 文档。销毁角色
组件后再销毁独立 `CaneCocosAssetV1`；组件自己 `load()` 的 lease 会随重载/销毁释放。

## 坐标迁移

Cane 与 Cocos 2D 都是 X-right/Y-up，不要在业务代码额外翻转 Y：

```ts
const muzzleWorld = hero.boneToWorld("gun-tip"); // boneToGlobal is an alias.
const aimInShoulder = hero.worldToBone("shoulder", pointerWorld); // globalToBone is an alias.
hero.addBoneObject("gun-tip", particleNode);
```

适配器读取/写入完整 2D affine，处理 shear、reflection 与负缩放。直接使用 Node 的普通 TRS
setter 会丢失任意 shear，因此 follower 应走适配器。

## Web、WebGPU 与 Native

业务控制代码三端相同。WebGL/WebGPU 使用 Cocos 2D assembler/RenderEntity 流程；Native
使用动态 `MIDDLEWARE`/`SUB_NODE` RenderDrawInfo，但几何始终是同一 Core packet。

WebGL context 恢复时纹理由 Store 重新解码。Creator 3.8.8 的 WebGPU device-loss 是终止性
边界：收到错误后重建游戏/renderer realm，不要继续使用旧 device。Native gfx 生命周期由
Cocos 管理；适配器不会自行重建引擎 device。

该包只支持精确 3.8.8。升级 Creator 前必须重新核验 `RenderEntity`、`RenderDrawInfo`、
`Batcher2D`、WebGPU device 与 Native 桥，并重跑全部真实后端验收。
