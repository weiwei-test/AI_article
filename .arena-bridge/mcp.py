#!/usr/bin/env python3
"""Minimal MCP (streamable HTTP) client for the arena-bridge workspace bridge.

Usage:
  mcp.py init                 # initialize + cache session id, print server info
  mcp.py tools [--full]       # list tools (names only, or full schemas)
  mcp.py schema <tool_name>   # print one tool's inputSchema
  mcp.py call <tool> '<json>' # invoke a tool with JSON arguments
  mcp.py raw '<json>'         # send a raw JSON-RPC {"method":..,"params":..} body

Env:
  MCP_URL  endpoint (defaults to the configured bridge URL below)
"""
import json
import os
import sys
import urllib.request
import urllib.error

HOME = os.path.expanduser("~/.arena-bridge")
URL = os.environ.get(
    "MCP_URL",
    "https://illa-nonblockaded-direly.ngrok-free.dev/mcp/BXRDvBj3jPUXZOVFew4bl3zuO5KCiwTo",
)
SESSION_FILE = os.path.join(HOME, "session")
TOOLS_FILE = os.path.join(HOME, "tools.json")
PROTOCOL = "2024-11-05"


def _post(payload, session=None, timeout=180):
    body = json.dumps(payload).encode()
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "ngrok-skip-browser-warning": "true",
        "MCP-Protocol-Version": PROTOCOL,
    }
    if session:
        headers["mcp-session-id"] = session
    req = urllib.request.Request(URL, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            sid = resp.headers.get("mcp-session-id", session)
            ctype = resp.headers.get("content-type", "")
            raw = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:2000]}") from None
    if "text/event-stream" in ctype:
        for line in raw.splitlines():  # last data: frame carries the JSON-RPC reply
            if line.startswith("data:"):
                chunk = line[5:].strip()
                if chunk and chunk != "[DONE]":
                    try:
                        return json.loads(chunk), sid
                    except json.JSONDecodeError:
                        continue
        raise RuntimeError(f"no JSON in SSE stream: {raw[:500]}")
    return json.loads(raw), sid


def _store_session(sid):
    os.makedirs(HOME, exist_ok=True)
    with open(SESSION_FILE, "w") as f:
        f.write(sid or "")


def _load_session():
    try:
        with open(SESSION_FILE) as f:
            return f.read().strip() or None
    except FileNotFoundError:
        return None


def initialize():
    res, sid = _post({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL,
            "capabilities": {},
            "clientInfo": {"name": "cline", "version": "1.0.0"},
        },
    })
    if "error" in res:
        raise RuntimeError(json.dumps(res["error"]))
    if sid:
        _store_session(sid)
        try:  # notifications/initialized is required by the MCP spec
            _post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
        except Exception:
            pass
    return res, sid


def request(method, params=None, _retry=True):
    sid = _load_session()
    if not sid:
        initialize()
        sid = _load_session()
    payload = {"jsonrpc": "2.0", "id": 2, "method": method}
    if params is not None:
        payload["params"] = params
    try:
        res, sid = _post(payload, sid)
    except RuntimeError as e:
        if _retry and ("HTTP 400" in str(e) or "HTTP 404" in str(e)):
            initialize()  # session expired -> handshake again
            return request(method, params, _retry=False)
        raise
    if sid:
        _store_session(sid)
    if "error" in res:
        raise RuntimeError(json.dumps(res["error"], ensure_ascii=False))
    return res.get("result")


def load_tools(force=False):
    if not force and os.path.exists(TOOLS_FILE):
        with open(TOOLS_FILE) as f:
            return json.load(f)
    tools = request("tools/list").get("tools", [])
    os.makedirs(HOME, exist_ok=True)
    with open(TOOLS_FILE, "w") as f:
        json.dump(tools, f, ensure_ascii=False, indent=2)
    return tools


def unwrap(result):
    """Collapse MCP content blocks into plain text / parsed JSON."""
    if isinstance(result, dict) and "content" in result:
        parts = []
        for block in result["content"]:
            if block.get("type") == "text":
                parts.append(block.get("text", ""))
            else:
                parts.append(json.dumps(block, ensure_ascii=False))
        text = "\n".join(parts)
        try:
            return json.loads(text)
        except (json.JSONDecodeError, ValueError):
            return text
    return result


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    cmd = argv[1]
    try:
        if cmd == "init":
            info, sid = initialize()
            print(json.dumps(info.get("result", info), ensure_ascii=False, indent=2))
            print(f"\nsession={sid}")
        elif cmd == "tools":
            tools = load_tools(force="--refresh" in argv)
            if "--full" in argv:
                print(json.dumps(tools, ensure_ascii=False, indent=2))
            else:
                for t in tools:
                    first = (t.get("description") or "").strip().splitlines()
                    print(f"- {t['name']}: {first[0][:130] if first else ''}")
                print(f"\n{len(tools)} tools")
        elif cmd == "schema":
            for t in load_tools():
                if t["name"] == argv[2]:
                    print(json.dumps(t.get("inputSchema", {}), ensure_ascii=False, indent=2))
                    return 0
            print(f"tool not found: {argv[2]}", file=sys.stderr)
            return 2
        elif cmd == "call":
            args = json.loads(argv[3]) if len(argv) > 3 else {}
            out = unwrap(request("tools/call", {"name": argv[2], "arguments": args}))
            print(out if isinstance(out, str) else json.dumps(out, ensure_ascii=False, indent=2))
        elif cmd == "raw":
            spec = json.loads(argv[2])
            print(json.dumps(request(spec["method"], spec.get("params")),
                             ensure_ascii=False, indent=2))
        else:
            print(__doc__)
            return 1
    except Exception as e:  # surface transport/protocol errors clearly
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
