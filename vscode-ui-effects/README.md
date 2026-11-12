# Customize Imports Effects

将原来的光标拖尾、界面 CSS 和编辑器水印打包为桌面版 VS Code 插件。需要 Custom CSS and JS Loader 来加载工作台效果。

从仓库根目录运行 `python scripts/install.py --plugin vscode-ui-effects`，然后执行命令 **Customize Imports: 启用或更新界面特效**，按 Loader 提示重新加载窗口。命令会登记稳定的生成脚本路径，替换本仓库原来的 `vscode-custom.css`、`vscode-logo.css` 和 `trail-effect.js` 导入，保留其他插件和自定义导入。

设置示例：

```json
{
  "customizeImports.cursorTrail": true,
  "customizeImports.smoke": true,
  "customizeImports.cursorCycleSeconds": 12,
  "customizeImports.maxFPS": 60,
  "customizeImports.interfaceStyles": true,
  "customizeImports.watermark": true
}
```

修改设置后，再运行启用或更新命令。停用时运行 **Customize Imports: 停用界面特效** 并重新加载；卸载前也先停用，移除 Loader 中登记的脚本。

拖尾保留弹簧链、渐变光带和尾部烟雾。默认最高 60 FPS；静止淡出后停止 canvas 绘制，光标颜色继续低频流动。失焦和隐藏时暂停，跟随系统减少动画设置，最多同时跟踪 64 个光标。重复加载会清理上一次的 canvas、监听器、定时器和动画。水印使用独立 PNG 资源，启用时再生成 CSS，源码不再包含大段 Base64。

光标和拖尾共用独立的七色亮 neon 初始色板：玫瑰粉 `#ff68ba` → 亮粉 `#ff68d4` → 电光玫粉 `#ff68ed` → 粉紫 `#e668ff` → 兰紫 `#d768ff` → 亮紫 `#a368ff` → 冰青 `#68e2ff`。色序沿连续的色相路径展开，默认各色的 HSL 明度与饱和度一致。参考旧提交 `77caafe644faac50ab58b53087b072c4100a53d2` 的 HSL 空间插值与时间滚动方式：按色相距离分配色点位置，再细分采样供 CSS 和 Canvas 共用，减轻短拖尾内的分段感；色点位置在滚动时固定，整条渐变的色相一起连续变化。默认每秒 30°、12 秒循环一轮，用 `customizeImports.cursorCycleSeconds` 调整周期（2–60 秒）。CSS 光标、Vim 字符光标、拖尾、泛光和尾部烟雾共用同一时钟和色相偏移，保持同步；循环时会经过其他 neon 色相。窗口失焦、隐藏或启用减少动态效果时冻结颜色，恢复后接着滚动；关闭拖尾时光标仍变色。行高亮、选区、搜索列表、滚动条和其他工作台配色继续使用原来的紫蓝青色板。颜色统一计算后提供给 CSS 和 Canvas，保留原生闪烁与当前光晕，不覆盖光标动画或使用双倍亮度滤镜。拖尾仍以单次描边绘制，烟雾采用普通透明叠加，减少重叠发白。

光标内部将共享渐变纵向拉长至三倍，只呈现相邻色相的一段连续过渡，减轻较短光标内的色块分层。本体与光晕使用相同背景尺寸和起点；渐变仍随时间完整循环，拖尾继续显示完整色谱。

Vim Visual 模式额外绘制的当前字符矩形，也使用相同渐变、背景尺寸与起点，并搭配深色文字。通过成对的装饰样式识别 VSCodeVim 光标，不依赖随机生成的类名；Vim 激活、主题切换和扩展宿主重启后自动重新识别。此效果跟随 `customizeImports.interfaceStyles` 开关。

编辑器选区（包括 Vim Visual 的字符、整行、块选择及鼠标选区）使用同色系的半透明紫蓝青渐变，失焦后选区变淡。只绘制原生选区背景，保留语法颜色、选区尺寸和圆角遮罩；此效果同样跟随 `customizeImports.interfaceStyles`。

