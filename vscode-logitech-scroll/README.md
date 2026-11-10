# Logitech Horizontal Scroll

把侧轮发送的快捷键转换为代码与顶部标签栏的平滑横滚。适用于能为侧轮左右分别配置快捷键的鼠标，不限制鼠标型号。

1. 从仓库根目录运行 `python scripts/install.py --plugin vscode-logitech-scroll`。
2. 在 Logi Options+ 的 VS Code 配置中，把侧轮左设为 `Ctrl+Shift+[`，侧轮右设为 `Ctrl+Shift+]`。
3. 执行 **Logitech: 启用或更新横滚补丁**，按 Custom CSS and JS Loader 提示重新加载。

插件会自动登记脚本路径，替换本仓库旧的根目录脚本导入，保留其他导入。鼠标悬停标签栏时滚动该标签列表，否则在代码区横滚，无需增加 VS Code 键绑定。

参数在设置中的 `logitechScroll.*` 下调整，修改后再次运行启用或更新命令。停用时执行 **Logitech: 停用横滚补丁** 并重载；卸载前先停用。

本目录运行 `npm run package`，或从仓库根目录运行 `python scripts/package_vsix.py vscode-logitech-scroll`，生成 `dist/logitech-horizontal-scroll-0.1.1.vsix`。参数和临时调试接口见 [Logitech_horizontal_scroll_patch.md](Logitech_horizontal_scroll_patch.md)。

生成脚本使用 `file:` 地址供 Loader 读取。旧版本若出现 `Cannot load 'vscode-userdata:…/scroll.js'`，更新后先重新加载 VS Code，再运行启用或更新横滚补丁命令，自动替换旧导入后按提示重载。
