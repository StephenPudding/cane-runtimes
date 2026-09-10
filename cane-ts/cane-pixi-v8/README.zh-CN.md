# @cane-runtime/pixi-v8

[English](README.md) | **简体中文**

基于 `@cane-runtime/core` 的高性能 PixiJS v8.18.1 适配器。Core 提供最终世界坐标顶点、UV、
三角形顺序、颜色和混合元数据；适配器不采样动画，也不重复应用附件变换。

完整的着色器颜色处理需要使用 WebGL 或 WebGPU。Canvas2D 的着色和合成存在明确限制，详见
[渲染器能力表](../../docs/COMPATIBILITY.md)。

## 默认批处理路径

`CanePixiRuntime` 继承 Pixi 的 `Container`，并围绕 Slot 对象组合一个或多个内部 `CanePixiBatchView`
分段，这是面向生产使用的路径。在调用 `Application.init(...)` 前导入本包，确保 Pixi 创建渲染器之前
已注册 `cane-v1` WebGL/WebGPU 渲染管线和批处理器。

这一路径提供：

- 每个 Cane 实例使用一个 Pixi 场景节点。
- 持久附件记录；通过弱关联的修改版本借用 Core 索引，外部数据包则使用可复用的类型化暂存区。
- 由附件记录保留、归属于渲染器的批处理元素，切换皮肤或序列时复用缓存附件，无需每次重建。
- 直接借用 Core 位置和 UV 数组，仅在 Pixi 打包共享 Buffer 时进行一次 Y 轴转换。
- 纯单色使用 24 字节顶点布局，支持双色时使用 28 字节布局；每批纹理数量根据设备能力确定，回退值为八张纹理。
- 在纹理容量、混合状态和绘制顺序允许时，合并相邻实例的批次。
- 在线性光空间中计算单色和双色着色。
- 支持 sRGB/linear 与 straight/premultiplied 来源声明。
- 映射 Pixi 的 `normal`、保留准确 alpha 的 `add-npm`、`multiply` 和 `screen` 混合模式。
- `once`（默认）、`always` 和 `none` 验证策略。
- 逻辑 Buffer 上传量、拓扑重打包量和独立绘制次数统计。
- 渲染管线预初始化，使 Pixi WebGPU 首次绑定自定义几何时不会与内置批次几何缓存混淆。
- 使用官方 Pixi Canvas 管线保留 Core 几何、UV、alpha 和裁剪，同时明确不提供仅着色器支持的明暗双色及线性光等价效果。

```ts
import { Application, Assets } from "pixi.js";
import { RuntimeDataV1 } from "@cane-runtime/core";
import {
  CanePixiRuntime,
  CanePixiAssetV1,
  CanePixiSchedulerV1,
  PixiTextureStore,
} from "@cane-runtime/pixi-v8";

// Package import above registers the render pipe before renderer creation.
const app = new Application();
await app.init({ canvas, preference: "webgpu" });

const data = RuntimeDataV1.fromJson(runtimeJson, {
  atlases: atlasDocuments,
});
const player = data.createPlayer({ executionMode: "performance" });
player.setAnimation({ trackIndex: 0, animationId: "idle", looping: true });

// caneBatch is the default and preserves source bytes for the Cane shader.
const textures = new PixiTextureStore({
  baseUrl: "/assets/",
  pipeline: "caneBatch",
});
await textures.preloadData(data);

const character = new CanePixiRuntime({
  player,
  textures,
  autoUpdate: false,
  validationMode: "once",
});
app.stage.addChild(character);

// One listener and deterministic iteration order for all Cane instances.
const scheduler = new CanePixiSchedulerV1({
  ticker: app.ticker,
  measureFrameTime: true,
});
scheduler.add(character);
```

如果需要一次调用完成资源加载与所有权管理，本包会在导入时向 `PIXI.Assets` 注册 CANEB 和 Runtime JSON：

```ts
const asset = await Assets.load<CanePixiAssetV1>({
  alias: "hero",
  src: "/assets/hero.caneb",
});
const player = asset.data.createPlayer({ executionMode: "performance" });
const character = new CanePixiRuntime({ player, textures: asset.textures });
// Later: await Assets.unload("hero");
```

## 可选的传统浏览器脚本包

`pnpm run build` 还会生成 `dist/iife/cane-pixi-v8.min.js`。它内嵌完整的 `@cane-runtime/core`
和 Pixi 适配器，PixiJS 保持为外部依赖。先加载匹配的 PixiJS 全局脚本，再加载此包；
它会安装资源与渲染器扩展，并导出 `globalThis.CanePixi`。内嵌的不依赖渲染器的 API 位于 `CanePixi.Core`。

```html
<script src="/vendor/pixi.min.js"></script>
<script src="/vendor/cane-pixi-v8.min.js"></script>
<script>
  (async () => {
    const app = new PIXI.Application();
    await app.init({ resizeTo: window, preference: "webgl" });
    document.body.appendChild(app.canvas);

    const asset = await PIXI.Assets.load({
      alias: "hero",
      src: "/assets/hero.caneb",
    });
    const player = asset.data.createPlayer({ executionMode: "performance" });
    const hero = new CanePixi.CanePixiRuntime({
      player,
      textures: asset.textures,
    });
    app.stage.addChild(hero);
    hero.setAnimation(0, "idle", true, 0.2);
  })();
</script>
```

缺少 `globalThis.PIXI` 时，脚本包会给出明确的启动错误。包元数据中的 `unpkg` 和 `jsdelivr` 字段指向该文件，
普通 npm 导入仍使用支持 tree-shaking 的 ESM 入口。

