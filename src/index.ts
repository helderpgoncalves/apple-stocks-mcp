#!/usr/bin/env node
/**
 * Apple Stocks Watchlist — an MCP server that reads the pre-installed macOS
 * Stocks app's own local data (watchlist, quotes, fundamentals, intraday chart)
 * and can open symbols in the Stocks app for adding. macOS only. No external
 * API, no network. All database access is read-only.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  readWatchlist,
  readQuotes,
  readDetails,
  readChart,
  readWatchlistQuotes,
  summarize,
  diagnostics,
  formatQuote,
  formatDetails,
  formatChart,
  formatSummary,
  assertMacOSStocks,
  DBSTORE_PATH,
} from "./appleStocks.js";

const execFileAsync = promisify(execFile);
const APPLE_SYMBOL = "AAPL";
const SYMBOL_RE = /^[A-Za-z0-9.\-=^]{1,15}$/;

const server = new McpServer({
  name: "apple-stocks-watchlist",
  version: "1.1.1",
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

/** Validate a symbol up front; throws a clean error the guard turns into text. */
function requireSymbol(symbol: string): string {
  const sym = symbol.trim().toUpperCase();
  if (!SYMBOL_RE.test(sym)) {
    throw new Error(`"${symbol}" is not a valid ticker symbol.`);
  }
  return sym;
}

// ===========================================================================
// Tools
// ===========================================================================

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
      if (symbols.length === 0) return `The Apple Stocks watchlist is empty (${DBSTORE_PATH}).`;
      return (
        `Apple Stocks watchlist (${symbols.length} symbols):\n\n` +
        symbols.map((s, i) => `${i + 1}. ${s}`).join("\n")
      );
    }),
);

server.registerTool(
  "get_quote",
  {
    title: "Get Quote (from Apple Stocks cache)",
    description:
      "Get the price and daily change for one or more symbols, read from the Apple Stocks app's local cache. Symbols need not be in the watchlist.",
    inputSchema: {
      symbols: z.array(z.string()).min(1).describe("One or more ticker symbols, e.g. ['AAPL', 'MSFT']."),
    },
  },
  ({ symbols }) =>
    guard(async () => {
      const quotes = await readQuotes(symbols);
      return quotes.map(formatQuote).join("\n");
    }),
);

server.registerTool(
  "quote_watchlist",
  {
    title: "Quote Entire Watchlist",
    description: "Get cached quotes for every symbol in the Apple Stocks watchlist, in order.",
    inputSchema: {},
  },
  () =>
    guard(async () => {
      const quotes = await readWatchlistQuotes();
      if (quotes.length === 0) return "The Apple Stocks watchlist is empty.";
      return quotes.map(formatQuote).join("\n");
    }),
);

server.registerTool(
  "stock_details",
  {
    title: "Stock Fundamentals",
    description:
      "Get full fundamentals for a symbol from the Apple Stocks cache: price, day & 52-week range, market cap, volume & average volume, P/E, EPS, beta, dividend yield and next earnings date.",
    inputSchema: {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL."),
    },
  },
  ({ symbol }) =>
    guard(async () => {
      const sym = requireSymbol(symbol);
      return formatDetails(await readDetails(sym));
    }),
);

server.registerTool(
  "stock_chart",
  {
    title: "Intraday Chart",
    description:
      "Get the cached intraday price chart (OHLCV sparkline) for a symbol from the Apple Stocks app, with day range and change vs previous close.",
    inputSchema: {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL."),
    },
  },
  ({ symbol }) =>
    guard(async () => {
      const sym = requireSymbol(symbol);
      return formatChart(await readChart(sym));
    }),
);

server.registerTool(
  "apple_stock",
  {
    title: "Apple (AAPL) Stock",
    description:
      "Get full Apple (AAPL) fundamentals from the Apple Stocks app and report whether AAPL is in the watchlist. A convenience shortcut for 'the Apple stock'.",
    inputSchema: {},
  },
  () =>
    guard(async () => {
      const watchlist = await readWatchlist();
      const inList = watchlist.includes(APPLE_SYMBOL);
      const details = await readDetails(APPLE_SYMBOL);
      const note = inList
        ? "AAPL is in the watchlist."
        : "AAPL is NOT in the watchlist (use add_stock to open it in the Stocks app).";
      return `${formatDetails(details)}\n${note}`;
    }),
);

server.registerTool(
  "portfolio_summary",
  {
    title: "Watchlist / Portfolio Summary",
    description:
      "Analyse the whole watchlist: how many are up/down, top gainers and losers today, and a breakdown by currency and exchange. All from the Apple Stocks cache.",
    inputSchema: {
      top: z.number().int().min(1).max(20).optional().describe("How many gainers/losers to show (default 5)."),
    },
  },
  ({ top }) =>
    guard(async () => {
      const quotes = await readWatchlistQuotes();
      if (quotes.length === 0) return "The Apple Stocks watchlist is empty.";
      return formatSummary(summarize(quotes, top ?? 5));
    }),
);

