import { sourceKeys, type Calendar, type SourceCheck } from "./model";

export function seedCalendar(week: string): Calendar {
  const sources: SourceCheck[] = sourceKeys.map(id => ({
    id, state: "unavailable", checkedAt: null, count: 0,
  }));
  return { week, refreshedAt: null, events: [], curve: [], sources };
}
