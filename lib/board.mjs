// Pure decision logic for the top card and the schedule section.
// No network access here -- every input is passed in, so it is fully testable.
import { addDays, dowOf, isWeekend, prettyDate, fmtClock, DOW_NAMES } from './time.mjs';
import { labelMatchesStop } from '../public/shared/names.mjs';

export const STATE = {
  LIVE: 'LIVE',
  NEXT_BOAT_TODAY: 'NEXT_BOAT_TODAY', // schedule-only, boat exists today
  CANT_CHECK: 'CANT_CHECK',
  NO_MORE_TODAY: 'NO_MORE_TODAY',
  NO_BOATS_TODAY: 'NO_BOATS_TODAY',   // shown as "NO BOATS RIGHT NOW" -- only when no boat today at all
  NO_TIMETABLE: 'NO_TIMETABLE',
  NO_DIRECT_FERRY: 'NO_DIRECT_FERRY',
};

const LOOKAHEAD_DAYS = 14;

/** Live trips on the origin board that the feed CONFIRMS will reach `to`. */
export function confirmLive({ live, gtfs, from, to, nowSecs }) {
  const confirmed = [];
  if (!live || !gtfs) return confirmed;
  const stopName = (tag) => gtfs.stopNames?.get(tag);
  const feedRouteNos = new Set([...gtfs.routes.values()].map((r) => String(r.short)));
  for (const r of live.routes) {
    if (!feedRouteNos.has(r.no)) continue; // merged boards can carry another operator's boats
    for (const d of r.destinations) {
      const segs = String(d.name || '').split('→').map((s) => s.trim()).filter(Boolean);
      for (const t of d.trips) {
        const mins = t.etd ?? t.eta;
        if (mins == null) continue; // a scheduled placeholder on the board, not a live estimate
        const gt = gtfs.trips.get(t.tripId);
        if (!gt) continue; // can't identify the boat -> never invent a confirmation
        const iO = gt.stops.findIndex((s) => s.tag === from.tag && s.pickup);
        if (iO < 0) continue;
        const iD = gt.stops.findIndex((s, i) => i > iO && s.tag === to.tag && s.drop);
        if (iD < 0) continue;
        // The board names where the boat is headed next (one or more "→" stops), not always its
        // final stop. Find the furthest downstream stop the label actually names; only stops up
        // to that one are confirmed. If the label names nothing we can place, confirm nothing.
        let furthest = -1;
        for (let i = iO + 1; i < gt.stops.length; i++) {
          const name = stopName(gt.stops[i].tag);
          if (name && segs.some((seg) => labelMatchesStop(seg, name))) furthest = i;
        }
        if (furthest < iD) continue;
        const depSecs = nowSecs + mins * 60;
        if (depSecs < nowSecs - 60) continue;
        const schedSecs = t.scheduledMin != null ? t.scheduledMin * 60 : gt.stops[iO].dep;
        let delay = Math.round((depSecs - schedSecs) / 60);
        if (delay > 720) delay -= 1440;
        if (delay < -720) delay += 1440;
        const route = gtfs.routes.get(gt.routeId) || {};
        confirmed.push({ tripId: t.tripId, depSecs, schedSecs, delayMin: delay, mode: route.mode || 'ferry', routeNo: r.no });
      }
    }
  }
  return confirmed.sort((a, b) => a.depSecs - b.depSecs);
}

/** Where the board's live boats actually go right now (single merged list). */
export function liveBoardDestinations(live) {
  if (!live) return [];
  const names = new Set();
  for (const r of live.routes) for (const d of r.destinations) {
    if (d.trips.some((t) => (t.etd ?? t.eta) != null)) names.add(d.name);
  }
  return [...names];
}

export function boardIsEmpty(live) {
  return !live || !live.routes.some((r) => r.destinations.some((d) => d.trips.some((t) => (t.etd ?? t.eta) != null)));
}

/** First day (after today) with service for the pair, from the official schedule. */
export function nextService(gtfs, from, to, ymd) {
  for (let d = 1; d <= LOOKAHEAD_DAYS; d++) {
    const day = addDays(ymd, d);
    const deps = gtfs.departures(from.tag, to.tag, day);
    if (deps.length) return { ymd: day, dateLabel: d === 1 ? 'Tomorrow' : prettyDate(day), clock: fmtClock(deps[0].secs), mode: deps[0].mode };
  }
  return null;
}

