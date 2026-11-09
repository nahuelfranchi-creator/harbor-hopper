// Live coverage smoke test against the REAL feeds (needs internet). Run: npm run test:live
// No expected times are hardcoded: we only check structure, ordering, and honesty.
import { FEEDS } from '../lib/config.mjs';
import { refreshGtfs, getStops, getNetwork, getLive, inNyBox } from '../lib/data.mjs';
import { computeTopCard, computeSchedule, STATE } from '../lib/board.mjs';
import { nyClock } from '../lib/time.mjs';
import { roundTripOrigins, origins } from '../public/shared/pickers.mjs';

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '✔' : '✘'} ${msg}`); if (!ok) failures++; };

for (const f of FEEDS) {
  const idx = await refreshGtfs(f.key, { force: true });
  check(idx && idx.pairs.size > 0, `GTFS ${f.label} downloaded and parsed (${idx?.pairs.size ?? 0} pairs)`);
}
const stops = await getStops();
check(stops.length > 0 && stops.every((s) => inNyBox(s.lat, s.lon)), `${stops.length} stops, all inside the NY-metro box`);
const net = await getNetwork();
check(!!net, 'Route network built from platformroutes');
const ids = new Set(stops.map((s) => s.id));
check(Object.entries(net.edges).every(([a, l]) => ids.has(a) && l.every((b) => ids.has(b) && b !== a)), 'No edge touches an out-of-box/unknown stop or loops to itself');
console.log(`  origins: ${origins(net).length}, round-trip origins: ${roundTripOrigins(net).length}`);

const now = { ...nyClock(), ms: Date.now() };
const byId = Object.fromEntries(stops.map((s) => [s.id, s]));
const pairs = Object.entries(net.edges).flatMap(([a, l]) => l.map((b) => [a, b]));
const sample = pairs.filter((_, i) => i % Math.max(1, Math.floor(pairs.length / 40)) === 0);
let crashes = 0, live = 0, sched = 0, honest = 0;
for (const [a, b] of sample) {
  const from = byId[a], to = byId[b];
  try {
    const gtfs = await refreshGtfs(from.feed);
    const lv = await getLive(from);
    const t = computeTopCard({ now, from, to, inNetwork: true, gtfs, live: lv.board, liveError: lv.error });
    if (t.state === STATE.NO_DIRECT_FERRY) throw new Error('NO DIRECT FERRY on a network-listed pair');
    if (t.state === STATE.LIVE) live++;
    for (const day of ['weekday', 'weekend']) {
      const s = computeSchedule({ now, from, to, inNetwork: true, gtfs, dayType: day });
      if (s.found) {
        const toMin = (c) => { const [h, m] = c.split(/[: ]/); return ((+h % 12) + (c.endsWith('PM') ? 12 : 0)) * 60 + +m; };
        const mins = s.times.map((x) => toMin(x.clock));
        // GTFS times can pass midnight; allow at most one wrap.
        const drops = mins.filter((m, i) => i && m < mins[i - 1]).length;
        if (drops > 1) throw new Error(`unsorted ${day} times`);
        if (!/· (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(s.dayLabel)) throw new Error('missing day label');
        sched++;
      } else {
        if (!s.message) throw new Error('found:false without an honest message');
        honest++;
      }
    }
  } catch (e) {
    crashes++;
    console.log(`  ✘ ${from.name} → ${to.name}: ${e.message}`);
  }
}
check(crashes === 0, `${sample.length} sampled pairs across both feeds: ${live} live now, ${sched} timetables found, ${honest} honest "no schedule" messages, ${crashes} problems`);
process.exit(failures ? 1 : 0);
