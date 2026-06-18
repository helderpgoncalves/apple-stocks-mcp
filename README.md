# Apple Stocks Watchlist — MCP Server (macOS)

[![CI](https://github.com/helderpgoncalves/apple-stocks-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/helderpgoncalves/apple-stocks-mcp/actions/workflows/ci.yml)

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant read
your **pre-installed macOS Apple Stocks app** — its **watchlist** and its
**cached quotes** — and open symbols in the app to add them. There's a
first-class shortcut for **Apple (AAPL)**.

**Everything comes from the Apple Stocks app's own local data. No external
financial API, no network calls, no API keys.** Quotes reflect whatever the
Stocks app last synced — open the app to refresh.

> ⚠️ **macOS only.** This server reads files inside the Apple Stocks app's group
> container, so it does not work on Linux or Windows.
>
> Listed on MCP Market under **Apple / Businesses** →
> <https://mcpmarket.com/businesses/apple>

---

## Where the data comes from

| Data | Source (inside `~/Library/Group Containers/group.com.apple.stocks/`) |
| --- | --- |
| Watchlist symbols | `Library/Documents/PrivateData/com.apple.stocks.private-production-dbstore.json` — a JSON file whose records are base64 binary-plists; symbols are decoded from them. |
| Quotes (price, change, currency, market state) | `Library/Caches/shared-database` — a SQLite cache the Stocks app maintains (`quotes` table). |
| Company names / exchanges | the same SQLite cache (`stock_metadata` table). |

This is the same "read the app's local store directly" approach used by
[`apple-notes-mcp`](https://github.com/sirmews/apple-notes-mcp).

---

## Tools

| Tool | What it does |
| --- | --- |
| `list_watchlist` | List every ticker in your Apple Stocks watchlist (in order). |
| `get_quote` | Price + daily change for one or more symbols, from the app cache. |
| `quote_watchlist` | Cached quotes for every symbol in the watchlist. |
| `stock_details` | Full fundamentals: day & 52-week range, market cap, volume, P/E, EPS, beta, dividend yield, next earnings. |
| `stock_chart` | Cached intraday OHLCV chart (ASCII sparkline) + change vs previous close. |
| `apple_stock` | Apple (AAPL) fundamentals + whether it's in the watchlist. |
| `portfolio_summary` | Whole-watchlist analysis: up/down counts, top gainers/losers, breakdown by currency & exchange. |
| `top_movers` | The biggest gainers and losers in the watchlist today. |
| `search_watchlist` | Search the watchlist by symbol or company name. |
| `stocks_doctor` | Diagnose your setup (macOS? app data present? readable? Full Disk Access?). |
| `add_stock` | **Opens** a symbol in the Apple Stocks app so you can add it with one click. |

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

The watchlist lives in an **encrypted CloudKit / `NSKeyedArchiver` binary-plist
store** that the app syncs to iCloud. Editing it by hand risks corrupting your
watchlist and breaking sync. So `add_stock` uses the `stocks://` URL scheme to
open the symbol in the Stocks app, where you add it with one tap — the app keeps
its own data consistent. (`apple-notes-mcp` makes the same choice: read the
store directly, don't write it.)

---

## Requirements

- **macOS** with the **Stocks app** opened at least once (so its data exists).
- **Node.js ≥ 18.**
- The system `sqlite3` at `/usr/bin/sqlite3` (ships with macOS).
- Depending on your macOS version, the MCP client may need **Full Disk Access**
  to read the Apple Stocks container. If `list_watchlist` returns a "not found"
  error, grant Full Disk Access to your terminal / MCP client in
  *System Settings → Privacy & Security → Full Disk Access*.

---

## Install & build

```bash
git clone https://github.com/helderpgoncalves/apple-stocks-mcp.git
cd apple-stocks-mcp
npm install      # also builds via the `prepare` hook
```

This produces `dist/index.js`, the executable server entrypoint.

---

## Connecting to a client

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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
claude mcp add apple-stocks -- node /absolute/path/to/dist/index.js
```

Restart the client and ask:

- *"What's in my Apple Stocks watchlist?"*
- *"What's the Apple stock doing today?"*
- *"Quote my whole watchlist."*
- *"Add NVDA to my watchlist."* → opens NVDA in the Stocks app to confirm.

---

## Quick local test

The server speaks JSON-RPC over stdio:

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"apple_stock","arguments":{}}}' \
| node dist/index.js
```

Expected (example): `AAPL (Apple Inc.): 295.95 USD  -3.29 (-1.10%) [preMarket]`

---

## Development & testing

```bash
npm run build      # compile to dist/
npm run typecheck  # type-check only
npm test           # build + run the test suite
```

The tests run against **synthetic fixtures** in `test/fixtures/` (a generated
`dbstore.json` and two small SQLite databases) — they **never touch your real
Apple Stocks data**. `STOCKS_TEST_MODE=1` bypasses the macOS gate so the pure
parsing/formatting logic can be tested on any OS, which is what CI does
(GitHub Actions, Linux, Node 18/20/22).

You can also point the server at custom data via env vars (used by the tests):
`STOCKS_DBSTORE_PATH`, `STOCKS_SHARED_DB_PATH`, `STOCKS_SPARKLINE_DB_PATH`,
`STOCKS_SQLITE_BIN`.

## Project layout

```
src/
  index.ts           # MCP server: tools, resources, prompts
  appleStocks.ts     # reads the Apple Stocks app: watchlist (bplist) + quotes/details/chart (SQLite)
  bplist-parser.d.ts
test/
  appleStocks.test.ts
  fixtures/          # synthetic data — no personal holdings
.github/workflows/ci.yml
```

---

## Notes & disclaimer

- All quote data is read from the Apple Stocks app's local cache and may be
  delayed. This project is **not affiliated with Apple** and is **not
  investment advice**.
- The server only **reads** your local Apple Stocks data; the one write-style
  action (`add_stock`) just opens the Stocks app. Nothing is sent anywhere.

## License

[MIT](./LICENSE)
