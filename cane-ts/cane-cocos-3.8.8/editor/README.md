# Cane Runtime for Cocos Creator 3.8.8

Copy this folder to your project's `extensions/cane-runtime`, then reopen the
project. Core, the adapter and the color Effect are already built.

安装：将此目录放入工程的 `extensions/cane-runtime`，再用 Creator 3.8.8 打开。
无需安装 Node.js 或手动编译 Runtime。

Import Cane Runtime JSON/CANEB, Atlas JSON and images together. Place the
skeleton asset under a 2D Canvas and configure its animation, ordered skins,
loop and speed in the Inspector.

一起导入骨骼、图集和图片，保持相对目录结构。将骨骼资源放到 2D Canvas 下，
在组件属性中设置动画、皮肤、循环、速度，并使用播放预览。

Keep the supplied `.meta` files when upgrading. The module path for Creator
scripts is `db://cane-runtime/cane-runtime.mjs`.

See the release's `docs` folder for the full English and Chinese installation
guides, API and third-party notices.
