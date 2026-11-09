// Picker + saved-config rules, derived ONLY from the live route network.
// network = { edges: { fromId: [toId, ...] } }

export const outbound = (net, from) => (net?.edges?.[from] || []).slice();
export const hasEdge = (net, a, b) => !!net?.edges?.[a]?.includes(b);
export const isRoundTrip = (net, a, b) => hasEdge(net, a, b) && hasEdge(net, b, a);

/** Origins with at least one direct outbound destination (Round trip OFF, Custom). */
export const origins = (net) => Object.keys(net?.edges || {}).filter((o) => outbound(net, o).length);

/** Origins with at least one valid round trip (Round trip ON). Count derived at runtime. */
export const roundTripOrigins = (net) => origins(net).filter((o) => outbound(net, o).some((t) => hasEdge(net, t, o)));

/** Destinations from `from` with a direct boat back (Round trip ON). */
export const roundTripDestinations = (net, from) => outbound(net, from).filter((t) => hasEdge(net, t, from));

export const STORAGE_KEY = 'harborHopper.settings.v2';
const LEGACY_KEYS = ['harborHopper.settings', 'harborHopper'];

export function defaultConfig(defaults) {
  return { v: 2, roundTrip: true, tab1: { ...defaults }, tab2: { from: defaults.to, to: defaults.from } };
}

/** Migrate older saved shapes to v2. Names (no ":" id) are resolved through `resolveName`. */
export function migrate(raw, resolveName = () => null) {
  if (!raw || typeof raw !== 'object') return null;
  const id = (x) => (typeof x === 'string' && x.includes(':') ? x : resolveName(x));
  if (raw.v === 2 && raw.tab1) return raw;
  // v1: { from, to, roundTrip? } or { outbound:{from,to}, ret:{from,to} }
  const t1 = raw.outbound || raw.tab1 || (raw.from && raw.to ? { from: raw.from, to: raw.to } : null);
  if (!t1) return null;
  const tab1 = { from: id(t1.from), to: id(t1.to) };
  const t2 = raw.ret || raw.return || raw.tab2;
  const roundTrip = raw.roundTrip ?? !t2;
  const tab2 = t2 && !roundTrip ? { from: id(t2.from), to: id(t2.to) } : { from: tab1.to, to: tab1.from };
  return { v: 2, roundTrip, tab1, tab2 };
}

/**
 * Validate a config against the network. Invalid pairs are repaired to the default.
 * Returns { config, repaired }. Valid configs pass through untouched (same object).
 */
export function validateConfig(cfg, net, defaults) {
  const def = defaultConfig(defaults);
  if (!cfg) return { config: def, repaired: true };
  if (cfg.roundTrip) {
    if (isRoundTrip(net, cfg.tab1?.from, cfg.tab1?.to)) {
      const ok = cfg.tab2?.from === cfg.tab1.to && cfg.tab2?.to === cfg.tab1.from;
      return ok ? { config: cfg, repaired: false } : { config: { ...cfg, tab2: { from: cfg.tab1.to, to: cfg.tab1.from } }, repaired: true };
    }
    return { config: def, repaired: true };
  }
  const ok1 = hasEdge(net, cfg.tab1?.from, cfg.tab1?.to);
  const ok2 = hasEdge(net, cfg.tab2?.from, cfg.tab2?.to);
  if (ok1 && ok2) return { config: cfg, repaired: false };
  return { config: { ...cfg, tab1: ok1 ? cfg.tab1 : def.tab1, tab2: ok2 ? cfg.tab2 : def.tab2 }, repaired: true };
}

export function loadConfig(storage, net, defaults, resolveName) {
  let raw = null;
  try {
    raw = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (!raw) for (const k of LEGACY_KEYS) { raw = JSON.parse(storage.getItem(k) || 'null'); if (raw) break; }
  } catch { raw = null; }
  const migrated = migrate(raw, resolveName);
  const { config, repaired } = validateConfig(migrated, net, defaults);
  if (repaired || migrated !== raw) saveConfig(storage, config);
  return config;
}

export function saveConfig(storage, cfg) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* storage full / blocked */ }
}

/** Geolocation: the tab whose FROM endpoint is nearer. */
export function nearerTab(pos, stopsById, cfg) {
  const d = (s) => (s ? (s.lat - pos.lat) ** 2 + ((s.lon - pos.lon) * Math.cos((pos.lat * Math.PI) / 180)) ** 2 : Infinity);
  const a = d(stopsById[cfg.tab1.from]), b = d(stopsById[cfg.tab2.from]);
  return b < a ? 'tab2' : 'tab1';
}
