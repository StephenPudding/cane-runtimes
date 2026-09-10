# Godot 编辑器使用流程

使用普通 Godot 4.7.2（Windows x64）。原生插件无需 .NET 或 C++ 编译器。
旧版渲染器限制见[安装说明](INSTALLATION.md)。

[English](EDITOR_WORKFLOW.md)

Windows x64 插件使用原生 C++ Core 和 GDExtension。把编译好的插件放进普通 Godot
工程即可使用，无需安装 .NET 或 C++ 编译器。`editor/` 下的脚本只负责编辑器集成。

## 安装和导入

1. 将插件压缩包解压到工程，确认存在 `addons/cane/cane.gdextension`、
   `addons/cane/bin/cane-godot.dll` 和 `addons/cane/plugin.cfg`。
   替换已经加载的 DLL 后，需要重新打开 Godot。
2. 在 **项目 → 项目设置 → 插件** 中启用 **Cane**。
   插件会为工程和编辑器的 2D 视口启用 HDR 2D，保证颜色混合正确。
3. 将完整的 Cane Runtime 导出复制到工程：JSON 或 CANEB、图集 JSON，以及引用的图片。
   保持这些文件之间的相对路径。
4. CANEB 会自动导入为场景。Runtime JSON 请通过 **项目 → 工具 → Import Cane animation…**
   选择导出文件。插件会在旁边生成一个很小的 `.cane` 引用文件，再将它导入为场景。
   工程中的其他 JSON 文件仍按 Godot 原有方式处理。
5. 从文件系统面板把 CANEB 或 `.cane` 资源拖入 2D 场景。

导入的场景包含 `CaneSkeleton` 节点，引用生成的 `CaneSkeletonData`。
骨骼数据、纹理和导入场景由 Godot 管理，不要直接编辑 `.godot/imported` 中的文件。

## 配置和预览

选中实例后，用 **Animation** 选择动画或初始姿势。**Skins** 可以添加、删除和调整皮肤顺序；
后面的皮肤会覆盖前面皮肤对应的附件。不同实例可使用不同组合，共享骨骼数据。
有些导出的默认皮肤是空的，需要先选择皮肤才能显示角色。

**Initial Loop** 和 **Playback Speed** 会随场景保存，速度为零时暂停自动播放。
预览面板支持播放、暂停、回到起点和拖动时间，使用游戏中相同的原生 Core 播放器。
关闭对应属性面板后预览停止，预览的播放状态不会存入游戏场景。

普通游戏播放保持 **Automatic** 开启；自己编写更新逻辑时再关闭。
手动调用 `advance(delta)` 时使用传入的时间差，面板中的速度倍率只影响自动播放和编辑器预览。
多轨道、混合、动画队列和事件接口见[播放说明](PLAYBACK.md)。

## 重新导入和引用

修改源动画、图集或图片后，会触发重新导入。依赖记录放在 Godot 可重新生成的 `.godot` 缓存中。
导入数据更新时保持共享资源引用，并通过原生工程更新接口保留兼容的播放状态。
格式错误或缺少文件时，编辑器会显示错误；恢复依赖后会重新尝试导入。

移动资源时，请把导出目录、JSON/CANEB、图集、图片以及 `.cane` 引用一起移动。
导出文件中的相对路径仍然有效。单独移动图片后，还需要同步修改导出数据中的图片路径。

手动调用 `CaneSkeletonData.load_files` 的旧接口仍保留原有快照语义：重新加载资源不会自动替换
已经存在的播放器。编辑器导入和序列化资源才会启用资源更新。

## 运行和导出游戏

保存场景后即可正常运行。使用 Godot 标准的 Windows Desktop 导出预设和导出模板构建游戏。
生成的骨骼资源内含经过验证的 Runtime 数据和图集文档，纹理作为普通 Godot 资源依赖。
Godot 的 GDExtension 导出流程负责包含原生扩展，编辑器插件脚本会从游戏中排除。
“导出所有资源”和“导出选定场景”都会包含生成的原生骨骼数据，无需手动添加 `.godot/imported` 包含规则。

此插件包只包含 Windows x64 原生库。其他系统或架构需要分别构建并验证对应的库。
如果使用自己的 SubViewport 渲染 Cane，也要开启它的 `use_hdr_2d`。
引擎版本和渲染设置见[安装说明](INSTALLATION.md)。
