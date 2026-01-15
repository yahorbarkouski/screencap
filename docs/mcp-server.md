# MCP Server

Screencap includes a built-in [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that allows AI assistants like Claude to access your activity data, projects, and insights.

## Configuration

The MCP server is bundled with the app and is started by running Screencap in MCP mode (`--mcp`).

### Claude Desktop

Add the following to your Claude Desktop configuration file (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "screencap": {
      "command": "/usr/bin/env",
      "args": [
        "-u",
        "ELECTRON_RUN_AS_NODE",
        "/Applications/Screencap.app/Contents/MacOS/Screencap",
        "--mcp"
      ]
    }
  }
}
```

If you see an error like `/Applications/Screencap.app/Contents/MacOS/Screencap: bad option: --mcp`, your MCP host is launching the process with `ELECTRON_RUN_AS_NODE` set. Unsetting it (as shown above) is required, otherwise the Screencap binary runs in “Node mode” and will not start the app.

### Manual run

When started manually, the MCP server will appear to “run forever”. This is expected: it waits for a client (Claude Desktop / Cursor) to send JSON-RPC messages over stdin.

To stop it, terminate the process (Ctrl+C in a terminal).

### Debugging

Set `SCREENCAP_MCP_DEBUG=1` to print server lifecycle and stdin activity to stderr.

### Custom Database Path

By default, the MCP server reads from the standard Screencap database location (`~/Library/Application Support/Screencap/screencap.db`). To use a custom path, set the `SCREENCAP_DB_PATH` environment variable:

```json
{
  "mcpServers": {
    "screencap": {
      "command": "/usr/bin/env",
      "args": [
        "-u",
        "ELECTRON_RUN_AS_NODE",
        "/Applications/Screencap.app/Contents/MacOS/Screencap",
        "--mcp"
      ],
      "env": {
        "SCREENCAP_DB_PATH": "/path/to/custom/screencap.db"
      }
    }
  }
}
```

## Available Resources

| Resource | Description |
|----------|-------------|
| `screencap://activity/today` | Today's activity events |
| `screencap://activity/recent` | Recent activity (last 2 hours) |
| `screencap://stats/today` | Today's time statistics by category |
| `screencap://stats/week` | This week's time statistics by category |
| `screencap://projects` | List of all tracked projects |
| `screencap://stories/latest` | Latest generated stories |
| `screencap://memories` | User memories (projects, addictions, preferences) |
| `screencap://eod/today` | Today's end-of-day entry |

## Available Tools

### Event Tools

| Tool | Description |
|------|-------------|
| `query_events` | Query activity events with flexible filters (date range, category, project, app, url) |
| `search_events` | Full-text search across captions and window titles |
| `get_recent_activity` | Get recent activity events (configurable hours) |
| `get_event_image` | Get the screenshot image for a specific event |

### Analytics Tools

| Tool | Description |
|------|-------------|
| `get_time_summary` | Get category/time breakdown for a period |
| `get_app_usage` | Get app usage statistics |
| `get_website_usage` | Get website usage statistics |
| `compare_periods` | Compare productivity across two time periods |

### Project Tools

| Tool | Description |
|------|-------------|
| `list_projects` | List all projects with event counts and last activity |
| `get_project_progress` | Get progress events for a specific project |
| `get_project_stats` | Get detailed statistics for a project |

### Awareness Tools

| Tool | Description |
|------|-------------|
| `get_addiction_stats` | Get addiction tracking statistics |
| `get_focus_score` | Get focus/distraction score for a day |

## Available Prompts

| Prompt | Arguments | Description |
|--------|-----------|-------------|
| `daily_summary` | `date` (optional, YYYY-MM-DD) | Summarize activity for a specific day |
| `focus_analysis` | `period` (today/week) | Analyze focus and distraction patterns |
| `project_status` | `project` (required) | Get status summary for a specific project |

## Requirements

- Screencap must have been run at least once to create the database
- The MCP server opens the database in read-only mode
