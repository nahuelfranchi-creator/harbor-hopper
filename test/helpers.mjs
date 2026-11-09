// Build tiny GTFS zips in memory for tests (stored, uncompressed).
import { crc32 } from 'node:zlib';

export function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/**
 * Synthetic feed:
 *   1 Alpha Pier, 2 Bravo Landing, 3 Charlie Point, 4 Delta Dock, 5 Echo Bus Stop
 *   R1 ferry   Alpha -> Bravo -> Charlie (weekday + weekend), Charlie -> Alpha (weekday; 1 weekend trip)
 *   R2 bus     Bravo -> Echo (weekday)
 *   R3 ferry   Alpha -> Delta, weekday only
 */
export function syntheticFeed({ withFare = false, withFareRules = false } = {}) {
  const trips = [], st = [];
  const add = (id, route, svc, stops) => {
    trips.push(`${route},${svc},${id},"",0`);
    stops.forEach(([stop, time], i) => st.push(`${id},${time},${time},${stop},${i + 1},0,0`));
  };
  add('100', 'R1', 'WK', [[1, '08:00:00'], [2, '08:10:00'], [3, '08:20:00']]);
  add('101', 'R1', 'WK', [[1, '18:00:00'], [2, '18:10:00'], [3, '18:20:00']]);
  add('110', 'R1', 'WE', [[1, '10:00:00'], [2, '10:10:00'], [3, '10:20:00']]);
  add('111', 'R1', 'WE', [[1, '12:00:00'], [2, '12:10:00'], [3, '12:20:00']]);
  add('112', 'R1', 'WE', [[1, '14:00:00'], [2, '14:10:00'], [3, '14:20:00']]);
  add('120', 'R1', 'WK', [[3, '09:00:00'], [1, '09:20:00']]);
  add('121', 'R1', 'WK', [[3, '19:00:00'], [1, '19:20:00']]);
  add('130', 'R1', 'WE', [[3, '21:00:00'], [1, '21:20:00']]);
  add('200', 'R2', 'WK', [[2, '12:00:00'], [5, '12:15:00']]);
  add('300', 'R3', 'WK', [[1, '07:00:00'], [4, '07:30:00']]);
  const files = {
    'agency.txt': 'agency_id,agency_name,agency_url,agency_timezone\nA,Test,https://x,America/New_York\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\n1,Alpha Pier,40.7,-74.0\n2,Bravo Landing,40.71,-74.0\n3,Charlie Point,40.72,-74.0\n4,Delta Dock,40.73,-74.0\n5,Echo Bus Stop,40.74,-74.0\n',
    'routes.txt': 'route_id,route_short_name,route_long_name,route_type\nR1,R1,Main Line,4\nR2,R2,Shuttle,3\nR3,R3,Delta Run,4\n',
    'trips.txt': `route_id,service_id,trip_id,trip_headsign,direction_id\n${trips.join('\n')}\n`,
    'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n${st.join('\n')}\n`,
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260101,20271231\nWE,0,0,0,0,0,1,1,20260101,20271231\n',
  };
  if (withFare) files['fare_attributes.txt'] = 'fare_id,price,currency_type,payment_method,transfers\nF1,3.25,USD,1,\n';
  if (withFareRules) files['fare_rules.txt'] = 'fare_id,route_id\nF1,R1\n';
  return makeZip(files);
}

export const stop = (tag, name) => ({ id: `t:${tag}`, feed: 't', tag, name });
export const MONDAY = '20261109';
export const SATURDAY = '20261114';
export const at = (ymd, hh, mm = 0) => ({ ymd, secs: hh * 3600 + mm * 60, ms: 0 });
