import type { Calendar } from "./model";

export async function loadCalendars(signal?: AbortSignal) {
  const response = await fetch("./calendar.json", { cache: "no-cache", signal });
  if (!response.ok) throw new Error("暂时无法载入发布日历。");
  return await response.json() as Record<string, Calendar>;
}
