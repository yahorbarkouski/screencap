#!/usr/bin/env python3
"""End-to-end check of `Screencap mcp` over stdio, in both protocol eras.

Usage: scripts/mcp-check.py BINARY --store DIR [--defaults SUITE] [--query WORDS] [--show]

Starts the server twice: once as a 2025-11-25 client (initialize, then calls) and once as a 2026-07-28 client
(server/discover and per-request _meta). It calls every tool with arguments taken from earlier results, checks each
result's shape (text content equal to structuredContent, annotations, paging fields, a JPEG screenshot), and prints
one line per call with its size in estimated tokens. --show also prints each result, which holds whatever the store
holds: run it only on a store you may read. Exits non-zero on the first failed check.
"""
import argparse
import base64
import json
import subprocess
import sys

MODERN = "2026-07-28"
META = {
    "io.modelcontextprotocol/protocolVersion": MODERN,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": {"name": "mcp-check", "version": "1"},
}


class Server:
    def __init__(self, command):
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.next_id = 0

    def send(self, method, params=None, notify=False):
        message = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        if not notify:
            self.next_id += 1
            message["id"] = self.next_id
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()
        if notify:
            return None
        reply = json.loads(self.process.stdout.readline())
        check(reply.get("id") == self.next_id, f"{method}: reply id {reply.get('id')} for request {self.next_id}")
        return reply

    def close(self):
        self.process.stdin.close()
        check(self.process.wait(timeout=10) == 0, "server did not exit cleanly on end of input")


def check(condition, message):
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)


def call(server, name, arguments, show, modern=False):
    params = {"name": name, "arguments": arguments}
    if modern:
        params["_meta"] = META
    reply = server.send("tools/call", params)
    check("result" in reply, f"{name}: protocol error {reply.get('error')}")
    result = reply["result"]
    text = result["content"][0]["text"]
    if result.get("isError"):
        print(f"  {name}({json.dumps(arguments)}) -> error: {text}")
        return None
    structured = result["structuredContent"]
    check(json.loads(text) == structured, f"{name}: text content differs from structuredContent")
    if modern:
        check(result.get("resultType") == "complete", f"{name}: no resultType")
        check("io.modelcontextprotocol/serverInfo" in result.get("_meta", {}), f"{name}: no serverInfo in _meta")
    images = [c for c in result["content"] if c["type"] == "image"]
    extra = ""
    if images:
        data = base64.b64decode(images[0]["data"])
        check(data[:3] == b"\xff\xd8\xff", f"{name}: image is not a JPEG")
        extra = f", image {structured['width']}x{structured['height']} {len(data) // 1024} KB"
    print(f"  {name}({json.dumps(arguments)}) -> ~{len(text) // 4} tokens{extra}")
    if show:
        print(json.dumps(structured, indent=2, ensure_ascii=False))
    return structured


