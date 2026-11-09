# Harbor Hopper

Live next-boat dashboard for NY Waterway and NYC Ferry.

## Run it

```bash
cd /Users/nahufran/workspace/harbor-hopper
npm start            # http://127.0.0.1:5178
```

Requires Node 22+. No packages to install.

## Test it

```bash
npm test             # behavioral tests (offline, synthetic timetable)
npm run test:live    # coverage smoke test against the real live feeds
```

## How it works

- `server.mjs` serves the page and fetches every bit of data server-side
  (Connexionz blocks browser requests from other sites).
- `lib/config.mjs` is the only place with fixed values: app name, default route
  *by name*, endpoint URLs, refresh intervals, and the NY-metro bounding box.
- Stops: Connexionz platforms API, filtered by the bounding box.
- Route network: GTFS stop sequences, kept only where `platformroutes` publishes the route (cached 1 week).
- Timetables: both official GTFS feeds, refreshed daily ~4 AM ET + 24 h cache; a failed or empty download keeps the last good copy.
- Live: Connexionz live board. A boat is LIVE for your stop only when the board's
  label names your stop (or a stop past it) on that boat's actual trip.

## Known limitations

- `nywaterway.com/hoboken14throute.aspx` is behind bot protection and can't be fetched
  automatically. When the weekend GTFS data looks incomplete for a direction, the app
  says so and points to that page instead of making up times.
- Fares: NYC Ferry publishes one flat fare in its feed, so it's shown for NYC Ferry
  pairs. NY Waterway publishes none, so those routes show "Fares vary by route."
