# 🍎 apple-stocks-mcp

[![CI](https://github.com/helderpgoncalves/apple-stocks-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/helderpgoncalves/apple-stocks-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/apple-stocks-mcp?logo=npm)](https://www.npmjs.com/package/apple-stocks-mcp)
[![npm downloads](https://img.shields.io/npm/dm/apple-stocks-mcp?logo=npm&color=cb3837)](https://www.npmjs.com/package/apple-stocks-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-listed-5965F2)](https://registry.modelcontextprotocol.io/v0/servers?search=apple-stocks-mcp)
[![platform: macOS](https://img.shields.io/badge/platform-macOS-000000?logo=apple)](https://www.apple.com/macos/)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
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

![apple-stocks-mcp demo](./docs/demo.gif)

> ⚠️ **macOS only.** The data lives inside the macOS Stocks app's container, so
> this server does not work on Linux or Windows.

---

## Contents

- [What you can ask](#what-you-can-ask)
- [Privacy](#privacy)
- [Where the data comes from](#where-the-data-comes-from)
- [Tools](#tools) · [Resources](#resources) · [Prompts](#prompts)
- [Example output](#example-output)
- [Requirements](#requirements)
- [Setup](#setup)
- [FAQ & troubleshooting](#faq--troubleshooting)
- [Development & testing](#development--testing)
- [Legal](#legal)

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

## Example output

These are the actual text results the tools return (symbols shown are generic
examples). Numbers come straight from your Stocks app's local cache.

**`apple_stock`** / **`stock_details AAPL`** — fundamentals at a glance:

```text
AAPL (Apple Inc.): 299.18 USD  +3.23 (+1.09%) [open]
  Open: 298.44   Day range: 298.07 – 299.75
  52-week range: 196.86 – 317.4
  Market cap: 4.39T   Volume: 11.12M (avg 47.14M)
  P/E: 36.27   EPS: 8.26   Beta: 1.09   Div yield: 0.36%
  Next earnings: 2026-07-30
AAPL is in the watchlist.
```

**`stock_chart NVDA`** — intraday OHLCV as an ASCII sparkline:

```text
NVDA intraday (7 points)
  ▁▁▂▃▆▇█
  prev close: 204.65   last: 208.69   day range: 207.36 – 208.69
  change vs prev close: +4.04 (+1.97%)
```

**`portfolio_summary`** — whole-watchlist analysis:

```text
Watchlist summary — 98/99 quoted (1 without a cached quote)
  Up: 57   Down: 41   Flat: 0

  Top gainers:
    NVDA: +1.97%
    AMD:  +4.13%
    MSFT: +0.31%
  Top losers:
    INTC: -2.10%
    ...

  By currency:
    USD: 82
    EUR: 16
  By exchange:
    NASDAQ: 38
    NYSE: 35
    XETRA: 9
    ...
```

**`get_quote ["AAPL","MSFT","BTC-USD","EGL.LS"]`** — one line per symbol, across
US / crypto / European tickers:

```text
AAPL (Apple Inc.): 299.18 USD  +3.23 (+1.09%) [open]
MSFT (Microsoft Corporation): 378.83 USD  -0.08 (-0.02%) [open]
BTC-USD (Bitcoin USD): 64291.09 USD  -928.50 (-1.42%) [open]
EGL.LS (Mota-Engil, SGPS, S.A.): 4.67 EUR  -0.04 (-0.81%) [open]
```

### What each tool returns

| Tool | Key fields in the result |
| --- | --- |
| `get_quote` / `quote_watchlist` | symbol, name, price, currency, daily change & %, market state |
| `stock_details` | the above **plus** open, day range, 52-week range, market cap, volume & average volume, P/E, EPS, beta, dividend yield, next earnings date |
| `stock_chart` | per-point open/high/low/close/volume, previous close, day range, change vs previous close, ASCII sparkline |
| `portfolio_summary` | quoted vs total, up/down/flat counts, top gainers/losers, breakdown by currency and exchange |
| `top_movers` | ranked gainers and losers (symbol, price, change %) |

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

Example output: `AAPL (Apple Inc.): 299.18 USD  +3.23 (+1.09%) [open]`

If anything looks off, run the built-in diagnostics tool — ask your assistant to
run `stocks_doctor`, or:

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"stocks_doctor","arguments":{}}}' \
| npx -y apple-stocks-mcp
```

---

## FAQ & troubleshooting

<details>
<summary><b>A tool says the data is "not found" or "unreadable".</b></summary>

Run `stocks_doctor` first — it pinpoints which check fails. The two common causes:

1. **The Stocks app has never run.** Open the Stocks app once so it creates its
   data, then try again.
2. **Full Disk Access.** On recent macOS, the app running this server (your
   terminal, or the MCP client like Claude Desktop) must be granted **Full Disk
   Access**. Go to *System Settings → Privacy & Security → Full Disk Access* and
   enable it for that app, then restart it.
</details>

<details>
<summary><b>Why aren't the quotes real-time?</b></summary>

This server reads the Stocks app's **local cache** — the last data the app
synced. It intentionally makes no network calls. To refresh, open the Stocks app
(or its widget); the cache updates and the next tool call reflects it.
</details>

<details>
<summary><b>A symbol in my watchlist returns "Not in the Apple Stocks cache".</b></summary>

The app hadn't cached a quote for that exact symbol when you asked (some tickers,
e.g. certain regional listings, aren't always cached). Open the Stocks app and
view the symbol once, then retry. The watchlist still lists it; only its quote
was missing.
</details>

<details>
<summary><b>Can it add a stock to my watchlist automatically?</b></summary>

`add_stock` **opens** the symbol in the Stocks app so you add it with one tap. It
deliberately does **not** write to the app's encrypted, iCloud-synced store —
that would risk corrupting your watchlist and sync. This is a safety decision.
</details>

<details>
<summary><b>Does it work on Linux or Windows?</b></summary>

No. The data lives in the macOS Stocks app's container, so the server is
macOS-only. (The pure parsing logic is unit-tested on Linux CI using synthetic
fixtures, but the real data only exists on macOS.)
</details>

<details>
<summary><b>Is any of my data sent anywhere?</b></summary>

No. There are **zero** network calls in the source — only local `sqlite3`
(read-only) and `open`. Everything read is returned solely to the MCP client you
connected. See [Privacy](#privacy).
</details>

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
docs/
  demo.tape          # VHS script that generates demo.gif
  run-tool.sh        # helper used by the demo
server.json          # MCP Registry metadata
.github/workflows/ci.yml
```

To regenerate the demo GIF (requires [VHS](https://github.com/charmbracelet/vhs)):

```bash
vhs docs/demo.tape   # writes docs/demo.gif
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
