import test from 'node:test';
import assert from 'node:assert/strict';
import {
  origins, roundTripOrigins, roundTripDestinations, outbound,
  validateConfig, migrate, loadConfig, defaultConfig, STORAGE_KEY, nearerTab,
} from '../public/shared/pickers.mjs';
import { inNyBox, isTwin } from '../lib/data.mjs';
import { shortLabel } from '../public/shared/names.mjs';

// a<->b round trip, a->c one-way, d->a one-way-only origin, x serves nothing
const net = { edges: { a: ['b', 'c'], b: ['a'], d: ['a'], x: [] } };
const defaults = { from: 'a', to: 'b' };

test('Round trip ON offers only origins with a valid round trip', () => {
  assert.deepEqual(roundTripOrigins(net).sort(), ['a', 'b']);
  assert.deepEqual(roundTripDestinations(net, 'a'), ['b']);
});

test('Round trip OFF / Custom offer any origin with a direct outbound, incl. one-way-only; never an origin that serves nothing', () => {
  assert.deepEqual(origins(net).sort(), ['a', 'b', 'd']);
  assert.ok(!origins(net).includes('x'));
  assert.deepEqual(outbound(net, 'a'), ['b', 'c']);
});

test('saved config: invalid pairs are repaired to the default; valid configs pass untouched', () => {
  const valid = { v: 2, roundTrip: true, tab1: { from: 'a', to: 'b' }, tab2: { from: 'b', to: 'a' } };
  const r1 = validateConfig(valid, net, defaults);
  assert.equal(r1.config, valid);
  assert.equal(r1.repaired, false);

  const bad = { v: 2, roundTrip: true, tab1: { from: 'a', to: 'c' }, tab2: { from: 'c', to: 'a' } }; // one-way only
  const r2 = validateConfig(bad, net, defaults);
  assert.deepEqual(r2.config, defaultConfig(defaults));
  assert.equal(r2.repaired, true);

  const offMixed = { v: 2, roundTrip: false, tab1: { from: 'd', to: 'a' }, tab2: { from: 'x', to: 'a' } };
  const r3 = validateConfig(offMixed, net, defaults);
  assert.deepEqual(r3.config.tab1, { from: 'd', to: 'a' });
  assert.deepEqual(r3.config.tab2, defaultConfig(defaults).tab2);
});

test('old saved routes migrate (names resolved through the live stop list)', () => {
  const names = { Alpha: 'a', Bravo: 'b' };
  const m = migrate({ from: 'Alpha', to: 'Bravo' }, (n) => names[n]);
  assert.deepEqual(m, { v: 2, roundTrip: true, tab1: { from: 'a', to: 'b' }, tab2: { from: 'b', to: 'a' } });
});

test('settings persist in storage across reloads; Reset restores default with Round trip ON', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const first = loadConfig(storage, net, defaults);
  assert.deepEqual(first, defaultConfig(defaults));
  const custom = { v: 2, roundTrip: false, tab1: { from: 'd', to: 'a' }, tab2: { from: 'a', to: 'c' } };
  storage.setItem(STORAGE_KEY, JSON.stringify(custom));
  assert.deepEqual(loadConfig(storage, net, defaults), custom); // "reload"
  assert.equal(defaultConfig(defaults).roundTrip, true);
});

test('geolocation picks the tab whose FROM endpoint is nearer', () => {
  const byId = { a: { lat: 40.75, lon: -74.02 }, b: { lat: 40.76, lon: -74.0 } };
  const cfg = { tab1: { from: 'a' }, tab2: { from: 'b' } };
  assert.equal(nearerTab({ lat: 40.751, lon: -74.021 }, byId, cfg), 'tab1');
  assert.equal(nearerTab({ lat: 40.761, lon: -73.99 }, byId, cfg), 'tab2');
});

test('NY-area scope is geographic (box), not a name list', () => {
  assert.equal(inNyBox(40.7526, -74.0219), true);  // Hudson waterfront
  assert.equal(inNyBox(40.58, -73.82), true);      // Rockaway
  assert.equal(inNyBox(27.94, -82.45), false);     // Tampa, FL
  assert.equal(inNyBox(30.40, -87.21), false);     // Pensacola, FL
});

test('twin records of the same terminal are recognised; similar names far apart are not', () => {
  const t = (name, lat, lon) => ({ id: name, name, lat, lon });
  assert.equal(isTwin(t('Paulus Hook', 40.714, -74.033), t('Paulus Hook Ferry', 40.7141, -74.0331)), true);
  assert.equal(isTwin(t('Paulus Hook', 40.714, -74.033), t('Paulus Hook', 40.80, -74.033)), false);
});

test('tab labels stay short', () => {
  assert.equal(shortLabel('Hoboken 14th Street'), 'Hoboken 14th');
  assert.equal(shortLabel('Midtown / W. 39th St.'), 'Midtown');
});
