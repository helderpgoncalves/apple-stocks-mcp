/**
 * Unit tests for the Apple Stocks data layer.
 *
 * These run against the fixtures in test/fixtures/ — a synthetic dbstore.json
 * and two small SQLite databases — never against your real Apple Stocks data.
 * STOCKS_TEST_MODE=1 bypasses the macOS gate so the pure logic can be tested on
 * any OS (including Linux CI).
 *
 * The env vars below MUST be set before importing the module, because the path
 * constants are resolved at import time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Compiled to dist/test/, so the project root is two levels up; fixtures live
// in <root>/test/fixtures.
const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "..", "..", "test", "fixtures");

process.env.STOCKS_TEST_MODE = "1";
process.env.STOCKS_DBSTORE_PATH = join(fixtures, "dbstore.json");
process.env.STOCKS_SHARED_DB_PATH = join(fixtures, "shared.db");
process.env.STOCKS_SPARKLINE_DB_PATH = join(fixtures, "sparkline.db");

const m = await import("../src/appleStocks.js");

test("readWatchlist parses symbols from the binary-plist dbstore", async () => {
  const wl = await m.readWatchlist();
  assert.deepEqual(wl, ["AAPL", "MSFT", "NVDA", "EGL.LS", "BTC-USD", "ETH-USD"]);
});

test("extractSymbols decodes [marker][len][ascii] runs", () => {
  const buf = Buffer.concat([
    Buffer.from([0x6a, 4]),
    Buffer.from("AAPL", "ascii"),
    Buffer.from([0x6a, 7]),
    Buffer.from("BTC-USD", "ascii"),
  ]);
  assert.deepEqual(m.extractSymbols(buf), ["AAPL", "BTC-USD"]);
});

test("readQuotes returns price, change %, name and market cap", async () => {
  const [aapl] = await m.readQuotes(["AAPL"]);
  assert.equal(aapl.symbol, "AAPL");
  assert.equal(aapl.name, "Apple Inc.");
  assert.equal(aapl.currency, "USD");
  assert.equal(aapl.price, 296.39);
  assert.ok(Math.abs(aapl.changePercent! - 0.1487) < 0.01); // 0.44 / 295.95
  assert.equal(aapl.marketCap, 4353185546240);
});

test("readQuotes reports symbols missing from the cache", async () => {
  const [missing] = await m.readQuotes(["DOESNOTEXIST"]);
  assert.ok(missing.error);
  assert.match(missing.error!, /Not in the Apple Stocks cache/);
});

test("readDetails returns fundamentals (P/E, EPS, 52-week range)", async () => {
  const d = await m.readDetails("AAPL");
  assert.equal(d.peRatio, 32.5);
  assert.equal(d.eps, 8.67);
  assert.equal(d.beta, 1.062);
  assert.equal(d.dividendYield, 0.6);
  assert.equal(d.yearHigh, 300);
  assert.equal(d.yearLow, 160);
  assert.equal(d.volume, 11748819);
  assert.ok(d.earningsStartDate?.startsWith("20"));
});

test("readDetails falls back to quote-level info when no fundamentals cached", async () => {
  const d = await m.readDetails("MSFT");
  assert.equal(d.price, 378.91);
  assert.equal(d.peRatio, undefined); // MSFT has no quote_details row in fixtures
});

test("readChart returns intraday OHLCV points and previous close", async () => {
  const c = await m.readChart("AAPL");
  assert.equal(c.symbol, "AAPL");
  assert.equal(c.previousClose, 295.95);
  assert.equal(c.points.length, 2);
  assert.equal(c.points[0].close, 299.68);
  assert.ok(c.points[0].time.startsWith("20"));
});

test("readChart reports symbols with no cached chart", async () => {
  const c = await m.readChart("MSFT");
  assert.ok(c.error);
  assert.equal(c.points.length, 0);
});

test("summarize counts up/down and ranks movers", async () => {
  const quotes = await m.readQuotes(["AAPL", "MSFT", "EGL.LS", "BTC-USD", "NVDA"]);
  const s = m.summarize(quotes, 2);
  assert.equal(s.total, 5);
  assert.equal(s.quoted, 5);
  assert.equal(s.up, 2); // AAPL, NVDA
  assert.equal(s.down, 3); // MSFT, EGL.LS, BTC-USD
  assert.equal(s.topGainers[0].symbol, "NVDA"); // +1.81% is the biggest gainer
  assert.equal(s.topLosers[0].symbol, "MSFT"); // -3.79% is the biggest loser
  assert.equal(s.byCurrency["USD"], 4);
  assert.equal(s.byCurrency["EUR"], 1);
});

test("appleTimeToIso converts the 2001 reference epoch", () => {
  // 0 seconds since 2001-01-01 -> that exact date.
  assert.equal(m.appleTimeToIso(0), undefined); // 0 is treated as 'no value'
  assert.equal(m.appleTimeToIso(1)!.slice(0, 4), "2001");
});

test("compact formats large numbers", () => {
  assert.equal(m.compact(4353185546240), "4.35T");
  assert.equal(m.compact(2_800_000_000), "2.80B");
  assert.equal(m.compact(11_748_819), "11.75M");
  assert.equal(m.compact(undefined), "n/a");
});

test("formatQuote renders a readable line", async () => {
  const [aapl] = await m.readQuotes(["AAPL"]);
  const line = m.formatQuote(aapl);
  assert.match(line, /AAPL \(Apple Inc\.\): 296\.39 USD/);
  assert.match(line, /\+0\.44/);
});

test("formatDetails includes fundamentals labels", async () => {
  const out = m.formatDetails(await m.readDetails("AAPL"));
  assert.match(out, /52-week range/);
  assert.match(out, /Market cap: 4\.35T/);
  assert.match(out, /P\/E: 32\.5/);
});

test("currentPlatform / isMacOS honor STOCKS_FORCE_PLATFORM", () => {
  const saved = process.env.STOCKS_FORCE_PLATFORM;
  try {
    process.env.STOCKS_FORCE_PLATFORM = "linux";
    assert.equal(m.currentPlatform(), "linux");
    assert.equal(m.isMacOS(), false);

    process.env.STOCKS_FORCE_PLATFORM = "darwin";
    assert.equal(m.currentPlatform(), "darwin");
    assert.equal(m.isMacOS(), true);
  } finally {
    if (saved === undefined) delete process.env.STOCKS_FORCE_PLATFORM;
    else process.env.STOCKS_FORCE_PLATFORM = saved;
  }
});

test("assertMacOSStocks throws a friendly error on non-macOS", () => {
  const saved = process.env.STOCKS_FORCE_PLATFORM;
  const savedTest = process.env.STOCKS_TEST_MODE;
  try {
    delete process.env.STOCKS_TEST_MODE; // test-mode bypass off
    process.env.STOCKS_FORCE_PLATFORM = "win32";
    assert.throws(() => m.assertMacOSStocks(), /only works on macOS/);
  } finally {
    if (saved === undefined) delete process.env.STOCKS_FORCE_PLATFORM;
    else process.env.STOCKS_FORCE_PLATFORM = saved;
    if (savedTest !== undefined) process.env.STOCKS_TEST_MODE = savedTest;
  }
});
