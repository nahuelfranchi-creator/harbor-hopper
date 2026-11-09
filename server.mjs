// Harbor Hopper server: serves the page and proxies all live data server-side.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST, PORT, FEEDS, INTERVALS, APP_NAME } from './lib/config.mjs';
import {
  getStops, getNetwork, getGtfs, getLive, resolvePair, resolveDefaults, hasEdge,
  crossCheckFor, footerFor, feedStatus, startDailyRefresh,
} from './lib/data.mjs';
import { computeTopCard, computeSchedule } from './lib/board.mjs';
import { nyClock } from './lib/time.mjs';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function pairContext(url) {
  const [stops, network] = await Promise.all([getStops(), getNetwork()]);
  const pair = resolvePair(stops, network, url.searchParams.get('from'), url.searchParams.get('to'));
  if (!pair) return { error: 'Unknown stop' };
  const gtfs = await getGtfs(pair.from.feed);
  const inNetwork = hasEdge(network, pair.from.id, pair.to.id);
  const goesTo = (network?.edges[pair.from.id] || []).map((id) => stops.find((s) => s.id === id)?.name).filter(Boolean);
  const clock = nyClock();
  return { ...pair, gtfs, inNetwork, goesTo, now: { ...clock, ms: Date.now() } };
}

const routes = {
  async '/api/meta'(req, res) {
    const stops = await getStops();
    const network = await getNetwork({ wait: req.url.includes('wait=1') });
    json(res, 200, {
      app: APP_NAME,
      stops: stops.map(({ id, name, lat, lon, operator }) => ({ id, name, lat, lon, operator })),
      network: network ? { ready: true, edges: network.edges, modes: network.modes } : { ready: false },
      defaults: network ? resolveDefaults(stops, network) : null,
      refreshMs: INTERVALS.clientRefreshMs,
    });
  },

  async '/api/board'(req, res, url) {
    const ctx = await pairContext(url);
    if (ctx.error) return json(res, 400, ctx);
    const live = ctx.inNetwork ? await getLive(ctx.from) : { board: null, error: false };
    const top = computeTopCard({ ...ctx, live: live.board, liveError: live.error });
    if (ctx.dockNote) top.dockNote = ctx.dockNote;
    json(res, 200, { top, footer: await footerFor(ctx.from, ctx.to), updatedAt: Date.now() });
  },

  async '/api/schedule'(req, res, url) {
    const ctx = await pairContext(url);
    if (ctx.error) return json(res, 400, ctx);
    const dayType = url.searchParams.get('day') === 'weekend' ? 'weekend' : 'weekday';
    const crossCheck = dayType === 'weekend' ? await crossCheckFor(ctx.from, ctx.to) : null;
    json(res, 200, computeSchedule({ ...ctx, dayType, crossCheck }));
  },

  async '/api/health'(req, res) {
    const network = await getNetwork({ wait: false });
    json(res, 200, { feeds: feedStatus(), networkReady: !!network });
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (routes[url.pathname]) return await routes[url.pathname](req, res, url);
    let path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = normalize(join(PUBLIC, decodeURIComponent(path)));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); } // no path traversal
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404); return res.end('Not found'); }
    console.error(e);
    json(res, 502, { error: 'Live data is unavailable right now.', detail: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`${APP_NAME} running at http://${HOST}:${PORT}`);
  // Warm caches in the background.
  Promise.all(FEEDS.map((f) => getGtfs(f.key))).then(() => getNetwork()).catch((e) => console.error(e));
  startDailyRefresh();
});
