# Cane TypeScript 运行时

[English](README.md) | **简体中文**

TypeScript 工作区包含四个生产环境使用的包：

- [Core](cane-core/README.zh-CN.md)：数据解码、验证、动画、约束和最终渲染数据包。
- [PixiJS v8](cane-pixi-v8/README.zh-CN.md)：PixiJS 8.18.1 资源管理、渲染和更新调度。
- [LayaAir 3.4.1](cane-layaair-3.4.1/README.zh-CN.md)：适配指定版本的 WebGL/WebGPU 渲染后端。
- [Cocos Creator 3.8.8](cane-cocos-3.8.8/README.zh-CN.md)：适配指定版本的 Web 和原生渲染后端。

适配层使用 Core 的输出，不会重复进行动画或约束计算。Core 默认的严格模式会发布具有独立所有权、已冻结的数据。
性能模式返回可复用的帧和渲染数据包，宿主必须在下一次修改状态前使用这些数据。

请参阅[源码构建说明](../docs/BUILDING.md)、[兼容性说明](../docs/COMPATIBILITY.md)、
[Runtime API 1.2 迁移指南](../docs/MIGRATION_RUNTIME_API_1_2.md)和
[Runtime API 1.3 迁移指南](../docs/MIGRATION_RUNTIME_API_1_3.md)。
