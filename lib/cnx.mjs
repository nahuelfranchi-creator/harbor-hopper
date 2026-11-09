// Server-side Connexionz client. Plain GET, no Origin header, no explicit
// `Accept: application/zip` (Connexionz 403s foreign Origins and 406s that Accept).
import { CNX } from './config.mjs';

async function cnxGet(path, { timeoutMs = 15000 } = {}) {
  const res = await fetch(`${CNX.apiBase}/${path}`, {
    method: 'GET',
    headers: { ApiKey: CNX.apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Connexionz ${path} -> HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function fetchPlatforms(domain) {
  const list = await cnxGet(`cnxlegacy/${domain}/platforms`);
  if (!Array.isArray(list) || !list.length) throw new Error(`No platforms from ${domain}`);
  return list;
}

/** Route numbers published at a platform (platformroutes endpoint). */
export async function fetchPlatformRoutes(domain, tag) {
  const data = await cnxGet(`cnxlegacy/${domain}/platformroutes/${tag}`);
  if (!Array.isArray(data)) return [];
  return data.flatMap((group) => (group.routes || []).map((r) => ({
    no: String(r.no), name: r.name,
    destinations: (r.destinations || []).map((d) => d.name),
  })));
}

/** Live departures board for one platform. Returns null when the board is empty. */
export async function fetchLiveBoard(domain, tag) {
  const data = await cnxGet(`cnxlegacy/stet/${domain}/${tag}`, { timeoutMs: 10000 });
  if (!data || !Array.isArray(data.platforms)) return null;
  return {
    maxArrivalScope: data.maxArrivalScope ?? null,
    routes: data.platforms.flatMap((p) => p.routes || []).map((r) => ({
      no: String(r.no), name: r.name, project: r.projectName,
      destinations: (r.destinations || []).map((d) => ({
        name: d.name,
        trips: (d.trips || []).map((t) => ({
          tripId: String(t.tripId), eta: t.eta, etd: t.etd, scheduledMin: t.scheduledMin,
        })),
      })),
    })),
  };
}

/** Run async jobs with a concurrency cap. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const n = i++;
      try { out[n] = { ok: true, value: await fn(items[n]) }; } catch (e) { out[n] = { ok: false, error: e }; }
    }
  }));
  return out;
}
