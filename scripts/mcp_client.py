#!/usr/bin/env python3
"""Minimal Streamable-HTTP MCP client for the arena-bridge server.

Stdlib only (no `pip install`), so it works in any sandbox/CI shell.

Usage:
    python3 scripts/mcp_client.py doctor
    python3 scripts/mcp_client.py wait --wait-sec 300
    python3 scripts/mcp_client.py info
    python3 scripts/mcp_client.py tools
    python3 scripts/mcp_client.py call list_files '{"path":".","depth":1}'
    python3 scripts/mcp_client.py call read_file @args.json
    echo '{"path":"README.md"}' | python3 scripts/mcp_client.py call read_file -
    python3 scripts/mcp_client.py raw '{"method":"ping"}'

Environment overrides:
    ARENA_MCP_URL           endpoint (defaults to the bridge URL below)
    ARENA_MCP_SESSION_FILE  session cache (default /tmp/arena_mcp_session.json)
    ARENA_MCP_TIMEOUT       per-request timeout seconds (default 120)

Exit codes: 0 ok, 1 tool/server error, 2 usage error.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_URL = (
    "https://illa-nonblockaded-direly.ngrok-free.dev/mcp/"
    "BXRDvBj3jPUXZOVFew4bl3zuO5KCiwTo"
)
PROTOCOL_VERSION = "2025-06-18"
CLIENT_INFO = {"name": "arena-bridge-cli", "version": "1.0.0"}


class MCPError(RuntimeError):
    """Transport / JSON-RPC level failure."""

    def __init__(self, message: str, *, status: int | None = None, payload: dict | None = None):
        super().__init__(message)
        self.status = status
        self.payload = payload


def _header(headers: dict, name: str) -> str | None:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def _request(
    url: str,
    payload: dict,
    session_id: str | None = None,
    timeout: float = 120.0,
) -> tuple[int, dict, bytes]:
    """POST one JSON-RPC message; never raises on HTTP status."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        # ngrok's free tunnel otherwise answers with an HTML warning page.
        "ngrok-skip-browser-warning": "true",
        "User-Agent": f"{CLIENT_INFO['name']}/{CLIENT_INFO['version']}",
    }
    if session_id:
        headers["mcp-session-id"] = session_id
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as exc:  # 4xx/5xx still carry a JSON-RPC body
        return exc.code, dict(exc.headers or {}), exc.read()



def _decode(headers: dict, body: bytes) -> dict | None:
    """Decode either a plain JSON body or a text/event-stream body."""
    text = body.decode("utf-8", "replace").strip()
    if not text:
        return None
    content_type = (_header(headers, "content-type") or "").lower()
    looks_like_sse = text.startswith(("event:", "data:", "id:", ":")) or "\ndata:" in text
    if "text/event-stream" in content_type or looks_like_sse:
        messages: list[dict] = []
        for event in text.replace("\r\n", "\n").split("\n\n"):
            data = [
                line[5:].lstrip()
                for line in event.splitlines()
                if line.startswith("data:")
            ]
            if not data:
                continue
            chunk = "\n".join(data).strip()
            if not chunk or chunk == "[DONE]":
                continue
            try:
                messages.append(json.loads(chunk))
            except json.JSONDecodeError:
                continue
        return messages[-1] if messages else None
    return json.loads(text)


def _gateway_hint(status: int, body: bytes) -> str | None:
    """Translate ngrok's plain-text/HTML errors into actionable messages."""
    text = body.decode("utf-8", "replace")
    lowered = text.lower()
    if "err_ngrok_3200" in lowered or "is offline" in lowered:
        return (
            "隧道离线 (ERR_NGROK_3200)：ngrok 端点当前没有上游。"
            "请在用户的 VS Code 里确认 Arena Bridge 已启动（命令面板: "
            "Arena Bridge: Start / Restart），或重新复制带新 URL 的 MCP 配置；"
            "随后用 `doctor` / `wait` 复检。"
        )
    if "err_ngrok_3004" in lowered:
        return (
            "网关超时 (ERR_NGROK_3004)：上游响应过慢或中断，长请求常被 ngrok 切断。"
            "换更轻的工具（search_code / read_file），或先 `doctor` 确认服务在线后重试。"
        )
    if status in (502, 503, 504) and "jsonrpc" not in lowered:
        return f"网关错误 (HTTP {status})：上游不可用或响应不完整。{text[:200].strip()}"
    return None


