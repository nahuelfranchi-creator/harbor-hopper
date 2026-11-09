// Time helpers pinned to New York local time.
import { TIMEZONE } from './config.mjs';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'long',
});

/** Local NY clock for a Date: { ymd:'20261109', dow:0-6 (0=Sun), weekday:'Monday', secs } */
export function nyClock(date = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  const dows = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return {
    ymd: `${p.year}${p.month}${p.day}`,
    weekday: p.weekday,
    dow: dows.indexOf(p.weekday),
    secs: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second),
  };
}

/** Add days to a YYYYMMDD string (calendar arithmetic, timezone-free). */
export function addDays(ymd, n) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + n));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function dowOf(ymd) {
  return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay();
}

export const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const isWeekend = (dow) => dow === 0 || dow === 6;

export function prettyDate(ymd) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
}

/** "HH:MM:SS" (may exceed 24h in GTFS) -> seconds after service-day midnight. */
export function gtfsSecs(t) {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

/** seconds after midnight -> "9:05 PM" (wraps past 24h). */
export function fmtClock(secs) {
  const total = Math.round(secs / 60);
  let h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}
