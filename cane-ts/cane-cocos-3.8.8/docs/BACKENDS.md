# Cocos 3.8.8 后端与内部接口边界

## 公开架构参考

实现基于公开 `cocos/cocos-engine` 3.8.8 tag、commit
`411f98df047c25902f93440d4b22925c2fb65461` 的行为审计。参考范围包括
`cocos/spine` 的 `Skeleton`、`SkeletonSystem`、assembler、缓存、socket、材质/资源，以及
`native/editor-support` 的 Spine middleware、Model、SkeletonCache 和原生桥。

只借鉴 Cocos 的组件/调度/提交组织方式；没有复制 Spine Runtime 源码、算法或专有数据结构。
Cane Core 仍独立产生最终 frame/packet。

## Web

`CaneSkeleton` 是 `UIRenderer`。保留的 geometry assembler 把 Core XY、UV、light/dark tint
和 indices 写入 Cocos `RenderData`/2D buffer，并按 texture、alpha/color-space、blend、
clipping 与 Slot object 建立连续提交段。WebGL 和 WebGPU 使用相同 CPU projection；Cocos
`gfx.Device` 决定真实 GPU backend。

WebGL/WebGPU 共用 Cane color Effect。纹理采样后根据 Core 的 color-space/alpha-mode 标志执行
sRGB 解码、PMA 反解、线性光 tint/two-color，再编码并输出 PMA；材质统一使用与该输出匹配的
blend factors。Web 可在运行时从 Creator 3.8.8 内置 Effect 建立兼容实例，也可使用构建期导入
的 `cane-runtime-color.effect`。

Slot before/after 对象采用 crossed traversal：组件控制子树遍历，并在目标 packet 段之间调用
2D `UI.walk`，防止普通场景遍历再次绘制同一子节点。

## Native

Native 仍上传相同 packed Core 几何。适配器创建 CROSSED `RenderEntity`，为每段产生动态
`MIDDLEWARE` draw info；Slot Node 用 `SUB_NODE` draw info 插入。它不链接或调用 Spine
middleware，也没有 Native 专属动画解算器。

Native custom pipeline 的 program/layout graph 在 Creator 构建阶段确定，不能可靠接受运行时
新增的 program name。因此包提供 `cocos-assets/cane-runtime-color.effect`，宿主须把它导入项目
并赋给 `CaneSkeleton.colorEffectAsset`；缺失时适配器返回结构化 `missingResource`，不会使用会
产生白边的内置颜色公式。

## 集中隔离的 3.8.8 内部接口

以下 Creator 接口不属于稳定公开 `cc` API，全部集中在 `src/internal-bridge.ts`：

- `RenderEntity` constructor/type `CROSSED`；
- `clearDynamicRenderDrawInfos` / `setDynamicRenderDrawInfo`；
- `RenderDrawInfo` constructor、`MIDDLEWARE` 与 `SUB_NODE`；
- `RenderData.fillDrawInfoAttributes` 及 draw-info texture/sampler/material/index setters；
- Web Node `_static` crossed traversal 标记。

WebGPU 的 `WebGPUDevice.nativeDevice.lost` 访问只在 `src/engine.ts`，且由
`CaneCocosDeviceLossMonitorV1` 统一 fan-out。每个入口先锁定 `cc.VERSION === 3.8.8` 并检查
所需方法/类型；契约变化会抛 `unsupportedInternalApi`。

## 能力与恢复边界

| 能力 | WebGL | WebGPU | Windows Native |
| --- | :---: | :---: | :---: |
| Core 完整几何/约束/Physics | 是 | 是 | 是 |
| sRGB/linear、straight/PMA、two-color、四种 blend | 是 | 是 | 是 |
| draw-order Slot objects | 是 | 是 | 是 |
| full-affine Bone/Slot followers | 是 | 是 | 是 |
| retained buffers/statistics | 是 | 是 | 是 |
| adapter 纹理原位恢复 | WebGL context 恢复 | 否，重建 realm | 交给 Cocos gfx |

Creator 3.8.8 的 WebGPU 实现监听 `GPUDevice.lost`，但没有可靠的整引擎原位 device 重建。
因此 Cane 暂停 Runtime 并报告 `contextLost`，不会把旧 GPU 对象伪装成已恢复。Native 目前以
Windows/GLES3 debug 构建验收；其他原生平台必须各自完成 Creator 工具链与真机验证后才能
加入兼容矩阵。
