import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGtfsIndex } from '../lib/gtfs.mjs';
import { computeTopCard, computeSchedule, STATE } from '../lib/board.mjs';
import { syntheticFeed, stop, MONDAY, SATURDAY, at } from './helpers.mjs';

const g = buildGtfsIndex(syntheticFeed());
const A = stop(1, 'Alpha Pier'), B = stop(2, 'Bravo Landing'), C = stop(3, 'Charlie Point'), D = stop(4, 'Delta Dock'), E = stop(5, 'Echo Bus Stop');
const board = (routes) => ({ maxArrivalScope: 78, routes });
const liveTrip = (tripId, etd, scheduledMin) => ({ tripId, eta: etd, etd, scheduledMin });
const top = (o) => computeTopCard({ inNetwork: true, gtfs: g, live: null, ...o });

test('LIVE with a delay badge when the live feed confirms the destination', () => {
  const live = board([{ no: 'R1', destinations: [{ name: 'Bravo → Charlie', trips: [liveTrip('100', 5, 480)] }] }]);
  const t = top({ now: at(MONDAY, 8, 0), from: A, to: C, live });
  assert.equal(t.state, STATE.LIVE);
  assert.equal(t.badge, 'LIVE');
  assert.equal(t.next.delayMin, 5);
  assert.match(t.message, /running late/);
});

