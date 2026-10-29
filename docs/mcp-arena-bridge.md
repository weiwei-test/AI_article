# MCP 接入说明 · arena-bridge

> 探测时间：2026-10-29 · 探测方式：MCP Streamable HTTP（JSON-RPC 2.0）
> 状态：**已连通并验证**（initialize / tools/list / bridge_info / project_info / browser_status / run_command 全部实测通过）

## 1. 端点与握手

| 项 | 值 |
| --- | --- |
| Endpoint | `https://illa-nonblockaded-direly.ngrok-free.dev/mcp/BXRDvBj3jPUXZOVFew4bl3zuO5KCiwTo` |
| 传输 | Streamable HTTP（`POST`，`Accept: application/json, text/event-stream`） |
| 协议版本 | `2025-06-18` |
| 服务端 | `arena-bridge` **0.5.2**（buildId `20261023-save-image.1`） |
| backend | `vscode-node`，pid 43965，端口 8765 |
| 会话 | 响应头 `mcp-session-id`，后续所有请求必须回带该头 |
| 额外头 | `ngrok-skip-browser-warning: 1`（绕过 ngrok 拦截页，强烈建议带） |

握手三步，缺一不可：

```
1. POST initialize            → 响应头取 mcp-session-id
2. POST notifications/initialized（无 id，返回空）
3. POST tools/list / tools/call
```

探测脚本已封装在 `.mcp-probe/mcp.sh`（本地脚手架，已加入 `.gitignore`）：

```bash
./.mcp-probe/mcp.sh init       # 建会话
./.mcp-probe/mcp.sh tools      # 拉工具清单
./.mcp-probe/mcp.sh raw '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"bridge_info","arguments":{}}}'
```

## 2. 目标环境

| 项 | 值 |
| --- | --- |
| 工作区根 | `/Users/shiwei/Arena2api-fixed-main/arena-bridge-vscode` |
| 文件数（排除忽略目录） | 5054 |
| 权限 | write ✅ exec ✅ home ✅ network ✅ browser ✅（全开） |
| 语言服务 | symbols / definition / references / rename 适配器均在线 |
| 浏览器 | Chrome 155.0.8059.86，调试端口 9222，配置目录 `~/.arena-bridge/chrome-profile`，`autoLaunch: true`，`allowMutations: true` |
| Git | ⚠️ **该目录不是 git 仓库**（`git_status` 返回 exit 128），`git_*` 系列工具在此工作区不可用 |
| 远端运行时 | node v22.23.1 / macOS |

## 3. 返回与错误约定

- 成功：`result.content[0].text` 为**纯文本/Markdown/JSON 字符串**（非结构化对象），需要时自行 `JSON.parse`。
- 失败：**不是** JSON-RPC `error`，而是 `result.isError === true`，同时 `content[0].text` 给中文原因（例：`未知工具: xxx`、`文件不存在: a/b.ts`）。
  → **每次调用后必须先看 `isError`，否则会把报错当成正常输出往下走。**
- `run_command` 的文本块尾部带元信息：`[已结束 exit=0，耗时 0.1s] session=cmd19-869662` 与 `[output next_offset=72 has_more=false dropped_chars=0]`；`exit != 0` 时也要按失败处理（即便 `isError` 为 false）。
- `browser_status` 成功时 `isError` 为 `null`（键缺失），判断用「是否为 true」而不是「是否为 false」。

## 4. 使用规则（硬约束）

1. 连接后**先 `bridge_info`** 确认版本，避免连到旧服务（旧版缺 `save_image`、regex 编辑等能力）。
2. 改代码顺序：`list_files` → `read_file` / `get_symbols` → `edit_file` / `multi_edit` / `apply_patch` → `get_diagnostics` 复查。
   - `edit_file`/`multi_edit` 改完**自动回传诊断**，必须据此自查，再补一次 `get_diagnostics`。
   - 诊断只是快照，**不等于构建/测试通过**；要验证就跑 `run_command`。
