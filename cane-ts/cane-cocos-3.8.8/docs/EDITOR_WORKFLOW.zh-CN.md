# 在 Cocos Creator 中使用 Cane

适用于 **Cocos Creator 3.8.8**。使用预构建扩展包时，无需安装 Node.js、pnpm，
也无需编译 Cane Runtime。游戏脚本编译和平台构建仍由 Creator 完成。

## 安装

1. 从 [Cane Releases](https://github.com/StephenPudding/cane-runtimes/releases)
   下载 Cocos Creator 3.8.8 的扩展 ZIP。
2. 关闭目标 Creator 工程，把压缩包中的 `cane-runtime` 文件夹放入工程的
   `extensions`，最终路径为 `extensions/cane-runtime/package.json`。
3. 使用 Creator 3.8.8 打开工程，等待扩展和资源导入完成。资源面板会出现
   `cane-runtime` 挂载目录，其中包含脚本、类型声明和颜色 Effect。

每个工程只安装一份 Cane 扩展。扩展已包含 TypeScript Core 和 Cocos 适配器，
不要同时导入另一份脚本包注册同名组件。更新扩展时保留项目资源的 `.meta`，
并使用发行包自带的脚本和 Effect `.meta`，以保持场景引用。

## 导入并放入场景

1. 从 Cane 导出 **Runtime JSON 或 CANEB**，以及它引用的 Atlas JSON 和图片。
   把整组文件放入 Creator 的 `assets`，保持导出时的相对目录结构。
2. 导入完成后，骨骼文件会成为 `CaneSkeletonDataAsset`。普通 JSON 文件仍按
   Creator 原有方式导入。此扩展读取 Cane Runtime 格式，不读取编辑器工程文件。
3. 在 2D 场景中，将骨骼资源放到 `Canvas` 下，生成带 `CaneSkeleton` 的节点。
   也可以为已有 `UITransform` 节点添加 `CaneSkeleton`，再指定骨骼资源。
4. 在组件属性中选择动画，添加皮肤，设置循环和播放速度。皮肤按照列表顺序叠加，
   后面的皮肤覆盖前面对应的附件。空动画表示设置姿势。
5. 点击“播放预览”，或输入秒数查看指定时刻。停止预览不会写入动画关键帧。
   保存场景会保存资源引用、动画、皮肤、循环和速度；预览时间和播放状态不保存。

Atlas、图片和颜色 Effect 引用自动维护，不需要逐个创建材质。移动资源时使用
Creator 资源面板移动整组目录，以保留 `.meta` 和 UUID。修改源文件会触发重导入；
缺少依赖时控制台会报告具体文件，补回文件后自动重新导入。

## 在游戏脚本中控制

使用扩展提供的 `db://` 模块路径，Creator 会解析脚本及类型声明：

```ts
import { _decorator, Component } from 'cc';
import { CaneSkeleton } from 'db://cane-runtime/cane-runtime.mjs';

const { ccclass, property } = _decorator;

@ccclass('HeroAnimation')
export class HeroAnimation extends Component {
  @property(CaneSkeleton)
  hero: CaneSkeleton | null = null;

  async start() {
    if (!this.hero) return;
    await this.hero.initialize();
    this.hero.setAnimation(0, 'idle', true);
    this.hero.onEvent('user', event => console.log(event.name));
  }
}
```

`idle` 需要替换为导出文件中的动画 ID 或名称。保存的配置在初始化时应用，
普通游戏帧不会重启通过脚本设置的动画。节点禁用后可以再次启用；移除角色时调用
Creator 的 `node.destroy()`，由组件释放自己的播放器和资源租用。

## 构建游戏

把保存的场景加入 Creator 构建列表。Web Desktop 使用 WebGL；需要 WebGPU 时
在该平台的构建选项中启用 WebGPU。Windows Native 需要 Creator 正常的 C++
游戏构建工具链。Cane 是 TypeScript 集成，无需额外编译一个 Cane 原生库。

自动导入的 Effect 会随资源依赖进入游戏包，Web 和 Native 使用同一颜色约定。
可编程加载方式仍见 [API](API.md)，底层平台边界见 [后端说明](BACKENDS.md)。

| 验证范围 | 当前说明 |
| --- | --- |
| Creator | 3.8.8；其他版本不能据此推定兼容 |
| 编辑器 | 自动导入、创建节点、配置与预览、保存重开、依赖重导入 |
| Web | WebGL 和 WebGPU；需要支持相应后端的浏览器和 GPU |
| Native | Windows x64 / GLES3；其他原生平台需单独验收 |

WebGPU 设备丢失后需要重新创建应用，详见后端说明。
