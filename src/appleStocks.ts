/**
 * Reads data exclusively from the pre-installed macOS **Stocks** app.
 *
 * Sources — all inside the app's group container, all read-only, no network:
 *
 *   1. Watchlist symbols
 *      …/PrivateData/com.apple.stocks.private-production-dbstore.json
 *      JSON whose `serverRecords` are base64 binary-plists; symbols live inside
 *      as [marker][len][ascii] byte runs. See HOW_TO_GET_STOCKS.txt.
 *
 *   2. Quotes / fundamentals / names  (SQLite: shared-database)
 *      `quotes`         -> price / change / currency / market state / market cap
 *      `quote_details`  -> volume, P/E, EPS, beta, dividend yield, 52w & day ranges
 *      `stock_metadata` -> company name / exchange / type
 *
 *   3. Intraday chart  (SQLite: sparkline-database)
 *      `sparklines`     -> OHLCV time series + previous close
 *
 * This server is therefore **macOS-only** and reflects whatever the Stocks app
 * last synced. Open the Stocks app to refresh.
 *
 * Paths can be overridden with env vars (used by the test-suite fixtures so the
 * tests never touch your real Apple Stocks data):
 *   STOCKS_DBSTORE_PATH, STOCKS_SHARED_DB_PATH, STOCKS_SPARKLINE_DB_PATH
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

export const DBSTORE_PATH =
  process.env.STOCKS_DBSTORE_PATH ||
  join(
    GROUP,
    "Library",
    "Documents",
    "PrivateData",
    "com.apple.stocks.private-production-dbstore.json",
  );

export const SHARED_DB_PATH =
  process.env.STOCKS_SHARED_DB_PATH ||
  join(GROUP, "Library", "Caches", "shared-database");

export const SPARKLINE_DB_PATH =
  process.env.STOCKS_SPARKLINE_DB_PATH ||
  join(GROUP, "Library", "Caches", "sparkline-database");

export const SQLITE_BIN = process.env.STOCKS_SQLITE_BIN || "/usr/bin/sqlite3";

/** Seconds between the Unix epoch (1970) and the Apple/CoreData epoch (2001). */
const APPLE_EPOCH_OFFSET = 978307200;

/** Convert an Apple reference-date timestamp (seconds since 2001) to ISO 8601. */
export function appleTimeToIso(raw: unknown): string | undefined {
  const ts = Number(raw);
  if (!Number.isFinite(ts) || ts <= 0) return undefined;
  return new Date((ts + APPLE_EPOCH_OFFSET) * 1000).toISOString();
}

/** True if we're on macOS. */
export function isMacOS(): boolean {
  return platform() === "darwin";
}

/**
 * Bypass the macOS gate. Set ONLY by the test-suite (STOCKS_TEST_MODE=1) so the
 * pure parsing/formatting logic can be exercised against fixtures on any OS
 * (e.g. Linux CI). Never set this in real use — the data only exists on macOS.
 */
function testMode(): boolean {
  return process.env.STOCKS_TEST_MODE === "1";
}