test('SCHEDULE fallback (NEXT BOAT TODAY) when no live boat is confirmed', () => {
  const live = board([{ no: 'R2', destinations: [{ name: 'Echo', trips: [liveTrip('200', 3, 720)] }] }]);
  const t = top({ now: at(MONDAY, 7, 30), from: A, to: C, live });
  assert.equal(t.state, STATE.NEXT_BOAT_TODAY);
  assert.equal(t.badge, 'SCHEDULE');
  assert.match(t.heading, /^NEXT BOAT TODAY AT /);
  assert.match(t.message, /official schedule.*isn't confirmed live/);
  assert.match(t.why, /Echo/);
});

test('through-route: a boat labelled only by its next stop is NOT live for a later stop', () => {
  const live = board([{ no: 'R1', destinations: [{ name: 'Bravo', trips: [liveTrip('100', 5, 480)] }] }]);
  assert.equal(top({ now: at(MONDAY, 8, 0), from: A, to: C, live }).state, STATE.NEXT_BOAT_TODAY);
  assert.equal(top({ now: at(MONDAY, 8, 0), from: A, to: B, live }).state, STATE.LIVE);
});

test('a boat that cannot be identified in the timetable is never promoted to LIVE', () => {
  const live = board([{ no: 'R1', destinations: [{ name: 'Charlie', trips: [liveTrip('999', 5, 480)] }] }]);
  assert.notEqual(top({ now: at(MONDAY, 8, 0), from: A, to: C, live }).state, STATE.LIVE);
});

test("another operator's boat on a merged board is ignored", () => {
  const live = board([{ no: 'XX', destinations: [{ name: 'Charlie', trips: [liveTrip('100', 5, 480)] }] }]);
  assert.notEqual(top({ now: at(MONDAY, 8, 0), from: A, to: C, live }).state, STATE.LIVE);
});

test('weekday-only route on a weekend: honest reason + next service day, SCHEDULE label', () => {
  const t = top({ now: at(SATURDAY, 9), from: A, to: D });
  assert.equal(t.state, STATE.NO_BOATS_TODAY);
  assert.equal(t.heading, 'NO BOATS RIGHT NOW');
  assert.match(t.reason, /weekdays only/);
  assert.equal(t.nextService.badge, 'SCHEDULE');
  assert.match(t.message, /Next boat: .* at 7:00 AM/);
  const s = computeSchedule({ now: at(SATURDAY, 9), from: A, to: D, inNetwork: true, gtfs: g, dayType: 'weekend' });
  assert.equal(s.found, false);
  assert.equal(s.message, 'No weekend schedule — this route runs weekdays only (Mon–Fri).');
});

test('a boat scheduled today never produces "No boats scheduled right now"', () => {
  for (const h of [6, 9, 12, 17]) {
    const t = top({ now: at(MONDAY, h), from: A, to: C, live: board([{ no: 'R2', destinations: [{ name: 'Echo', trips: [liveTrip('200', 3, 720)] }] }]) });
    assert.notEqual(t.state, STATE.NO_BOATS_TODAY);
    assert.doesNotMatch(JSON.stringify(t), /No boats scheduled right now/);
  }
});

test("empty live board -> CAN'T CHECK RIGHT NOW, keeping the next scheduled boat", () => {
  const t = top({ now: at(MONDAY, 7), from: A, to: C, live: board([]) });
  assert.equal(t.state, STATE.CANT_CHECK);
  assert.ok(t.next && t.next.badge === 'SCHEDULE');
});

test('after the last boat: "No more boats today." with the next service', () => {
  const t = top({ now: at(MONDAY, 23), from: A, to: C });
  assert.equal(t.state, STATE.NO_MORE_TODAY);
  assert.equal(t.heading, 'No more boats today.');
  assert.ok(t.nextService);
});

test('no timetable in either source -> honest NO VERIFIED TIMETABLE; not in network -> NO DIRECT FERRY', () => {
  assert.equal(top({ now: at(MONDAY, 9), from: D, to: E }).state, STATE.NO_TIMETABLE);
  const nd = computeTopCard({ now: at(MONDAY, 9), from: D, to: E, inNetwork: false, goesTo: ['Alpha Pier'], gtfs: g });
  assert.equal(nd.state, STATE.NO_DIRECT_FERRY);
  assert.match(nd.message, /Alpha Pier/);
  const s = computeSchedule({ now: at(MONDAY, 9), from: D, to: E, inNetwork: true, gtfs: g, dayType: 'weekday' });
  assert.equal(s.found, false);
  assert.match(s.message, /No verified timetable/);
});

test('shuttle legs are labelled shuttle bus, derived from the feed', () => {
  const t = top({ now: at(MONDAY, 10), from: B, to: E, live: board([{ no: 'R1', destinations: [{ name: 'Charlie', trips: [liveTrip('101', 400, 1080)] }] }]) });
  assert.equal(t.next.mode, 'shuttle bus');
  assert.match(t.heading, /SHUTTLE BUS/);
});

test('schedule section: one labelled real day, never blended, and never any live data', () => {
  const live = board([{ no: 'R1', destinations: [{ name: 'Bravo → Charlie', trips: [liveTrip('100', 5, 480)] }] }]);
  const s = computeSchedule({ now: at(MONDAY, 8), from: A, to: C, inNetwork: true, gtfs: g, dayType: 'weekday', live });
  assert.equal(s.found, true);
  assert.equal(s.dayLabel, 'Weekday schedule · Monday');
  assert.deepEqual(s.times.map((x) => x.clock), ['8:00 AM', '6:00 PM']);
  assert.doesNotMatch(JSON.stringify(s), /LIVE/);
  const we = computeSchedule({ now: at(MONDAY, 8), from: A, to: C, inNetwork: true, gtfs: g, dayType: 'weekend' });
  assert.equal(we.dayLabel, 'Weekend schedule · Saturday');
  assert.equal(we.times.length, 3);
});

test('lopsided weekend data is detected and flagged, with the cross-check outcome', () => {
  const s = computeSchedule({ now: at(SATURDAY, 8), from: C, to: A, inNetwork: true, gtfs: g, dayType: 'weekend',
    crossCheck: { attempted: true, ok: false, url: 'https://example.test/page' } });
  assert.equal(s.found, true);
  assert.match(s.notes.join(' '), /looks incomplete .*1 boat listed vs 3/);
  assert.match(s.notes.join(' '), /example\.test/);
});

test('fare comes only from the feed: single fare w/o rules applies; rules present -> no blanket fare', () => {
  assert.equal(buildGtfsIndex(syntheticFeed()).feedFare, null);
  assert.deepEqual(buildGtfsIndex(syntheticFeed({ withFare: true })).feedFare, { price: 3.25, currency: 'USD' });
  assert.equal(buildGtfsIndex(syntheticFeed({ withFare: true, withFareRules: true })).feedFare, null);
});
