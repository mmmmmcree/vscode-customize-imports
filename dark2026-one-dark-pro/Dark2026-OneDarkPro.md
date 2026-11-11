Dark 2026 的界面、One Dark Pro 的代码配色和 Synthwave 光晕一起打包在本主题插件中。

插件展开 Dark 2026 的颜色继承，完整使用 One Dark Pro 的 TextMate 与语义规则、默认代码文字和括号颜色。主题 JSON 不继承 Dark 2026 的语法规则，避免更具体的规则混入原主题配色。源主题配色的初始快照来自 VS Code 1.123.0 和 One Dark Pro 3.20.6。

`theme-overrides.json` 保存跨语言定制，`languages/*.json` 保存各语言的配色扩展，构建时依次合并到上游配色之后。语言特有的语法适合独立维护规则文件，随同一主题发布。

当前行号、工作台原生主按钮和调试底栏使用 Synthwave 渐变效果。单个原生主题色只能表达单色，渐变、光晕和动画由随扩展打包的 CSS 实现，需要启用 Custom CSS and JS Loader 并运行 **Dark 2026: 启用或更新 Synthwave 光晕**。渐变的三个色点通过主题贡献颜色暴露，可自由覆盖：

| 颜色项 | 配色 |
| --- | --- |
| `dark2026OneDarkPro.neonStart` | 紫 `#9566FF` |
| `dark2026OneDarkPro.neonMiddle` | 蓝 `#478FFF` |
| `dark2026OneDarkPro.neonEnd` | 青 `#03EDF9` |

当前行号将紫 → 蓝 → 青的渐变裁剪到数字字形内，并附带低强度蓝青光晕。渐变从上到下覆盖行高，避免单个右对齐数字只显示横向渐变末端的一种颜色。高亮由 Monaco 原生的当前行号类驱动，不增加脚本、轮询或持续动画。选择器限定在当前主题的活动行号，兼容 UI Effects 同时加载及两种加载顺序；切换主题或停用 Synthwave 后恢复原有行号样式。

布局分隔条使用 Monaco 原生的 `.monaco-sash.hover` 与 `.monaco-sash.active` 状态，在原有 `::before` 指示条上绘制渐变和光晕。两种状态共用 `opacity 300ms ease, transform 300ms ease`：竖条以上端为原点展开，横条以左端为原点展开；离开时反向收回并淡出，完整显示和消失均为 300 毫秒。渐变与光晕一起缩放、淡入淡出，快速移入移出时从当前程度平滑反向，悬停与拖动状态切换时保持展开。变换只作用于绘制用的伪元素，指示条粗细、拖动命中范围、光标及禁用行为沿用原生实现。禁用时立即隐藏；系统减少动态效果或 VS Code 的 `monaco-reduce-motion` 状态下立即切换。基础主题的 `sash.hoverBorder` 为紫色 `#9566FF`，启用 Synthwave 后呈现三色渐变。

原生徽标统一使用紫蓝青渐变底、深色文字和柔和光晕，覆盖 `.monaco-count-badge`、活动栏等位置的 `.badge-content`、操作菜单徽标、面板筛选徽标、配置文件文字标记、欢迎页新功能标记和扩展图标徽标。计数文字稍加粗，原生边距、圆角、最小尺寸、更新与隐藏逻辑继续生效，多位数字可自然扩展为胶囊；进度徽标的遮罩及动画继续工作。仅绘制徽标显示面，外层图标容器保留原有布局。这两处效果复用 `dark2026OneDarkPro.neonStart`、`neonMiddle`、`neonEnd`，切换主题或停用 Synthwave 时一起退出。Webview 和系统界面中的徽标由各自的页面或系统控制。

SCM 统计卡片 `.scm-lines-hover` 与原生图表卡片 `.history-item-hover` 共用 13px/19px 的字体与行高、12px 留白、8px 圆角、暗色渐变底、紫蓝青渐变边框与低强度光晕。卡片最小宽度为 340px，受视口宽度约束；长路径和文本可换行。图表原有的提交链接、分支标签、焦点轮廓及悬停指针继续使用原生结构，编辑器等其他悬停框不套用这组卡片样式。