不要对 `character.scale.y` 取反；批处理器只转换一次世界坐标 Y。`performance` 播放器返回临时复用的 DTO，
应立即使用帧，仅复制需要保留到下一次更新之后的数据。

## 纹理与颜色约定

`PixiTextureStore` 提供两种不能混用的处理路径：

- 默认的 `caneBatch` 保留解码后的来源字节，由 Cane 着色器解释 Runtime 的 `colorSpace` 和 `alphaMode`，
  再输出 Pixi 混合状态所需的数据表示。
- `pixiBasic` 仅用于旧版 `CanePixiView` 与 `BasicPixiMeshFactory`。Pixi 会在上传时为其内置 Mesh 着色器
  对 straight-alpha 图片进行预乘。

纹理存储与不匹配的视图配对时会被拒绝。已注册或缓存的纹理也会检查 Pixi 来源 alpha 模式，
防止同一 URL 在上传语义不同的路径之间被静默复用。

`preloadData(data)` 加载独立图片和所有 Atlas 页面，应用声明的过滤与环绕状态，并在渲染前验证解码尺寸。
宿主若有意仅加载当前可见资源，可以使用 `preload(packet)`。

纹理存储在实例之间共享 `PIXI.Assets` 租约，只有最后一个所有者释放后才卸载。部分加载失败会回滚，之后可以重试。
外部注册纹理默认仍归宿主所有，除非明确设置 `ownership: "store"`。
`bindRendererContextLifecycle(renderer)` 处理 WebGL 丢失/恢复事件或 WebGPU `device.lost`；
渲染器或设备替换后，保留的来源数据会按需重新上传。

## 骨骼、Slot、裁剪、Bounds 与诊断

`addBoneObject` 使用完整仿射变换跟随最终骨骼矩阵。`addSlotObject` 将一个或多个外部 Pixi 对象插入
Slot 当前附件之前或之后，保留 Cane 绘制顺序，并显示所需的批次拆分信息。相关选项控制附件时间轴可见性、
允许显示的附件列表、继承的 Slot alpha，以及 Core 生成的裁剪。
`getSlotObject`、`querySlotObject`、`writeSlotObjects`、`removeSlotObject` 和 `removeSlotObjects`
提供查找和生命周期管理，不暴露内部挂载对象。

`getBonePosition`、`boneToGlobal` 和 `globalToBone` 只进行一次 Cane Y 向上与 Pixi Y 向下的坐标转换，
保留错切、反射、负缩放及任意 Pixi 父级变换。`runtime.bounds` 封装可复用的 Core Bounds，提供局部或全局
AABB、点和线段辅助方法，不推进 Core。可选的 `CanePixiDebugViewV1` 可绘制骨骼、Bounding Box、裁剪、
绘制顺序标签、批次分段，以及求值、CPU 和上传统计。

动态 Skin/Attachment/Image/Atlas 事务、根节点 Physics 模式和最终几何修改器都会转发到同一个 Core 控制器。
适配器重新投影返回的帧，不再次采样、求解约束、裁剪或修改几何。

## 多实例与性能观测

使用 `CanePixiSchedulerV1` 时，将 Runtime 的 `autoUpdate` 设为 `false`。
`scheduler.stats()` 在非逐帧路径中汇总活跃几何、逻辑顶点字节数、索引重打包量和独立绘制次数估计。
`scheduler.frameTimes.snapshot()` 只在请求报告时分配内存，记录过程使用固定容量的类型化环形缓冲区。

`isolatedDrawCalls` 是对单个 Cane 视图的确定性估计。默认的 `colorBatching: "instance"` 策略在任意
活跃附件需要双色着色时，对整个视图选择 28 字节布局，避免角色内部因颜色布局不同而拆分批次，
与 Spine Pixi 按实例选择暗色着色的策略一致。`colorBatching: "attachment"` 尽量减小单个顶点的数据量，
但单色和双色附件交替出现时可能拆分批次。Pixi 可能合并相邻的兼容视图，因此应以整个渲染器的统计为准。
`vertexUploadBytes` 表示所选 24/28 字节布局的逻辑数据量，不是驱动层传输计数。

未激活的附件记录与对应的渲染器批处理元素拥有相同的按帧保留周期。返回已缓存的皮肤或序列页面时，
两种对象都会复用；侵入式 LRU 会淘汰旧记录，无需每帧扫描完整缓存。

## 旧版 Mesh 兼容路径

`CanePixiView` 为每个附件保留一个 Pixi `Mesh`，用于调试或自定义工厂集成。
内置 `BasicPixiMeshFactory` 仅接受单色、sRGB、straight-alpha Runtime 数据包，并要求
`new PixiTextureStore({ pipeline: "pixiBasic" })`。它不提供完整的严格 Cane 材质约定，
场景节点数量和绘制次数也与批处理路径不同。

[Runtime API 1.2 迁移指南](../../docs/MIGRATION_RUNTIME_API_1_2.md)介绍最初的游戏控制 API，
[Runtime API 1.3 迁移指南](../../docs/MIGRATION_RUNTIME_API_1_3.md)介绍动态资源、Bounds、Physics 和最终几何，
[兼容性策略](../../docs/COMPATIBILITY.md)说明后端限制，
[性能与所有权说明](../../docs/PERFORMANCE.md)说明内存分配边界和帧所有权。

## 从源码构建

请参阅[源码构建说明](../../docs/BUILDING.md)。
