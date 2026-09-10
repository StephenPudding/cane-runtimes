# Cane Godot 原生运行时

[English](README.md) | **简体中文**

原生 Windows x64 扩展的接入方式见[安装说明](docs/INSTALLATION.md)，
所需的准确依赖版本见[源码构建指南](../../docs/BUILDING.md)。

[公开 SDK 指南](docs/SDK.md)介绍数据与能力查询、独立快照、采样、原子创作批处理、独立皮肤构建器和配置克隆。

此 GDExtension 面向无需 .NET 的普通 Godot 4.5。`CaneSkeletonData` 拥有不可变的 C++ Core 数据和解码后的引擎纹理。
`CaneSkeleton` 拥有一个原生 Core 播放器，发出具有独立所有权的事件字典，并按数据包顺序将最终发布结果上传到子 CanvasItem。
适配器不重复执行动画、约束、裁剪、变形、Atlas UV 或创作颜色计算。

## 渲染约定

[性能诊断](docs/PERFORMANCE.md)说明材质状态复用、每次发布的上传计数和最终几何批处理。

开启 `Viewport.use_hdr_2d`，使合成在线性空间中进行；Godot 4.5 的 Compatibility 后端也支持此选项。
适配器会检查该要求。它只翻转一次最终顶点 Y，保留输入的 UV 和三角形顺序。
图集裁边、旋转、裁剪和诊断用 `sourceAffine` 已由 Core 处理。

纹理颜色空间和 straight/PMA 元数据决定着色器的解码方式。明暗颜色字节从 sRGB 转为着色器计算空间；
显式黑色暗色与未启用双色着色保持不同。显式纹素采样保留 Atlas 独立的 min/mag 过滤，
以及 U/V 方向的 clamp/repeat/mirror 规则。

Normal 混合使用 Godot 的预乘 alpha 管线。Add 通过提交 `(Cs/sqrt(As), sqrt(As))` 补偿 Godot 的
`SRC_ALPHA` 因子，无需复制目标即可得到所需的 `Cs+Cd, As+Ad`。
Multiply 和 Screen 在每个三角形绘制前读取当前线性目标 RGB，再将修正后的来源提交给原生预乘管线。
原生混合保留目标 alpha，不依赖 Forward+ 屏幕复制纹理的 Alpha。逐三角形复制 RGB 可以正确处理自身重叠的网格。

资源先暂存并通过 Core 尺寸验证，只有所有引用纹理解码成功后才提交。重新加载 Resource 时，
已有播放器仍保留原先的不可变资源快照。纹理、材质和 CanvasItem RID 始终位于 Core 之外，
由拥有它们的适配器对象释放。

Core 的[加载计划](../docs/LOADING.md)在数据构建完成前提供有序解码请求，
包括未声明宽度、高度或两者均未声明的独立图片。适配器不会猜测尺寸。

## 当前脚本接口

[最终几何修改器](docs/GEOMETRY_MODIFIERS.md)提供原生抖动、径向波浪和受限的同步脚本回调，
在最终裁剪和颜色计算后执行。持久与临时操作、UV/颜色编辑，以及姿势/几何联合提交，均保留 Core 的事务边界和发布所有权。

[临时姿势修改器](docs/POSE_MODIFIERS.md)在一次 Core 求值中按顺序应用逐帧 Bone 和约束编辑，
可选择固定帧或阶梯采样，并在下一次普通求值时失效。

[约束控制与查询](docs/CONSTRAINTS.md)提供 Core 全部五类约束、诊断、Path 正向/反向查询和 Transform Match。
约束补丁可以加入原子 Bone/Region 姿势批处理，在一次求值中完成。

[宿主姿势与 Physics 控制](docs/HOST_CONTROLS.md)提供完整的局部 Bone/Region 覆盖、有序原子姿势批处理、
根变换、显式 Physics 运动/环境/重置控制、独立 Physics 推进和独立姿势查询。
这些值使用 Core 坐标，并通过一次求值生效。

[动画轨道与队列](docs/PLAYBACK.md)提供 Core 混合配置、替换/叠加覆盖、播放范围/时间/速度/阈值控制、
队列条目编辑、空动画渐隐和独立播放状态查询。

[运行时资源事务](docs/RESOURCES.md)支持按顺序添加、更新或移除图片、Atlas、附件和皮肤，
显式获取引擎文件，以及恢复原始资源。适配器替换可见资源前，Core 提交前回调会验证纹理并准备尚未显示的绘制对象。

[`CaneBone2D`](docs/BONE_FOLLOWERS.md) 跟随已发布骨骼的完整仿射矩阵，保留反射、错切、产生奇异矩阵的动画缩放和宿主变换。
它的普通 Godot 子节点可以包含精灵、粒子、碰撞形状或其他游戏节点。
已注册跟随器在公开帧/事件通知之前更新；跟随和引擎变换变化不会触发 Core 采样或数据包上传。

- `CaneSkeletonData.load_files(runtime_file, atlas_files)` 支持 JSON/CANEB 和 Atlas 文档。
  旧版第三个布尔参数仍可传入，但不产生影响；`get_last_error()` 返回结构化失败信息。
- `CaneSkeleton.skeleton_data`、`automatic`、`play`、`queue`、`advance`、`apply`、`sample_at`、
  `set_skins`、`set_attachment`、`clear_attachment`、`clear_track`、`reset` 用于控制原生播放器。
- `runtime_event`、`frame_updated` 和 `runtime_error` 信号包含独立拥有的值。发布信号期间，包括初次赋值数据时，
  都会拒绝重入修改。初始赋值发布一次通知；未变化的渲染刷新和重新进入场景不会再次发布帧。
- `sample_at` 将重放事件与增量 `runtime_event` 通知分开保留。`get_replay_events()` 返回最近成功重放批次的深拷贝，
  重放失败不会改变该批次。数据包快照的位置仍采用 Core X 向右/Y 向上坐标；
  `get_bone_transform` 将已发布骨骼矩阵转换为跟随器使用的 Godot 局部坐标。
- 原生 C++ 宿主可通过 `native_player()` 访问底层公开 Core。用 `refresh_render()` 投影 Core 已发布的帧；
  仅在需要求值时使用 `apply()`，例如 Core `update()` 之后。

宿主约定参考的 Godot 来源：[CanvasItem 着色器](https://docs.godotengine.org/en/4.5/tutorials/shaders/shader_reference/canvas_item_shader.html)、
[HDR 2D Viewport](https://docs.godotengine.org/en/4.5/classes/class_viewport.html#class-viewport-property-use-hdr-2d)和
[Godot 4.5 GLES3 混合状态](https://github.com/godotengine/godot/blob/4.5-stable/drivers/gles3/rasterizer_canvas_gles3.cpp)。

[`CaneSlot2D`](docs/SLOT_NODES.md) 在完整采样后的 Slot 边界插入普通游戏内容，跟随已发布的所属骨骼矩阵，
并保留隐藏 Slot 的顺序。

[`CanePoint2D`](docs/POINT_FOLLOWERS.md) 跟随完整的已发布 Point 变换，支持明确的按名称或当前选中状态控制可见性。
Bone 和 Point 跟随器共享坐标、调度和生命周期实现。

## 从源码构建

请参阅[源码构建说明](../../docs/BUILDING.md)。
