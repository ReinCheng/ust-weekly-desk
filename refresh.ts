import { readFile, rename, writeFile } from "node:fs/promises";
import { publicFeeds } from "./feeds";
import { addDays, isWeek, newYorkDate, sourceKeys, timeSort, todayWeek, type Calendar, type MarketEvent, type SourceCheck } from "./model";
import { seedCalendar } from "./seed";

async function refreshCalendar(week: string, previous: Calendar): Promise<Calendar> {
  const baseline = seedCalendar(week);
  const checkedAt = new Date().toISOString();
  const feeds = publicFeeds(week);
  const responses = await Promise.allSettled(feeds.map(([, pending]) => pending));
  const received = new Map(feeds.map(([id], i) => [id, responses[i]] as const));
  const events = new Map<string, MarketEvent>();
  const sources: SourceCheck[] = [];
  let curve = previous.curve;
  function collect(event: MarketEvent) {
    const old = events.get(event.id);
    if (old?.status === "confirmed" && event.status === "tentative") return;
    if (old?.time && !event.time && old.status === event.status) return;
    if (old && event.source === "fomc" && old.source === "fed" && !event.url.includes("fomcminutes")) return;
    events.set(event.id, event);
  }
  for (const id of sourceKeys) {
    const response = received.get(id);
    const old = previous.sources.find(source => source.id === id);
    if (response?.status === "rejected") console.warn(week, id, String(response.reason));
    const previousEvents = [...new Map([...previous.events, ...baseline.events.filter(event => event.source === "cme")].filter(event => event.source === id)
      .map(event => [event.id, event])).values()];
    if (response?.status !== "fulfilled") {
      for (const event of previousEvents) collect(event);
      sources.push({
        id, count: previousEvents.length, state: old?.state === "reference" ? "reference" : old?.checkedAt ? "cached" : "unavailable",
        checkedAt: old?.checkedAt ?? null, officialUpdate: old?.officialUpdate,
      });
      continue;
    }
    const { value } = response;
    const past = week < todayWeek();
    const preserved = previousEvents.filter(event => past || value.partial || event.actual || (event.date < newYorkDate() && id === "dol") ||
      (id === "cme" && /^cme-20/.test(event.id)));
    for (const event of preserved) collect(event);
    for (const event of value.events) {
      const prior = previous.events.find(item => item.id === event.id) ?? baseline.events.find(item => item.id === event.id);
      if (id === "bls" && !prior) {
        const sameRelease = previous.events.find(item => item.source === id && item.date === event.date && item.title === event.title);
        if (sameRelease) {
          collect({ ...sameRelease, time: event.time });
          continue;
        }
      }
      const fromOtherSource = events.get(event.id);
      const officialUrl = prior?.source === event.source ? prior.resultUrl : fromOtherSource?.resultUrl;
      const url = prior?.source === event.source && /sifma.org\/news\/press-releases\//.test(prior.url) ? prior.url : event.url;
      collect({ ...event, url, officialDate: event.officialDate ?? prior?.officialDate, actual: event.actual ?? prior?.actual, resultUrl: event.resultUrl ?? officialUrl });
    }
    if (id === "curve" && value.curve?.length) {
      curve = [...new Map([...previous.curve, ...value.curve].map(point => [point.date, point])).values()].sort((a, b) => a.date.localeCompare(b.date));
    }
    sources.push({
      id, state: value.partial ? "cached" : "verified", checkedAt, officialUpdate: value.officialUpdate ?? old?.officialUpdate,
      count: value.events.length,
    });
  }
  const announced = new Set([...events.values()].filter(event => event.source === "treasury").map(event => event.auctionKey + ":" + event.date));
  const knownCme = new Set([...events.values()].filter(event => event.source === "cme" && event.id.startsWith("cme-globex")).map(event => event.date));
  for (const event of events.values()) {
    if (event.source === "cme" && event.status === "tentative" && knownCme.has(event.date)) events.delete(event.id);
    if (event.source === "tentative" && announced.has(event.auctionKey + ":" + event.date)) events.delete(event.id);
  }
  const succeeded = responses.some(response => response.status === "fulfilled");
  const data: Calendar = { week, events: [...events.values()].sort(timeSort), sources, curve,
    refreshedAt: succeeded ? checkedAt : previous.refreshedAt };
  return data;
}

const file = "calendar.json";
const calendars = JSON.parse(await readFile(file, "utf8")) as Record<string, Calendar>;
const week = todayWeek();
const requested = process.argv.slice(2);
if (!requested.every(isWeek)) throw new Error("Requested weeks must be Monday dates (YYYY-MM-DD).");
const weeks = requested.length ? requested : [addDays(week, -7), week, addDays(week, 7)];
for (const target of weeks) {
  const previous = calendars[target] ?? seedCalendar(target);
  const calendar = await refreshCalendar(target, previous);
  const verified = calendar.sources.filter(source => source.state === "verified").length;
  console.log(target, calendar.events.length + " events", verified + "/" + sourceKeys.length + " verified sources");
  if (verified > 0) calendars[target] = calendar;
}
await writeFile(file + ".tmp", JSON.stringify(calendars, null, 2) + "\n");
await rename(file + ".tmp", file);