统计卡片的数字缩小为与图表正文一致的 13px，并直接使用 `scmGraph.historyItemHoverAdditionsForeground` 和 `scmGraph.historyItemHoverDeletionsForeground`，因此两处的新增、删除色保持一致；比例条继续按实际行数计算。此主题将它们设为薄荷绿 `#72E3B2` 与珊瑚红 `#FF7B86`。图表分支线使用紫、蓝、青、淡紫、薄荷绿，本地、远端及基线引用分别使用紫、青、蓝；这些 `scmGraph.*` 值维护在 `theme-overrides.json`，可通过 `workbench.colorCustomizations` 覆盖。更新后需要分别重新启用 SCM 卡片与 Synthwave 光晕。

按钮的深色渐变底由三个色点混合暗色生成，保持浅色文字清晰可读。原生主按钮统一采用此效果，包括源码管理的提交与同步、右下角通知及通知中心、设置、欢迎页和工作台内的对话框按钮。次要按钮保留原有配色，以区分操作层级；图标工具栏保留原有样式。扩展 Webview、嵌入网页及系统文件对话框具有独立的页面或系统样式，需要由对应扩展或系统单独支持。

分体按钮的主操作、分隔线及下拉操作共用连续渐变。悬停或键盘聚焦时，渐变在 300 毫秒内移动并增强光晕；禁用状态变暗并停止增强光晕，保留原生点击、焦点轮廓和无障碍语义。

调试底栏使用相同的深色渐变，配有 2px 紫蓝青渐变顶边，底色以 6 秒周期缓慢往返。脚本通过监听原生状态栏的行内背景色变化启停效果，不轮询，也不依赖私有调试状态类；调试结束时恢复普通状态栏，`debug.enableStatusBarColor` 关闭时不启用渐变。系统启用减少动态效果时，两处均保留静态渐变并停止动画。

未启用 Loader 时，主按钮沿用基础主题的蓝色，调试状态栏使用深青底 `#17384D`、浅色文字 `#EAFBFF` 和蓝色顶边。基础色与渐变色点保存在 `theme-overrides.json` 和随包发布的主题 JSON 中，重新生成主题时会保留。切换到其他主题或停用 Synthwave 时会移除渐变效果。