def legacy(command, query, show):
    print("2025-11-25 client")
    server = Server(command)
    init = server.send("initialize", {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "mcp-check", "version": "1"}})
    check(init["result"]["protocolVersion"] == "2025-11-25", "initialize: version not echoed")
    check("Screencap" in init["result"]["instructions"], "initialize: no instructions")
    server.send("notifications/initialized", notify=True)
    check(server.send("ping")["result"] == {}, "ping")
    tools = server.send("tools/list")["result"]["tools"]
    names = [t["name"] for t in tools]
    check(names == ["search", "day", "threads", "thread", "activity", "now", "screenshot"], f"tools/list: {names}")
    for tool in tools:
        check(tool["annotations"]["readOnlyHint"] is True and tool["annotations"]["openWorldHint"] is False, f"{tool['name']}: annotations")
        check(tool["inputSchema"]["type"] == "object" and tool["outputSchema"]["type"] == "object", f"{tool['name']}: schemas")
    print(f"  tools/list -> {len(tools)} tools, ~{len(json.dumps(tools)) // 4} tokens")
    prompts = server.send("prompts/list")["result"]["prompts"]
    check([p["name"] for p in prompts] == ["standup", "recap", "resume"], f"prompts/list: {prompts}")
    resume = server.send("prompts/get", {"name": "resume", "arguments": {"topic": "the plan"}})["result"]
    check("the plan" in resume["messages"][0]["content"]["text"], "prompts/get: topic not in the request")
    check(server.send("prompts/get", {"name": "resume"}).get("error", {}).get("code") == -32602, "prompts/get: a missing topic is not -32602")
    print(f"  prompts/list -> {len(prompts)} prompts")

    now = call(server, "now", {}, show)
    check(now is None or "history_since" in now or now.get("screen") is None, "now: no history_since")
    day = call(server, "day", {"date": "today"}, show)
    yesterday = call(server, "day", {"date": "yesterday"}, show)
    threads = call(server, "threads", {}, show)
    if threads and threads["threads"]:
        thread = call(server, "thread", {"id": threads["threads"][0]["id"], "limit": 5}, show)
        check(thread["activity_count"] >= len(thread["activities"]), "thread: activity_count below the page")
    activities = [a for d in (day, yesterday) if d for a in d["activities"] if "id" in a and not a.get("open")]
    if activities:
        longest = max(activities, key=lambda a: a["when"])
        detail = call(server, "activity", {"id": longest["id"], "text_limit": 1500}, show)
        check(len(detail["screen_text"]) <= 1500, "activity: text_limit not applied")
        if detail.get("screenshot_at"):
            call(server, "screenshot", {"at": detail["screenshot_at"]}, show)
            call(server, "screenshot", {"at": detail["screenshot_at"], "crop": "screen"}, show)
    words = query
    if not words and now and now.get("screen", {}).get("window"):
        words = " ".join(w for w in now["screen"]["window"].split() if len(w) > 3 and w.isalpha())[:40].split(" ")[0]
    if words:
        found = call(server, "search", {"query": words, "limit": 3}, show)
        check(len(found["results"]) <= 3, "search: limit not applied")
        if found["more"]:
            page = call(server, "search", {"query": words, "limit": 3, "offset": found["next_offset"]}, show)
            check(page["results"] != found["results"], "search: offset returned the same page")
        call(server, "search", {"query": words, "sort": "newest", "from": "today"}, show)
    call(server, "screenshot", {"at": "now"}, show)
    bad = server.send("tools/call", {"name": "day", "arguments": {"date": "last tuesday"}})["result"]
    check(bad.get("isError") is True and "YYYY-MM-DD" in bad["content"][0]["text"], "day: a bad date is not an error that names the form")
    unknown = server.send("tools/call", {"name": "nope", "arguments": {}})
    check(unknown.get("error", {}).get("code") == -32602, "unknown tool is not -32602")
    server.close()


def modern(command, show):
    print(f"{MODERN} client")
    server = Server(command)
    discover = server.send("server/discover", {"_meta": META})["result"]
    check(discover["supportedVersions"] == [MODERN] and discover["cacheScope"] == "public" and discover["ttlMs"] > 0, "server/discover")
    check(discover["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "screencap", "server/discover: serverInfo")
    listed = server.send("tools/list", {"_meta": META})["result"]
    check(listed["resultType"] == "complete" and listed["ttlMs"] > 0 and len(listed["tools"]) == 7, "tools/list (modern)")
    call(server, "now", {}, show, modern=True)
    old = server.send("tools/list", {"_meta": {**META, "io.modelcontextprotocol/protocolVersion": "1900-01-01"}})
    check(old["error"]["code"] == -32022 and MODERN in old["error"]["data"]["supported"], "unsupported version is not -32022")
    missing = server.send("tools/list", {"_meta": {"io.modelcontextprotocol/protocolVersion": MODERN}})
    check(missing["error"]["code"] == -32602, "missing clientCapabilities is not -32602")
    print("  discover, versions and errors -> ok")
    server.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("binary")
    parser.add_argument("--store", required=True)
    parser.add_argument("--defaults")
    parser.add_argument("--query")
    parser.add_argument("--show", action="store_true")
    args = parser.parse_args()
    command = [args.binary, "mcp", "--store", args.store] + (["--defaults", args.defaults] if args.defaults else [])
    legacy(command, args.query, args.show)
    modern(command, args.show)
    print("all checks passed")


main()