3. 改前必读：`edit_file` 的 `old_string` 必须**唯一命中**；`multi_edit` 是**全成功才落盘**（不会改一半）；大改动优先 `apply_patch`（unified diff，仅限已有文件，新建用 `write_file`）。
4. `write_file` / `delete_file` / `restore_backup`：覆盖与删除前**自动备份**，出错可用 `restore_backup` 回滚（`backupFormat: 2`，留空参数列出备份清单）。
5. 语义操作**一律用 LSP 工具**，禁止正则手搓：
   - 跨文件重命名 → `rename_symbol`（**禁止** search + replace）
   - 找符号 → `search_workspace_symbols` / `get_symbols`
   - 跳定义 → `go_to_definition`；评估改动影响面 → `find_references`
   - 找**文本**才用 `search_code`，找**路径**用 `find_files`
6. 省 token 优先：`browser_text`/`browser_snapshot` 优于整页 HTML；`read_many` 优于多次 `read_file`；`edit_file` 支持 `mode=regex`（带 `s` 标志），长段替换写 `begin.*?end`。
7. 长命令用会话机制：`run_command` 的 `wait_sec` 默认 20（上限 60），超时返回 `session_id` → `command_output`（`wait_ms` 上限 50000）续取 → 必要时 `kill_command`。`timeout_sec` 默认 600 硬杀。
8. 图片必须走 `save_image`：传实际拿到的 Base64 / data URI，或**公网 HTTPS（443）** 下载地址；单张 ≤ 6 MiB（`max_bytes` 上限 6291456）；默认不覆盖，`overwrite: true` 才覆盖（先备份）。**不得**把二进制当 UTF-8 文本写进 `write_file`；**未拿到返回的成功路径前，不得声称"已保存"**。
9. 浏览器默认 `new_tab: true`，不动用户正在看的页面；`browser_eval` 能改页面，仅用于必要场景；排障先看 `browser_status`（唯一不受 `allowBrowser` 限制的浏览器工具）。
10. **只有用户明确要求时才执行 `git_commit`**；且当前工作区非 git 仓库，实际不可用。
11. 命令执行**不是沙箱**（服务端原话），在用户真实机器上跑，谨慎使用破坏性命令。
12. `set_workspace` 可切到 `/Users/weiwei` 下其他项目，无需重启；当前仅发现 1 个可用项目。

## 5. 工具清单（49 个，按用途分组）

**元信息 / 工作区**　`bridge_info` `project_info` `list_workspaces` `set_workspace`

**浏览与读取**　`list_files` `read_file` `read_many` `find_files` `search_code` `list_todos` `open_file`

**写入与编辑**　`write_file` `edit_file`（literal/regex）`multi_edit` `apply_patch` `delete_file` `restore_backup` `save_image`

**质量与诊断**　`get_diagnostics`

**Git（当前工作区不可用）**　`git_status` `git_diff` `git_log` `git_commit`

**LSP 语义**　`get_symbols` `go_to_definition` `find_references` `search_workspace_symbols` `rename_symbol`

**执行**　`run_command` `command_output` `kill_command` `list_commands`

**网络**　`web_fetch`（需 allowNetwork）

**浏览器（16 个）**　`browser_status` `browser_launch` `browser_tabs` `browser_use` `browser_open` `browser_navigate` `browser_eval` `browser_text` `browser_snapshot` `browser_click` `browser_fill` `browser_press` `browser_wait` `browser_scroll` `browser_screenshot` `browser_close_tab`

> 无 `resources`、无 `prompts`（均返回空数组），能力全在 tools 上。

### 关键参数速查

