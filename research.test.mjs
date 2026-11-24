import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents: [
      'export { coReleases, curveShape, groupReleases, lessons } from "./learning";',
      'export { parseDol } from "./feeds";',
      'export { playbookByKey } from "./playbooks";',
      'export { eventCurveBase, selectReplayItems } from "./replay-model";',
      'export { priorFor, ruleFor } from "./scenarios";',
    ].join("\n"),
    resolveDir: import.meta.dirname,
  },
  platform: "node", format: "esm", bundle: true, write: false,
});
const {
  coReleases, curveShape, groupReleases, lessons, parseDol, playbookByKey,
  eventCurveBase, selectReplayItems, priorFor, ruleFor,
} = await import("data:text/javascript;base64," + Buffer.from(outputFiles[0].contents).toString("base64"));

const release = (id, fields = {}) => ({
  id, date: "2026-11-25", time: "08:30", category: "macro", status: "confirmed", impact: 3,
  title: id, ...fields,
});
const load = async name => JSON.parse(await readFile(new URL(name, import.meta.url), "utf8"));

test("an indicator has one directory entry backed by a playbook", () => {
  assert.equal(new Set(lessons.map(lesson => lesson.key)).size, lessons.length);
  assert.ok(lessons.length >= 24);
  for (const lesson of lessons) assert.ok(playbookByKey(lesson.key), lesson.key);
});

test("calendar groups only confirmed macro releases with identical New York times", () => {
  const pce = release("PCE", { impact: 5 });
  const gdp = release("GDP");
  const claims = release("claims");
  const durables = release("durables");
  const tentative = release("tentative", { status: "tentative" });
  const missing = release("time unknown", { time: null });
  const later = release("later", { time: "10:00" });
  const nextDay = release("next day", { date: "2026-11-26" });
  const market = release("holiday", { category: "market" });
  const events = [pce, gdp, claims, durables, tentative, missing, later, nextDay, market];
  assert.deepEqual(groupReleases(events), [[pce, gdp, claims, durables], [tentative], [missing], [later], [nextDay], [market]]);
  assert.equal(coReleases(pce, events).length, 3);
  assert.deepEqual(coReleases(tentative, events), []);
});

test("DOL calendar honors the Thanksgiving Wednesday release", () => {
  const sample = 'Publication Schedule: Thursday morning at 8:30am<table><tr><th>Release Date</th><th>Release Time</th></tr>' +
    '<tr><td>Wednesday, November 25, 2026</td><td>8:30 AM EST</td></tr></table>';
  const { events: [claims] } = parseDol(sample, "2026-11-23");
  assert.equal(claims.date, "2026-11-25");
  assert.equal(claims.time, "08:30");
  assert.equal(parseDol(sample, "2026-11-30").events[0].date, "2026-12-03");
});

test("GDP compares previous vintages for the same reference quarter", () => {
  const gdp = (date, detail, value) => release(date, {
    date, detail, title: "美国 GDP",
    readings: [{ label: "实际 GDP 季环比折年率", unit: "%", value }],
  });
  const current = gdp("2026-11-25", "GDP (Second Estimate), 3rd Quarter 2026", 3.5);
  const initial = gdp("2026-10-29", "GDP (Advance Estimate), Third Quarter 2026", 3.4);
  const other = gdp("2026-11-05", "GDP (Third Estimate), 2nd Quarter 2026", 2.1);
  assert.deepEqual(priorFor(current, [initial, other], ruleFor(current)), { date: initial.date, value: 3.4 });
  assert.equal(priorFor(current, [other], ruleFor(current)), undefined);
});

test("historical scenario excludes event-day and later price bases", () => {
  const event = release("event", { date: "2026-11-10" });
  const before = Array(9).fill(4);
  const points = [{ date: "2026-11-09", values: before }, { date: event.date, values: Array(9).fill(5) }];
  const latest = { values: Array(9).fill(6), label: "latest" };
  assert.equal(eventCurveBase(event, new Date("2026-11-10T13:29:00Z"), points, undefined, latest), latest);
  assert.deepEqual(eventCurveBase(event, new Date("2026-11-10T13:30:00Z"), points, undefined, latest).values, before);
  assert.deepEqual(eventCurveBase(event, new Date("2026-11-10T13:30:00Z"), points.slice(1), undefined, latest).values, []);
  assert.deepEqual(selectReplayItems({ items: [{ date: event.date }, { date: "2026-10-14" }] }, "2026-11-09"), [{ date: "2026-10-14" }]);
  assert.equal(curveShape(17, 10), "熊平");
  assert.equal(curveShape(3, -2), "走平");
  assert.equal(curveShape(-12, -5), "牛陡");
});

test("published snapshots reconcile maturity changes and 10Y decomposition", async () => {
  const { series, curveThrough } = await load("replays.json");
  for (const { key, items } of Object.values(series)) {
    assert.equal(new Set(items.map(item => item.date)).size, items.length, key);
    for (const item of items) {
      const label = key + " " + item.date;
      assert.ok(item.prevDate < item.date && item.date <= curveThrough, label);
      for (const values of [item.curve, item.prevCurve, item.shiftsBp]) {
        assert.equal(values.length, 9, label);
        assert.ok(values.every(Number.isFinite), label);
      }
      item.shiftsBp.forEach((bp, i) => assert.ok(Math.abs(bp - (item.curve[i] - item.prevCurve[i]) * 100) < 0.051, label));
      if (item.real10Bp === null || item.be10Bp === null) {
        assert.equal(item.real10Bp, item.be10Bp, label);
      } else {
        assert.ok(Math.abs(item.shiftsBp[6] - item.real10Bp - item.be10Bp) < 0.051, label);
      }
    }
  }
  const calendar = await load("calendar.json");
  for (const week of Object.values(calendar)) {
    for (const event of week.events) {
      if (event.reference) {
        assert.ok(Number.isFinite(event.reference.value) && event.reference.asOf < event.date, event.id);
      }
    }
  }
});
