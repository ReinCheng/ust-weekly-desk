import data from "./seed-data.json";
import { addDays, sourceKeys, timeSort, type Calendar, type CurvePoint, type MarketEvent, type SourceCheck, type SourceId } from "./model";

const checkedAt = data.checkedAt;
const initial = data.events as MarketEvent[];
const curve = data.curve as CurvePoint[];
const official = data.official as Partial<Record<SourceId, string>>;
const reference = new Set<SourceId>(["tentative", "cme"]);

export function seedCalendar(week: string): Calendar {
  const end = addDays(week, 6);
  const events = initial.filter(item => item.date >= week && item.date <= end).sort(timeSort);
  const points = curve.filter(point => point.date >= addDays(week, -7) && point.date <= end);
  const close = week >= "2026-11-02" && week <= "2026-12-14";
  const sources: SourceCheck[] = sourceKeys.map(id => {
    const count = events.filter(item => item.source === id).length;
    const available = close || count > 0 || (id === "curve" && points.length > 0);
    return { id, state: reference.has(id) ? "reference" : available ? "cached" : "unavailable",
      checkedAt: available ? checkedAt : null, officialUpdate: available ? official[id] : undefined, count };
  });
  return { week, refreshedAt: close || events.length ? checkedAt : null, events, curve: points, sources };
}