| 工具 | 必填 | 常用可选 |
| --- | --- | --- |
| `read_file` | `path` | `start_line`(1) `max_lines`(400) |
| `read_many` | `paths[]` | `max_lines`(200) |
| `search_code` | `pattern`(正则) | `path` `glob` `max_results`(60) |
| `find_files` | `pattern`(glob) | `path` `limit`(100) |
| `edit_file` | `path` `old_string` `new_string` | `replace_all` `mode`(literal/regex) |
| `multi_edit` | `edits[]`(`{path,old_string,new_string,replace_all?}`) | — |
| `apply_patch` | `patch`(unified diff) | — |
| `rename_symbol` | `path` `line` `new_name` | `column`(1) |
| `find_references` | `path` `line` | `column` `include_declaration`(true) |
| `run_command` | `command` | `cwd` `wait_sec`(20) `timeout_sec`(600) |
| `command_output` | `session_id` | `wait_ms`(5000) |
| `save_image` | `path` | `url` 或 `base64`、`mime_type` `overwrite` `max_bytes` |
| `browser_fill` | `selector` `value` | `submit` |
| `browser_screenshot` | — | `format`(jpeg) `quality`(60) `full_page` `max_width`(1100) `selector` `save_path` |
| `browser_text` | — | `selector`(body) `max_chars`(4000) |

## 6. 已观察到的环境现状（供后续工作参考）

### 6.1 工作区其实就是 arena-bridge 自身源码

`/Users/shiwei/Arena2api-fixed-main/arena-bridge-vscode` 是 **arena-bridge 这个 VS Code 扩展的源码目录**（一份解压拷贝，未 `git init`）：

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `src/server.ts` | 1652 | MCP server 全量实现：工具定义、分发、`tool*` 方法、写操作白名单 |
| `src/browser.ts` | 870 | Chrome CDP 通道（标签页/点击/填表/截图） |
| `src/extension.ts` | 448 | 扩展激活、命令注册、启停 |
| `src/image.ts` | 264 | `save_image` 的解码/校验/落盘 |
| `src/tunnel.ts` | 200 | 公网隧道（ngrok） |
| `src/version.ts` | 3 | 版本号 |

其他：`out/`（编译产物，`package.json main = ./out/extension.js`）、`test/`、`tools/`、`docs/`、`reports/`、`releases/arena-bridge-0.3.2 → 0.5.2.vsix`（7 个历史包）、`node_modules/`、`_archive/`（几份 660KB+ 的 `arena-ai*.txt` 备份）、`ArenaDesk/`（Swift 包：Package.swift + Sources/Tests）。

`package.json`：`name: arena-bridge`、`version: 0.5.2`、`publisher: weiwei`、`engines.vscode: ^1.90.0`、`activationEvents: onStartupFinished`。

关键实现锚点（改工具行为时先看这里）：
- `src/server.ts:1233` 工具定义（`save_image` 的 `inputSchema`）
- `src/server.ts:1315` 写操作白名单 `writes = new Set(["write_file","save_image","edit_file","multi_edit","delete_file","apply_patch","rename_symbol","git_commit"])`
- `src/server.ts:1339` 工具分发 `switch (name)`
- `src/server.ts:1395` 下发给客户端的 `instructions` 文案

### 6.2 浏览器

7 个标签页，集中在 `arena.ai`（Agent Mode / 模型对比 / leaderboard）、`grok.com/imagine`、一个 DevTools 面板，以及 `emailnator.com`（临时邮箱）。

### 6.3 注意

- 该目录**无 `.git`**，所以 `git_status`/`git_diff`/`git_commit` 全部返回 exit 128；改动无法用 git 回滚 —— 幸而 `write_file`/`edit_file`/`delete_file` 自带备份，`restore_backup` 可救。
- 存在 `out/` 编译产物，源码改动后需重新编译（`tsc`）并重装 vsix 才会体现在运行中的服务上 —— 即：**改了源码，当前 MCP 会话的 49 个工具行为不会立刻变**。


## 7. 复连检查清单

1. `bridge_info` → 版本应为 `0.5.2`
2. `project_info` → 根目录应为 `/Users/shiwei/Arena2api-fixed-main/arena-bridge-vscode`
3. `tools/list` → 数量应为 **49**
4. 任取一条只读调用（如 `git_status`）→ 能正常返回（含预期的 `isError` 失败也算通道正常）
