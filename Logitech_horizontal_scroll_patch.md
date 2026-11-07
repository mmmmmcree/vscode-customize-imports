`Logitech_horizontal_scroll_patch.js` 把侧轮发出的快捷键转换为平滑横滚，适用于能够分别配置侧轮左右快捷键的鼠标。脚本不识别或限制鼠标型号。

使用方法：

1. 在 Logi Options+ 中添加 VS Code 的应用配置，把侧轮左设为 `Ctrl+Shift+[`，侧轮右设为 `Ctrl+Shift+]`。
2. 使用 Custom CSS and JS Loader，把脚本的文件 URL 加入 `vscode_custom_css.imports`。本机路径为 `file:///K:/vscode-customize-imports/Logitech_horizontal_scroll_patch.js`。其他机器改为自己的路径。
3. 执行 `Reload Custom CSS and JS`，按提示重新加载 VS Code。
4. 点击代码区后滚动侧轮。不需要添加 VS Code 键绑定。现有对应键绑定在脚本处理成功时会被阻止，避免重复滚动。

脚本顶部 `CONFIG` 可调整：

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `STEP_PX` | `64` | 每次快捷键的横滚事件输入量，越大越快；实际距离也受 VS Code 滚轮敏感度影响 |
| `DURATION_MS` | `140` | 平滑动画时长，单位毫秒；`0` 为直接滚动 |
| `MAX_PENDING_STEPS` | `6` | 最多积压的输入步数，限制快速连转后多余的拖尾 |
| `INVERT` | `false` | 反转左右方向 |
| `LEFT` / `RIGHT` | `Ctrl+Shift+[` / `]` | 按键的 `KeyboardEvent.code` 及修饰键，可按需换成 F13/F14 等 |

修改文件后需要再次执行 `Reload Custom CSS and JS`，仅保存文件不会更新已经嵌入工作台的脚本。

也可在 VS Code Developer Tools 的 Console 临时调参，立即生效：

```js
logitechHorizontalScrollPatch.setConfig({ STEP_PX: 40, DURATION_MS: 180 });
```

临时参数在窗口重新加载后恢复为文件中的配置。查看当前参数或事件计数：

```js
logitechHorizontalScrollPatch.getConfig();
logitechHorizontalScrollPatch.getStats();
```

停止并移除本窗口的补丁监听器：

```js
logitechHorizontalScrollPatch.dispose();
```

脚本只处理代码编辑器内的目标快捷键，不接管终端、查找框或快速输入框。切换方向、窗口失焦、点击鼠标或使用真实滚轮会停止待执行动画。

这是快捷键输入的平滑化方案。它需要鼠标软件持续发送快捷键，无法恢复原生侧轮已丢失的转速信息，也不会修复 Windows 驱动中的原始横滚事件。
