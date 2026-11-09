// Live data orchestration: stops, route network, GTFS schedules, live boards.
// Everything here is fetched at runtime and cached; nothing is embedded.
import { FEEDS, CNX, NY_BOX, DEFAULT_ROUTE, CROSS_CHECK_PAGES, INTERVALS } from './config.mjs';
import { fetchPlatforms, fetchPlatformRoutes, fetchLiveBoard, pool } from './cnx.mjs';
import { buildGtfsIndex } from './gtfs.mjs';
import { nyClock } from './time.mjs';
import { tokens, nameContains } from '../public/shared/names.mjs';

export const inNyBox = (lat, lon) =>
  lat >= NY_BOX.minLat && lat <= NY_BOX.maxLat && lon >= NY_BOX.minLon && lon <= NY_BOX.maxLon;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const feedByKey = Object.fromEntries(FEEDS.map((f) => [f.key, f]));

// ---------- GTFS ----------
const gtfsCache = new Map(); // feedKey -> { index, fetchedAt, error }

async function downloadGtfs(feed) {
  const res = await fetch(feed.gtfsUrl, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`GTFS ${feed.key} HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function refreshGtfs(feedKey, { force = false } = {}) {
  const feed = feedByKey[feedKey];
  const cur = gtfsCache.get(feedKey);
  if (!force && cur?.index && Date.now() - cur.fetchedAt < INTERVALS.gtfsMaxAgeMs) return cur.index;
  try {
    const index = buildGtfsIndex(await downloadGtfs(feed));
    if (index.pairs.size === 0) throw new Error('parsed zero pairs'); // never overwrite a good copy with nothing
    gtfsCache.set(feedKey, { index, fetchedAt: Date.now(), error: null });
    log(`GTFS ${feedKey}: ${index.trips.size} trips, ${index.pairs.size} pairs (feed version ${index.feedInfo.feed_version || '?'})`);
    return index;
  } catch (e) {
    log(`GTFS ${feedKey} refresh failed: ${e.message}${cur?.index ? ' (keeping last good copy)' : ''}`);
    gtfsCache.set(feedKey, { ...(cur || {}), error: e.message, fetchedAt: cur?.fetchedAt ?? 0 });
    return cur?.index ?? null;
  }
}

export const getGtfs = (feedKey) => refreshGtfs(feedKey);

// Early-morning refresh, checked every 10 minutes.
let lastDailyRefresh = null;
export function startDailyRefresh() {
  setInterval(async () => {
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(now));
    const day = nyClock(now).ymd;
    if (hour === INTERVALS.gtfsDailyRefreshHourET && lastDailyRefresh !== day) {
      lastDailyRefresh = day;
      for (const f of FEEDS) await refreshGtfs(f.key, { force: true });
      networkCache.builtAt = 0; // rebuild network against the fresh timetables (platformroutes still cached)
    }
  }, 10 * 60 * 1000).unref();
}

// ---------- Stops (platforms API, geo-filtered) ----------
let stopsCache = { stops: null, fetchedAt: 0 };

export async function getStops() {
  if (stopsCache.stops && Date.now() - stopsCache.fetchedAt < INTERVALS.platformsMaxAgeMs) return stopsCache.stops;
  const results = await pool(FEEDS, 2, (f) => fetchPlatforms(f.liveDomain));
  const byFeed = Object.fromEntries(FEEDS.map((f, i) => [f.key, results[i].ok ? results[i].value : null]));
  if (!byFeed.nyw && !byFeed.nycf) {
    if (stopsCache.stops) return stopsCache.stops;
    throw new Error('Stop list unavailable from the live platforms API');
  }
  // The board-link domain (nywaterway) is a merged system that lists every stop; use it for board IDs.
  const boardList = byFeed.nyw || [];
  const boardIdByCode = new Map(boardList.map((p) => [String(p.no), p.tag]));
  const nycfCodes = new Set((byFeed.nycf || []).map((p) => String(p.no)));
  const stops = [];
  for (const p of byFeed.nycf || []) {
    if (!inNyBox(p.lat, p.long)) continue;
    stops.push({ id: `nycf:${p.tag}`, feed: 'nycf', operator: feedByKey.nycf.label, tag: p.tag, code: String(p.no),
      name: p.name, lat: p.lat, lon: p.long, boardId: boardIdByCode.get(String(p.no)) ?? null });
  }
  for (const p of byFeed.nyw || []) {
    if (!inNyBox(p.lat, p.long) || nycfCodes.has(String(p.no))) continue;
    stops.push({ id: `nyw:${p.tag}`, feed: 'nyw', operator: feedByKey.nyw.label, tag: p.tag, code: String(p.no),
      name: p.name, lat: p.lat, lon: p.long, boardId: p.tag });
  }
  stops.sort((a, b) => a.name.localeCompare(b.name));
  stopsCache = { stops, fetchedAt: Date.now() };
  log(`Stops: ${stops.length} in the NY-metro box`);
  return stops;
}

// ---------- Route network (platformroutes, cached one week) ----------
const networkCache = { network: null, builtAt: 0, building: null };
const platformRoutesCache = new Map(); // stopId -> { routes, fetchedAt }

async function publishedRoutes(stop) {
  const c = platformRoutesCache.get(stop.id);
  if (c && Date.now() - c.fetchedAt < INTERVALS.networkMaxAgeMs) return c.routes;
  const routes = await fetchPlatformRoutes(feedByKey[stop.feed].liveDomain, stop.tag);
  platformRoutesCache.set(stop.id, { routes, fetchedAt: Date.now() });
  return routes;
}

async function buildNetwork() {
  const stops = await getStops();
  const byFeedTag = new Map(stops.map((s) => [`${s.feed}:${s.tag}`, s]));
  const gtfs = Object.fromEntries(await Promise.all(FEEDS.map(async (f) => [f.key, await getGtfs(f.key)])));
  const published = await pool(stops, 6, publishedRoutes);
  const edges = {}, modes = {};
  stops.forEach((origin, i) => {
    const idx = gtfs[origin.feed];
    if (!idx) return;
    const pub = published[i].ok ? new Set(published[i].value.map((r) => r.no)) : null; // null = endpoint failed
    for (const [key, list] of idx.pairs) {
      const [a, b] = key.split('|').map(Number);
      if (a !== origin.tag) continue;
      const dest = byFeedTag.get(`${origin.feed}:${b}`);
      if (!dest || dest.id === origin.id) continue; // out-of-box or unknown stop: drop the edge
      const routeShorts = new Set(list.map((p) => idx.routes.get(idx.trips.get(p.tripId).routeId)?.short));
      if (pub && ![...routeShorts].some((r) => pub.has(String(r)))) continue; // not in the published network
      (edges[origin.id] ||= []).push(dest.id);
      modes[`${origin.id}|${dest.id}`] = [...new Set(list.map((p) => idx.routes.get(idx.trips.get(p.tripId).routeId)?.mode))];
    }
  });
  const edgeCount = Object.values(edges).reduce((n, l) => n + l.length, 0);
  if (!edgeCount) throw new Error('Route network came back empty');
  log(`Network: ${Object.keys(edges).length} origins, ${edgeCount} direct pairs`);
  return { edges, modes };
}

export async function getNetwork({ wait = true } = {}) {
  const fresh = networkCache.network && Date.now() - networkCache.builtAt < INTERVALS.networkMaxAgeMs;
  if (fresh) return networkCache.network;
  if (!networkCache.building) {
    networkCache.building = buildNetwork()
      .then((n) => { networkCache.network = n; networkCache.builtAt = Date.now(); return n; })
      .catch((e) => { log(`Network build failed: ${e.message}`); return networkCache.network; })
      .finally(() => { networkCache.building = null; });
  }
  return wait ? networkCache.building : networkCache.network;
}

export const hasEdge = (network, a, b) => !!network?.edges[a]?.includes(b);

// ---------- Name resolution, twins, defaults ----------
const metersBetween = (a, b) => {
  const R = 6371000, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Twin record of the same terminal: very close by AND one name contains the other (one extra token). */
export function isTwin(a, b) {
  if (a.id === b.id || metersBetween(a, b) > 300) return false;
  const ta = tokens(a.name), tb = tokens(b.name);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return long.length - short.length <= 1 && short.every((t) => long.includes(t));
}

/** Resolve a picked pair, following a same-terminal twin when boats really dock there. */
export function resolvePair(stops, network, fromId, toId) {
  const from = stops.find((s) => s.id === fromId), to = stops.find((s) => s.id === toId);
  if (!from || !to) return null;
  if (hasEdge(network, from.id, to.id)) return { from, to, dockNote: null };
  const twin = (network?.edges[from.id] || []).map((id) => stops.find((s) => s.id === id)).find((s) => s && isTwin(s, to));
  if (twin) return { from, to: twin, dockNote: `Boats on this route actually dock at ${twin.name} — this is that stop's official schedule.` };
  return { from, to, dockNote: null };
}

export function resolveDefaults(stops, network) {
  const fromC = stops.filter((s) => nameContains(s.name, DEFAULT_ROUTE.from));
  const toC = stops.filter((s) => nameContains(s.name, DEFAULT_ROUTE.to));
  let best = null;
  for (const f of fromC) for (const t of toC) {
    const score = (hasEdge(network, f.id, t.id) ? 2 : 0) + (hasEdge(network, t.id, f.id) ? 1 : 0);
    if (!best || score > best.score) best = { from: f.id, to: t.id, score };
  }
  return best ? { from: best.from, to: best.to } : null;
}

// ---------- Live boards ----------
const liveCache = new Map(); // stopId -> { board, error, fetchedAt }

export async function getLive(stop) {
  const c = liveCache.get(stop.id);
  if (c && Date.now() - c.fetchedAt < INTERVALS.liveMaxAgeMs) return c;
  let entry;
  try {
    entry = { board: await fetchLiveBoard(feedByKey[stop.feed].liveDomain, stop.tag), error: false, fetchedAt: Date.now() };
  } catch (e) {
    log(`Live ${stop.id} failed: ${e.message}`);
    entry = { board: null, error: true, fetchedAt: Date.now() };
  }
  liveCache.set(stop.id, entry);
  return entry;
}

// ---------- Official timetable page cross-check ----------
const crossCheckCache = new Map(); // url -> { result, fetchedAt }

export async function crossCheckFor(from, to) {
  const page = CROSS_CHECK_PAGES.find((p) =>
    (nameContains(from.name, p.a) && nameContains(to.name, p.b)) || (nameContains(from.name, p.b) && nameContains(to.name, p.a)));
  if (!page) return null;
  const c = crossCheckCache.get(page.url);
  if (c && Date.now() - c.fetchedAt < 60 * 60 * 1000) return c.result;
  let result = { attempted: true, ok: false, url: page.url };
  try {
    const res = await fetch(page.url, { signal: AbortSignal.timeout(10000) });
    const html = await res.text();
    // Bot-protection interstitials ("Just a moment...") are not the timetable.
    if (res.ok && !/just a moment|cf-challenge|captcha/i.test(html)) {
      // The page is reachable, but its layout is unverified: we do NOT scrape times we
      // can't validate (never invent a timetable). Treat as "couldn't be checked".
      result = { attempted: true, ok: false, reachable: true, url: page.url };
    }
  } catch { /* unreachable -> ok:false */ }
  crossCheckCache.set(page.url, { result, fetchedAt: Date.now() });
  return result;
}

// ---------- Footer ----------
export async function footerFor(from, to) {
  const idx = await getGtfs(from.feed);
  const fare = idx?.feedFare && from.feed === to.feed
    ? `$${idx.feedFare.price.toFixed(2)} one-way · official ${feedByKey[from.feed].label} fare`
    : 'Fares vary by route.';
  return {
    boardUrl: from.boardId != null ? CNX.boardUrl(from.boardId) : null,
    boardLabel: `Official ${from.name} board`,
    fare,
  };
}

export function feedStatus() {
  return FEEDS.map((f) => {
    const c = gtfsCache.get(f.key);
    return { feed: f.key, loaded: !!c?.index, pairs: c?.index?.pairs.size ?? 0, fetchedAt: c?.fetchedAt ?? null, error: c?.error ?? null };
  });
}
