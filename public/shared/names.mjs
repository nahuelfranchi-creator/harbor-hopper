// Stop-name helpers shared by server and browser (pure, no data).

const ABBREV = { st: 'street', w: 'west', e: 'east', n: 'north', s: 'south', ave: 'avenue', blvd: 'boulevard' };
// Words that don't distinguish one terminal from another.
const WEAK = new Set(['street', 'the', 'terminal', 'ferry', 'landing', 'pier', 'and', 'at', 'to']);

export function tokens(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(\d+)(st|nd|rd|th)\b/g, '$1')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ABBREV[t] || t);
}

/** Does every token of `query` appear in `name`? (order-free) */
export function nameContains(name, query) {
  const have = new Set(tokens(name));
  return tokens(query).every((t) => have.has(t));
}

/** Loose "same place" check used to read live-board labels conservatively. */
export function labelMatchesStop(label, stopName) {
  const strong = (s) => tokens(s).filter((t) => !WEAK.has(t));
  const a = new Set(strong(label));
  return strong(stopName).some((t) => a.has(t) && !/^\d+$/.test(t)) ||
    strong(stopName).filter((t) => a.has(t)).length >= 2;
}

/** Short tab label: "Hoboken 14th Street" -> "Hoboken 14th", "Midtown / W. 39th St." -> "Midtown". */
export function shortLabel(name) {
  let s = String(name || '').split(/\s[\/\-–]\s|\//)[0].trim();
  s = s.replace(/\s+(Street|St\.?|Terminal|Ferry Landing|Landing)$/i, '').trim();
  if (s.length > 16) s = s.slice(0, 16).replace(/\s+\S*$/, '') || s.slice(0, 16);
  return s;
}
