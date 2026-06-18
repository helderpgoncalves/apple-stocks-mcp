# apple-stocks-mcp

[![CI](https://github.com/helderpgoncalves/apple-stocks-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/helderpgoncalves/apple-stocks-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/apple-stocks-mcp)](https://www.npmjs.com/package/apple-stocks-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A **macOS-only** [Model Context Protocol](https://modelcontextprotocol.io) (MCP)
server that lets an AI assistant read **your own** data from the Stocks app that
ships with macOS — your watchlist, and the quotes, fundamentals and intraday
charts the app has already cached on **your Mac**.

**100% local and read-only.** It reads files that already exist on your own
machine, in the Stocks app's container under your home folder. It makes **no
network requests**, uses **no external API**, needs **no API keys**, and sends
**nothing anywhere**. The data is whatever the Stocks app last synced — open the
app to refresh it.

> ⚠️ **macOS only.** The data lives inside the macOS Stocks app's container, so
> this server does not work on Linux or Windows.

---

## What you can ask

Once connected (see [Setup](#setup)), ask your assistant things like:

- *"What's in my stock watchlist?"*
- *"What's the Apple stock doing today?"*
- *"Show me the fundamentals for NVDA."*
- *"Which of my stocks are up the most today?"*
- *"Summarize my whole watchlist."*

---

## Privacy

This is the most important section, so it's first.

- **Read-only.** The server never modifies, deletes, or writes to the Stocks
  app's data. It opens the SQLite caches with sqlite3's `-readonly` flag and only
  parses the watchlist file. The single write-style action, `add_stock`, does
  **not** touch any file — it just asks macOS to open a symbol in the Stocks app
  so *you* can add it with a tap.
- **Local only.** Every byte read stays on your machine and is only returned to
  the MCP client you connected (e.g. your local AI assistant). There are **no
  outbound network connections** in this server's code — you can verify this:
  there is no `fetch`/`http`/`https` client call anywhere in `src/`.
- **Your own data.** It reads only files owned by your user account, in your home
  folder (`~/Library/Group Containers/group.com.apple.stocks/`). It does not
  access other users' data, remote accounts, or anything outside that container.
- **No telemetry, no analytics, no tracking.** None. Ever.
- **You stay in control of access.** On recent macOS versions the app reading
  this data (your terminal or MCP client) must be granted **Full Disk Access** by
  you, in System Settings. Revoke it any time and the server can no longer read.

---

## Where the data comes from

All paths are inside your own user container
`~/Library/Group Containers/group.com.apple.stocks/`:

| Data | File (read-only) |
| --- | --- |
| Watchlist symbols | `Library/Documents/PrivateData/com.apple.stocks.private-production-dbstore.json` |
| Quotes, market cap | `Library/Caches/shared-database` (SQLite, `quotes` table) |
| Fundamentals (P/E, EPS, ranges…) | same SQLite cache (`quote_details` table) |
| Company names / exchanges | same SQLite cache (`stock_metadata` table) |
| Intraday chart (OHLCV) | `Library/Caches/sparkline-database` (SQLite, `sparklines` table) |

This is the same "read the app's own local store" approach used by other macOS
MCP servers such as [`apple-notes-mcp`](https://github.com/sirmews/apple-notes-mcp).
It is reading **your** data from **your** Mac — analogous to exporting your own
information — and it does not bypass any DRM, access any account, or contact any
Apple service.

---

## Tools

| Tool | What it does |
| --- | --- |
| `list_watchlist` | List every ticker in your Stocks watchlist (in order). |
| `get_quote` | Price + daily change for one or more symbols, from the local cache. |
| `quote_watchlist` | Cached quotes for every symbol in the watchlist. |
| `stock_details` | Fundamentals: day & 52-week range, market cap, volume, P/E, EPS, beta, dividend yield, next earnings. |
| `stock_chart` | Cached intraday OHLCV chart (ASCII sparkline) + change vs previous close. |
| `apple_stock` | Apple (AAPL) fundamentals + whether it's in the watchlist. |
| `portfolio_summary` | Whole-watchlist analysis: up/down counts, top gainers/losers, breakdown by currency & exchange. |
| `top_movers` | The biggest gainers and losers in the watchlist today. |
| `search_watchlist` | Search the watchlist by symbol or company name. |
| `stocks_doctor` | Diagnose your setup (macOS? data present? readable? Full Disk Access?). |
| `add_stock` | **Opens** a symbol in the Stocks app so you can add it with one tap (no file is written). |

### Resources

| Resource URI | Contents |
| --- | --- |
| `stocks://watchlist` | The watchlist symbols, one per line (`text/plain`). |
| `stocks://quotes` | Cached quotes for every watchlist symbol (`application/json`). |

### Prompts

| Prompt | What it does |
| --- | --- |
| `analyze_portfolio` | Reviews the whole watchlist and highlights what's notable today. |
| `research_stock` | Pulls fundamentals + intraday chart for one symbol and summarizes it. |

### Why `add_stock` opens the app instead of writing the database

The watchlist lives in an encrypted, iCloud-synced store. Editing it by hand
risks corrupting your watchlist and breaking sync, so `add_stock` deliberately
**does not write** anything — it uses the `stocks://` URL scheme to open the
symbol in the Stocks app, where you add it with one tap and the app keeps its
own data consistent.

---

## Requirements

- **macOS**, with the **Stocks app** opened at least once (so its data exists).
- **Node.js ≥ 18.**
- The system `sqlite3` at `/usr/bin/sqlite3` (ships with macOS).
- On recent macOS versions, the MCP client (or your terminal) may need
  **Full Disk Access** to read the Stocks container. If tools return a
  "not found / unreadable" error, run the `stocks_doctor` tool, then grant
  Full Disk Access in *System Settings → Privacy & Security → Full Disk Access*.

---

## Setup

### Option A — npx (no install)

Add this to your MCP client config (e.g. Claude Desktop:
`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "apple-stocks": {
      "command": "npx",
      "args": ["-y", "apple-stocks-mcp"]
    }
  }
}
```

### Option B — from source

```bash
git clone https://github.com/helderpgoncalves/apple-stocks-mcp.git
cd apple-stocks-mcp
npm install            # also builds via the `prepare` hook
```

```json
{
  "mcpServers": {
    "apple-stocks": {
      "command": "node",
      "args": ["/absolute/path/to/apple-stocks-mcp/dist/index.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add apple-stocks -- npx -y apple-stocks-mcp
```

Restart the client after editing the config.

---

## Quick local test

The server speaks JSON-RPC over stdio:

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"apple_stock","arguments":{}}}' \
| npx -y apple-stocks-mcp
```

Example output: `AAPL (Apple Inc.): 295.95 USD  -3.29 (-1.10%) [open]`

---

## Development & testing

```bash
npm run build      # compile to dist/
npm run typecheck  # type-check only
npm test           # build + run the test suite
```

Tests run against **synthetic fixtures** in `test/fixtures/` (a generated
`dbstore.json` and two small SQLite databases) — they **never touch your real
Stocks data**. `STOCKS_TEST_MODE=1` bypasses the macOS gate so the pure
parsing/formatting logic can be tested on any OS, which is what CI does
(GitHub Actions, Linux, Node 18/20/22).

Data paths can be overridden via env vars (used by the tests):
`STOCKS_DBSTORE_PATH`, `STOCKS_SHARED_DB_PATH`, `STOCKS_SPARKLINE_DB_PATH`,
`STOCKS_SQLITE_BIN`.

### Project layout

```
src/
  index.ts           # MCP server: tools, resources, prompts
  appleStocks.ts     # reads your Stocks app data (read-only): watchlist + quotes/details/chart
  bplist-parser.d.ts
test/
  appleStocks.test.ts
  fixtures/          # synthetic data — no personal holdings
server.json          # MCP Registry metadata
.github/workflows/ci.yml
```

---

## Legal

### Not affiliated with Apple

This is an independent, community project. It is **not affiliated with,
endorsed by, sponsored by, or supported by Apple Inc.** "Apple", "Apple Stocks",
"Stocks", "macOS", and related marks are trademarks of Apple Inc. They are used
here **only nominatively** — to describe, factually and accurately, which app's
local data this software reads. No claim of ownership or endorsement is made or
implied.

This project ships no Apple code, assets, or trademarks, and does not bundle or
redistribute any Apple data.

### How it accesses data

The server reads files that already exist on **your own Mac**, under **your own**
user account, in **read-only** mode. It does **not** circumvent any technical
protection measure or DRM, does **not** access any online account or third-party
data, and does **not** transmit data off your machine. The cache file formats may
change between macOS versions; if that happens, a tool may simply return "no data"
rather than misbehave.

### Not financial advice

All figures are read from your Stocks app's local cache, may be **delayed or
inaccurate**, and are provided **as-is**. Nothing here is investment, financial,
legal, or tax advice. Do your own research; do not rely on this software for
trading decisions. Market data ultimately originates from third-party providers
via the Stocks app and is subject to their terms.

### Warranty

This software is provided "AS IS", without warranty of any kind, to the fullest
extent permitted by law. See the [MIT License](./LICENSE). Use at your own risk.

---

## License

[MIT](./LICENSE) © Hélder Gonçalves