server.registerTool(
  "top_movers",
  {
    title: "Top Movers Today",
    description:
      "Show the biggest gainers and losers in the watchlist today, ranked by percentage change. Data from the Apple Stocks cache.",
    inputSchema: {
      count: z.number().int().min(1).max(20).optional().describe("How many of each to show (default 5)."),
    },
  },
  ({ count }) =>
    guard(async () => {
      const quotes = await readWatchlistQuotes();
      const ranked = quotes
        .filter((q) => !q.error && q.changePercent != null)
        .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
      const n = count ?? 5;
      const gainers = ranked.slice(0, n);
      const losers = ranked.slice(-n).reverse();
      return (
        "📈 Top gainers:\n" +
        (gainers.length ? gainers.map((q) => "  " + formatQuote(q)).join("\n") : "  (none)") +
        "\n\n📉 Top losers:\n" +
        (losers.length ? losers.map((q) => "  " + formatQuote(q)).join("\n") : "  (none)")
      );
    }),
);

server.registerTool(
  "search_watchlist",
  {
    title: "Search Watchlist",
    description:
      "Search the watchlist by ticker symbol or company name (case-insensitive substring). Returns matching quotes from the Apple Stocks cache.",
    inputSchema: {
      query: z.string().min(1).describe("Substring to match against symbol or company name, e.g. 'apple' or 'AAP'."),
    },
  },
  ({ query }) =>
    guard(async () => {
      const q = query.trim().toLowerCase();
      const quotes = await readWatchlistQuotes();
      const matches = quotes.filter(
        (x) => x.symbol.toLowerCase().includes(q) || (x.name ?? "").toLowerCase().includes(q),
      );
      if (matches.length === 0) return `No watchlist symbols match "${query}".`;
      return `Matches for "${query}":\n` + matches.map(formatQuote).join("\n");
    }),
);

server.registerTool(
  "stocks_doctor",
  {
    title: "Diagnose Setup",
    description:
      "Check the environment: are you on macOS, is the Stocks app data present, is sqlite3 available, and can the data actually be read (catches Full Disk Access problems)? Use this when other tools error.",
    inputSchema: {},
  },
  () =>
    guard(async () => {
      const checks = await diagnostics();
      const allOk = checks.every((c) => c.ok);
      const body = checks.map((c) => `${c.ok ? "✅" : "❌"} ${c.name}\n     ${c.detail}`).join("\n");
      return `${allOk ? "All checks passed." : "Some checks failed — see below."}\n\n${body}`;
    }),
);

server.registerTool(
  "add_stock",
  {
    title: "Add Stock (open in Apple Stocks)",
    description:
      "Open a ticker in the macOS Apple Stocks app so it can be added to the watchlist with one click. Does NOT modify the app's database directly (which would risk corrupting it / iCloud sync). macOS only.",
    inputSchema: {
      symbol: z.string().describe("Ticker symbol to open in the Stocks app, e.g. NVDA."),
    },
  },
  ({ symbol }) =>
    guard(async () => {
      assertMacOSStocks();
      const sym = requireSymbol(symbol);
      const already = (await readWatchlist()).includes(sym);
      await execFileAsync("/usr/bin/open", [`stocks://?symbol=${encodeURIComponent(sym)}`]);
      return already
        ? `${sym} is already in the watchlist — opened it in the Apple Stocks app.`
        : `Opened ${sym} in the Apple Stocks app. Tap "Add to Watchlist" there to add it. ` +
            `(Direct database writes are intentionally avoided to keep your watchlist and iCloud sync safe.)`;
    }),
);

// ===========================================================================
// Resources — let clients read the watchlist & quotes as "files"
// ===========================================================================

server.registerResource(
  "watchlist",
  "stocks://watchlist",
  {
    title: "Apple Stocks Watchlist",
    description: "The current watchlist symbols, one per line.",
    mimeType: "text/plain",
  },
  async (uri) => {
    const symbols = await readWatchlist();
    return { contents: [{ uri: uri.href, mimeType: "text/plain", text: symbols.join("\n") }] };
  },
);

server.registerResource(
  "quotes",
  "stocks://quotes",
  {
    title: "Apple Stocks Watchlist Quotes (JSON)",
    description: "Cached quotes for every watchlist symbol, as JSON.",
    mimeType: "application/json",
  },
  async (uri) => {
    const quotes = await readWatchlistQuotes();
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(quotes, null, 2) }],
    };
  },
);

// ===========================================================================
// Prompts — ready-made analyses over the Apple Stocks data
// ===========================================================================

server.registerPrompt(
  "analyze_portfolio",
  {
    title: "Analyze my watchlist",
    description: "Ask the model to review the whole watchlist and highlight what's notable today.",
    argsSchema: {},
  },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            "Use the `portfolio_summary` and `top_movers` tools to review my Apple Stocks watchlist. " +
            "Summarize how the portfolio is doing today, call out the most notable movers, and note any " +
            "concentration by currency or exchange. Keep it concise.",
        },
      },
    ],
  }),
);

server.registerPrompt(
  "research_stock",
  {
    title: "Research a stock",
    description: "Pull fundamentals + intraday chart for one symbol and summarize it.",
    argsSchema: { symbol: z.string().describe("Ticker symbol, e.g. AAPL") },
  },
  ({ symbol }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Use the \`stock_details\` and \`stock_chart\` tools for ${symbol}. ` +
            "Summarize its valuation (P/E, EPS, dividend), where today's price sits within the day and " +
            "52-week range, and how it has moved intraday. Note it's not investment advice.",
        },
      },
    ],
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