光标所在行使用同色点、同透明度的左→右渐变，失焦后同步变淡；若在 `editor.renderLineHighlight` 中开启行号区高亮，该区域以起始紫色与正文左侧衔接。仍由 VS Code 控制高亮位置、换行、多光标和显示开关；非空选区下按原生行为隐藏当前行背景，避免重复叠亮。

顶部搜索、快速打开和命令面板的候选行使用同色系霓虹背景：选中或键盘焦点行较明显，鼠标悬停与被动焦点较淡，选中态优先。调试浮动工具栏使用深色霓虹表面、细渐变边缘和按钮悬停／键盘焦点背景；保留图标颜色、禁用状态、拖动区域和原有尺寸。以上效果跟随 `customizeImports.interfaceStyles` 开关。

编辑器、侧栏和列表等工作台滚动条的滑块使用柔和的紫蓝青渐变与圆角：纵向沿上→下渐变，横向沿左→右渐变，默认、悬停、拖动状态逐级增强。保留原有滑块尺寸、命中区域、轨道和自动隐藏行为；此效果同样跟随 `customizeImports.interfaceStyles`。

界面 CSS 使用主题颜色，不再依赖动态 `.mtkN` 编号或逐 token 的弹跳动画。Synthwave 的代码光晕属于主题插件，独立于本插件开关。

若代码光晕正常但光标变色和拖尾同时消失，先运行 **Customize Imports: 启用或更新界面特效**。主题的启用命令不会注册本插件；正常启用后，`vscode_custom_css.imports` 应包含扩展存储目录中的 `effects.js`。光标变色需要 `customizeImports.interfaceStyles`，拖尾需要 `customizeImports.cursorTrail`，两项默认均为 `true`。

本目录执行 `npm run package`，或从仓库根目录执行 `python scripts/package_vsix.py vscode-ui-effects`，生成 `dist/customize-imports-effects-0.1.14.vsix`。

`0.1.14` 将原生光标与 Vim 字符光标的渐变拉长，让内部只呈现相邻色相的连续过渡，减轻分层；保留完整拖尾渐变、流光周期和其他高亮配色。

`0.1.13` 优化七色亮 neon 色板，采用连续色序、统一明度与密集 HSL 插值，减轻拖尾内部的颜色分界线；保留现有流光周期、光晕与行高亮等配色。

`0.1.12` 参考 `77caafe` 恢复整条渐变的 HSL 色相滚动方式及默认 30°/秒速度，光标与拖尾保持同步，保留亮粉初始色板与当前拖尾形态。

`0.1.11` 使七色亮粉渐变随时间流动，光标与拖尾共用循环、支持单独光标模式，并保留原生闪烁和其他高亮配色。

`0.1.10` 提亮光标与拖尾，增加独立七色亮粉渐变；行高亮等工作台配色不变，弹簧链、拖尾长度、帧率与暂停行为沿用原设置。

`0.1.9` 更新共用注入器，特效脚本在原生编辑器界面绘制后启动。更新后运行一次启用或更新命令，再按提示重载。图片预览出现 Service Worker 注册错误时，缓存恢复步骤见 [scripts/README.md](../scripts/README.md)。

`0.1.8` 将工作台横向、纵向滚动滑块统一为霓虹渐变，区分默认、悬停和拖动状态。

`0.1.7` 统一搜索候选行和调试浮动工具栏的霓虹风格，并将当前行背景改为左→右渐变。

`0.1.6` 将光标所在行的高亮背景与 Visual 选区的霓虹渐变统一。

`0.1.5` 将编辑器选区统一为柔和的霓虹渐变，支持 Vim Visual 字符、整行和块选择。

`0.1.4` 将 VSCodeVim Visual 当前字符矩形统一为渐变光标配色。

`0.1.3` 统一光标与拖尾的霓虹色板并降低泛光亮度；弹簧链、拖尾长度和帧率设置不变。

`0.1.2` 与其他特效插件共用串行、原子更新器，避免同时启用时写坏工作台入口；效果配色及已有导入保持原样。

生成脚本使用 `file:` 地址供 Loader 读取。旧版本若出现 `Cannot load 'vscode-userdata:…/effects.js'`，更新后先重新加载 VS Code，再运行启用或更新界面特效命令，自动替换旧导入后按提示重载。