需要个人微调时，在 `settings.json` 的现有 `workbench.colorCustomizations` 中合并以下按主题限定的设置。用户设置优先于主题，保存后渐变色即时更新，无需修改扩展文件或重新打包。可定制的颜色项见 [VS Code 主题颜色参考](https://code.visualstudio.com/api/references/theme-color)。

```json
"workbench.colorCustomizations": {
  "[Dark 2026 + One Dark Pro]": {
    "dark2026OneDarkPro.neonStart": "#9566FF",
    "dark2026OneDarkPro.neonMiddle": "#478FFF",
    "dark2026OneDarkPro.neonEnd": "#03EDF9"
  }
}
```

当前 `languages/cpp.json` 为 C++ 添加以下分组：

| 语法类别 | 示例 | 颜色 |
| --- | --- | --- |
| 命名空间 | `std`、`app` | 蓝灰 `#7DA9C7` |
| 类、结构体 | `Widget`、`Record` | 黄 `#E5C07B` |
| Concept 名称 | `Addable`、`std::same_as` | 薄荷绿 `#7EC8B5` |
| 约束和模板关键字 | `concept`、`requires`、`template`、`typename` | 紫 `#C678DD` |
| 声明与修饰符 | `noexcept`、`override`、`final`、`explicit`、`virtual`、`mutable`、`friend`、`const`、`thread_local` | 紫 `#C678DD` |
| 编译期求值、初始化与断言 | `constexpr`、`consteval`、`constinit`、`static_assert` | 橙 `#D19A66` |
| 类型查询、对齐与命名转换 | `decltype`、`sizeof`、`alignof`、`alignas`、`typeid`、`static_cast`、`dynamic_cast`、`const_cast`、`reinterpret_cast` | 青 `#56B6C2` |
| 基础与推导类型 | `int`、`void`、`auto` | 青 `#56B6C2` |
| 协程关键字 | `co_await`、`co_yield`、`co_return` | 紫 `#C678DD` |
| 模块关键字 | `module`、`import`、`export` | 蓝 `#61AFEF` |
| 属性名称 | `nodiscard`、`deprecated`、`likely` | 橙 `#D19A66` |

`noexcept` 在函数声明、`noexcept(...)` 表达式与复合要求中的颜色保持一致。`syntaxes/cpp-modern.tmLanguage.json` 补充内置语法缺少的 concept 声明名、复合要求中的 `noexcept` 和模块 `import` 分类，排除注释、字符串与预处理上下文。语法补充随扩展启用，其他主题按自己的规则显示这些 scope；上述自定义配色仅属于本主题的 C++ 规则。

Concept 名称的语义规则为 `concept:cpp`，已通过本机 clangd 的实际语义 token 验证声明和引用。C/C++ 1.35.6 没有独立的 concept token，因此扩展还提供补充着色：直接识别声明处的 `concept Name`，并对 `template <dispatch_source_c Inputs, typename Router>`、限定名和约束参数包等模板参数开头的名字调用语言服务的“转到定义”。目标确实是 `concept` 声明时，用编辑器装饰显示薄荷绿，覆盖语言服务泛化的类型色；目标是普通类、枚举等具体类型时保持原色。通过解析定义文件也能识别其他头文件中的 concept。

补充着色不根据 `_c` 等后缀猜测，不把所有 `template<Name Value>` 都当成 concept。它只在本主题和 C++ 编辑器中运行，不依赖 Loader；可用 `dark2026OneDarkPro.cppConceptHighlighting` 关闭。跨文件识别需要语言服务能正常转到定义；项目尚未配置或索引未就绪时，不会强行给未确认的引用上色。模板参数以外的 concept 引用仍由语言服务的语义分类处理。

只分析可见编辑器中的模板约束候选，每次最多查询 64 个，所有更新合计最多 4 个查询同时运行。变更后防抖 250 毫秒，文本分析按文档版本缓存，已确认的定义结果在滚动时复用。无关文件的诊断不会触发查询；定义文件修改后使缓存失效。编辑期间过期的异步结果不会应用，也不扫描整个工作区。测试覆盖跨文件定义、同名类、缓存、主题开关、可见范围与并发限制，在插件目录运行 `npm test`。

命名空间声明、别名与 using 指令在没有语言服务时也可区分；`app::Widget::method()` 等限定名中的命名空间与类需要 C++ 语言服务的语义高亮来准确识别，避免把类名也按命名空间改色。

从仓库根目录执行：

```powershell
python scripts/install.py --plugin dark2026-one-dark-pro
```

安装后按 `Ctrl+K Ctrl+T`，选择 `Dark 2026 + One Dark Pro`。再运行命令 **Dark 2026: 启用或更新 Synthwave 光晕**，按 Custom CSS and JS Loader 提示重新加载。

`media/synthwave84.css` 随主题扩展一起安装。它不会仅因存在于 `media/` 中就被 Loader 发现；启用命令读取它，在当前配置文件的扩展存储目录生成稳定的加载入口，以实际文件的 `file:` 地址登记到 `vscode_custom_css.imports`，由共用安全更新器应用并提示重新加载。VS Code 内部的 `vscode-userdata:` 存储地址不能直接交给 Loader；旧版本登记的此类导入会在下次启用时自动替换。更新主题后先重新加载 VS Code，再次执行启用或更新命令；无需修改扩展版本路径。其他插件和自定义导入会被保留，本仓库旧的根目录 `synthwave84.css` 导入会被替换。

更新器在跨进程互斥内生成页面，校验原生启动脚本及必需效果后原子替换，完整页面保留为最近可用备份。SCM 启动检查不再自动改写页面，避免同时启用光晕时两次更新交叠导致入口被写空。Loader 的会话备份格式与停用操作继续兼容。

代码光晕使用 `currentColor` 跟随实际文字颜色，不再按 `.mtk1`、`.mtk2` 等动态编号指定颜色。脚本读取当前 token 样式，将 One Dark Pro 的文字颜色归入角色组：

| 配色语义组 | 基础强度 |
| --- | --- |
| 注释 | 0.04 |
| 普通文字、标点 | 0.10；彩色括号固定使用更弱的光晕 |
| 变量、属性 | 0.18 |
| 字符串 | 0.24 |
| 数值、字面量 | 0.34 |
| 关键字 | 0.40 |
| 函数 | 0.52 |
| C++ 命名空间（蓝灰色） | 0.52，与函数一致 |
| 枚举等青色类型组 | 0.72 |
| C++ concept（薄荷绿） | 0.78 |
| 类、类型等黄色组 | 0.85 |

在基础强度上，默认按当前可见代码各组的出现频次乘以 0.65–1.35 的系数，频次越高系数越小。这样大量变量和符号不会淹没少数类名。分类来自主题配色，不是完整的语法解析；同色的语法类型会共用一个组。因此青色类型查询与青色枚举共组，橙色编译期关键字与橙色字面量共组，蓝色模块关键字与蓝色函数共组。Concept 的薄荷绿有独立频次统计。统计的是 Monaco 已渲染的可见代码，不是整个文件或项目；变化后等待 250 毫秒再合并更新，最多扫描 5000 个 token，不逐帧分析文本。

用 `dark2026OneDarkPro.glowIntensity`（默认 1，范围 0–2）调整代码光晕总强度，用 `dark2026OneDarkPro.frequencyAware`（默认 true）开关频次调整。修改后运行启用或更新光晕命令；关闭频次调整后仍保留各组不同的基础强度。颜色始终来自 `currentColor`，没有恢复独立手工泛光色板。

标签页、活动栏和灯泡保留霓虹装饰。标签页底部的 4px 粉青渐变共用 `transition: opacity 300ms ease, clip-path 300ms ease`：选中时透明度从 0 到 1、右侧裁剪从 100% 到 0，从左向右展开并淡入；取消选中时两项属性同时返回原值，从右向左收回并淡出。两种状态只定义端点，不覆盖共同的过渡规则。左粉右青的配色固定，底部淡光以相同的 300 毫秒时长同步过渡。快速切换时浏览器从当前插值平滑反向，避免重新从端点播放。系统启用减少动态效果时立即切换；无须持续执行动画脚本。

配色、条高和 `ease` 缓动曲线来自最早提交 `2e3e2b5`。本版将原先的 1 秒过渡缩短为 300 毫秒，同时用同一曲线驱动透明度与裁剪。顶部横条已移除，并保留拖放提示。`theme-overrides.json` 将选中、活动及未聚焦活动标签的顶部边线设为透明，基础主题无需 Loader 即可去除蓝线；启用 Synthwave 时也隐藏原生顶部容器。

光标渐变变色、光标拖尾和界面样式由 UI Effects 插件提供，需另外运行 **Customize Imports: 启用或更新界面特效**。若 `vscode_custom_css.imports` 中只有主题的 `synthwave84.js`，这些光标效果不会加载；该命令会登记 `effects.js`，保留主题、SCM 和其他导入，再由共用安全更新器应用并提示重载。

主题贡献一个专用颜色标记，加载脚本监听主题变化，仅在该标记生效时启用光晕和标签页渐变，因此切换到其他主题会自动关闭，切回时恢复。

运行 **Dark 2026: 停用 Synthwave 光晕** 并按提示重载，可移除加载入口；卸载前也应先运行这个命令。基础主题配色无需 Loader，只有额外 CSS 效果依赖它。

源码中的 `scripts/build_theme.py` 专门重新生成配色和上游许可证，不覆盖手工维护的 README 与 `package.json`。在本插件目录执行：

```powershell
python scripts/build_theme.py
python ../scripts/package_vsix.py .
```

第一个步骤需要本机已安装 Dark 2026 和 One Dark Pro，并自动合并 `theme-overrides.json` 与 `languages/*.json` 的界面颜色、TextMate 和语义定制；语言规则按文件名排序加载。第二个步骤使用仓库共用的 Python VSIX 打包器，将 `package.json.files` 白名单中的主题、语法补充、脚本与样式连同文档、许可证及共用更新模块打包，生成 `dist/dark2026-one-dark-pro-1.2.16.vsix`。它不需要重新读取源主题，也不需要 pip 包、npm 依赖或 vsce。

自动检测使用 PATH 中的 `code` 和用户目录的 `.vscode/extensions`。自定义位置可在本插件目录指定：

```powershell
python scripts/build_theme.py --vscode-dir 'K:\Microsoft VS Code' --one-dark-pro-dir 'C:\Users\mmmmmcree\.vscode\extensions\zhuangtongfa.material-theme-3.20.6'
```

现有 `editor.tokenColorCustomizations`、`editor.semanticTokenColorCustomizations`、`workbench.colorCustomizations` 和语言扩展仍可覆盖主题。语义高亮需要 `editor.semanticHighlighting.enabled` 为 `configuredByTheme` 或 `true`。VS Code 或 One Dark Pro 更新后，重新生成、打包安装，再更新光晕入口即可同步。

命名配置文件安装示例及其他安装参数见 [scripts 使用说明](../scripts/README.md)。
