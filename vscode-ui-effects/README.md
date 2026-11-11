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

光标和拖尾共用柔和的紫→蓝→青渐变，跟随 Dark2026 的 `neonStart`、`neonMiddle`、`neonEnd` 主题颜色，并混入 22% 深色降低亮度；其他主题也有相同色系的默认值。光标保留 VS Code 原生闪烁方式，不再单独循环色相或使用双倍亮度滤镜。拖尾以单次描边搭配较弱泛光，烟雾采用普通透明叠加，减少重叠发白。仅启用拖尾时也会加载共用色板。

Vim Visual 模式额外绘制的当前字符矩形，也使用相同渐变并搭配深色文字。通过成对的装饰样式识别 VSCodeVim 光标，不依赖随机生成的类名；Vim 激活、主题切换和扩展宿主重启后自动重新识别。此效果跟随 `customizeImports.interfaceStyles` 开关。

编辑器选区（包括 Vim Visual 的字符、整行、块选择及鼠标选区）使用同色系的半透明紫蓝青渐变，失焦后选区变淡。只绘制原生选区背景，保留语法颜色、选区尺寸和圆角遮罩；此效果同样跟随 `customizeImports.interfaceStyles`。

光标所在行使用同色点、同透明度的左→右渐变，失焦后同步变淡；若在 `editor.renderLineHighlight` 中开启行号区高亮，该区域以起始紫色与正文左侧衔接。仍由 VS Code 控制高亮位置、换行、多光标和显示开关；非空选区下按原生行为隐藏当前行背景，避免重复叠亮。

顶部搜索、快速打开和命令面板的候选行使用同色系霓虹背景：选中或键盘焦点行较明显，鼠标悬停与被动焦点较淡，选中态优先。调试浮动工具栏使用深色霓虹表面、细渐变边缘和按钮悬停／键盘焦点背景；保留图标颜色、禁用状态、拖动区域和原有尺寸。以上效果跟随 `customizeImports.interfaceStyles` 开关。

编辑器、侧栏和列表等工作台滚动条的滑块使用柔和的紫蓝青渐变与圆角：纵向沿上→下渐变，横向沿左→右渐变，默认、悬停、拖动状态逐级增强。保留原有滑块尺寸、命中区域、轨道和自动隐藏行为；此效果同样跟随 `customizeImports.interfaceStyles`。

界面 CSS 使用主题颜色，不再依赖动态 `.mtkN` 编号或逐 token 的弹跳动画。Synthwave 的代码光晕属于主题插件，独立于本插件开关。

若代码光晕正常但光标变色和拖尾同时消失，先运行 **Customize Imports: 启用或更新界面特效**。主题的启用命令不会注册本插件；正常启用后，`vscode_custom_css.imports` 应包含扩展存储目录中的 `effects.js`。光标变色需要 `customizeImports.interfaceStyles`，拖尾需要 `customizeImports.cursorTrail`，两项默认均为 `true`。

本目录执行 `npm run package`，或从仓库根目录执行 `python scripts/package_vsix.py vscode-ui-effects`，生成 `dist/customize-imports-effects-0.1.8.vsix`。

`0.1.8` 将工作台横向、纵向滚动滑块统一为霓虹渐变，区分默认、悬停和拖动状态。

`0.1.7` 统一搜索候选行和调试浮动工具栏的霓虹风格，并将当前行背景改为左→右渐变。

`0.1.6` 将光标所在行的高亮背景与 Visual 选区的霓虹渐变统一。

`0.1.5` 将编辑器选区统一为柔和的霓虹渐变，支持 Vim Visual 字符、整行和块选择。

`0.1.4` 将 VSCodeVim Visual 当前字符矩形统一为渐变光标配色。

`0.1.3` 统一光标与拖尾的霓虹色板并降低泛光亮度；弹簧链、拖尾长度和帧率设置不变。

`0.1.2` 与其他特效插件共用串行、原子更新器，避免同时启用时写坏工作台入口；效果配色及已有导入保持原样。

生成脚本使用 `file:` 地址供 Loader 读取。旧版本若出现 `Cannot load 'vscode-userdata:…/effects.js'`，更新后先重新加载 VS Code，再运行启用或更新界面特效命令，自动替换旧导入后按提示重载。
