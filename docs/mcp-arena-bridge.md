# Arena Bridge MCP 接入与使用手册

> 目标：把用户本机 VS Code 工作区当成“远程手和眼”。本文档记录**已实测**的连接方式、硬性规则、工具地图与常见坑。
> 配套客户端：`scripts/mcp_client.py`（纯标准库，无需安装依赖）。

---

## 1. 连接信息（2026-10-26 实测）

| 项目 | 值 |
| --- | --- |
| Endpoint | `https://illa-nonblockaded-direly.ngrok-free.dev/mcp/BXRDvBj3jPUXZOVFew4bl3zuO5KCiwTo` |
| 传输 | Streamable HTTP（只支持 POST） |
| 协议版本 | `2025-06-18` |
| 服务端 | `arena-bridge` **0.5.2**，buildId `20261023-save-image.1`，backend `vscode-node`，端口 8765（pid 首次连接 8290，17:06 重启后 59176） |
| 当前工作区 | `/Users/shiwei/Arena2api-fixed-main/arena-bridge-vscode`（5044 个文件，**不是 git 仓库**） |
| 可切换范围 | `list_workspaces` 显示：`/Users/weiwei` 下任意项目 |
| 权限 | write ✅ exec（非沙箱）✅ home ✅ network ✅ browser ✅，页面可变（allowMutations）✅ |
| 语言服务 | symbols / definition / references / rename 均 ✅ |
| 浏览器 | CDP 端口 9222，profile `~/.arena-bridge/chrome-profile`，Chrome 155.0.8059.86，自动拉起 |
| 工具数 | **49** |

### 手工握手（排查用）

