# Weather Intelligence AI

An SIH 2026 command-center prototype for extreme-weather anomaly tracking, ensemble uncertainty, AI downscaling, and geographic impact intelligence. It opens directly into an interactive 4D forecast map. The data provider boundary lets the same React components consume the deterministic demonstration, a FastAPI backend, or a Cloudflare Worker.

**Scientific status:** All event forecasts, member agreement, location risk, impacts, downscaling comparisons, physics scores, and alerts shown by default are **simulated**. The project includes integration interfaces for real data and models, but no NCMRWF feed or trained model is connected. It does not replace official weather forecasts or emergency guidance.

## Run the demo

Requirements: Node.js 20+ and npm. Python 3.11+ is needed for the API.

```bash
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. The site works without a backend. Its regional geographic country boundaries, state lines, and rivers are bundled under `public/geo/`. `npm run geo:prepare` can rebuild these optimized assets from Natural Earth when online. Optional CARTO basemap and Mapterhorn terrain tiles need an internet connection; the local geographic map remains interactive without them.

The default scenario is a **fixed synthetic 27 September 2026 forecast**, not current weather. `/replay` is a **historical-inspired synthetic Cyclone Amphan scenario**, not an observed reconstruction. Move the T+72–240h slider, play at 0.5–4×, select a threat, toggle weather, impact, and AI-resolution layers, inspect a map location, compare forecast runs, and open the supporting routes. Press `Ctrl/Cmd + K` to find locations, coordinates (`22.57, 88.36`), events, and actions.

## Application routes

| Route | Purpose |
| --- | --- |
| `/` | Map-first command center, event discovery, timeline, location risk |
| `/events`, `/events/:id` | Event catalog and intelligence dossier |
| `/replay` | Guided synthetic Amphan-inspired replay |
| `/downscaling` | Synchronized 12 km / 5 km field comparison and prototype physics checks |
| `/impact` | Geographic exposure and response planning |
| `/alerts` | Read-only simulated alert center with JSON / GeoJSON export |
| `/api` | Interactive API explorer |
| `/models`, `/data`, `/system` | Pipeline architecture, provenance, and health |

## Use the FastAPI backend

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) or use a standard Python virtual environment. From the repository root:

```bash
uv sync --project backend --extra test
uv run --project backend uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000/docs> for generated OpenAPI documentation. To direct the frontend to FastAPI, create `.env.local`:

```dotenv
VITE_DATA_PROVIDER=api
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

Restart Vite after editing the file. The API provider surfaces connection errors; it does not replace failed calls with synthetic fixtures. The backend is intentionally a working demo service. `backend/app/weather_processing.py` provides lazy GRIB/NetCDF, anomaly, spatial intersection, and raster-window interfaces; `backend/app/model_contracts.py` defines graph and artifact prerequisites. Install optional scientific packages with `uv sync --project backend --extra weather --extra geospatial --extra ai` on a suitable Python/PyTorch environment. Model inference is disabled until trained weights, licensed inputs, and validation are supplied.

## Cloudflare setup

The frontend targets **Cloudflare Pages**. The API gateway is a separate **Cloudflare Worker** with D1 metadata and R2 object bindings. The Worker defaults to the same deterministic demo contract, so it can be tested before the Python service is hosted. Production `MODE=api` proxies reads to `FASTAPI_ORIGIN`, and the Worker can cache event and alert metadata in D1. `/api/assets/{tiles|geojson|raster|replay|model-output}/...` reads R2. The two deployments need separate origins because `/api` is also the frontend's API Explorer page.

1. Log in with `npx wrangler login`. Create `weather-intelligence` D1 and `weather-intelligence-assets` R2:

   ```bash
   npx wrangler d1 create weather-intelligence
   npx wrangler r2 bucket create weather-intelligence-assets
   ```

2. Replace the zero `database_id` in `cloudflare/wrangler.toml` with the returned D1 ID. Apply `cloudflare/migrations/0001_metadata.sql`:

   ```bash
   npx wrangler d1 migrations apply weather-intelligence --config cloudflare/wrangler.toml --remote
   ```

3. Set `ALLOWED_ORIGIN` to your Pages origin. For a hosted FastAPI service, set `MODE="api"` and `FASTAPI_ORIGIN="https://your-api-host.example"` in Wrangler vars. The hosted service must be publicly reachable over HTTPS from Cloudflare. Set the same `BACKEND_TOKEN` in the backend environment and as a Worker secret to require authenticated gateway requests. Keep `MODE="demo"` for a standalone judge preview.
4. Deploy the API Worker: `npm run worker:deploy`. Configure Pages to build this GitHub repository using `npm run build`, output `dist`, with `VITE_DATA_PROVIDER=api` and `VITE_API_BASE_URL=https://your-worker.workers.dev/api`. Deploy Pages through Git integration or `npm run pages:deploy` after creating the Pages project. Frontend variables are baked into the build, so rebuild after changing them.

Local Worker development: `npm run db:migrate:local`, then `npm run worker:dev`. Wrangler's local R2 binding stores objects locally. The Worker does not upload weather or raster files; ingestion should write validated assets to R2 through a separate authorized pipeline.

## GitHub setup

The `.github/workflows/ci.yml` workflow builds and checks TypeScript, runs domain and browser tests, and tests the FastAPI contract on pushes to `main` and pull requests. This folder contains a local `main` repository and an initial commit. Create an empty repository under your own GitHub account, then connect it:

```bash
git remote add origin https://github.com/YOUR_ACCOUNT/weather-intelligence-ai.git
git push -u origin main
```

Create the remote repository under your own account first. Cloudflare Pages can connect to that repository to build previews for pull requests. No GitHub credentials, Cloudflare account IDs, D1 database IDs, hosted FastAPI URL, or operational data licenses are stored in this project.

## Verify

```bash
npm run build
npm run format:check
npm run worker:typecheck
npm test
npm run test:e2e
uv run --project backend --extra test python -m pytest backend/tests -q
```

The Playwright configuration uses locally installed Microsoft Edge. For other environments, change `channel` in `playwright.config.ts` and install the matching Playwright browser.
After `npm run build`, run `npm run preview` and `node scripts/capture.mjs` for desktop and mobile visual captures under `artifacts/`.

## Architecture and real-data integration

```text
NCMRWF / ensemble GRIB + topography + authoritative exposure layers
  → Xarray / Dask / cfgrib / MetPy preprocessing
  → anomaly climatology + spatial graph + PyTorch Geometric tracking
  → ensemble assessment + cropped conditional diffusion downscaling
  → physical validation + GeoPandas / Shapely / Rasterio impact analysis
  → FastAPI inference and data API
  → Cloudflare Worker (gateway) + D1 metadata + R2 files and tiles
  → Cloudflare Pages React / TypeScript / MapLibre / deck.gl command center
```

`shared/types.ts` is the typed frontend/Worker contract. `src/services/weather.ts` selects `MockWeatherProvider` or `ApiWeatherProvider`, and `shared/api.ts` handles the Worker's demo API. `backend/app/main.py` implements the matching JSON endpoints. The Python simulation mirrors the TypeScript fixture logic so development can use either provider. Real ingestion belongs behind the existing API, with provenance, model run time, uncertainty, and authorization checked before display. NCMRWF's [dataset portal](https://rds.ncmrwf.gov.in/datasets) is linked as a candidate source; the project does not assume its data is openly downloadable or suitable for every variable.

The Natural Earth geographic files are public-domain cartographic assets. CARTO/OpenStreetMap and optional terrain tiles retain their attributions in the map. Synthetic infrastructure coordinates are intentionally labeled and must be replaced with authoritative exposure data before any operational use.