/** Verified reason for no boats today -- or null (never fabricate a cause). */
export function noServiceReason(gtfs, from, to, ymd) {
  const dows = new Set();
  for (let d = 0; d < LOOKAHEAD_DAYS; d++) {
    const day = addDays(ymd, d);
    if (gtfs.departures(from.tag, to.tag, day).length) dows.add(dowOf(day));
  }
  const today = dowOf(ymd);
  if (dows.size && !dows.has(today)) {
    const all = [...dows];
    if (all.every((x) => !isWeekend(x)) && isWeekend(today)) return 'No weekend service — this route runs weekdays only (Mon–Fri).';
    if (all.every((x) => isWeekend(x)) && !isWeekend(today)) return 'No weekday service — this route runs weekends only (Sat–Sun).';
  }
  const removed = new Set(gtfs.removedOn(ymd));
  const pairSids = gtfs.pairServiceIds(from.tag, to.tag);
  if ([...pairSids].some((s) => removed.has(s))) return 'The official schedule lists no service on this date (service exception, e.g. a holiday).';
  return null;
}

const depItem = (x, nowSecs, nowMs, badge) => ({
  clock: fmtClock(x.depSecs ?? x.secs),
  depAtMs: nowMs + ((x.depSecs ?? x.secs) - nowSecs) * 1000,
  badge,
  delayMin: badge === 'LIVE' ? x.delayMin : null,
  scheduledClock: badge === 'LIVE' ? fmtClock(x.schedSecs) : null,
  mode: x.mode || 'ferry',
});

/**
 * Top card. Inputs:
 *  now: { ymd, secs, ms }, from/to: stop records, inNetwork: bool, goesTo: [names],
 *  gtfs: feed index (or null), live: board (or null), liveError: bool
 */
export function computeTopCard({ now, from, to, inNetwork, goesTo = [], gtfs, live, liveError = false }) {
  const base = { from: from.name, to: to.name };
  if (!inNetwork) {
    return { ...base, state: STATE.NO_DIRECT_FERRY, badge: null, heading: 'NO DIRECT FERRY',
      message: goesTo.length ? `Boats from ${from.name} go to: ${goesTo.join(', ')}.` : `No published destinations from ${from.name}.` };
  }
  const hasTimetable = !!gtfs && gtfs.pairs.has(`${from.tag}|${to.tag}`);
  const todayAll = hasTimetable ? gtfs.departures(from.tag, to.tag, now.ymd) : [];
  const remaining = todayAll.filter((d) => d.secs >= now.secs - 30);
  const confirmed = confirmLive({ live, gtfs, from, to, nowSecs: now.secs });
  const liveTripIds = new Set(confirmed.map((c) => c.tripId));
  const empty = liveError || boardIsEmpty(live);
  const why = liveBoardDestinations(live);

  const thenList = (skipFirst) => {
    const items = [
      ...confirmed.map((c) => ({ ...c, _b: 'LIVE' })),
      ...remaining.filter((d) => !liveTripIds.has(d.tripId)).map((d) => ({ ...d, depSecs: d.secs, _b: 'SCHEDULE' })),
    ].sort((a, b) => a.depSecs - b.depSecs);
    return items.slice(skipFirst ? 1 : 0, (skipFirst ? 1 : 0) + 4).map((x) => depItem(x, now.secs, now.ms, x._b));
  };

  if (confirmed.length) {
    const next = depItem(confirmed[0], now.secs, now.ms, 'LIVE');
    return { ...base, state: STATE.LIVE, badge: 'LIVE', heading: `NEXT ${next.mode === 'shuttle bus' ? 'SHUTTLE BUS' : 'BOAT'}`,
      next, then: thenList(true),
      message: next.delayMin > 0 ? `Scheduled ${next.scheduledClock} — running late` : null };
  }

  if (!hasTimetable) {
    return { ...base, state: STATE.NO_TIMETABLE, badge: null, heading: 'NO VERIFIED TIMETABLE',
      message: `No verified timetable for this route, so its official schedule can't be shown.${empty ? ' The live board is empty right now, so live times can\'t be checked either.' : ' No live boat is confirmed for this destination right now.'}` };
  }

  if (remaining.length) {
    const first = { ...remaining[0], depSecs: remaining[0].secs };
    const next = depItem(first, now.secs, now.ms, 'SCHEDULE');
    if (empty) {
      return { ...base, state: STATE.CANT_CHECK, badge: 'SCHEDULE', heading: "CAN'T CHECK RIGHT NOW", next, then: thenList(true),
        message: `The live board for ${from.name} is empty, so this boat can't be confirmed either way. Next boat per the official schedule: ${next.clock}.` };
    }
    return { ...base, state: STATE.NEXT_BOAT_TODAY, badge: 'SCHEDULE', heading: `NEXT ${next.mode === 'shuttle bus' ? 'SHUTTLE BUS' : 'BOAT'} TODAY AT ${next.clock}`,
      next, then: thenList(true),
      message: `This time is from the official schedule and isn't confirmed live for ${to.name} yet. It switches to LIVE when the live feed confirms it.`,
      why: why.length ? `Live board right now shows boats to: ${why.join(', ')}.` : null };
  }

  const ns = nextService(gtfs, from, to, now.ymd);
  const nextLine = ns ? `Next boat: ${ns.dateLabel} at ${ns.clock} (official schedule).` : 'No upcoming boat found in the official schedule for the next two weeks.';
  const nextServiceItem = ns ? { clock: ns.clock, dateLabel: ns.dateLabel, badge: 'SCHEDULE', mode: ns.mode } : null;
  if (todayAll.length) {
    return { ...base, state: STATE.NO_MORE_TODAY, badge: 'SCHEDULE', heading: 'No more boats today.', nextService: nextServiceItem,
      message: `The last boat today left at ${fmtClock(todayAll[todayAll.length - 1].secs)}. ${nextLine}` };
  }
  const reason = noServiceReason(gtfs, from, to, now.ymd);
  return { ...base, state: STATE.NO_BOATS_TODAY, badge: 'SCHEDULE', heading: 'NO BOATS RIGHT NOW', nextService: nextServiceItem,
    reason, message: `${reason ? reason + ' ' : 'No boats today per the official schedule. '}${nextLine}` };
}

