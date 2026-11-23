import { createRoot } from "react-dom/client";
import Desk from "./desk";
import { isWeek, newYorkDate, weekOf } from "./model";
import { seedCalendar } from "./seed";
import "./globals.css";

const now = new Date();
const currentWeek = weekOf(newYorkDate(now));
const requested = new URLSearchParams(location.search).get("week");
const initial = seedCalendar(isWeek(requested) ? requested : currentWeek);

createRoot(document.getElementById("root")!).render(
  <Desk initial={initial} currentWeek={currentWeek} renderedAt={now.toISOString()} />,
);
