# Dark 2026 + One Dark Pro

Dark 2026 界面与 One Dark Pro 完整的语法、语义高亮配色，附带 Synthwave 光晕。

C++ 使用蓝灰色显示命名空间、黄色显示类和结构体、薄荷绿显示 concept 名称；`noexcept` 等修饰符为紫色，编译期关键字为橙色，类型查询、转换及基础类型为青色。完整分组见[配色说明](Dark2026-OneDarkPro.md)。C++ 规则独立维护在 `languages/cpp.json`，随主题构建合并，无需单独安装语言配色插件。

附带语法规则补充 concept 声明、复合约束中的 `noexcept` 和模块 `import`。对于 `template <dispatch_source_c Inputs, typename Router>` 这类用法，插件还会通过语言服务的“转到定义”确认 `dispatch_source_c` 是否为 concept，确认为 concept 后显示薄荷绿；支持声明位于其他头文件中的情况。`typename` 和普通的非类型模板参数保持各自配色。此补充着色不需要 Loader，可用 `dark2026OneDarkPro.cppConceptHighlighting` 关闭；其他位置的引用由语言服务的 `concept` 语义分类处理。

从仓库根目录执行 `python scripts/install.py --plugin dark2026-one-dark-pro`。安装后按 `Ctrl+K Ctrl+T`，选择 **Dark 2026 + One Dark Pro**。

支持 VS Code `1.111.0` 及以上的 1.x 版本，包括原先支持的 `1.123.0` 及后续版本。主题配色已随扩展打包，安装时无需 VS Code 内置 Dark 2026；源主题所在的 VS Code 版本不等于扩展的最低运行版本。`1.2.7` 将误设的 `^1.123.0` 扩展为 `^1.111.0`，保留原有配色、光晕和 C++ 着色实现。

光晕通过命令 **Dark 2026: 启用或更新 Synthwave 光晕** 注册到 Custom CSS and JS Loader，按提示重新加载即可；无需手写 `media/` 或扩展版本路径。切换到其他主题后光晕自动关闭，切回时恢复。运行 **Dark 2026: 停用 Synthwave 光晕** 可以移除注册；卸载前先停用。

光晕颜色跟随文字，强度按 One Dark Pro 的配色语义组分级：变量、标点和注释较弱，函数、命名空间和关键字居中，类、类型、concept 和枚举较强。命名空间与函数的基础强度均为 0.52，concept 为 0.78，分别按各自的出现频次调整。默认还根据当前可见代码的出现频次调整，越常见越弱。可通过 `dark2026OneDarkPro.glowIntensity` 调整总强度，或用 `dark2026OneDarkPro.frequencyAware` 关闭频次调整；修改后再运行启用或更新命令。同色的语法类型共用一个组，具体算法见完整说明。

标签页底部的粉青渐变共用一组 300 毫秒 `ease` 过渡，比原先的 1 秒更快：选中时从左向右展开并淡入，取消选中时沿相反方向收回并淡出，左粉右青的配色固定。保留 Git 原版的 `ease` 缓动曲线；快速切换时从当前状态平滑反向。底部淡光同步过渡，顶部蓝线已移除。系统启用减少动态效果时立即切换。顶部边线在主题配色中也设为透明，基础主题无需 Loader 即可去除蓝线。

光标变色和拖尾由独立的 UI Effects 插件提供。若只有代码光晕和标签页效果，请运行 **Customize Imports: 启用或更新界面特效** 并按提示重载；主题的光晕命令只登记主题资源。对应插件说明见 [UI Effects](../vscode-ui-effects/README.md)。

生成配色与打包分为两个步骤。在本目录执行：

```powershell
# 仅在需要同步本机源主题时重新生成配色
python scripts/build_theme.py

# 打包已有主题和特效资源
python ../scripts/package_vsix.py .
```

安装产物为 `dist/dark2026-one-dark-pro-1.2.8.vsix`。直接打包和安装不要求本机有 One Dark Pro 扩展；重新生成配色时才需要。

Concept 补充着色只查询可见的模板约束名字，每次最多 64 个候选、全局最多 4 个并发请求，变化后防抖 250 毫秒。文本分析与定义结果都有缓存，不扫描整个项目。符号尚未被语言服务索引时，等待后续编辑器或诊断更新再重试。开发验证可在本目录运行 `npm test` 和 `npm run check`。

若旧版本出现 `Cannot load 'vscode-userdata:…/synthwave84.js'. Skipping.`，更新安装后先重新加载 VS Code，再执行一次启用或更新光晕命令。插件会把旧导入替换为 Loader 可读取的 `file:` 地址，按提示再次重载即可。

完整说明见 [Dark2026-OneDarkPro.md](Dark2026-OneDarkPro.md)，仓库安装入口见 [scripts/README.md](../scripts/README.md)。
