import { analysis, scenariosFor } from "./analysis";
import type { Calendar, DeskItem, Version } from "./model";
import { seedCalendar } from "./seed";

const storagePrefix = "ust-weekly-desk-pages:";
const versionListKey = storagePrefix + "versions";
let published: Promise<Record<string, Calendar>> | undefined;

export async function loadCalendar(week: string, reload = false) {
  if (reload || !published) {
    const request = fetch("./calendar.json", { cache: reload ? "reload" : "no-cache" }).then(async response => {
      if (!response.ok) throw new Error("无法载入日程，请稍后重试。");
      return await response.json() as Record<string, Calendar>;
    });
    published = request;
    void request.catch(() => { if (published === request) published = undefined; });
  }
  return (await published)[week] ?? seedCalendar(week);
}

function stored<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : JSON.parse(raw) as T;
}

const itemKey = (week: string) => storagePrefix + "items:" + week;

export function readDesk(week: string) {
  return {
    items: stored<DeskItem[]>(itemKey(week), []),
    versions: stored<Version[]>(versionListKey, []).map(({ id, week, title, created }) => ({ id, week, title, created })),
  };
}

export function editDeskItem(week: string, item: Omit<DeskItem, "updated">, remove: boolean): DeskItem {
  const key = itemKey(week);
  const items = stored<DeskItem[]>(key, []).filter(entry => entry.kind !== item.kind || entry.id !== item.id);
  const updated = { ...item, body: item.body.trim().slice(0, 5000), updated: new Date().toISOString() };
  localStorage.setItem(key, JSON.stringify(remove ? items : [updated, ...items]));
  return updated;
}

export function saveVersion(calendar: Calendar, title: string): Version {
  const { week } = calendar;
  const items = stored<DeskItem[]>(itemKey(week), []);
  const impactAnalysis = Object.fromEntries(calendar.events.map(event => [event.kind, analysis[event.kind]]));
  const version = {
    id: crypto.randomUUID(), week, title: title.trim().slice(0, 100), created: new Date().toISOString(),
    calendar, items, impactAnalysis, scenarios: scenariosFor(calendar),
  };
  const versions = stored<Version[]>(versionListKey, []);
  localStorage.setItem(versionListKey, JSON.stringify([version, ...versions]));
  return version;
}

export function readVersion(id: string) {
  const version = stored<Version[]>(versionListKey, []).find(entry => entry.id === id);
  if (!version) throw new Error("此版本不可用。");
  return version;
}