/** Throw a clear error if we're not on macOS or the Stocks data is missing. */
export function assertMacOSStocks(): void {
  if (!isMacOS() && !testMode()) {
    throw new Error(
      "This MCP server only works on macOS — it reads the pre-installed Apple Stocks app's local data.",
    );
  }
  if (!existsSync(DBSTORE_PATH)) {
    throw new Error(
      `Apple Stocks watchlist file not found at:\n  ${DBSTORE_PATH}\n` +
        "Open the Stocks app at least once so it creates its data. " +
        "If the file exists but is unreadable, grant your client Full Disk Access " +
        "(System Settings → Privacy & Security → Full Disk Access).",
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
export function extractSymbols(blob: Buffer): string[] {
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
// SQLite helpers
// ---------------------------------------------------------------------------

const UNIT_SEP = "\x1f";
const REC_SEP = "\x1e";

/** Run a read-only SQL query against a Stocks SQLite cache via system `sqlite3`. */
async function querySqlite(dbPath: string, sql: string): Promise<string[][]> {
  if (!existsSync(dbPath)) {
    throw new Error(
      `Apple Stocks database not found at:\n  ${dbPath}\nOpen the Stocks app so it populates its cache.`,
    );
  }
  const { stdout } = await execFileAsync(SQLITE_BIN, [
    "-readonly", // never writes to the app's DB
    "-noheader",
    "-separator",
    UNIT_SEP,
    "-newline",
    REC_SEP,
    dbPath,
    sql,
  ]);
  if (!stdout) return [];
  return stdout
    .split(REC_SEP)
    .filter((row) => row.length > 0)
    .map((row) => row.split(UNIT_SEP));
}

const num = (s: string | undefined): number | undefined => {
  if (s == null || s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

// ---------------------------------------------------------------------------
// Names / metadata
// ---------------------------------------------------------------------------

export interface StockMeta {
  name?: string;
  exchange?: string;
  type?: string;
}

/** Map of UPPERCASE symbol -> metadata from stock_metadata. */
export async function readNames(): Promise<Map<string, StockMeta>> {
  const map = new Map<string, StockMeta>();
  try {
    const rows = await querySqlite(
      SHARED_DB_PATH,
      `SELECT id,
              json_extract(valueJson,'$.v.stock.name'),
              json_extract(valueJson,'$.v.stock.exchange'),
              json_extract(valueJson,'$.v.stock.type')
       FROM stock_metadata;`,
    );
    for (const [id, name, exchange, type] of rows) {
      // ids look like "AAPL;pt-PT;PT" — take the symbol before the first ';'.
      const symbol = id.split(";")[0].toUpperCase();
      if (!map.has(symbol)) {
        map.set(symbol, {
          name: name || undefined,
          exchange: exchange || undefined,
          type: type || undefined,
        });
      }
    }
  } catch {
    /* metadata is optional enrichment */
  }
  return map;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export interface Quote {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  price?: number;
  priceChange?: number;
  changePercent?: number;
  marketCap?: number;
  marketState?: string;
  updatedAt?: string;
  error?: string;
}

/** Build a Quote from a quotes-table row + metadata. */
function buildQuote(symbol: string, row: string[] | undefined, meta?: StockMeta): Quote {
  if (!row) {
    return {
      symbol,
      name: meta?.name,
      error: "Not in the Apple Stocks cache (add it in the Stocks app first).",
    };
  }
  const [, updatedAtRaw, priceRaw, changeRaw, currency, marketState, capRaw] = row;
  const price = num(priceRaw);
  const priceChange = num(changeRaw);
  const prevClose =
    price != null && priceChange != null ? price - priceChange : undefined;
  const changePercent =
    prevClose != null && prevClose !== 0
      ? (priceChange! / prevClose) * 100
      : undefined;
  return {
    symbol,
    name: meta?.name,
    exchange: meta?.exchange,
    currency: currency || undefined,
    price,
    priceChange,
    changePercent,
    marketCap: num(capRaw),
    marketState: marketState || undefined,
    updatedAt: appleTimeToIso(updatedAtRaw),
  };
}

async function quotesBySymbol(): Promise<Map<string, string[]>> {
  const rows = await querySqlite(
    SHARED_DB_PATH,
    `SELECT id,
            updatedAt,
            json_extract(valueJson,'$.v.price'),
            json_extract(valueJson,'$.v.priceChange'),
            json_extract(valueJson,'$.v.currencyCode'),
            json_extract(valueJson,'$.v.exchangeStatus'),
            json_extract(valueJson,'$.v.marketCapitalization')
     FROM quotes;`,
  );
  const map = new Map<string, string[]>();
  for (const row of rows) map.set(row[0].toUpperCase(), row);
  return map;
}

/** Read cached quotes for the given symbols (uppercased) from the Stocks app. */
export async function readQuotes(symbols: string[]): Promise<Quote[]> {
  assertMacOSStocks();
  const wanted = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (wanted.length === 0) return [];
  const [names, quotes] = await Promise.all([readNames(), quotesBySymbol()]);
  return wanted.map((symbol) => buildQuote(symbol, quotes.get(symbol), names.get(symbol)));
}

// ---------------------------------------------------------------------------
// Fundamentals (quote_details)
// ---------------------------------------------------------------------------

export interface StockDetails extends Quote {
  open?: number;
  dayHigh?: number;
  dayLow?: number;
  yearHigh?: number;
  yearLow?: number;
  volume?: number;
  averageVolume?: number;
  peRatio?: number;
  eps?: number;
  beta?: number;
  dividendYield?: number;
  earningsStartDate?: string;
  earningsEndDate?: string;
}

/** Read full fundamentals (price + quote_details) for a single symbol. */
export async function readDetails(symbol: string): Promise<StockDetails> {
  assertMacOSStocks();
  const sym = symbol.trim().toUpperCase();
  const [names, quotes, detailRows] = await Promise.all([
    readNames(),
    quotesBySymbol(),
    querySqlite(
      SHARED_DB_PATH,
      `SELECT id,
              json_extract(valueJson,'$.v.dayOpenPrice'),
              json_extract(valueJson,'$.v.dayHighPrice'),
              json_extract(valueJson,'$.v.dayLowPrice'),
              json_extract(valueJson,'$.v.yearHighPrice'),
              json_extract(valueJson,'$.v.yearLowPrice'),
              json_extract(valueJson,'$.v.volume'),
              json_extract(valueJson,'$.v.averageVolume'),
              json_extract(valueJson,'$.v.priceEarningsRatio'),
              json_extract(valueJson,'$.v.earningsPerShare'),
              json_extract(valueJson,'$.v.beta'),
              json_extract(valueJson,'$.v.dividendYield'),
              json_extract(valueJson,'$.v.earningsStartDate'),
              json_extract(valueJson,'$.v.earningsEndDate')
       FROM quote_details WHERE id = '${sym.replace(/'/g, "''")}';`,
    ),
  ]);

  const base = buildQuote(sym, quotes.get(sym), names.get(sym));
  const d = detailRows[0];
  if (!d) return base; // no fundamentals cached; price-level info still returned

  const [
    ,
    open,
    dayHigh,
    dayLow,
    yearHigh,
    yearLow,
    volume,
    averageVolume,
    pe,
    eps,
    beta,
    divYield,
    earnStart,
    earnEnd,
  ] = d;

  return {
    ...base,
    open: num(open),
    dayHigh: num(dayHigh),
    dayLow: num(dayLow),
    yearHigh: num(yearHigh),
    yearLow: num(yearLow),
    volume: num(volume),
    averageVolume: num(averageVolume),
    peRatio: num(pe),
    eps: num(eps),
    beta: num(beta),
    dividendYield: num(divYield),
    earningsStartDate: appleTimeToIso(earnStart),
    earningsEndDate: appleTimeToIso(earnEnd),
  };
}

// ---------------------------------------------------------------------------
// Intraday chart (sparklines)
// ---------------------------------------------------------------------------

export interface ChartPoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockChart {
  symbol: string;
  previousClose?: number;
  points: ChartPoint[];
  error?: string;
}

interface SparklineJson {
  v?: {
    previousClose?: number;
    entries?: Array<{
      referenceDate?: number;
      open?: number;
      high?: number;
      low?: number;
      close?: number;
      volume?: number;
    }>;
  };
}

/** Read the cached intraday OHLCV sparkline for a single symbol. */
export async function readChart(symbol: string): Promise<StockChart> {
  assertMacOSStocks();
  const sym = symbol.trim().toUpperCase();
  // Sparkline ids can be suffixed (e.g. "AAPL" or "AAPL;range"); match the prefix.
  const rows = await querySqlite(
    SPARKLINE_DB_PATH,
    `SELECT valueJson FROM sparklines
     WHERE id = '${sym.replace(/'/g, "''")}' OR id LIKE '${sym.replace(/'/g, "''")};%'
     LIMIT 1;`,
  );
  if (!rows[0]) {
    return { symbol: sym, points: [], error: "No intraday chart cached for this symbol." };
  }
  let parsed: SparklineJson;
  try {
    parsed = JSON.parse(rows[0][0]) as SparklineJson;
  } catch {
    return { symbol: sym, points: [], error: "Could not parse cached chart data." };
  }
  const entries = parsed.v?.entries ?? [];
  const points: ChartPoint[] = entries
    .filter((e) => e.referenceDate != null && e.close != null)
    .map((e) => ({
      time: appleTimeToIso(e.referenceDate) ?? "",
      open: e.open ?? e.close!,
      high: e.high ?? e.close!,
      low: e.low ?? e.close!,
      close: e.close!,
      volume: e.volume ?? 0,
    }));
  return { symbol: sym, previousClose: parsed.v?.previousClose, points };
}

// ---------------------------------------------------------------------------
// Portfolio analytics (computed from the watchlist's quotes)
// ---------------------------------------------------------------------------

export interface PortfolioSummary {
  total: number;
  quoted: number;
  missing: string[];
  up: number;
  down: number;
  flat: number;
  byCurrency: Record<string, number>;
  byExchange: Record<string, number>;
  topGainers: Quote[];
  topLosers: Quote[];
}

/** Read every watchlist quote (used by the analytics tools). */
export async function readWatchlistQuotes(): Promise<Quote[]> {
  const symbols = await readWatchlist();
  return readQuotes(symbols);
}

/** Compute an at-a-glance portfolio summary from the watchlist quotes. */
export function summarize(quotes: Quote[], topN = 5): PortfolioSummary {
  const valid = quotes.filter((q) => !q.error);
  const missing = quotes.filter((q) => q.error).map((q) => q.symbol);
  const byCurrency: Record<string, number> = {};
  const byExchange: Record<string, number> = {};
  let up = 0;
  let down = 0;
  let flat = 0;

  for (const q of valid) {
    const cur = q.currency ?? "—";
    byCurrency[cur] = (byCurrency[cur] ?? 0) + 1;
    const exch = q.exchange ?? "—";
    byExchange[exch] = (byExchange[exch] ?? 0) + 1;
    if (q.changePercent == null || q.changePercent === 0) flat++;
    else if (q.changePercent > 0) up++;
    else down++;
  }

  const ranked = valid
    .filter((q) => q.changePercent != null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));

  return {
    total: quotes.length,
    quoted: valid.length,
    missing,
    up,
    down,
    flat,
    byCurrency,
    byExchange,
    topGainers: ranked.slice(0, topN),
    topLosers: ranked.slice(-topN).reverse(),
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const fmtNum = (n: number | undefined, digits = 2): string =>
  n == null ? "n/a" : n.toLocaleString("en-US", { maximumFractionDigits: digits });

/** Compact large numbers (market cap, volume): 4.35T, 11.7M. */
export function compact(n: number | undefined): string {
  if (n == null) return "n/a";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return String(n);
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

/** Format full fundamentals as a multi-line block. */
export function formatDetails(d: StockDetails): string {
  if (d.error && d.price == null) {
    return `${d.symbol}: ⚠️ ${d.error}`;
  }
  const lines = [formatQuote(d)];
  const range52 =
    d.yearLow != null && d.yearHigh != null
      ? `${fmtNum(d.yearLow)} – ${fmtNum(d.yearHigh)}`
      : "n/a";
  const dayRange =
    d.dayLow != null && d.dayHigh != null
      ? `${fmtNum(d.dayLow)} – ${fmtNum(d.dayHigh)}`
      : "n/a";
  lines.push(`  Open: ${fmtNum(d.open)}   Day range: ${dayRange}`);
  lines.push(`  52-week range: ${range52}`);
  lines.push(`  Market cap: ${compact(d.marketCap)}   Volume: ${compact(d.volume)} (avg ${compact(d.averageVolume)})`);
  lines.push(`  P/E: ${fmtNum(d.peRatio)}   EPS: ${fmtNum(d.eps)}   Beta: ${fmtNum(d.beta)}   Div yield: ${d.dividendYield != null ? d.dividendYield + "%" : "n/a"}`);
  if (d.earningsStartDate) {
    lines.push(`  Next earnings: ${d.earningsStartDate.slice(0, 10)}`);
  }
  return lines.join("\n");
}

/** Format an intraday chart as a sparkline-ish summary. */
export function formatChart(c: StockChart): string {
  if (c.error) return `${c.symbol}: ⚠️ ${c.error}`;
  if (c.points.length === 0) return `${c.symbol}: no intraday points cached.`;
  const closes = c.points.map((p) => p.close);
  const first = closes[0];
  const last = closes[closes.length - 1];
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const blocks = "▁▂▃▄▅▆▇█";
  const span = hi - lo || 1;
  const spark = closes
    .map((v) => blocks[Math.min(blocks.length - 1, Math.floor(((v - lo) / span) * (blocks.length - 1)))])
    .join("");
  const change = c.previousClose != null ? last - c.previousClose : last - first;
  const pct = c.previousClose ? (change / c.previousClose) * 100 : ((last - first) / first) * 100;
  return [
    `${c.symbol} intraday (${c.points.length} points)`,
    `  ${spark}`,
    `  prev close: ${fmtNum(c.previousClose)}   last: ${fmtNum(last)}   day range: ${fmtNum(lo)} – ${fmtNum(hi)}`,
    `  change vs prev close: ${change >= 0 ? "+" : ""}${fmtNum(change)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`,
  ].join("\n");
}

/** Format a portfolio summary block. */
export function formatSummary(s: PortfolioSummary): string {
  const top = (qs: Quote[]) =>
    qs.length
      ? qs
          .map(
            (q) =>
              `    ${q.symbol}: ${q.changePercent! >= 0 ? "+" : ""}${q.changePercent!.toFixed(2)}%`,
          )
          .join("\n")
      : "    (none)";
  const dist = (rec: Record<string, number>) =>
    Object.entries(rec)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `    ${k}: ${v}`)
      .join("\n");
  const lines = [
    `Watchlist summary — ${s.quoted}/${s.total} quoted` +
      (s.missing.length ? ` (${s.missing.length} without a cached quote)` : ""),
    `  Up: ${s.up}   Down: ${s.down}   Flat: ${s.flat}`,
    "",
    "  Top gainers:",
    top(s.topGainers),
    "  Top losers:",
    top(s.topLosers),
    "",
    "  By currency:",
    dist(s.byCurrency),
    "  By exchange:",
    dist(s.byExchange),
  ];
  if (s.missing.length) {
    lines.push("", `  Not in cache: ${s.missing.join(", ")}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export interface DiagnosticCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** Run environment checks to help diagnose setup problems. */
export async function diagnostics(): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];

  checks.push({
    name: "Operating system is macOS",
    ok: isMacOS(),
    detail: isMacOS() ? `platform=${platform()}` : `platform=${platform()} (this server is macOS-only)`,
  });

  const sqliteOk = existsSync(SQLITE_BIN);
  checks.push({
    name: "sqlite3 binary available",
    ok: sqliteOk,
    detail: sqliteOk ? SQLITE_BIN : `${SQLITE_BIN} not found`,
  });

  const dbstoreOk = existsSync(DBSTORE_PATH);
  checks.push({
    name: "Watchlist file present",
    ok: dbstoreOk,
    detail: dbstoreOk ? DBSTORE_PATH : `missing — open the Stocks app at least once (${DBSTORE_PATH})`,
  });

  const sharedOk = existsSync(SHARED_DB_PATH);
  checks.push({
    name: "Quote cache present",
    ok: sharedOk,
    detail: sharedOk ? SHARED_DB_PATH : `missing (${SHARED_DB_PATH})`,
  });

  const sparkOk = existsSync(SPARKLINE_DB_PATH);
  checks.push({
    name: "Sparkline cache present",
    ok: sparkOk,
    detail: sparkOk ? SPARKLINE_DB_PATH : `missing (${SPARKLINE_DB_PATH})`,
  });

  // Can we actually read the data? (catches Full Disk Access problems.)
  let readOk = false;
  let readDetail = "skipped (prerequisites missing)";
  if (isMacOS() && dbstoreOk && sharedOk && sqliteOk) {
    try {
      const wl = await readWatchlist();
      const q = await quotesBySymbol();
      readOk = true;
      readDetail = `read ${wl.length} watchlist symbols and ${q.size} cached quotes`;
    } catch (err) {
      readDetail =
        (err instanceof Error ? err.message.split("\n")[0] : String(err)) +
        " — you may need to grant Full Disk Access to your MCP client.";
    }
  }
  checks.push({ name: "Data is readable", ok: readOk, detail: readDetail });

  return checks;
}
