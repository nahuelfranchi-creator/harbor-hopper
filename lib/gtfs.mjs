// Parse an official GTFS zip into a per-pair schedule index.
import { unzip } from './zip.mjs';
import { parseCsv } from './csv.mjs';
import { gtfsSecs, dowOf } from './time.mjs';

const DAY_COLS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** GTFS route_type -> human mode. 3 = bus (used for shuttle legs), 4 = ferry. */
export function modeOf(routeType) {
  const t = Number(routeType);
  if (t === 3 || (t >= 700 && t < 800)) return 'shuttle bus';
  if (t === 4 || t === 1200) return 'ferry';
  return 'other';
}

export function buildGtfsIndex(zipBuf) {
  const files = unzip(zipBuf);
  const read = (n) => (files[n] ? parseCsv(files[n].toString('utf8')) : []);

  const routes = new Map();
  for (const r of read('routes.txt')) {
    routes.set(r.route_id, {
      id: r.route_id, short: r.route_short_name, long: r.route_long_name,
      mode: modeOf(r.route_type), color: r.route_color,
    });
  }

  const trips = new Map();
  for (const t of read('trips.txt')) {
    trips.set(t.trip_id, { id: t.trip_id, routeId: t.route_id, serviceId: t.service_id, headsign: t.trip_headsign, stops: [] });
  }
  for (const s of read('stop_times.txt')) {
    const trip = trips.get(s.trip_id);
    if (!trip) continue;
    trip.stops.push({
      tag: Number(s.stop_id), seq: Number(s.stop_sequence),
      dep: gtfsSecs(s.departure_time || s.arrival_time),
      pickup: s.pickup_type !== '1', drop: s.drop_off_type !== '1',
    });
  }

  // Per-pair index: every (origin, later stop) on a trip, honoring pickup/drop-off rules.
  const pairs = new Map();
  for (const trip of trips.values()) {
    trip.stops.sort((a, b) => a.seq - b.seq);
    const st = trip.stops;
    for (let i = 0; i < st.length; i++) {
      if (!st[i].pickup) continue;
      for (let j = i + 1; j < st.length; j++) {
        if (!st[j].drop || st[j].tag === st[i].tag) continue;
        const k = `${st[i].tag}|${st[j].tag}`;
        if (!pairs.has(k)) pairs.set(k, []);
        pairs.get(k).push({ tripId: trip.id, dep: st[i].dep });
      }
    }
  }

  const calendar = new Map(read('calendar.txt').map((c) => [c.service_id, c]));
  const exceptions = new Map(); // ymd -> Map(serviceId -> type)
  for (const d of read('calendar_dates.txt')) {
    if (!exceptions.has(d.date)) exceptions.set(d.date, new Map());
    exceptions.get(d.date).set(d.service_id, d.exception_type);
  }

  // Fare: GTFS semantics -- with no fare_rules.txt, a single fare applies to every trip in the feed.
  const fares = read('fare_attributes.txt');
  const fareRules = read('fare_rules.txt');
  let feedFare = null;
  if (fares.length === 1 && fareRules.length === 0 && fares[0].price) {
    feedFare = { price: Number(fares[0].price), currency: fares[0].currency_type || 'USD' };
  }
  const feedInfo = read('feed_info.txt')[0] || {};

  const servicesOn = (ymd) => {
    const active = new Set();
    const col = DAY_COLS[dowOf(ymd)];
    for (const c of calendar.values()) {
      if (c[col] === '1' && c.start_date <= ymd && ymd <= c.end_date) active.add(c.service_id);
    }
    const ex = exceptions.get(ymd);
    if (ex) for (const [sid, type] of ex) type === '1' ? active.add(sid) : active.delete(sid);
    return active;
  };

  /** Removed-by-exception services for a date (used to explain holiday closures honestly). */
  const removedOn = (ymd) => {
    const ex = exceptions.get(ymd);
    return ex ? [...ex].filter(([, t]) => t === '2').map(([sid]) => sid) : [];
  };

  /** Departures for origin->dest on a service date, sorted. */
  const departures = (a, b, ymd) => {
    const list = pairs.get(`${a}|${b}`) || [];
    const active = servicesOn(ymd);
    const out = [];
    const seen = new Set();
    for (const p of list) {
      const trip = trips.get(p.tripId);
      if (!active.has(trip.serviceId)) continue;
      const route = routes.get(trip.routeId) || {};
      const key = `${p.dep}|${route.mode}`;
      if (seen.has(key)) continue; // same boat time listed by two overlapping trips
      seen.add(key);
      out.push({ secs: p.dep, tripId: p.tripId, routeId: trip.routeId, mode: route.mode || 'ferry', headsign: trip.headsign });
    }
    return out.sort((x, y) => x.secs - y.secs);
  };

  /** Which services on a pair are scheduled at all (any date), for honest reasons. */
  const pairServiceIds = (a, b) => new Set((pairs.get(`${a}|${b}`) || []).map((p) => trips.get(p.tripId).serviceId));

  return {
    routes, trips, pairs, calendar, feedFare, feedInfo,
    stopNames: new Map(read('stops.txt').map((s) => [Number(s.stop_id), s.stop_name])),
    servicesOn, removedOn, departures, pairServiceIds,
    stopTags: new Set([...trips.values()].flatMap((t) => t.stops.map((s) => s.tag))),
  };
}