/** Representative real date for a day type, starting today, that has service (or the first such date). */
function representativeDay(gtfs, from, to, ymd, dayType) {
  const wantWeekend = dayType === 'weekend';
  let firstOfType = null;
  for (let d = 0; d < LOOKAHEAD_DAYS; d++) {
    const day = addDays(ymd, d);
    if (isWeekend(dowOf(day)) !== wantWeekend) continue;
    firstOfType ??= day;
    const deps = gtfs.departures(from.tag, to.tag, day);
    if (deps.length) return { ymd: day, deps };
  }
  return { ymd: firstOfType, deps: [] };
}

/** Detect a lopsided weekend timetable (one direction far thinner than its reverse) from the data. */
export function weekendLooksIncomplete(gtfs, from, to, ymd) {
  const count = (a, b, type) => representativeDay(gtfs, a, b, ymd, type).deps.length;
  const we = count(from, to, 'weekend'), weRev = count(to, from, 'weekend');
  const wd = count(from, to, 'weekday'), wdRev = count(to, from, 'weekday');
  const balancedWeekday = Math.min(wd, wdRev) > 0 && Math.min(wd, wdRev) / Math.max(wd, wdRev) >= 0.8;
  if (balancedWeekday && weRev > 0 && we < 0.5 * weRev) return { thisWay: we, otherWay: weRev };
  return null;
}

/**
 * Bottom section: OFFICIAL SCHEDULE ONLY (never live data).
 * crossCheck: { attempted, ok, url } result of the official-page cross-check, if relevant.
 */
export function computeSchedule({ now, from, to, inNetwork, gtfs, dayType, crossCheck = null, dockNote = null }) {
  const label = dayType === 'weekend' ? 'Weekend' : 'Weekday';
  if (!inNetwork || !gtfs || !gtfs.pairs.has(`${from.tag}|${to.tag}`)) {
    return { found: false, dayType, title: 'Full timetable · official schedule',
      message: "No verified timetable for this route, so its official schedule can't be shown." };
  }
  const rep = representativeDay(gtfs, from, to, now.ymd, dayType);
  if (!rep.deps.length) {
    const other = representativeDay(gtfs, from, to, now.ymd, dayType === 'weekend' ? 'weekday' : 'weekend');
    const message = other.deps.length
      ? (dayType === 'weekend' ? 'No weekend schedule — this route runs weekdays only (Mon–Fri).' : 'No weekday schedule — this route runs weekends only (Sat–Sun).')
      : `No ${label.toLowerCase()} schedule found for this route in the official timetable.`;
    return { found: false, dayType, title: 'Full timetable · official schedule', message };
  }
  const notes = [];
  if (dockNote) notes.push(dockNote);
  if (rep.deps.some((d) => d.mode === 'shuttle bus')) notes.push('Some legs on this route are a shuttle bus, not a ferry (per the official feed).');
  if (dayType === 'weekend') {
    const inc = weekendLooksIncomplete(gtfs, from, to, now.ymd);
    if (inc) {
      notes.push(`Heads up: the official weekend data looks incomplete for this direction (${inc.thisWay} ${inc.thisWay === 1 ? 'boat' : 'boats'} listed vs ${inc.otherWay} the other way), so some boats may be missing.` +
        (crossCheck?.attempted && !crossCheck.ok ? ` We tried to cross-check the official timetable page, but it couldn't be checked automatically — please confirm late boats at ${crossCheck.url}.` : ''));
    }
  }
  return {
    found: true, dayType, title: 'Full timetable · official schedule',
    dayLabel: `${label} schedule · ${DOW_NAMES[dowOf(rep.ymd)]}`,
    dateLabel: prettyDate(rep.ymd),
    times: rep.deps.map((d) => ({ clock: fmtClock(d.secs), mode: d.mode })),
    notes,
  };
}
