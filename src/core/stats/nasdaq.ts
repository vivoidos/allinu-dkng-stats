// When Nasdaq is open, for splitting DKNG volume into trading while it is open and while it is closed.
// Nasdaq's regular session: 9:30–16:00 New York time on weekdays, except exchange holidays (13:00 close
// on early-close days). Pre-market and after-hours count as closed. The table runs to NASDAQ_CALENDAR_END:
// past it, the volume block fails until the next year's holidays are added, instead of quietly miscounting.

const NASDAQ_CALENDAR_END = "2027-12-31";
const NASDAQ_HOLIDAYS = new Set(["2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"]);
const NASDAQ_EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);
const newYorkClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" });

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** New York weekday (Mon = 0) and hour for a unix time in seconds. */
export function newYorkHour(sec: number) {
  const p = Object.fromEntries(newYorkClock.formatToParts(new Date(sec * 1000)).map((x) => [x.type, x.value]));
  return { weekday: WEEKDAYS.indexOf(p.weekday ?? ""), hour: Number(p.hour) };
}

/** Share of the hour starting at `sec` (unix seconds) that falls inside Nasdaq's regular session. */
export function nasdaqOpenShare(sec: number): number {
  const p = Object.fromEntries(newYorkClock.formatToParts(new Date(sec * 1000)).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  if (day > NASDAQ_CALENDAR_END) throw new Error(`Nasdaq holiday table ends ${NASDAQ_CALENDAR_END}: add the next year's holidays to nasdaq.ts`);
  if (p.weekday === "Sat" || p.weekday === "Sun" || NASDAQ_HOLIDAYS.has(day)) return 0;
  const hour = Number(p.hour);
  const close = NASDAQ_EARLY_CLOSE.has(day) ? 13 : 16;
  // New York is a whole number of hours from UTC, so hourly candles start on the hour there too:
  // only the 9:00 candle straddles the open.
  return hour === 9 ? 0.5 : hour >= 10 && hour < close ? 1 : 0;
}
