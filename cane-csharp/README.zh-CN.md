# Cane C# 运行时

[English](README.md) | **简体中文**

本目录独立实现 Cane Runtime Format v1 和 Runtime API v1.3。Core 是 `netstandard2.1` 库，
不依赖引擎、Rust、FFI、解释器或外部 JSON 库。Unity 集成位于 `cane-unity`，使用 Core 输出的最终渲染数据包。

## Core 与 Unity 集成

Core 负责加载与验证、动画轨道/队列/混合、约束、Physics、皮肤与变形、裁剪、最终渲染数据包、
实例资源、查询和事务化播放器状态。动画关键帧允许骨骼零缩放，初始骨骼和 Region 缩放仍遵守格式验证规则。

公开接口约定见[加载](docs/LOADING.md)、[约束与播放](docs/CONSTRAINTS_AND_PLAYBACK.md)、
[几何与资源](docs/GEOMETRY_AND_RESOURCES.md)和[工程替换](docs/PROJECT_RECONCILIATION.md)。
[Unity 安装说明](cane-unity/docs/INSTALLATION.md)介绍引擎包及宿主配置。

## 数据与所有权

[分阶段加载外部资源](docs/LOADING.md)将不可变的解码请求与完整 `RuntimeData` 分开。
宿主可以先解码未声明宽度或高度的独立图片，再在发布前提供完整的实际尺寸目录。Unity 使用这一路径，不猜测图片尺寸。

安装后的资源是不可变值；播放器的有效资源目录是在 `SourceData` 上叠加实例独立覆盖的结果。
Unity/GPU 对象不能进入这些值。几何回调通过受限的编辑接口在 Core 中执行；递归修改同一播放器的尝试会整体失败，
不会提交部分状态。

功能声明会与模型实际使用情况核对。资源事务包含新增功能需求，默认接受已验证的功能，并保留原始 CANEB 警告元数据。

## Core 用法

[能力查询](docs/CAPABILITIES.md)提供支持的版本、不可变功能列表、API 功能位和最近通过的 Core 测试套件摘要。
已知功能默认可加载，未知功能和不支持的版本始终会被拒绝：

```csharp
var data = RuntimeData.FromJson(runtimeJson, new RuntimeLoadOptions {
    AtlasJson = atlasDocumentsById
});
var player = data.CreatePlayer();
player.SetAnimation(animationId, looping: true);
player.Advance(deltaSeconds);
RenderPacket packet = player.Frame.RenderPacket;
```

宿主通过数据包描述符解析纹理，按数据包顺序上传最终世界坐标 XY、UV、索引、明暗颜色和声明的混合模式。
不得再次向顶点应用 `SourceAffine`、重算图集 UV 或颜色，或再次执行约束、变形和修改器。
Core 世界坐标为 X 向右、Y 向上，UV 原点位于左上角。保留的帧具有独立所有权；保留的 `RuntimeBounds` 视图
在下一次写入同一个 Bounds 对象时失效，`Snapshot()` 则返回具有独立所有权的结果。

即使所有来源顶点仍是有限值，Bounds 查询也会以 `NonFinite` 拒绝 binary32 宽度或高度溢出，
错误字段为 `aabb.width` 或 `aabb.height`。此类读取失败不会改变播放器已发布的帧或播放状态。
与其他失败写入相同，在下一次成功重写前，不应使用所提供 Bounds 缓冲区中的内容。

播放器是单写入者对象，数据和已经发布的不可变帧可以共享。`Update` 推进状态但不发布帧；
`Apply` 发布帧但不推进动画时钟。求值失败会保留此前的帧、轨道、Physics 历史、覆盖层和待处理事件。
`CloneConfiguration` 创建的实例不包含轨道、队列、事件或求解器历史。

公开约定详见[几何、创作与资源 API](docs/GEOMETRY_AND_RESOURCES.md)和
[约束、快照与播放控制](docs/CONSTRAINTS_AND_PLAYBACK.md)。NuGet 包包含这些指南，以及工程状态协调和能力查询文档。

[已发布 Slot 查询](docs/SLOT_QUERIES.md)提供完整采样顺序与所属骨骼姿势，不进行求值。

[Point 与骨骼激活状态查询](docs/POINT_QUERIES.md)提供完整仿射及已发布的选中/激活状态，不增加规范化传输字段。

[Core 性能与所有权](docs/PERFORMANCE.md)说明预编译皮肤、私有姿势/渲染工作区和不可变数据通道共享。
发布的帧保持独立所有权；动画和资源变化可能分配内存。

## 从源码构建

请参阅[源码构建说明](../docs/BUILDING.md)。