class Client:
    """Stateful MCP client; the session id is cached on disk between runs."""

    def __init__(
        self,
        url: str | None = None,
        session_file: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.url = url or os.environ.get("ARENA_MCP_URL") or DEFAULT_URL
        self.session_file = Path(
            session_file
            or os.environ.get("ARENA_MCP_SESSION_FILE")
            or "/tmp/arena_mcp_session.json"
        )
        self.timeout = float(timeout or os.environ.get("ARENA_MCP_TIMEOUT") or 120)
        self.session_id: str | None = None
        self.server_info: dict | None = None
        self._next_id = 0

    # -- session persistence -------------------------------------------------
    def _load_session(self) -> str | None:
        try:
            cached = json.loads(self.session_file.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if cached.get("url") != self.url:
            return None
        session_id = cached.get("session_id")
        return session_id if isinstance(session_id, str) and session_id else None

    def _save_session(self) -> None:
        try:
            self.session_file.parent.mkdir(parents=True, exist_ok=True)
            self.session_file.write_text(
                json.dumps({"url": self.url, "session_id": self.session_id}),
                "utf-8",
            )
        except OSError:
            pass  # caching is a convenience only


    # -- JSON-RPC ------------------------------------------------------------
    @staticmethod
    def _session_expired(error: dict) -> bool:
        message = str(error.get("message", "")).lower()
        return "session" in message or error.get("code") in (-32001, -32002)

    def _rpc(
        self,
        method: str,
        params: dict | None = None,
        *,
        notify: bool = False,
        retry: bool = True,
    ) -> dict | None:
        payload: dict = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        if not notify:
            self._next_id += 1
            payload["id"] = self._next_id

        status, headers, body = _request(self.url, payload, self.session_id, self.timeout)
        session_header = _header(headers, "mcp-session-id")
        if session_header:
            self.session_id = session_header

        if notify:
            if status >= 400:
                raise MCPError(f"通知 {method} 失败 (HTTP {status})", status=status)
            return None

        hint = _gateway_hint(status, body)
        if hint:
            raise MCPError(hint, status=status)

        try:
            message = _decode(headers, body)
        except json.JSONDecodeError as exc:
            raise MCPError(
                f"响应不是合法 JSON (HTTP {status}): {body[:300]!r}", status=status
            ) from exc

        if message is None:
            raise MCPError(f"服务端返回空响应 (HTTP {status})", status=status)

        error = message.get("error")
        if error:
            if retry and self._session_expired(error):
                self.initialize(force=True)
                return self._rpc(method, params, notify=notify, retry=False)
            raise MCPError(
                f"{error.get('message', 'JSON-RPC error')} (code {error.get('code')})",
                status=status,
                payload=message,
            )
        return message.get("result")

    # -- high-level API ------------------------------------------------------
    def initialize(self, force: bool = False) -> dict | None:
        if not force:
            cached = self._load_session()
            if cached:
                self.session_id = cached
                return None
        self.session_id = None
        result = self._rpc(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": CLIENT_INFO,
            },
            retry=False,
        )
        self.server_info = result
        self._save_session()
        self._rpc("notifications/initialized", notify=True, retry=False)
        return result

    def ensure(self) -> None:
        if not self.session_id:
            self.initialize()

    def list_tools(self) -> list[dict]:
        self.ensure()
        tools: list[dict] = []
        cursor = None
        while True:
            result = self._rpc("tools/list", {"cursor": cursor} if cursor else {}) or {}
            tools.extend(result.get("tools") or [])
            cursor = result.get("nextCursor")
            if not cursor:
                return tools

    def call_tool(self, name: str, arguments: dict | None = None) -> dict:
        self.ensure()
        return self._rpc("tools/call", {"name": name, "arguments": arguments or {}}) or {}

    def health(self) -> tuple[bool, str]:
        """One-shot reachability + identity check. Returns (ok, message)."""
        try:
            result = self.call_tool("bridge_info")
        except (MCPError, urllib.error.URLError, TimeoutError, OSError) as exc:
            return False, str(exc)
        text = "\n".join(
            item.get("text", "")
            for item in result.get("content") or []
            if item.get("type") == "text"
        )
        try:
            info = json.loads(text)
        except json.JSONDecodeError:
            return not result.get("isError"), text[:400]
        return True, (
            f"arena-bridge {info.get('version')} (build {info.get('buildId')}) | "
            f"{info.get('backend')} pid={info.get('processId')} | "
            f"workspace={info.get('workspaceRoot')} | "
            f"tools={len(info.get('tools') or [])} | "
            f"perm={info.get('permissions')}"
        )


def _render(result: dict, *, as_json: bool, image_dir: str | None, tool: str) -> int:
    """Print a tools/call result; return the process exit code."""
    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if result.get("isError") else 0

    parts: list[str] = []
    saved: list[str] = []
    for index, item in enumerate(result.get("content") or [], start=1):
        kind = item.get("type")
        if kind == "text":
            parts.append(item.get("text", ""))
        elif kind == "image":
            data = item.get("data") or ""
            mime = item.get("mimeType") or "image/png"
            ext = {"image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}.get(
                mime, "png"
            )
            if image_dir:
                target = Path(image_dir)
                target.mkdir(parents=True, exist_ok=True)
                path = target / f"{tool}-{index}.{ext}"
                path.write_bytes(base64.b64decode(data))
                saved.append(str(path))
            else:
                parts.append(f"[image {mime}, {len(data)} base64 chars]")
        elif kind == "resource":
            resource = item.get("resource") or {}
            parts.append(resource.get("text") or json.dumps(resource, ensure_ascii=False))
        else:
            parts.append(json.dumps(item, ensure_ascii=False))

    if not parts and result.get("structuredContent") is not None:
        parts.append(json.dumps(result["structuredContent"], ensure_ascii=False, indent=2))

    body = "\n".join(piece for piece in parts if piece)
    if body:
        print(body)
    for path in saved:
        print(f"[saved image] {path}")

    if result.get("isError"):
        print("工具返回 isError=true", file=sys.stderr)
        return 1
    return 0


def _load_arguments(raw: str | None) -> dict:
    if not raw or raw == "-":
        text = sys.stdin.read()
    elif raw.startswith("@"):
        text = Path(raw[1:]).read_text("utf-8")
    else:
        text = raw
    text = text.strip()
    if not text:
        return {}
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"参数不是合法 JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise SystemExit("参数必须是 JSON 对象，例如 {\"path\":\"src\"}")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="arena-bridge MCP 客户端（Streamable HTTP）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    def add_common(target: argparse.ArgumentParser, *, suppress: bool = False) -> None:
        # 放在子命令后面也能用；suppress 避免子解析器覆盖主解析器已取到的值
        default = argparse.SUPPRESS if suppress else None
        target.add_argument("--url", default=default, help="覆盖 MCP 端点")
        target.add_argument("--timeout", type=float, default=default, help="单次请求超时秒数")
        target.add_argument(
            "--json", action="store_true", default=default, help="输出原始 JSON-RPC result"
        )
        target.add_argument(
            "--image-dir", default=default, help="把返回的图片内容解码保存到该目录，并打印路径"
        )

    add_common(parser)
    sub = parser.add_subparsers(dest="command", required=True)

    for name, help_text in (
        ("info", "bridge_info：版本/权限/工作区"),
        ("tools", "列出工具及其参数 schema"),
        ("doctor", "连通性 + 版本自检（只读，不改动任何东西）"),
    ):
        add_common(sub.add_parser(name, help=help_text), suppress=True)

    wait_parser = sub.add_parser("wait", help="轮询直到桥恢复在线")
    add_common(wait_parser, suppress=True)
    wait_parser.add_argument("--wait-sec", type=float, default=180, help="最多等多少秒")
    wait_parser.add_argument("--interval", type=float, default=5, help="轮询间隔秒")

    call_parser = sub.add_parser("call", help="调用工具")
    add_common(call_parser, suppress=True)
    call_parser.add_argument("tool")
    call_parser.add_argument(
        "arguments", nargs="?", help="JSON 字符串、@文件路径，或 - 从 stdin 读取"
    )
    raw_parser = sub.add_parser("raw", help="发送任意 JSON-RPC 请求")
    add_common(raw_parser, suppress=True)
    raw_parser.add_argument("payload", help="JSON 字符串或 @文件路径")

    args = parser.parse_args(argv)
    client = Client(url=args.url, timeout=args.timeout)

    try:
        if args.command == "doctor":
            ok, message = client.health()
            print(("✅ 在线: " if ok else "❌ 不可用: ") + message)
            return 0 if ok else 1

        if args.command == "wait":
            deadline = time.time() + args.wait_sec
            attempt = 0
            while True:
                attempt += 1
                ok, message = client.health()
                stamp = time.strftime("%H:%M:%S")
                if ok:
                    print(f"[{stamp}] 第 {attempt} 次探测 ✅ 在线: {message}")
                    return 0
                print(f"[{stamp}] 第 {attempt} 次探测 ❌ {message}", file=sys.stderr)
                if time.time() + args.interval >= deadline:
                    print(f"等待 {args.wait_sec:.0f}s 后仍不可用，放弃。", file=sys.stderr)
                    return 1
                time.sleep(args.interval)

        if args.command == "info":
            return _render(
                client.call_tool("bridge_info"),
                as_json=args.json,
                image_dir=args.image_dir,
                tool="bridge_info",
            )

        if args.command == "tools":
            tools = client.list_tools()
            if args.json:
                print(json.dumps(tools, ensure_ascii=False, indent=2))
                return 0
            print(f"{len(tools)} 个工具\n" + "-" * 60)
            for tool in tools:
                schema = tool.get("inputSchema") or {}
                required = schema.get("required") or []
                props = list((schema.get("properties") or {}).keys())
                mark = f" 必填: {', '.join(required)}" if required else ""
                print(f"- {tool['name']}({', '.join(props)}){mark}")
                print(f"  {tool.get('description', '')}")
            return 0

        if args.command == "call":
            payload = _load_arguments(args.arguments)
            result = client.call_tool(args.tool, payload)
            return _render(
                result, as_json=args.json, image_dir=args.image_dir, tool=args.tool
            )

        if args.command == "raw":
            text = args.payload
            if text.startswith("@"):
                text = Path(text[1:]).read_text("utf-8")
            request = json.loads(text)
            method = request.get("method")
            if not method:
                raise SystemExit("raw 载荷必须包含 method")
            result = client._rpc(method, request.get("params"))
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
    except MCPError as exc:
        print(f"MCP 错误: {exc}", file=sys.stderr)
        if exc.payload:
            print(json.dumps(exc.payload, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"网络错误: {exc}", file=sys.stderr)
        return 1

    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
