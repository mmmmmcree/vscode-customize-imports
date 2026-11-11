# VS Code 本地插件

各插件独立保存源码、资源、说明和安装产物，共用 Python 打包与安装入口。

| 目录 | 功能 |
| --- | --- |
| [dark2026-one-dark-pro](dark2026-one-dark-pro/README.md) | Dark 2026 界面、One Dark Pro 配色和随主题启停的 Synthwave 光晕 |
| [vscode-ui-effects](vscode-ui-effects/README.md) | 光标拖尾、界面样式和编辑器水印 |
| [vscode-logitech-scroll](vscode-logitech-scroll/README.md) | 鼠标侧轮快捷键的平滑横滚补丁 |
| [vscode-scm-line-stats](vscode-scm-line-stats/README.md) | 原生 Git 更改的行数统计和悬停卡片 |
| [scripts](scripts/README.md) | 可复用的 VSIX 打包器和一键安装入口 |

在仓库根目录运行 ：

```powershell
python scripts/install.py
```

仅生成各插件的安装包：

```powershell
python scripts/install.py --package-only
```

产物统一写入各插件的 `dist/插件名-版本.vsix`。安装参数、首次启用步骤及新增插件约定见 [scripts/README.md](scripts/README.md)。
