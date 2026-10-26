# arena-bridge MCP — 接入备忘（Cline 侧）

## 端点与传输
- URL: https://illa-nonblockaded-direly.ngrok-free.dev/mcp/BXRDvBj3jPUXZOVFew4bl3zuO5KCiwTo
- 传输: Streamable HTTP（POST JSON-RPC），协议 `2024-11-05`，仅暴露 `tools` 能力
- 必需请求头: `Content-Type: application/json`、`Accept: application/json, text/event-stream`、
  `ngrok-skip-browser-warning: true`、`MCP-Protocol-Version: 2024-11-05`
- 第二次起必须带 `mcp-session-id`（initialize 的响应头返回）。session 过期会返回 400/404，
  重新 initialize 即可。会话 id 缓存在 `~/.arena-bridge/session`。
- 回应可能是 `application/json` 或 `text/event-stream`（取 data: 帧里的 JSON-RPC）。

## 客户端封装
`~/.arena-bridge/mcp.py`
```
python3 ~/.arena-bridge/mcp.py init
python3 ~/.arena-bridge/mcp.py tools [--full] [--refresh]
python3 ~/.arena-bridge/mcp.py schema edit_file
python3 ~/.arena-bridge/mcp.py call list_files '{"path":".","depth":1}'
```
工具清单缓存：`~/.arena-bridge/tools.json`

## 服务端身份（已核验）
- serverInfo: arena-bridge 0.5.2 / build `20261023-save-image.1` / backend vscode-node / port 8765
- workspaceRoot: `/Users/shiwei/Arena2api-fixed-main/arena-bridge-vscode`（5042 文件）
- 权限: write=true exec=true home=true network=true browser=true
- 浏览器: CDP 9222，profile `~/.arena-bridge/chrome-profile`，autoLaunch，allowMutations
- 语言服务: symbols / definition / references / rename 均可用（布尔仅表示适配器已连）

## 使用规则（来自 server instructions + 实测）
1. 连接后先 `bridge_info`，区分是否为旧服务版本。
2. 探索顺序：`list_files` → `get_symbols` / `read_file`（批量用 `read_many`）。
3. 修改优先 `edit_file`（唯一匹配；`mode=regex` 省 token）/ `multi_edit`（全成功才落盘）/
   `apply_patch`（大改动 unified diff，仅限已存在文件；新建用 `write_file`）。
4. 每次编辑后返回值自带诊断 → `get_diagnostics` 复查；诊断是快照，不等于构建/测试通过。
5. 语义操作用 LSP：`go_to_definition` / `find_references` / `search_workspace_symbols`；
   跨文件重命名一律 `rename_symbol`，禁止手搓 search+replace。
6. 找内容用 `search_code`（正则），找路径用 `find_files`（glob），不要互相替代。
7. 长命令用 `run_command` 会话：返回 session_id 后 `command_output` 续取（wait_ms ≤ 50000），
   必要时 `kill_command`；`list_commands` 查看所有会话。
8. 删除/覆盖都有备份：`delete_file` / `write_file` 覆盖前备份，`restore_backup` 可回滚。
9. 图片：`save_image` 传真实 base64 或公网 HTTPS 地址（≤6 MiB，默认不覆盖），
   不得把图片当 UTF-8 文本写入；工具没返回成功路径就不能说"已保存"。
10. **只有用户明确要求时才 git_commit**；默认不提交。
11. 命令执行不是沙箱 —— 是用户真实的 Mac 工作区，破坏性命令先确认。
12. 浏览器：先 `browser_status`（唯一不受 allowBrowser 限制的排障工具）→ `browser_snapshot`
    定位元素 → `browser_click` / `browser_fill`；取文本用 `browser_text`，
    截图 `browser_screenshot`（已压到 1100px 宽省 token）。

## 工具清单（49）
- 环境/工作区: bridge_info, project_info, list_workspaces, set_workspace
- 文件: list_files, read_file, read_many, find_files, search_code, write_file, edit_file,
  multi_edit, apply_patch, delete_file, restore_backup, save_image, open_file
- LSP: get_symbols, go_to_definition, find_references, search_workspace_symbols, rename_symbol,
  get_diagnostics
- Git: git_status, git_diff, git_log, git_commit
- 执行: run_command, command_output, kill_command, list_commands
- 网络: web_fetch
- 浏览器: browser_status, browser_launch, browser_tabs, browser_use, browser_open,
  browser_navigate, browser_eval, browser_text, browser_snapshot, browser_click, browser_fill,
  browser_press, browser_wait, browser_scroll, browser_screenshot, browser_close_tab
- 其它: list_todos

## 实测发现的坑
- 该工作区 **不是 git 仓库**（`fatal: not a git repository`）：git_* 工具会失败 128，
  需要历史/差异时用 `run_command` 或先确认用户是否要 `git init`。
- `git_commit` 不带 paths 时只提交已跟踪改动，不含新文件。
- 桥接的是 macOS 路径（`/Users/...`），与本地沙箱 `/workspace` 无关，不要混淆。
- ngrok 免费域名可能变动；变了只改 `mcp.py` 里的 URL 或设 `MCP_URL` 环境变量。
