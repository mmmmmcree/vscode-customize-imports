# Customize Imports Effects

将原来的光标拖尾、界面 CSS 和编辑器水印打包为桌面版 VS Code 插件。需要 Custom CSS and JS Loader 来加载工作台效果。

从仓库根目录运行 `python scripts/install.py --plugin vscode-ui-effects`，然后执行命令 **Customize Imports: 启用或更新界面特效**，按 Loader 提示重新加载窗口。命令会登记稳定的生成脚本路径，替换本仓库原来的 `vscode-custom.css`、`vscode-logo.css` 和 `trail-effect.js` 导入，保留其他插件和自定义导入。

设置示例：

```json
{
  "customizeImports.cursorTrail": true,
  "customizeImports.smoke": true,
  "customizeImports.maxFPS": 60,
  "customizeImports.interfaceStyles": true,
  "customizeImports.watermark": true
}
```

修改设置后，再运行启用或更新命令。停用时运行 **Customize Imports: 停用界面特效** 并重新加载；卸载前也先停用，移除 Loader 中登记的脚本。

拖尾保留弹簧链、渐变光带和尾部烟雾。默认最高 60 FPS；静止淡出后停止绘制，失焦和隐藏时暂停，跟随系统减少动画设置，最多同时跟踪 64 个光标。重复加载会清理上一次的 canvas、监听器、定时器和动画。水印使用独立 PNG 资源，启用时再生成 CSS，源码不再包含大段 Base64。

界面 CSS 使用主题颜色，不再依赖动态 `.mtkN` 编号或逐 token 的弹跳动画。Synthwave 的代码光晕属于主题插件，独立于本插件开关。

若代码光晕正常但光标变色和拖尾同时消失，先运行 **Customize Imports: 启用或更新界面特效**。主题的启用命令不会注册本插件；正常启用后，`vscode_custom_css.imports` 应包含扩展存储目录中的 `effects.js`。光标变色需要 `customizeImports.interfaceStyles`，拖尾需要 `customizeImports.cursorTrail`，两项默认均为 `true`。

本目录执行 `npm run package`，或从仓库根目录执行 `python scripts/package_vsix.py vscode-ui-effects`，生成 `dist/customize-imports-effects-0.1.2.vsix`。

`0.1.2` 与其他特效插件共用串行、原子更新器，避免同时启用时写坏工作台入口；效果配色及已有导入保持原样。

生成脚本使用 `file:` 地址供 Loader 读取。旧版本若出现 `Cannot load 'vscode-userdata:…/effects.js'`，更新后先重新加载 VS Code，再运行启用或更新界面特效命令，自动替换旧导入后按提示重载。
