# Weather Intelligence AI

An SIH prototype for screening extreme weather signals in medium-range ensemble forecasts. The React command center and Cloudflare Worker backend are both TypeScript. The default command center fetches the latest NOAA GEFS 0.25° ensemble mean through [Open-Meteo](https://open-meteo.com/en/docs/ensemble-mean-api), samples 16 locations across India and adjacent seas, and displays rainfall, wind gust, temperature, pressure, six-hour signal movement, an approximate footprint, and coordinate risk. Forecast data is refreshed every 30 minutes while the page is open.

**Scientific boundary:** This is a screening prototype, not an official forecast or public warning. The sampled maximum path is not a continuous storm-centre track. Colored footprint rings are geometric estimates, not native-grid affected-area polygons. No calibrated event probability, historical EFI baseline, trained GNN, validated 5 km diffusion model, or authoritative population exposure dataset is connected. The live global ensemble source is about **25 km**, not the proposed 12 km NCMRWF input. The `/replay` route remains an explicitly simulated Amphan-inspired scenario.

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

Open <http://127.0.0.1:5173/>. The default live view needs internet access to fetch GEFS forecasts. The bundled regional geographic boundaries still load without map tiles. Click the map to request a fresh coordinate forecast. Use the Day 3–10 slider to inspect changing samples, or open `/replay` for the offline scenario.

If `npm ci` reports `EPERM` while unlinking `lightningcss.win32-x64-msvc.node` on Windows, stop any running Vite, Wrangler, Playwright, or Node processes using this project, then retry. A loaded native module cannot be replaced while its process is running; OneDrive synchronization may also briefly hold the file.

To use a MapTiler basemap, obtain a key from [MapTiler Cloud](https://cloud.maptiler.com/), restrict its allowed origins in the MapTiler dashboard, then create `.env.local` with:

```dotenv
VITE_MAPTILER_KEY=your_maptiler_key
```

Restart Vite after editing `.env.local`. MapTiler browser keys are visible to site visitors; domain restrictions are the protection. If no key is configured, the map uses its locally bundled geographic outlines without a commercial basemap. Do not place a private server credential in a `VITE_` variable.

## What is implemented

| View                     | Behavior                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `/`                      | Live sampled GEFS forecast map, weather variables, screening signals, day 3–10 timeline, coordinate forecast |
| `/events`, `/events/:id` | Rainfall, wind/pressure and heat screening, sampled movement table                                           |
| `/impact`                | Approximate footprint radius and area; no fabricated population exposure                                     |
| `/alerts`                | Read-only screening advisories with JSON and GeoJSON export; no messages sent                                |
| `/downscaling`           | Shows coarse input and a 5 km rainfall grid only when a validated model artifact and gridded run are present |
| `/api`                   | Interactive TypeScript Worker API explorer                                                                   |
| `/replay`                | Explicitly simulated Amphan-inspired historical scenario                                                     |

Live detection currently uses transparent weather thresholds on sampled ensemble-mean fields. The private [FastAPI model service](ml_service/README.md) contains NetCDF/GRIB2 ingestion, a conditional diffusion trainer, an event-held-out validation gate, and a DGL graph network module. No training files or validated weights are present; the service does not invent 5 km output.

## Run the TypeScript API

In a second terminal, run the Cloudflare Worker locally:

```powershell
npm.cmd run worker:dev
```

Call:

```text
GET http://127.0.0.1:8787/api/live/risk?lat=22.57&lon=88.36&hour=96
```

The Worker serves live `/api/events`, `/api/forecast`, `/api/risk`, `/api/live/risk`, `/api/alerts`, `/api/impact`, and `/api/trajectory/:id`. Coordinate-risk probability is `null`; a validated 5 km radius is not claimed. Set `VITE_DATA_PROVIDER=api` and `VITE_API_BASE_URL=http://127.0.0.1:8787/api` in `.env.local` to route the website through the Worker. Leave `VITE_DATA_PROVIDER` unset for the one-terminal live website, or use `demo` for offline fixtures. In `cloudflare/wrangler.toml`, `MODE="live"` is the default; `MODE="demo"` is an explicitly synthetic API mode. D1 and Backblaze B2 are optional for the live forecast endpoints. For deployment, set `ALLOWED_ORIGIN` to the Pages site and configure the Pages build with the deployed Worker URL.

The Worker also accepts private `ML_API_ORIGIN` and `ML_API_KEY` settings. It proxies `/api/ml/status`, `/api/ml/track/:eventId`, and `/api/downscaled/:eventId` to the Python service. D1 caches events, alerts, trajectories, and approved model metadata; apply its local migrations with `npm.cmd run db:migrate:local`. Administrative cache routes require `ADMIN_API_TOKEN`. Copy `cloudflare/.dev.vars.example` to `cloudflare/.dev.vars` for local secrets. Never place internal keys in a `VITE_` variable. In production, set `ML_API_ORIGIN` to a private HTTPS endpoint and configure `ML_API_KEY` as a Worker secret.

## Verification

```powershell
npm.cmd run build
npm.cmd run format:check
npm.cmd run worker:typecheck
npm.cmd test
npm.cmd run test:e2e
```

The TypeScript Worker shares forecast logic with the website through `shared/liveWeather.ts`. D1 can cache event and alert metadata. Private validated assets can be read from Backblaze B2 through `/api/assets/:key`; configure `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_KEY_ID`, and `B2_APPLICATION_KEY` in `cloudflare/.dev.vars`. Use a bucket-scoped read-only B2 application key. In production, add the same five values with `wrangler secret put`. NCMRWF historical NEPS-G/NCUM inputs, ERA5/IMDAA baselines, trained GNN/diffusion weights and verification datasets are not included or claimed to be publicly accessible. [NCMRWF dataset portal](https://rds.ncmrwf.gov.in/datasets).