```bash
URL='https://illa-nonblockaded-direly.ngrok-free.dev/mcp/BXRDvBj3jPUXZOVFew4bl3zuO5KCiwTo'

# 1) initialize —— 响应头会带 mcp-session-id，必须保存
curl -sS -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'ngrok-skip-browser-warning: true' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}'

# 2) 通知（返回 202、空 body）
curl -sS -X POST "$URL" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'ngrok-skip-browser-warning: true' -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# 3) 列工具 / 调工具
curl -sS -X POST "$URL" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'ngrok-skip-browser-warning: true' -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

四个必须点：
1. **只能 POST**，GET 返回 `405 {"error":"GET not supported; use POST for JSON-RPC"}`。
2. `Accept` 必须同时包含 `application/json` 和 `text/event-stream`，否则可能被拒。
3. ngrok 免费隧道必须带 `ngrok-skip-browser-warning: true`，否则拿到的是 HTML 警告页而不是 JSON。
4. `initialize` 响应头里的 `mcp-session-id` 要在后续每个请求回带；服务端对会话校验宽松（实测伪造 id 也能用），但不要依赖这一点。

服务端在 `initialize` 里返回的 `instructions` 字段就是官方使用规则，原文要点：
`list_files → get_symbols / read_file` 了解代码 → `edit_file / multi_edit / apply_patch` 修改（返回值自带诊断，据此自查）→ `get_diagnostics` 复查；只有用户明确要求时才提交代码；连接后先 `bridge_info`；诊断是快照，不代表构建测试通过；语义操作走 LSP；跨文件重命名一律 `rename_symbol`；`edit_file` 支持 `mode=regex` 省 token；长命令用 `run_command` 会话 + `command_output`；图片走 `save_image`，未成功不得声称已保存。

---

## 2. 使用规则（硬约束，按优先级）

### 2.1 连接与身份
1. **每次新会话先 `bridge_info`**：确认 `version/buildId`、`permissions`、`workspaceRoot`。buildId 不对说明连到了旧服务或旧扩展实例。
2. 工作区不对先 `list_workspaces` → `set_workspace`，不要在不相关仓库里读写（会污染用户工程）。
3. **`help` 不存在**：没有 `resources/*`、没有 `prompts/*`，能力只有 `tools`（服务端 `capabilities.tools.listChanged=false`，即工具集固定，不需要刷新）。

### 2.2 读（省 token 优先）
4. 顺序：`project_info` → `list_files(depth=2)` → `read_many` / `read_file`（大文件用 `start_line`+`max_lines`，默认只读 400 行）→ 需要结构时 `get_symbols`。
5. 找内容用 `search_code`（正则，`glob` 过滤）；找文件用 `find_files`（glob）；找符号用 `search_workspace_symbols`（LSP 模糊匹配，**别用正则猜函数在哪**）。
6. 未知符号定义/影响面：`go_to_definition`、`find_references`。**重构前先 `find_references` 评估影响面。**

### 2.3 写
7. 新建或整文件覆盖：`write_file`（覆盖前自动备份）。只改一段：`edit_file`（`old_string` 必须唯一；长段可用 `mode=regex` + `.*?` 省 token）。
8. 多处/多文件：`multi_edit`（全部校验通过才落盘，避免改一半）；大改动/标准补丁：`apply_patch`（unified diff，**只能改已有文件**，新建仍用 `write_file`）。
9. **跨文件重命名一律 `rename_symbol`**，禁止手搓 search+replace（会漏改、改错同名符号）。
10. 删除单文件用 `delete_file`（先备份）；误删用 `restore_backup` 查看清单/恢复最近备份。
11. 改完必须自查：`edit_file` 返回值自带诊断；再跑 `get_diagnostics`（可带 `path`）。**诊断是 VS Code 快照，不等于构建/测试通过**——需要时用 `run_command` 真跑。

### 2.4 git
12. `git_status` / `git_diff` / `git_log` 只读，可自由用。
13. `git_commit` **只在用户明确要求时**调用。传 `paths` 只提交这些文件；不传则提交所有已跟踪改动（**不含新文件**，新文件需先自行 `git add`，注意 `run_command` 的 git 白名单只含只读命令）。
14. ⚠️ 当前工作区 `/Users/shiwei/Arena2api-fixed-main/arena-bridge-vscode` **不是 git 仓库**，实测 `git_status` 返回 `Git执行失败 (128): fatal: not a git repository`。要提交代码必须先 `set_workspace` 到真正的仓库。

### 2.5 命令执行
15. `run_command` **不是沙箱**、`exec=true` 全放行，等于在用户 Mac 上以用户身份执行。只跑必要命令，避免 `rm -rf`、`sudo`、长时间驻留进程。
16. 长命令不要靠加大 `wait_sec`：默认等 20s（上限 60），没结束会返回 `session=cmdXXX-xxxxxx`，用 `command_output(session_id, wait_ms≤50000)` 续取，`kill_command` 收尾，`list_commands` 查看历史。
17. 破坏性/网络/发布类命令执行前先说明意图；不可逆操作先问。

### 2.6 图片
18. `save_image` 只接受**实际拿到的** `base64`（可 data URI）或**公网 HTTPS:443 直链**；单张 ≤6 MiB；默认不覆盖（`overwrite=true` 才覆盖且先备份）；不能读本地/sandbox 路径，不复用浏览器登录态。
19. 工具返回成功路径前，**不得声称图片已保存**。

### 2.7 浏览器
20. 默认 `browser_open` **新开标签页**，不动用户正在看的页面；只有 `new_tab=false` 才会导航当前页。
21. 操作前先 `browser_status`（唯一不受 allowBrowser 限制、可排障）→ `browser_tabs` → `browser_use` 选定标签页。
22. 只读巡检优先 `browser_text` / `browser_snapshot`（省 token）；`browser_eval` 能改页面，非必要不用。
23. `allowMutations=true` 意味着点击/填写会真实影响用户账号页面——涉及提交表单、发布、购买前必须确认。

### 2.8 网络
24. `web_fetch` 需 allowNetwork（已开），返回转纯文本，`max_chars` 默认 20000，注意截断。

---

## 3. 工具地图（49 个，按用途分组）

### 3.1 元信息 / 工作区（5）
| 工具 | 必填参数 | 说明 |
| --- | --- | --- |
| `bridge_info` | — | 版本、buildId、pid/端口、权限、工作区、工具清单、LSP 能力 |
| `project_info` | — | 根目录、文件数、可写/可执行、VS Code 工作区 |
| `list_workspaces` | — | 打开的工作区、允许的根目录、发现的项目 |
| `set_workspace` | `path` | 切工作区（绝对路径），不用重启 |
| `open_file` | `path`（`line`） | 在编辑器打开并定位 |

### 3.2 浏览与读取（7）
| 工具 | 必填参数 | 说明 |
| --- | --- | --- |
| `list_files` | —（`path`、`depth=2`） | 列表带大小 |
| `read_file` | `path`（`start_line`、`max_lines=400`） | 带行号，大文件分段 |
| `read_many` | `paths[]`（`max_lines=200`） | 一次读多个，省往返 |
| `search_code` | `pattern`（`path`、`glob`、`max_results=60`） | 正则内容搜索，返回 文件:行:内容 |
| `find_files` | `pattern`（`path`、`limit=100`） | glob 找路径 |
| `list_todos` | —（`path`、`limit=80`） | TODO/FIXME/HACK/XXX/BUG |
| `get_symbols` | `path` | 文件符号大纲（LSP） |

### 3.3 写入 / 备份（6）
| 工具 | 必填参数 | 说明 |
| --- | --- | --- |
| `write_file` | `path`、`content` | 新建/覆盖（自动备份） |
| `edit_file` | `path`、`old_string`、`new_string`（`replace_all`、`mode=literal\|regex`） | 唯一片段替换，**返回诊断** |
| `multi_edit` | `edits[]` | 多处/多文件，全通过才落盘 |
| `apply_patch` | `patch` | unified diff，仅已有文件 |
| `delete_file` | `path` | 删单文件（先备份） |
| `restore_backup` | —（`path`） | 列备份清单 / 恢复最近备份（backupFormat 2） |

### 3.4 git / 诊断（5）
| 工具 | 必填参数 | 说明 |
| --- | --- | --- |
| `git_status` / `git_diff` / `git_log` | —（`git_diff`: `path`、`staged`；`git_log`: `limit=15`、`path`） | 只读 |
| `git_commit` | `message`（`paths[]`） | 仅用户要求时；新文件需先 add |
| `get_diagnostics` | —（`path`） | VS Code 错误/警告快照 |

### 3.5 LSP 语义（5）
| 工具 | 必填参数 | 说明 |
| --- | --- | --- |
| `search_workspace_symbols` | `query` | 模糊找类/函数（优先于正则） |
| `go_to_definition` | `path`、`line`（`column=1`） | 跳定义 |
| `find_references` | `path`、`line`（`column`、`include_declaration`） | 全工作区引用 |
| `rename_symbol` | `path`、`line`、`new_name`（`column`） | 安全重命名，自动改所有引用 |
| `get_symbols` | `path` | 见 3.2 |

### 3.6 命令（5）
| 工具 | 必填参数 | 说明 |
| --- | --- | --- |
| `run_command` | `command`（`cwd`、`wait_sec=20`≤60、`timeout_sec=600`） | 非沙箱；超时返回 `session=...` |
| `command_output` | `session_id`（`wait_ms=5000`≤50000） | 续取输出（带 `next_offset`、`has_more`） |
| `kill_command` | `session_id` | 中止会话 |
| `list_commands` | — | 历史会话与状态 |
| `web_fetch` | `url`（`max_chars=20000`） | 抓网页转纯文本 |

### 3.7 浏览器（15）
`browser_status`（排障，唯一不受限）→ `browser_launch`（`url`）→ `browser_tabs` → `browser_use`（`tab`）→ `browser_open`（`url`、`new_tab=true`）/`browser_navigate`（`url`、`wait_ms=4000`）→ `browser_text`（`selector=body`、`max_chars=4000`）/`browser_snapshot`（`max_items=120`）→ `browser_click`（`selector`）/`browser_fill`（`selector`、`value`、`submit`）/`browser_press`（`key`）/`browser_wait`（`selector`、`timeout_ms=15000`）/`browser_scroll`（`y`）/`browser_eval`（`expression`、`tab`）→ `browser_screenshot`（`format=jpeg\|png`、`quality=60`、`full_page`、`max_width=1100`、`selector`、`save_path`）→ `browser_close_tab`（`tab`）。

> 截图默认返回**图片内容**（base64），本仓库客户端会存到 `--image-dir`；也可用 `save_path` 让服务端直接写进工作区。

### 3.8 图片（1）
`save_image`：`path` + （`url` | `base64`），可选 `mime_type`、`overwrite`、`max_bytes`。返回保存路径/格式/尺寸/字节数/SHA256。

---

## 4. 推荐工作流（配方）

**A. 接手陌生仓库**
```
bridge_info → project_info → list_files(depth=2) → read_many(package.json, README.md, 入口文件)
→ get_symbols(核心文件) → list_todos
```

**B. 定位并修一个 bug**
```
search_workspace_symbols(名字) 或 search_code(报错文本/日志) → read_file(上下文)
→ find_references(要改的符号，评估影响) → edit_file / multi_edit
→ 读返回的诊断 → get_diagnostics(path) → run_command("npm test -- --run") 验证
```

**C. 跨文件重命名**
```
find_references 看影响面 → rename_symbol(path, line, new_name) → get_diagnostics → 跑测试
```

**D. 长任务（安装/构建/下载）**
```
run_command("npm ci && npm run build", wait_sec=60)   # 大概率返回 session=cmdXXX
→ command_output(session_id, wait_ms=50000) 循环直到 has_more=false
→ 失败或挂住：kill_command(session_id) + list_commands 复盘
```

**E. 网页问题排查**
```
browser_status → browser_tabs → browser_use("片段") → browser_text 或 browser_snapshot
→ 交互：browser_click / browser_fill(submit) / browser_wait
→ 存证：browser_screenshot(save_path="reports/xxx.jpg") 或 --image-dir
```

**F. 保存图片到工作区**
```
save_image(path="assets/cover.png", url="https://…/x.png")     # 或 base64=data:image/png;base64,…
→ 校验返回的 path/尺寸/SHA256 后再向用户汇报
```

---

## 5. 本地 CLI：`scripts/mcp_client.py`

纯标准库，自动完成 `initialize` + `notifications/initialized`，会话 id 缓存在 `/tmp/arena_mcp_session.json`，重复调用不必重新握手；同时解析 `application/json` 与 `text/event-stream` 两种响应。

```bash
cd /workspace

python3 scripts/mcp_client.py doctor                      # 一条命令自检：在线？版本？工作区？
python3 scripts/mcp_client.py wait --wait-sec 300         # 隧道掉线时轮询直到恢复
python3 scripts/mcp_client.py info                      # bridge_info
python3 scripts/mcp_client.py tools                      # 49 个工具 + 参数
python3 scripts/mcp_client.py tools --json               # 原始 schema

python3 scripts/mcp_client.py call read_file '{"path":"src/version.ts"}'
python3 scripts/mcp_client.py call multi_edit @/tmp/edits.json
echo '{"query":"Tunnel"}' | python3 scripts/mcp_client.py call search_workspace_symbols -
python3 scripts/mcp_client.py call run_command '{"command":"npm test","wait_sec":60}' --json
python3 scripts/mcp_client.py call bridge_info --json | jq '{version, processId, workspaceRoot}'

python3 scripts/mcp_client.py --image-dir /tmp/shots call browser_screenshot '{"format":"jpeg"}'
python3 scripts/mcp_client.py raw '{"method":"ping"}'
```

| 开关 / 环境变量 | 作用 |
| --- | --- |
| `--url` / `ARENA_MCP_URL` | 覆盖端点（换隧道/换工作区） |
| `--timeout` / `ARENA_MCP_TIMEOUT` | 单请求超时，默认 120s |
| `--json` | 结构化输出：工具正文能解析成 JSON 就直接输出 payload（`| jq` 友好），否则输出完整 JSON-RPC result |
| `--image-dir DIR` | 把 image 内容解码落盘（默认只打印占位） |
| `ARENA_MCP_SESSION_FILE` | 会话缓存路径，默认 `/tmp/arena_mcp_session.json` |
| 退出码 | `0` 成功 / `1` 工具或服务端错误（`isError=true`）/ `2` 用法错误 |

Python 内直接复用：

```python
from scripts.mcp_client import Client

client = Client()                      # 自动握手/复用会话
tools = client.list_tools()
client.call_tool("read_file", {"path": "README.md"})
```

---

## 6. 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| `404 The endpoint xxx is offline / ERR_NGROK_3200` | **隧道离线**：用户端 VS Code 的 Arena Bridge 没在跑、或 ngrok 隧道断开。让用户在命令面板执行 `Arena Bridge: Start` / `Restart`，若 URL 变了就更新 `ARENA_MCP_URL`；用 `doctor` / `wait` 复检 |
| `503 ngrok gateway error / ERR_NGROK_3004` | 上游过慢或半途断开（长请求常见）。先 `doctor` 确认在线，换更轻的工具或重试 |
| `405 GET not supported` | 只能 POST，别用浏览器直接打开 |
| 返回 HTML（ngrok 警告页） | 缺 `ngrok-skip-browser-warning: true` |
| `Missing session` / session 相关错误 | 客户端会自动 `initialize` 重试一次；仍失败就删 `/tmp/arena_mcp_session.json` |
| `工具返回 isError=true` | 业务错误，看输出正文（如 `文件不存在: x.ts`）；CLI 退出码 1 |
| `Git执行失败 (128): not a git repository` | 当前工作区不是 git 仓库，先 `set_workspace` |
| 命令只有前半截 | 用返回的 `session=cmdXXX` 调 `command_output` 续取 |
| 诊断为空但构建失败 | `get_diagnostics` 只是编辑器快照，必须 `run_command` 真跑构建/测试 |
| 图片没存上 | `save_image` 只收真实 base64 / 公网 HTTPS:443 直链，≤6 MiB，且未 `overwrite=true` 不覆盖 |
| 浏览器连不上 | 先 `browser_status`，再 `browser_launch`（自动拉起独立 profile 的 Chrome） |
| 想换项目 | `list_workspaces` 看可切换项（`/Users/weiwei` 下均可）→ `set_workspace` |

---

## 7. 注册到 MCP 客户端

VS Code / Cline 的 `mcp_settings.json`（或同类支持 Streamable HTTP 的客户端）：

```json
{
  "mcpServers": {
    "arena-bridge": {
      "url": "https://illa-nonblockaded-direly.ngrok-free.dev/mcp/BXRDvBj3jPUXZOVFew4bl3zuO5KCiwTo",
      "transport": "streamableHttp",
      "headers": { "ngrok-skip-browser-warning": "true" },
      "alwaysAllow": [],
      "disabled": false
    }
  }
}
```

> 注意：URL 里的 token 等同凭据，且该隧道是免费 ngrok 域名，可能随时变化。写进仓库前确认仓库是私有的。

---

## 8. 本次连接实测记录（2026-10-26）

| 检查项 | 结果 |
| --- | --- |
| `initialize` + `notifications/initialized` | ✅ 协议 `2025-06-18`，server `arena-bridge 0.5.2` |
| `tools/list` | ✅ 49 个工具，与 `bridge_info.tools` 一致 |
| `bridge_info` / `project_info` | ✅ 权限 write/exec/home/network/browser 全开 |
| `list_files` / `read_file` / `get_symbols` | ✅ 5044 文件；`src/version.ts` 3 行；`tunnel.ts` 62 符号 |
| `run_command` + 会话 | ✅ `node -v && pwd` → v22.23.1 / 工作区路径，exit=0（session `cmd1-614ef5`） |
| `git_status` | ⚠️ 非 git 仓库（128），已记录规避方式 |
| `browser_status` / `browser_screenshot` | ✅ Chrome 155，4 标签页；JPEG 1100x594 35KB 落盘 |
| `web_fetch` | ✅ example.com 200 转纯文本 |
| **写入链路**（write→edit→apply_patch→read→delete） | ✅ 探针文件 `.arena-probe/mcp-smoke.txt`：新建 17 字符 → 替换 1 处 → 补丁改 1 行（`beta-patched`）→ 读回 4 行 → 删除；`restore_backup` 能看到该文件备份，删除后读到 `文件不存在`，工作区无残留 |
| `get_diagnostics` | ✅ 返回「没有诊断信息」快照提示 |
| `find_references` | ✅ 正常返回 |
| `search_workspace_symbols` | ❌ 20s 超时（5044 文件工作区 LSP 索引慢，会被 ngrok 切断），实战改用 `search_code`/`find_files` |
| `save_image` / `rename_symbol` / `git_commit` | ⏸ 未实调（避免无授权改动用户仓库内容） |


**连接中途掉线并已自动恢复（实证）**：16:56–16:58 全部调用正常；16:59 起同一端点变成 `404 ERR_NGROK_3200 endpoint is offline`（用户侧 tunnel/扩展停了，与客户端无关）；17:06:21 后台 `wait` 探针捕获到恢复（新 pid 59176），随后 `bridge_info`/`tools/list`(49)/`read_file`/`run_command`/写链路全部复测通过。结论：**掉线只需重启 Arena Bridge，客户端无需改动；URL 变化则用 `ARENA_MCP_URL` 覆盖。**


**已知性能注意**：`search_workspace_symbols`（LSP 全库索引）首次调用可能超过 ngrok 网关容忍时间并触发 `ERR_NGROK_3004`；此时优先用 `search_code` + `glob` 或 `find_files`，等 LSP 索引预热后再用语义工具。




