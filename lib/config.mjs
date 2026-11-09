// Harbor Hopper configuration.
// Per the spec, ONLY configuration lives here: names, endpoint URLs, intervals,
// and the geographic scope box. No stops, times, fares, counts, or platform IDs.

export const APP_NAME = 'Harbor Hopper';

export const PORT = Number(process.env.PORT || 5178);
export const HOST = '127.0.0.1';

// Default home route, by NAME. Resolved at runtime through the live platforms API.
export const DEFAULT_ROUTE = {
  from: 'Hoboken 14th St',
  to: 'Midtown / W. 39th St',
};

// Connexionz ETA API. The key below is the public key that the official
// etacloud.connexionz.net board ships to every browser; we only use it server-side.
export const CNX = {
  apiBase: 'https://api-eta.connexionz.net/api',
  apiKey: 'EFD912BD775313FED5D8791D11365',
  boardUrl: (platformId) => `https://etacloud.connexionz.net/nywaterway/eta/${platformId}`,
  // The nywaterway domain is the merged board system (it also lists NYC Ferry
  // stops under its own IDs). Board links use that domain's platform IDs.
  boardDomain: 'nywaterway.connexionz.net',
};

// The two official operators. Each has its own live domain + GTFS feed; GTFS
// stop_id == that domain's platform tag, and live tripId == GTFS trip_id.
export const FEEDS = [
  {
    key: 'nyw',
    label: 'NY Waterway',
    liveDomain: 'nywaterway.connexionz.net',
    gtfsUrl: 'https://nywaterway.connexionz.net/rtt/public/utility/gtfs.aspx',
  },
  {
    key: 'nycf',
    label: 'NYC Ferry',
    liveDomain: 'nycferry.connexionz.net',
    gtfsUrl: 'https://nycferry.connexionz.net/rtt/public/utility/gtfs.aspx',
  },
];

// NY-metro scope: geographic box, never a list of names.
export const NY_BOX = { minLat: 40.30, maxLat: 41.35, minLon: -74.40, maxLon: -73.60 };

// Pairs whose weekend GTFS is known to be unreliable get cross-checked against
// the operator's official timetable page (URL is config; its times are data).
export const CROSS_CHECK_PAGES = [
  {
    a: 'Hoboken 14th St',
    b: 'Midtown / W. 39th St',
    url: 'https://nywaterway.com/hoboken14throute.aspx',
  },
];

export const INTERVALS = {
  gtfsMaxAgeMs: 24 * 60 * 60 * 1000,        // 24 h lazy cache
  gtfsDailyRefreshHourET: 4,                 // early-morning refresh
  platformsMaxAgeMs: 24 * 60 * 60 * 1000,
  networkMaxAgeMs: 7 * 24 * 60 * 60 * 1000,  // platformroutes cached one week
  liveMaxAgeMs: 15 * 1000,
  clientRefreshMs: 30 * 1000,
};

export const TIMEZONE = 'America/New_York';
