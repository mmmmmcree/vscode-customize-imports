`Logitech_horizontal_scroll_patch.js` 把侧轮发出的快捷键转换为平滑横滚，适用于能够分别配置侧轮左右快捷键的鼠标。脚本不识别或限制鼠标型号。

使用方法：

1. 在 Logi Options+ 中添加 VS Code 的应用配置，把侧轮左设为 `Ctrl+Shift+[`，侧轮右设为 `Ctrl+Shift+]`。
2. 安装本目录的插件后，执行 `Logitech: 启用或更新横滚补丁`。插件自动登记脚本路径，并保留 Custom CSS and JS Loader 中的其他导入。
3. 按 Loader 提示重新加载 VS Code。
4. 鼠标停在顶部标签栏时，侧轮平滑滚动标签列表；无需先点击标签，也不会因滚动而切换活动文件。代码编辑器内继续滚动代码。不需要添加 VS Code 键绑定；脚本处理成功时会阻止对应键绑定，避免重复滚动。

标签栏按鼠标当前位置选择滚动目标，支持多个编辑器分组。标签全部可见或已滚到两端时不会转而滚动代码。鼠标离开标签栏会停止该标签栏的待执行动画。

优先在 VS Code 设置中调整 `logitechScroll.*`，然后执行启用或更新命令。源码顶部 `CONFIG` 是默认值；可配置参数如下：

| 参数 | 当前文件值 | 含义 |
| --- | --- | --- |
| `STEP_PX` | `320` | 代码区每次快捷键的横滚事件输入量，越大越快；实际距离也受 VS Code 滚轮敏感度影响 |
| `TAB_STEP_PX` | `120` | 标签栏独立步长，越大越快 |
| `TAB_SPEED_MULTIPLIER` | `4` | 标签栏速度倍率，有效步长 = `TAB_STEP_PX × TAB_SPEED_MULTIPLIER`；当前为 `480` |
| `DURATION_MS` | `500` | 平滑动画时长，单位毫秒；`0` 为直接滚动 |
| `MAX_PENDING_STEPS` | `1024` | 最多积压的输入步数，限制快速连转后多余的拖尾 |
| `INVERT` | `true` | 反转代码区与标签栏的左右方向 |
| `LEFT` / `RIGHT` | `Ctrl+Shift+[` / `]` | 按键的 `KeyboardEvent.code` 及修饰键，可按需换成 F13/F14 等 |

修改设置或 `media/` 中的源码后，需要再次执行 `Logitech: 启用或更新横滚补丁`，再按 Loader 提示重新加载；仅保存源文件不会更新已经生成的加载入口。

也可在 VS Code Developer Tools 的 Console 临时调参，立即生效：

```js
logitechHorizontalScrollPatch.setConfig({ TAB_SPEED_MULTIPLIER: 3 });
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

脚本处理代码编辑器与顶部文件标签栏的目标快捷键。鼠标停在标签栏时，即使焦点还在代码区或终端，侧轮也会滚动所指的标签栏；鼠标未停在标签栏时不接管终端、查找框或快速输入框。切换方向、窗口失焦、点击鼠标或使用真实滚轮会停止待执行动画。

这是快捷键输入的平滑化方案。它需要鼠标软件持续发送快捷键，无法恢复原生侧轮已丢失的转速信息，也不会修复 Windows 驱动中的原始横滚事件。
