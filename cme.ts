import { sourceIndex, type MarketEvent } from "./model";
import type { Feed } from "./feeds";

type Transition = { eventTime: string; marketEventType: string; tradingDate: string };
type Session = { eventDate: string; events: Transition[] };
type Product = { globex: string; tradingHours?: { schedules: Session[] } };
const contracts = { ZT: 303, ZF: 329, ZN: 316, TN: 7978, ZB: 307, UB: 3141, TWE: 10072 };
const names = { closed: "收市", paused: "暂停", open: "开市", preopen: "预开盘" } as const;

export function cmeDataUrl(start: string, end: string) {
  return "https://www.cmegroup.com/services/trading-hours-by-product?id=" + Object.values(contracts).join(",") +
    "&pageNumber=1&pageSize=25&sortAsc=true&fromEventDate=" + start + "&toEventDate=" + end;
}

function eastern(clock: string) {
  const match = clock.match(/^(\d\d):(\d\d)$/);
  return match ? String((Number(match[1]) + 1) % 24).padStart(2, "0") + ":" + match[2] : null;
}

export function parseCme(raw: unknown, start: string, end: string, officialDate?: string, holidayDays: string[] = []): Feed {
  const body = raw as { products?: Product[] };
  if (!Array.isArray(body?.products) || !body.products.some(product => product.globex === "ZN")) throw new Error("CME Treasury futures session data unavailable");
  const dates = new Map<string, { time: string; type: keyof typeof names; codes: Set<string> }>();
  for (const product of body.products) {
    if (!(product.globex in contracts)) continue;
    for (const session of product.tradingHours?.schedules ?? []) {
      if (session.eventDate < start || session.eventDate > end) continue;
      for (const entry of session.events) {
        if (entry.marketEventType !== "closed" && entry.marketEventType !== "paused" && entry.marketEventType !== "open") continue;
        if (entry.marketEventType === "closed" && entry.eventTime === "16:00" && !holidayDays.includes(session.eventDate)) continue;
        if (entry.marketEventType === "open" && !holidayDays.includes(session.eventDate)) continue;
        const time = eastern(entry.eventTime);
        if (!time) continue;
        const key = [session.eventDate, time, entry.marketEventType].join("|");
        const type = entry.marketEventType;
        const group = dates.get(key) ?? { time, type, codes: new Set<string>() };
        group.codes.add(product.globex);
        dates.set(key, group);
      }
    }
  }
  const events: MarketEvent[] = [...dates.entries()].map(([key, group]) => {
    const [date] = key.split("|");
    const title = "CME 美债期货" + (group.type === "closed" && group.time < "17:00" ? "提前收市" : names[group.type]);
    const codes = Object.keys(contracts).filter(code => group.codes.has(code)).join(" / ");
    return { id: "cme-globex-" + date + "-" + group.time.replace(":", "") + "-" + group.type, date, time: group.time, title,
      detail: codes + " · Globex 撮合时段", category: "market", kind: group.type === "closed" && group.time < "17:00" ? "earlyClose" : "marketCheck",
      impact: group.type === "paused" || group.time < "17:00" ? 4 : 3, status: "confirmed", source: "cme",
      url: sourceIndex.cme.url, officialDate };
  });
  for (const event of events) if (event.id.endsWith("-open")) event.detail += " · 交易日期见 CME 日历";
  return { id: "cme", events, officialUpdate: officialDate };
}
