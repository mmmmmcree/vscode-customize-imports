# 构建与安装

这些脚本共用 Python 3.9+ 标准库，不需要安装 pip 包、npm 依赖或 vsce。以下命令从仓库根目录执行。

```powershell
# 打包并安装仓库内全部插件
python scripts/install.py

# 仅打包，产物写入各插件的 dist/
python scripts/install.py --package-only

# 仅安装选中的插件，可以使用目录名或 package.json 中的 name
python scripts/install.py --plugin dark2026-one-dark-pro vscode-logitech-scroll

# 安装到已有的 VS Code 配置文件
python scripts/install.py --profile "副屏"

# VS Code 不在 PATH 时指定入口
python scripts/install.py --code "K:\Microsoft VS Code\bin\code.cmd"

# 只打包一个插件
python scripts/package_vsix.py dark2026-one-dark-pro
```

`install.py` 自动发现仓库下包含 `package.json`、`engines.vscode` 和 `files` 的插件目录，调用共用打包器，再通过 VS Code CLI 安装。安装入口在 Windows 上直接运行 `code.cmd` 指向的可执行文件和 CLI，不经过批处理命令拼接；带空格或中文的路径、配置文件名称可正常传递。

默认安装进入 VS Code 当前默认安装环境。`--profile` 指定已有配置文件；若名称不存在，VS Code CLI 会报错，请先在 VS Code 中创建该配置文件。测试时可使用 `--extensions-dir` 和 `--user-data-dir` 指定独立目录，例如：

```powershell
python scripts/install.py --extensions-dir .agent/validation/extensions --user-data-dir .agent/validation/user-data
```

所有安装包统一命名为 `插件名-版本.vsix`，存放在对应插件的 `dist/`。各 `dist/.gitignore` 忽略产物并保留 `.gitignore` 自身；`scripts/.gitignore` 忽略 Python 缓存。打包器使用 `package.json` 的 `files` 白名单选择源码，并自动加入清单、README、许可证和 `package.nls*.json`；不会把开发脚本、测试、缓存或历史安装包打入包内。

四个插件共用 `shared/custom-css.js` 更新工作台效果。各 `src/custom-css.js` 是开发入口，打包器按 `repositorySharedFiles` 将共用实现直接写入 VSIX 中的同名位置，因此每个安装包仍可独立运行。共享源文件必须位于仓库的 `shared/`，目标必须已在插件的 `files` 白名单中。

主题的配色生成属于该插件自己的构建步骤。只有需要同步本机更新后的 Dark 2026 或 One Dark Pro 时，才先执行：

```powershell
python dark2026-one-dark-pro/scripts/build_theme.py
python scripts/install.py --plugin dark2026-one-dark-pro
```

直接打包和安装使用仓库中已有的主题文件，不要求本机安装 One Dark Pro。配色生成脚本才需要本机的源主题，参数见主题目录中的说明。

安装完成后重新加载 VS Code，选择 `Dark 2026 + One Dark Pro`。首次使用以下效果时，在命令面板执行相应启用命令，它们会登记 Custom CSS and JS Loader 的导入，通过共用更新器应用效果并提示重载：

| 插件 | 启用命令 |
| --- | --- |
| Dark 2026 主题 | `Dark 2026: 启用或更新 Synthwave 光晕` |
| 界面特效 | `Customize Imports: 启用或更新界面特效` |
| 横滚补丁 | `Logitech: 启用或更新横滚补丁` |
| SCM 统计 | `更改统计: 启用原生悬停`（英文显示语言为 `Line Stats: Enable Native Hover`） |

Loader 未安装时，启用命令会打开对应扩展的搜索结果。仅把文件放入 `media/` 不会自动加载；启用命令负责注册，不需要手写扩展版本路径。修改设置或升级特效插件后，再执行一次启用或更新命令。停用这些效果请先执行各插件的停用命令，再按 Loader 提示重载；SCM 统计的设置和行为见其 README。

更新器对同一 VS Code 安装使用跨进程文件锁，先在临时文件中生成完整页面、检查原生启动脚本及必需资源，再原子替换工作台 HTML；生成失败时保留当前可用页面。更新前后的完整页面会保存为最近可用备份，同时保留 Loader 兼容的会话备份，Loader 自身的停用命令仍可恢复基础页面。SCM 启动时只检查卡片脚本状态，安装或更新卡片需要手动运行“启用原生悬停”，避免启动更新与其他插件的启用命令重叠。

当前版本将导入的特效脚本延后到页面加载及原生编辑器容器出现后，跨过绘制帧再按导入顺序执行。隐藏窗口有 500 毫秒兜底；原生界面尚未出现时，特效不抢占启动。更新全部插件后，执行一次任意插件的启用或更新命令，即可重新生成共用加载入口。

共用更新器与打包回归检查：

```powershell
node --test shared/test/*.test.js
python -m unittest discover -s scripts -p "test_*.py"
```

若旧版本提示 `Cannot load 'vscode-userdata:…'. Skipping.`，重新运行安装脚本后先重新加载 VS Code，再运行受影响插件的启用或更新命令。新版本将扩展存储路径转换为 Loader 可读取的 `file:` 地址，并替换该插件的旧导入；无需手动改写用户目录路径。

新增插件时，把源码、README、LICENSE、`package.json` 和 `dist/.gitignore` 放入独立目录，在 `package.json.files` 中声明需打包的资源，便会被安装脚本发现。可增加以下 npm 快捷入口，但 Python 命令本身不依赖 npm：

```json
"scripts": {
  "package": "python ../scripts/package_vsix.py ."
}
```
