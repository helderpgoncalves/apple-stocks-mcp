# Apple Stocks Watchlist — MCP Server (macOS)

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

See [`HOW_TO_GET_STOCKS.txt`](./HOW_TO_GET_STOCKS.txt) for the full reverse-engineering notes.

This is the same "read the app's local store directly" approach used by
[`apple-notes-mcp`](https://github.com/sirmews/apple-notes-mcp).

---

## Tools

| Tool | What it does |
| --- | --- |
| `list_watchlist` | List every ticker in your Apple Stocks watchlist (in order). |
| `get_quote` | Price + daily change for one or more symbols, from the app cache. |
| `quote_watchlist` | Cached quotes for every symbol in the watchlist. |
| `apple_stock` | AAPL quote + whether it's in the watchlist. |
| `add_stock` | **Opens** a symbol in the Apple Stocks app so you can add it with one click. |

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
git clone https://github.com/helderpgoncalves/apple-stocks-watchlist-mcp.git
cd apple-stocks-watchlist-mcp
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
    "apple-stocks-watchlist": {
      "command": "node",
      "args": ["/absolute/path/to/apple-stocks-watchlist-mcp/dist/index.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add apple-stocks-watchlist -- node /absolute/path/to/dist/index.js
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

## Project layout

```
src/
  index.ts          # MCP server + tool definitions
  appleStocks.ts    # reads the Apple Stocks app: watchlist (bplist) + quotes (SQLite)
  bplist-parser.d.ts
HOW_TO_GET_STOCKS.txt  # how the Apple Stocks data is laid out and decoded
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
