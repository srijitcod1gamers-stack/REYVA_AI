# Weather Intelligence AI

An SIH weather screening and verification application with a React dashboard, a TypeScript Cloudflare Worker API, D1 metadata and private Backblaze B2 datasets. Production reads native NOAA GEFS 0.25-degree grids over 68-98E / 6-36N, with rainfall, gust and pressure fields at daily lead times from day 3 to day 10. Contiguous threshold cells form forecast objects; overlap and distance associate them through time. Footprint area is calculated from spherical cell areas.

The historical explorer serves 12 prepared NOAA reforecast / CHIRPS verification cases. The downscaling lab compares actual coarse forecasts, CHIRPS 0.05-degree land observations and interpolation, alongside measured model validation reports. Impact intelligence finds OpenStreetMap facility representative points inside the selected footprint; mapping coverage is incomplete and population totals are not invented.

**Scientific boundary:** Native-grid threshold screening is not a calibrated storm probability or an official warning. Five GEFS members are used, not the full ensemble. The selected historical cases are single 96-hour verification windows, not complete cyclone reconstructions. AI output is withheld unless event-held-out validation beats the declared baseline. A 0.05-degree observation or interpolation layer must not be described as a trained forecast. The current model release state is available at `/api/ml/status`.

## Run locally

Install Node.js 20+ and run from the project folder:

```powershell
npm.cmd ci
npm.cmd run dev
```

To run the frontend and TypeScript Worker together in one terminal, use:

```powershell
npm.cmd run dev:all
```

Open <http://127.0.0.1:5173/>. Local API mode needs the B2 variables in `cloudflare/.dev.vars`; the same migrated datasets are then available through Wrangler. Set `VITE_DATA_PROVIDER=api` and `VITE_API_BASE_URL=/api` in `.env.local`. The native domain is regional; outside-domain queries return a clear coverage error. Historical cases remain available independently when the live cycle is stale.

If `npm ci` reports `EPERM` while unlinking `lightningcss.win32-x64-msvc.node` on Windows, stop any running Vite, Wrangler, Playwright, or Node processes using this project, then retry. A loaded native module cannot be replaced while its process is running; OneDrive synchronization may also briefly hold the file.

To use a MapTiler basemap, obtain a key from [MapTiler Cloud](https://cloud.maptiler.com/), restrict its allowed origins in the MapTiler dashboard, then create `.env.local` with:

```dotenv
VITE_MAPTILER_KEY=your_maptiler_key
```

Restart Vite after editing `.env.local`. MapTiler browser keys are visible to site visitors; domain restrictions are the protection. If no key is configured, the map uses its locally bundled geographic outlines without a commercial basemap. Do not place a private server credential in a `VITE_` variable.

## What is implemented

- Native NOAA raster fields, contiguous-object footprints and daily object association.
- Actual initialization and valid timestamps, five-member provenance and stale-cycle rejection.
- Coordinate forecast inspection, advisory and footprint GeoJSON exports.
- Twelve historical verification cases with observed land masking and complete-region interpolation scores.
- Model checkpoints, measured validation reports and release gates; held-out predictions are never substituted with synthetic data.
- Private B2 archive and signed Worker access; D1 event, trajectory, alert and dataset metadata.
- Facility point-in-polygon assessment through OpenStreetMap / Overpass.
- GitHub Actions refresh every six hours using encrypted B2 secrets, with publication pointers uploaded after their referenced files.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for deployment verification and the remaining scientific requirements.

## Run the TypeScript API

In a second terminal, run the Cloudflare Worker locally:

```powershell
npm.cmd run worker:dev
```

Call:

```text
GET http://127.0.0.1:8787/api/live/risk?lat=22.57&lon=88.36&hour=96
```

The Worker serves live `/api/events`, `/api/forecast`, `/api/risk`, `/api/live/risk`, `/api/alerts`, `/api/impact`, and `/api/trajectory/:id`. Coordinate-risk probability is `null`; a validated 5 km radius is not claimed. Set `VITE_DATA_PROVIDER=api` and `VITE_API_BASE_URL=http://127.0.0.1:8787/api` in `.env.local` to route the website through the Worker. Use `demo` only for explicit offline fixtures. Production and local API mode read the migrated native grids. In `cloudflare/wrangler.toml`, `MODE="live"` is the default; `MODE="demo"` is an explicitly synthetic API mode. Backblaze B2 is required for native published grids; D1 stores metadata. Production Pages proxies `/api` to the deployed Worker.

The Worker also accepts private `ML_API_ORIGIN` and `ML_API_KEY` settings. It proxies `/api/ml/status`, `/api/ml/track/:eventId`, and `/api/downscaled/:eventId` to the Python service. D1 caches events, alerts, trajectories, and approved model metadata; apply its local migrations with `npm.cmd run db:migrate:local`. Administrative cache routes require `ADMIN_API_TOKEN`. Copy `cloudflare/.dev.vars.example` to `cloudflare/.dev.vars` for local secrets. Never place internal keys in a `VITE_` variable. In production, set `ML_API_ORIGIN` to a private HTTPS endpoint and configure `ML_API_KEY` as a Worker secret.

## Verification

```powershell
npm.cmd run build
npm.cmd run format:check
npm.cmd run worker:typecheck
npm.cmd test
npm.cmd run test:e2e
```

The production TypeScript Worker reads signed B2 objects through `cloudflare/src/gridded.ts`; `shared/liveWeather.ts` remains the optional sparse browser fallback. D1 can cache event and alert metadata. Private validated assets can be read from Backblaze B2 through `/api/assets/:key`; configure `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_KEY_ID`, and `B2_APPLICATION_KEY` in `cloudflare/.dev.vars`. Use a bucket-scoped read-only B2 application key. In production, add the same five values with `wrangler secret put`. NCMRWF historical NEPS-G/NCUM inputs and ERA5/IMDAA baselines are not included. Prepared NOAA/CHIRPS datasets and trained artifacts are in the private B2 archive. [NCMRWF dataset portal](https://rds.ncmrwf.gov.in/datasets).
