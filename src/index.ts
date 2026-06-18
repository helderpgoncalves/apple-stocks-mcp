#!/usr/bin/env node
/**
 * Apple Stocks Watchlist — an MCP server that reads the pre-installed macOS
 * Stocks app's own local data (watchlist + cached quotes) and can open symbols
 * in the Stocks app for adding. macOS only. No external API, no network.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  readWatchlist,
  readQuotes,
  formatQuote,
  assertMacOSStocks,
  DBSTORE_PATH,
} from "./appleStocks.js";

const execFileAsync = promisify(execFile);
const APPLE_SYMBOL = "AAPL";

const server = new McpServer({
  name: "apple-stocks-watchlist",
  version: "1.0.0",
});

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

/** Wrap a handler so macOS/Stocks-availability errors come back as readable text. */
async function guard(fn: () => Promise<string>) {
  try {
    return text(await fn());
  } catch (err) {
    return text(`⚠️ ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// list_watchlist — read the watchlist straight from the Apple Stocks app.
// ---------------------------------------------------------------------------
server.registerTool(
  "list_watchlist",
  {
    title: "List Apple Stocks Watchlist",
    description:
      "List every ticker in the macOS Apple Stocks app watchlist, read directly from the app's local data. macOS only.",
    inputSchema: {},
  },
  () =>
    guard(async () => {
      const symbols = await readWatchlist();
      if (symbols.length === 0) {
        return `The Apple Stocks watchlist is empty (${DBSTORE_PATH}).`;
      }
      return (
        `Apple Stocks watchlist (${symbols.length} symbols):\n\n` +
        symbols.map((s, i) => `${i + 1}. ${s}`).join("\n")
      );
    }),
);

// ---------------------------------------------------------------------------
// get_quote — cached quote for one or more symbols, from the Stocks app.
// ---------------------------------------------------------------------------
server.registerTool(
  "get_quote",
  {
    title: "Get Quote (from Apple Stocks cache)",
    description:
      "Get the price and daily change for one or more symbols, read from the Apple Stocks app's local cache. Reflects whatever the Stocks app last synced — open the app to refresh.",
    inputSchema: {
      symbols: z
        .array(z.string())
        .min(1)
        .describe("One or more ticker symbols, e.g. ['AAPL', 'MSFT']."),
    },
  },
  ({ symbols }) =>
    guard(async () => {
      const quotes = await readQuotes(symbols);
      return quotes.map(formatQuote).join("\n");
    }),
);

// ---------------------------------------------------------------------------
// quote_watchlist — cached quotes for the whole watchlist.
// ---------------------------------------------------------------------------
server.registerTool(
  "quote_watchlist",
  {
    title: "Quote Entire Watchlist",
    description:
      "Get cached quotes for every symbol in the Apple Stocks watchlist, in order. All data from the Apple Stocks app.",
    inputSchema: {},
  },
  () =>
    guard(async () => {
      const symbols = await readWatchlist();
      if (symbols.length === 0) return "The Apple Stocks watchlist is empty.";
      const quotes = await readQuotes(symbols);
      return quotes.map(formatQuote).join("\n");
    }),
);

// ---------------------------------------------------------------------------
// apple_stock — first-class shortcut for Apple (AAPL).
// ---------------------------------------------------------------------------
server.registerTool(
  "apple_stock",
  {
    title: "Apple (AAPL) Stock",
    description:
      "Get the Apple (AAPL) quote from the Apple Stocks app and report whether AAPL is in the watchlist. A convenience shortcut for 'the Apple stock'.",
    inputSchema: {},
  },
  () =>
    guard(async () => {
      const watchlist = await readWatchlist();
      const inList = watchlist.includes(APPLE_SYMBOL);
      const [quote] = await readQuotes([APPLE_SYMBOL]);
      const note = inList
        ? "AAPL is in the watchlist."
        : "AAPL is NOT in the watchlist (use add_stock to open it in the Stocks app).";
      return `${formatQuote(quote)}\n${note}`;
    }),
);

// ---------------------------------------------------------------------------
// add_stock — open a symbol in the Stocks app so the user can add it safely.
//
// We deliberately do NOT write the app's encrypted CloudKit/binary-plist store
// directly — that risks corrupting the watchlist and iCloud sync. Opening the
// symbol via the `stocks://` URL scheme lets the user add it with one click and
// keeps the app's data consistent. (Same read-only-DB philosophy as
// apple-notes-mcp, which also avoids direct writes.)
// ---------------------------------------------------------------------------
server.registerTool(
  "add_stock",
  {
    title: "Add Stock (open in Apple Stocks)",
    description:
      "Open a ticker in the macOS Apple Stocks app so it can be added to the watchlist with one click. Does not modify the app's database directly (which would risk corrupting it / iCloud sync). macOS only.",
    inputSchema: {
      symbol: z
        .string()
        .describe("Ticker symbol to open in the Stocks app, e.g. NVDA."),
    },
  },
  ({ symbol }) =>
    guard(async () => {
      assertMacOSStocks();
      const sym = symbol.trim().toUpperCase();
      if (!/^[A-Za-z0-9.\-=^]{1,15}$/.test(sym)) {
        return `"${symbol}" is not a valid ticker symbol.`;
      }
      const already = (await readWatchlist()).includes(sym);
      // Open in the Stocks app; user taps "Add to Watchlist".
      await execFileAsync("/usr/bin/open", [`stocks://?symbol=${encodeURIComponent(sym)}`]);
      return already
        ? `${sym} is already in the watchlist — opened it in the Apple Stocks app.`
        : `Opened ${sym} in the Apple Stocks app. Tap "Add to Watchlist" there to add it. ` +
            `(Direct database writes are intentionally avoided to keep your watchlist and iCloud sync safe.)`;
    }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("apple-stocks-watchlist MCP server running on stdio (macOS, reads Apple Stocks app data)");
}

main().catch((error) => {
  console.error("Fatal error starting MCP server:", error);
  process.exit(1);
});
