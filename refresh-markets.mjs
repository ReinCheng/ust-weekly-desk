import { readFile, rename, writeFile } from "node:fs/promises";
import { dailyMoves, historyAssets } from "./market-stats.ts";

const current = new Date();
const cutoff = current.toISOString().slice(0, 10);
const start = shiftDate(cutoff, -270);
const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const filename = new URL("./market-history.json", import.meta.url);
const cboe = "https://cdn.cboe.com/api/global/us_indices/daily_prices/";
const treasury = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/";

function shiftDate(date, days) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86400_000).toISOString().slice(0, 10);
}

async function request(url) {
  const response = await fetch(url, {
    headers: { "Accept": "*/*", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(String(response.status) + " " + new URL(url).hostname);
  return response;
}

function number(value) {
  const raw = value?.trim().replaceAll(",", "");
  return raw && /^[+-]?\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
}

function fromUS(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  return match ? [match[3], match[1].padStart(2, "0"), match[2].padStart(2, "0")].join("-") : "";
}

function selected(levels) {
  // All providers in this task publish rows keyed by the observation date.
  // A UTC-day close is included only after the whole UTC date has passed.
  return levels.filter(([date, value]) => date >= start && date < cutoff && Number.isFinite(value));
}

async function cboeLevels(symbol) {
  const rows = (await (await request(cboe + symbol + "_History.csv")).text()).trim().split(/\r?\n/);
  const header = rows.shift().split(",");
  const column = header.indexOf(symbol === "VIX" ? "CLOSE" : symbol);
  if (header[0] !== "DATE" || column < 0) throw new Error("Cboe unexpected header");
  return selected(rows.map(line => {
    const cells = line.split(",");
    return [fromUS(cells[0]), number(cells[column])];
  }));
}

async function nasdaqLevels() {
  const url = "https://api.nasdaq.com/api/quote/NDX/historical?assetclass=index&fromdate=" + start + "&todate=" + cutoff + "&limit=300";
  const body = await (await request(url)).json();
  if (body.data?.symbol !== "NDX") throw new Error("Nasdaq returned an unexpected symbol");
  return selected(body.data.tradesTable.rows.map(row => [fromUS(row.date), number(row.close)]));
}

async function treasuryLevels() {
  const years = [...new Set([start.slice(0, 4), cutoff.slice(0, 4)])];
  const parts = await Promise.all(years.map(async year => {
    const url = treasury + year + "/all?type=daily_treasury_yield_curve&field_tdr_date_value=" + year + "&page&_format=csv";
    const rows = (await (await request(url)).text()).trim().split(/\r?\n/);
    const cells = line => line.split(",").map(cell => cell.trim().replace(/^"|"$/g, ""));
    const header = cells(rows.shift());
    const columns = ["2 Yr", "10 Yr"].map(name => header.indexOf(name));
    if (columns.includes(-1)) throw new Error("Treasury maturity missing");
    return rows.map(line => {
      const row = cells(line);
      return [fromUS(row[0]), ...columns.map(i => number(row[i]))];
    });
  }));
  const levels = parts.flat();
  return { us2y: selected(levels.map(([date, front]) => [date, front])), us10y: selected(levels.map(([date, , back]) => [date, back])) };
}

async function ecbLevels() {
  const url = "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+JPY+GBP+CNY+AUD+CHF.EUR.SP00.A?startPeriod=" + start + "&format=csvdata";
  const rows = (await (await request(url)).text()).trim().split(/\r?\n/);
  if (!rows.shift().startsWith("KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,")) {
    throw new Error("ECB unexpected header");
  }
  const byDate = new Map();
  for (const row of rows) {
    const [, frequency, currency, denominator, , , date, quote] = row.split(",", 8);
    const value = number(quote);
    if (frequency !== "D" || denominator !== "EUR" || !date || !(value > 0)) continue;
    const rates = byDate.get(date) ?? { EUR: 1 };
    rates[currency] = value;
    byDate.set(date, rates);
  }
  const pairs = { eur: ["EUR", "USD"], jpy: ["USD", "JPY"], gbp: ["GBP", "USD"],
    cny: ["USD", "CNY"], aud: ["AUD", "USD"], chf: ["USD", "CHF"] };
  return Object.fromEntries(Object.entries(pairs).map(([id, [base, quote]]) => [id,
    selected([...byDate].map(([date, rates]) => [date, rates[quote] / rates[base]]))]));
}

async function eiaLevels(product, series) {
  const url = "https://www.eia.gov/dnav/" + product + "/hist/" + series.toLowerCase() + "D.htm";
  const html = await (await request(url)).text();
  const levels = [];
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1].replaceAll("&nbsp;", " ").trim());
    const week = /^(\d{4}) ([A-Z][a-z]{2})-\s*(\d{1,2}) to /.exec(cells[0]);
    if (!week || cells.length !== 6) continue;
    const date = [week[1], String(months.indexOf(week[2]) + 1).padStart(2, "0"), week[3].padStart(2, "0")].join("-");
    if (!Number.isFinite(Date.parse(date)) || new Date(date + "T00:00:00Z").getUTCDay() !== 1) continue;
    for (let i = 0; i < 5; i++) levels.push([shiftDate(date, i), number(cells[i + 1])]);
  }
  return selected(levels);
}

async function btcLevels() {
  const url = "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start=" + start + "&end=" + cutoff;
  const body = await (await request(url)).json();
  return selected(body.map(([time, , , , close]) => [new Date(time * 1000).toISOString().slice(0, 10), close]));
}

const feeds = [
  ["Cboe SPX", async () => ({ spx: await cboeLevels("SPX") })],
  ["Cboe RUT", async () => ({ rut: await cboeLevels("RUT") })],
  ["Cboe VIX", async () => ({ vix: await cboeLevels("VIX") })],
  ["Nasdaq", async () => ({ ndx: await nasdaqLevels() })],
  ["Treasury", treasuryLevels], ["ECB", ecbLevels],
  ["EIA WTI", async () => ({ wti: await eiaLevels("pet", "RWTC") })],
  ["EIA Brent", async () => ({ brent: await eiaLevels("pet", "RBRTE") })],
  ["EIA Henry Hub", async () => ({ gas: await eiaLevels("ng", "RNGWHHD") })],
  ["Coinbase", async () => ({ btc: await btcLevels() })],
];
const previous = await readFile(filename, "utf8").then(JSON.parse).catch(() => null);
const results = await Promise.allSettled(feeds.map(([, load]) => load()));
const fresh = {};
for (const [i, result] of results.entries()) {
  if (result.status === "fulfilled") Object.assign(fresh, result.value);
  else console.warn(feeds[i][0], String(result.reason));
}
const series = {};
for (const { id, unit } of historyAssets) {
  const next = dailyMoves(fresh[id] ?? [], unit).slice(-195);
  const old = previous?.series[id];
  const oldEnd = old?.at(-1)?.[0] ?? "";
  if (next.length >= 60 && next.at(-1)[0] >= oldEnd) series[id] = next;
  else if (old?.length) series[id] = old;
  console.log(id, series[id]?.length ?? 0, series[id]?.at(-1)?.[0] ?? "unavailable");
}
if (!Object.keys(series).length) throw new Error("No usable market history");
if (previous && JSON.stringify(series) === JSON.stringify(previous.series)) process.exit(0);
const temporary = new URL("./market-history.json.tmp", import.meta.url);
await writeFile(temporary, JSON.stringify({ updatedAt: current.toISOString(), series }) + "\n");
await rename(temporary, filename);
