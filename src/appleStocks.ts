/**
 * Reads data exclusively from the pre-installed macOS **Stocks** app.
 *
 * Two local sources, both inside the app's group container — nothing is fetched
 * from the internet:
 *
 *   1. Watchlist symbols
 *      ~/Library/Group Containers/group.com.apple.stocks/Library/Documents/
 *        PrivateData/com.apple.stocks.private-production-dbstore.json
 *      A JSON file whose `serverRecords` are base64 binary-plists; the symbols
 *      live inside as [marker][len][ascii] byte runs. See HOW_TO_GET_STOCKS.txt.
 *
 *   2. Quotes + names
 *      ~/Library/Group Containers/group.com.apple.stocks/Library/Caches/
 *        shared-database   (SQLite)
 *      `quotes` table -> price / change / currency / market state (Apple's own
 *      cached quote, refreshed by the Stocks app).
 *      `stock_metadata` table -> company name / exchange.
 *
 * This server is therefore **macOS-only** and reflects whatever the Stocks app
 * last synced. Open the Stocks app to refresh the cache.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Buffer } from "node:buffer";
import bplist from "bplist-parser";

const execFileAsync = promisify(execFile);

const GROUP = join(
  homedir(),
  "Library",
  "Group Containers",
  "group.com.apple.stocks",
);

export const DBSTORE_PATH = join(
  GROUP,
  "Library",
  "Documents",
  "PrivateData",
  "com.apple.stocks.private-production-dbstore.json",
);

export const SHARED_DB_PATH = join(
  GROUP,
  "Library",
  "Caches",
  "shared-database",
);

/** Throw a clear error if we're not on macOS or the Stocks data is missing. */
export function assertMacOSStocks(): void {
  if (platform() !== "darwin") {
    throw new Error(
      "This MCP server only works on macOS — it reads the pre-installed Apple Stocks app's local data.",
    );
  }
  if (!existsSync(DBSTORE_PATH)) {
    throw new Error(
      `Apple Stocks watchlist file not found at:\n  ${DBSTORE_PATH}\nOpen the Stocks app at least once so it creates its data.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Watchlist (symbols) — parsed from the binary-plist dbstore.json
// ---------------------------------------------------------------------------

const JUNK = new Set([
  "Crypto",
  "Equity",
  "Index",
  "ETF",
  "MutualFund",
  "Fund",
  "watchlist",
  "Stocks",
  "Watchlist",
  "WatchlistOrder",
]);

/** Pull ticker symbols out of a raw plist byte buffer ([marker][len][ascii] runs). */
function extractSymbols(blob: Buffer): string[] {
  const syms: string[] = [];
  const n = blob.length;
  let i = 0;
  while (i < n - 1) {
    const len = blob[i + 1];
    if (len >= 1 && len <= 12 && i + 2 + len <= n) {
      const chunk = blob.subarray(i + 2, i + 2 + len);
      const s = chunk.toString("ascii");
      if (/^[A-Za-z0-9.\-=^]+$/.test(s)) {
        syms.push(s);
        i += 2 + len;
        continue;
      }
    }
    i += 1;
  }
  return syms;
}

interface DbStore {
  database?: { zones?: Array<{ name?: string; serverRecords?: string[] }> };
}

/**
 * Read the ordered, de-duplicated list of watchlist symbols straight from the
 * Apple Stocks app. Equities first (record 2), then crypto (record 0), matching
 * the export logic documented in HOW_TO_GET_STOCKS.txt.
 */
export async function readWatchlist(): Promise<string[]> {
  assertMacOSStocks();
  const data = JSON.parse(await readFile(DBSTORE_PATH, "utf8")) as DbStore;
  const zone = data.database?.zones?.find((z) => z.name === "Watchlist");
  if (!zone?.serverRecords) return [];

  let main: string[] = [];
  let crypto: string[] = [];

  zone.serverRecords.forEach((rec, idx) => {
    let objects: unknown[];
    try {
      const parsed = bplist.parseBuffer(Buffer.from(rec, "base64"));
      objects = (parsed[0] as { $objects?: unknown[] })?.$objects ?? [];
    } catch {
      return;
    }
    for (const o of objects) {
      if (Buffer.isBuffer(o) && o.length > 3) {
        const found = extractSymbols(o).filter((s) => !JUNK.has(s));
        if (found.length) {
          if (idx === 2) main = found;
          else if (idx === 0) crypto = found;
        }
      }
    }
  });

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const s of [...main, ...crypto]) {
    const sym = s.toUpperCase();
    if (!seen.has(sym)) {
      seen.add(sym);
      ordered.push(sym);
    }
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Quotes — read from the app's SQLite cache (shared-database)
// ---------------------------------------------------------------------------

export interface Quote {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  price?: number;
  priceChange?: number;
  changePercent?: number;
  marketState?: string;
  updatedAt?: string;
  error?: string;
}

/** Run a read-only SQL query against the Stocks cache via the system `sqlite3`. */
async function querySharedDb(sql: string): Promise<string[][]> {
  if (!existsSync(SHARED_DB_PATH)) {
    throw new Error(
      `Apple Stocks quote cache not found at:\n  ${SHARED_DB_PATH}\nOpen the Stocks app so it populates its cache.`,
    );
  }
  // -readonly avoids touching the app's DB; \x1f / \x1e are unit/record separators.
  const { stdout } = await execFileAsync("/usr/bin/sqlite3", [
    "-readonly",
    "-noheader",
    "-separator",
    "\x1f",
    "-newline",
    "\x1e",
    SHARED_DB_PATH,
    sql,
  ]);
  if (!stdout) return [];
  return stdout
    .split("\x1e")
    .filter((row) => row.length > 0)
    .map((row) => row.split("\x1f"));
}

/** Map of UPPERCASE symbol -> { name, exchange } from stock_metadata. */
async function readNames(): Promise<Map<string, { name?: string; exchange?: string }>> {
  const map = new Map<string, { name?: string; exchange?: string }>();
  try {
    const rows = await querySharedDb(
      `SELECT id,
              json_extract(valueJson,'$.v.stock.name'),
              json_extract(valueJson,'$.v.stock.exchange')
       FROM stock_metadata;`,
    );
    for (const [id, name, exchange] of rows) {
      // ids look like "AAPL;pt-PT;PT" — take the symbol before the first ';'.
      const symbol = id.split(";")[0].toUpperCase();
      if (!map.has(symbol)) {
        map.set(symbol, { name: name || undefined, exchange: exchange || undefined });
      }
    }
  } catch {
    /* metadata is optional enrichment */
  }
  return map;
}

const APPLE_EPOCH_OFFSET = 978307200; // seconds between 1970-01-01 and 2001-01-01

/** Read cached quotes for the given symbols (uppercased) from the Stocks app. */
export async function readQuotes(symbols: string[]): Promise<Quote[]> {
  assertMacOSStocks();
  const wanted = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (wanted.length === 0) return [];

  const names = await readNames();

  const rows = await querySharedDb(
    `SELECT id,
            updatedAt,
            json_extract(valueJson,'$.v.price'),
            json_extract(valueJson,'$.v.priceChange'),
            json_extract(valueJson,'$.v.currencyCode'),
            json_extract(valueJson,'$.v.exchangeStatus')
     FROM quotes;`,
  );

  const bySymbol = new Map<string, string[]>();
  for (const row of rows) bySymbol.set(row[0].toUpperCase(), row);

  return wanted.map((symbol) => {
    const row = bySymbol.get(symbol);
    const meta = names.get(symbol);
    if (!row) {
      return {
        symbol,
        name: meta?.name,
        error: "Not in the Apple Stocks cache (add it in the Stocks app first).",
      };
    }
    const [, updatedAtRaw, priceRaw, changeRaw, currency, marketState] = row;
    const price = priceRaw ? Number(priceRaw) : undefined;
    const priceChange = changeRaw ? Number(changeRaw) : undefined;
    const prevClose =
      price != null && priceChange != null ? price - priceChange : undefined;
    const changePercent =
      prevClose != null && prevClose !== 0
        ? (priceChange! / prevClose) * 100
        : undefined;
    let updatedAt: string | undefined;
    const ts = Number(updatedAtRaw);
    if (Number.isFinite(ts) && ts > 0) {
      // updatedAt is seconds since the Apple/CoreData reference date (2001).
      updatedAt = new Date((ts + APPLE_EPOCH_OFFSET) * 1000).toISOString();
    }
    return {
      symbol,
      name: meta?.name,
      exchange: meta?.exchange,
      currency: currency || undefined,
      price,
      priceChange,
      changePercent,
      marketState: marketState || undefined,
      updatedAt,
    };
  });
}

/** Format a single quote as a human-readable line. */
export function formatQuote(q: Quote): string {
  if (q.error) {
    const name = q.name ? ` (${q.name})` : "";
    return `${q.symbol}${name}: ⚠️ ${q.error}`;
  }
  const name = q.name ? ` (${q.name})` : "";
  const price =
    q.price != null ? `${q.price.toFixed(2)} ${q.currency ?? ""}`.trim() : "n/a";
  const change =
    q.priceChange != null && q.changePercent != null
      ? `${q.priceChange >= 0 ? "+" : ""}${q.priceChange.toFixed(2)} (${
          q.changePercent >= 0 ? "+" : ""
        }${q.changePercent.toFixed(2)}%)`
      : "";
  const state = q.marketState ? ` [${q.marketState}]` : "";
  return `${q.symbol}${name}: ${price}${change ? "  " + change : ""}${state}`;
}
