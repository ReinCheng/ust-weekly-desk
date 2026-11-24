import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: 'export * from "./market-data"; export * from "./market-stats";',
    resolveDir: import.meta.dirname,
  },
  platform: "node", format: "esm", bundle: true, write: false,
});
const { alignMoves, correlation, dailyMoves, historyAssets, instruments, marketNumber, parseQuote, summarizeMoves } =
  await import("data:text/javascript;base64," + Buffer.from(outputFiles[0].contents).toString("base64"));
const asset = symbol => Object.values(instruments).flat().find(item => item.symbol === symbol);
const now = new Date("2026-11-24T03:45:00Z");

test("live quote units, provider changes and market-local dates", () => {
  const fixtures = [
    [".RUT", { last: "2,669.655", change: "+87.866", previous_day_closing: "2,669.655", last_time: "2026-11-23T16:30:00.000-0500" }, 3.403300, "2026-11-23"],
    ["US10Y", { last: "4.912%", change: "-0.008", last_time: "2026-11-23T22:41:53.000-0500" }, -0.8, "2026-11-23"],
    ["JP10Y", { last: "2.705%", change: "-0.082", last_time: "2026-11-24T12:41:47.000+0900" }, -8.2, "2026-11-24"],
  ];
  for (const [symbol, fields, expected, date] of fixtures) {
    const quote = parseQuote({ symbol, ...fields }, asset(symbol), now);
    assert.equal(quote.tradingDate, date);
    assert.ok(Math.abs(quote.change - expected) < 0.001);
  }
  const dateOnly = parseQuote({ symbol: ".GDAXI", last: "25,337.27", previous_day_closing: "25,337.27",
    change: "UNCH", last_time: "2026-11-23" }, asset(".GDAXI"), now);
  assert.equal(dateOnly.change, null);
  assert.equal(dateOnly.dateOnly, true);
  assert.equal(parseQuote({ symbol: "US10Y", last: "4.1%", last_time: "2026-11-24T00:00:00" }, asset("US10Y"), now), null);
  assert.equal(parseQuote({ symbol: "US10Y", last: "4.1%", last_time: "2026-11-24T07:00:00Z" }, asset("US10Y"), now), null);
  assert.equal(marketNumber(""), null);
  assert.equal(marketNumber("-0.10%"), -0.1);
});

test("daily changes distinguish percentage returns from basis-point changes", () => {
  const prices = [["2026-01-02", 100], ["2026-01-05", 110], ["2026-01-06", 99]];
  const yields = [["2026-01-02", 4.05], ["2026-01-05", 4.0], ["2026-01-06", 4.07]];
  assert.deepEqual(dailyMoves(prices, "%").map(row => row[2]), [10, -10]);
  assert.deepEqual(dailyMoves(yields, "bp").map(row => row[2]), [-5, 7]);
  assert.deepEqual(dailyMoves([prices[0], ["2026-01-05", 0]], "%"), []);
  const stock = summarizeMoves(dailyMoves(prices, "%"), 20, { unit: "%" });
  assert.ok(Math.abs(stock.total + 1) < 1e-8);
  assert.ok(Math.abs(stock.drawdown + 10) < 1e-8);
  assert.ok(Math.abs(stock.volatility - Math.sqrt(200 * 252)) < 1e-8);
  assert.equal(stock.positive, 50);
  const rate = summarizeMoves(dailyMoves(yields, "bp"), 20, { unit: "bp" });
  assert.equal(rate.total, 2);
  assert.equal(rate.drawdown, null);
});

test("correlations match both dates, deal with ties and reject constant samples", () => {
  const x = [["2026-01-05", "2026-01-02", 3], ["2026-01-06", "2026-01-05", 1]];
  const y = [["2026-01-05", "2026-01-04", 7], ["2026-01-06", "2026-01-05", -5]];
  assert.deepEqual(alignMoves(x, y, 20), [{ date: "2026-01-06", previous: "2026-01-05", x: 1, y: -5 }]);
  assert.equal(correlation([1, 2, 3], [3, 2, 1], "pearson", 3), -1);
  assert.equal(correlation([1, 1, 2, 4], [2, 2, 4, 5], "spearman", 4), 1);
  assert.equal(correlation([1, 1, 1], [1, 2, 3], "pearson", 3), null);
  assert.equal(correlation([1, 2, 3], [1, 2, 3]), null);
});

test("published day history contains valid dated moves across categories", async () => {
  const history = JSON.parse(await readFile(new URL("./market-history.json", import.meta.url), "utf8"));
  assert.ok(Number.isFinite(Date.parse(history.updatedAt)));
  const keys = new Set(historyAssets.map(asset => asset.id));
  for (const key of ["spx", "us10y", "eur", "wti", "btc"]) assert.ok(history.series[key]?.length >= 60, key);
  assert.equal(new Set(Object.values(instruments).flat().map(item => item.symbol)).size, Object.values(instruments).flat().length);
  for (const [id, rows] of Object.entries(history.series)) {
    assert.ok(keys.has(id));
    assert.ok(rows.length >= 60 && rows.length <= 195, id);
    for (const [i, [date, previous, move]] of rows.entries()) {
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{4}-\d{2}-\d{2}$/.test(previous), id);
      assert.ok(previous < date && date < history.updatedAt.slice(0, 10), id);
      assert.ok(Number.isFinite(move) && (i === 0 || rows[i - 1][0] <= previous), id);
    }
  }
});
