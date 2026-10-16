# Agents: Screencap's MCP server and skill

AI agents such as Claude Code, Claude Desktop, Cursor and Codex can look things up in your Screencap history when you ask them something that depends on it: "what was the Rust article about borrowing I read on Tuesday?", "write my standup from yesterday", "where did I leave off on the Kyoto plan?". Screencap serves the history to them as a local [MCP](https://modelcontextprotocol.io) server built into the app, so connecting an agent needs nothing besides Screencap. Agents can only read, and Settings shows which agent read what. Each agent starts the server itself when it needs it, so Screencap does not have to be open for agents to read; the history grows only while it runs.

Agent access is off until you turn it on.

## Turn it on and connect an agent

1. Open Screencap's Settings (right-click the menu-bar icon, then Settings) and go to **Agents**.
2. Turn on **Let agents read my history**. **Include screenshots**, also off until you turn it on, lets agents see screenshots too; without it they read text only.
3. Click **Connect** next to your agent. Connect does what the command in the table below does, so you never need Terminal for it.

In these commands, `Screencap` stands for the app's binary: type `/Applications/Screencap.app/Contents/MacOS/Screencap` in its place (or the same path inside wherever you keep the app). Connecting also writes Screencap's skill, a short file of instructions that tells the agent when to reach for Screencap and how to use its tools, where that agent reads skills (Claude Desktop reads none).

| Agent | Command | What it changes |
|---|---|---|
| Claude Code | `Screencap mcp install claude-code` | Runs `claude mcp add --scope user screencap -- /Applications/Screencap.app/Contents/MacOS/Screencap mcp`, so every project sees it, and writes the skill to `~/.claude/skills/screencap/SKILL.md`. New sessions pick it up. Without Claude Code's `claude` command on this Mac, it says so: install Claude Code, then connect again. |
| Claude Desktop | `Screencap mcp install claude-desktop` | Adds `screencap` to `mcpServers` in `~/Library/Application Support/Claude/claude_desktop_config.json`. Quit and reopen Claude Desktop. |
| Cursor | `Screencap mcp install cursor` | Adds `screencap` to `mcpServers` in `~/.cursor/mcp.json` and writes the skill to `~/.agents/skills/screencap/SKILL.md`, the skills folder Cursor and Codex both read. Restart Cursor if it is open. |
| Codex | `Screencap mcp install codex` | Adds a `[mcp_servers.screencap]` table to `~/.codex/config.toml` and writes the skill to `~/.agents/skills/screencap/SKILL.md`. |

Each command edits only Screencap's own entry and keeps everything else in the file, in its order. Running it again changes nothing, and it replaces an older `screencap` entry, such as the one Screencap v1 (the earlier Electron app) added. `Screencap mcp uninstall <agent>` removes what install added, and `Screencap mcp status` shows the two Settings switches and each agent's connection:

```bash
/Applications/Screencap.app/Contents/MacOS/Screencap mcp status
```

To connect Claude Code by hand, Settings shows the command with a Copy button. It connects the server only; Connect also adds the skill.

```bash
claude mcp add --scope user screencap -- /Applications/Screencap.app/Contents/MacOS/Screencap mcp
```

Any other MCP client takes the same stdio server: the command `/Applications/Screencap.app/Contents/MacOS/Screencap` with the argument `mcp`. For example, VS Code's `mcp.json` (run "MCP: Open User Configuration" from VS Code's Command Palette):

```json
{
  "servers": {
    "screencap": { "type": "stdio", "command": "/Applications/Screencap.app/Contents/MacOS/Screencap", "args": ["mcp"] }
  }
}
```

Windsurf takes the same command under `mcpServers` in `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "screencap": { "command": "/Applications/Screencap.app/Contents/MacOS/Screencap", "args": ["mcp"] }
  }
}
```

## What agents can read

Screencap's history has three levels, and the tools follow them:

- A **moment** is one screenshot with the app, window title and page address at that time, and the text read from the screen.
- An **activity** is one stretch of work on one thing, such as 25 minutes reading a contract, with a short title and a one-sentence caption.
- A **thread** groups related activities across days: one project, one personal matter or one pastime.

| Tool | Ask it for | It returns |
|---|---|---|
| `search` | Words that were on screen; optionally `from` and `to` (all time by default), one app or site (`app`), `sort` by relevance, newest or oldest first, `limit` and `offset` | One result per activity whose screenshots matched: its id, title, caption, thread and time span, and the best-matching moment with its app, window, page and a snippet with the matched words in «». 10 results a page by default, up to 25 with `limit` |
| `day` | A date: `today`, `yesterday` or `YYYY-MM-DD` | The day's headline (a few words Screencap wrote to sum it up), active minutes, its threads with categories, minutes and time spans, every activity in order, the sites and apps that took the most time, and the nearest earlier and later days with history |
| `threads` | A time range (the last 7 days by default; all time when only words are given), words in the name or description, a category, `limit` and `offset` | Threads with time in the range, most time first: name, category (Work, Study, Leisure, Chores, Social or Unknown), description, minutes, days active, last seen |
| `thread` | A thread's id, `limit` and `offset` | Its description, first and last seen, minutes per day, and its activities newest first with captions |
| `activity` | An activity's id, and `text_limit` for its screen text (3,000 characters by default, up to 20,000) | Its title, caption, time and thread, the apps, windows and pages it happened in, the moment that shows it best, and every distinct line of its screen text |
| `now` | Nothing | The local time and time zone, whether Screencap is capturing, when the history begins, the latest screen and its text, the activity in progress, and the last five activities today |
| `screenshot` | A moment (`2026-10-15 14:05:12`) or `now`, and `crop`: `window` (the default) or `screen` | The last screenshot taken at or before that moment as a JPEG, at most 1,568 px on its longer side, cut to the front window unless `crop` is `screen`. When the window cannot be cut out, such as one that fills the display, it returns the whole display and says why. With no screenshot in the 10 minutes before, an error says so |

