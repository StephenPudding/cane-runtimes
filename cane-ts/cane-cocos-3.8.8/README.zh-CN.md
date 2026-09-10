# @cane-runtime/cocos-3.8.8

[English](README.md) | **简体中文**

完整面向 **Cocos Creator 3.8.8** 的 Cane Runtime 适配器。包保持 `private: true`、
`UNLICENSED`，并严格依赖 Creator 提供的虚拟 `cc` 模块，不包含第二份 Cocos Engine。

## 安装和打开示例

下载发行版中的 Creator 3.8.8 插件，将解压得到的 `cane-runtime` 文件夹放入工程的
`extensions`，再重新打开工程。Core、适配器、颜色 Effect 和类型声明均已构建好，
无需安装 Node.js 或单独编译 Runtime。

将 Runtime JSON/CANEB、Atlas JSON 和图片一起导入，保留相对路径。
把骨骼资源拖到 2D Canvas 下，在 Inspector 中设置动画、皮肤、循环和速度，
点击播放预览。保存场景后即可使用 Creator 运行和构建游戏。
配套 Cane Bot 示例包含保存好的场景、4 个动画、2 套皮肤和可分发的原创素材。

完整步骤见[中文编辑器说明](docs/EDITOR_WORKFLOW.zh-CN.md)。下方 API 也可用于代码加载和控制角色。

`@cane-runtime/core` 是动画、混合、骨骼、约束、Physics、deform、clipping、tint 与最终
几何的唯一权威。该包只负责 Cocos 资源、生命周期、坐标、场景对象、GPU 上传与提交；正常
一帧始终只有一次 Core sample、一次 solve 和一次 publish。

## 支持范围

- 正式 `CaneSkeleton extends UIRenderer` 组件与可序列化 `CaneSkeletonDataAsset`；
- 统一 `CaneSkeletonSystem`，以及手动/共享 `CaneCocosSchedulerV1`；
- WebGL、WebGPU 和 Windows Native，三者消费同一个 `RuntimeRenderPacketV1`；
- Region、Mesh、Weighted Mesh、Deform、Linked Mesh、Sequence；
- draw order、Core clipping、attachment visibility、Slot before/after 对象；
- light/dark tint、alpha、straight/PMA、sRGB/linear 元数据；
- normal、additive、multiply、screen；
- 完整仿射、shear、reflection、negative scale 的 Bone/Slot follower；
- `boneToWorld/worldToBone` 与 `boneToGlobal/globalToBone` 均保留，便于 Cocos/Spine 风格迁移；
- CANEB、Runtime JSON、Atlas、direct image、Bundle/URL/宿主 resolver；
- 共享资源去重、引用计数、事务回滚、卸载、WebGL 纹理恢复与明确的 WebGPU device-loss
  终止边界；
- Spine 风格动画、姿势、约束、Skin/Attachment、Physics、Bounds、事件和动态资源 API；
- REALTIME/SHARED_CACHE/PRIVATE_CACHE。缓存只复用已发布帧的 Cocos 投影，不跳过 Core
  求值，因此不会形成第二套动画状态。

## 最小用法

推荐使用预构建的 Creator 扩展：包含 Core、适配器、类型声明和颜色 Effect，
无需手动编译。把扩展放到工程 `extensions/cane-runtime`，一起导入骨骼、Atlas
和图片，再配置场景中的 `CaneSkeleton`。详见
[安装、导入与编辑器预览](docs/EDITOR_WORKFLOW.zh-CN.md)。
此方式会自动引用 Effect；下面的手动加载方法保留给编程接入。

扩展的脚本导入路径是 `db://cane-runtime/cane-runtime.mjs`，不要重复安装另一份 Runtime。

在 Creator 脚本中导入并把组件加到带 `UITransform` 的节点：

```ts
import { Node, UITransform, resources } from "cc";
import {
  CaneSkeleton,
  CocosBundleResourceResolverV1,
} from "@cane-runtime/cocos-3.8.8";

const node = new Node("Hero");
node.addComponent(UITransform);
const hero = node.addComponent(CaneSkeleton);

await hero.load("characters/hero.caneb", {
  resolver: new CocosBundleResourceResolverV1(resources),
});
hero.setAnimation(0, "idle", true);
```

### 颜色 Effect（Native 必需）

把包内的 `cocos-assets/cane-runtime-color.effect` 导入 Creator 项目的 `assets`，并把 Creator
生成的 `EffectAsset` 赋给 `CaneSkeleton.colorEffectAsset`。建议 WebGL、WebGPU 和 Native 都使用
同一个已导入 Effect；这样 sRGB/linear 与 straight/PMA 会走完全相同的线性光颜色计算，避免
半透明边缘出现白边。可以把它放在 `assets/resources/cane-runtime-color.effect` 并在角色加载前
通过 `resources.load("cane-runtime-color", EffectAsset, ...)` 赋值。

Web 平台在未指定该资源时可从 Cocos 3.8.8 内置 Spine Effect 动态建立等价 Effect；Native 的
pipeline layout 在构建期确定，因此缺少已编译 Effect 时会明确报错，不会静默退回错误材质。

序列化工作流可在 Creator 中给 `CaneSkeleton.skeletonData` 指定
`CaneSkeletonDataAsset`。程序化 URL、`ArrayBuffer` 或 JSON 工作流分别使用
`loadCaneCocosAssetV1`、`createCaneCocosAssetFromCanebV1`、
`createCaneCocosAssetFromJsonV1`。

角色操纵示例：

```ts
hero.setMix("walk", "shoot", 0.15);
hero.setAnimation(0, "walk", true);
hero.addAnimation(0, "idle", true, 0);
hero.setSkin("armored");
hero.setAttachment("weapon", "rifle");

const stopAim = hero.beforeConstraints(pose => {
  pose.setConstraintTarget("aim-ik", pointerX, pointerY);
  pose.setConstraintMix("aim-ik", 1);
});
const stopEvent = hero.onEvent("user", event => console.log(event.name));
```

`autoUpdate` 默认开启，由唯一的 `CaneSkeletonSystem` 驱动。宿主自己控制时钟时设置
`autoUpdate = false` 并调用 `manualUpdate(deltaSeconds)`。`applyCurrentFrame()` 仅重新投影
已经发布的帧，不会再次采样或解算。

## 精确版本与构建

包的类型检查和构建在执行前都会核验：

- Cocos Creator：`3.8.8`；
- 官方 engine commit：`411f98df047c25902f93440d4b22925c2fb65461`；
- `@cocos/creator-types@3.8.8` declaration SHA-256：
  `88fa33fe074ccd5471fb1bea6779a37d025dbf9570a195fc0d9f684a3608dcc9`。

```sh
pnpm --filter @cane-runtime/cocos-3.8.8 typecheck
pnpm --filter @cane-runtime/cocos-3.8.8 build
```

输出为标准 ESM 与 `.d.ts`。`cc` 由 Creator 构建器解析，不能在普通浏览器或 Node 中脱离
Cocos 直接执行。

## 从源码构建

请参阅[源码构建说明](../../docs/BUILDING.md)。