Clients that support MCP prompts also offer three ready-made requests, which Claude Code lists as slash commands such as `/mcp__screencap__standup`:

| Prompt | It asks the agent to |
|---|---|
| `standup` | Write a standup from your last working day and today so far, grouped by thread |
| `recap` | Tell the story of one day (`date`, today by default): main threads, what got done, what was left open |
| `resume` | Find where you stopped on a `topic` and suggest the next step |

A prompt only words the request; the agent then reads your history through the tools, under the same switches.

All times are your Mac's local time, written as `2026-10-15 14:05:12` for a moment and `2026-10-15 14:05–14:30` for a span. Long lists come in pages, and agents ask for the next page themselves.

## Privacy

- The server checks both switches on every call, so turning one off stops the next call without restarting the agent. An agent that calls while access is off gets an error telling it where you turn access on.
- The switches are your consent setting for agent apps that connect through this server. Any program running under your account can change them (they live in Screencap's preferences) or read Screencap's data folder directly, as it can any of your files.
- Screen text can include text a web page or message wrote to steer an AI. Screencap tells every agent, in its instructions and tool descriptions, to treat what it returns as quoted data and never as instructions; an agent's own safeguards decide how well it follows that.
- Screencap never captures password managers, the private browser windows it recognises (the README's [Security](../README.md#security) section lists which browsers), apps you exclude in Settings, or moments when a password field is in focus, and it masks keys, tokens, card numbers and IBANs in screen text before storing it, so none of these reach an agent. Moments you delete in Screencap are gone for agents from then on; what an agent already read stays in its conversation.
- The server opens the database read-only, so it cannot change your history. The one file it writes is its access log, `agent-access.jsonl` in Screencap's data folder (`~/Library/Application Support/com.screencaping.app`): one line per call with the time, the agent (by the name its app reports), the tool and what it read, such as `searched “borrowing” · 3 results`, including calls refused because access was off. Settings > Agents lists the eight latest reads, and its Clear button empties the log.
- An agent sends what it reads to its own AI provider (Anthropic for Claude, OpenAI for Codex, and so on), under that provider's terms.

## For agents and the people who build them

Screencap's skill, [skills/screencap/SKILL.md](../skills/screencap/SKILL.md), tells an agent when to reach for Screencap and how to use the tools well. It follows the [Agent Skills](https://agentskills.io) format, so Claude Code, Codex and Cursor read it; `Screencap mcp install` puts it where each looks. Agents Screencap writes no skill for, such as Claude Desktop, get a short version of the same guidance from the server itself, in the instructions every MCP client receives when it connects. To give such an agent more, paste this into its instructions file (an `AGENTS.md`, for example):

```markdown
When I refer to something I saw, read, did or discussed earlier on my Mac, ask what I worked on, or want to pick up where I left off, look it up with the Screencap MCP tools: `search` with words that were on screen (narrow with `from`, `to` and `app`), `day` for a date, `threads` and `thread` for an ongoing effort, `activity` for an activity's full screen text, `now` for what is on my screen, and `screenshot` only when the text is not enough. Say when and where you found something, and quote only what the task needs.
```

What a client author needs to know:

- The server speaks MCP over stdio, one JSON-RPC message per line. It serves revision 2026-07-28 (no handshake: each request carries `io.modelcontextprotocol/protocolVersion` and `clientCapabilities` in `params._meta`, and `server/discover` describes the server) and, for clients that open with `initialize`, revisions 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05.
- Results are JSON, sized to stay under about 4,000 tokens: lists come in pages, with `more` true when another page follows and `next_offset` to pass as `offset` for it, and screen text stops at `text_limit`.
- It offers tools only. Every tool is annotated `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: false`, declares an `outputSchema`, and returns `structuredContent` plus the same JSON as its text content. `screenshot` adds an image content block.
- Mistakes the model can correct, such as a date written wrong or an activity id that does not exist, come back as results with `isError: true` and a sentence saying what to send instead. An unknown tool or a malformed request is a JSON-RPC error.
- `scripts/mcp-check.py` drives a built binary through both protocol revisions and every tool against a store you name, and checks each result's shape:

```bash
python3 scripts/mcp-check.py .build/debug/Screencap --store /tmp/screencap-demo --query kyoto
```

## Troubleshooting

| You see | Do |
|---|---|
| The agent says you have not let agents read your history | Turn on **Let agents read my history** in Settings > Agents. |
| The agent says screenshots are off | Turn on **Include screenshots**, or let it work from text. |
| "Screencap has no history on this Mac yet" | Open Screencap; it starts recording once it runs. |
| "Ask the person to open Screencap once" | A newer Screencap updates its database the first time it opens: open the app once. |
| Claude Desktop does not list Screencap | Quit and reopen Claude Desktop after connecting. |
| Cursor does not list Screencap | Restart Cursor; its MCP settings should then show `screencap` turned on. |
| Claude Code does not list Screencap | Start a new session; `claude mcp list` should show `screencap` as connected. |
| Settings says an agent is "Set to another Screencap" | Its entry starts another copy of Screencap, such as v1 or a build elsewhere. Click Connect to point it at this one. |

To watch the server answer by hand, send it one request:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"now","arguments":{}}}' | /Applications/Screencap.app/Contents/MacOS/Screencap mcp
```
