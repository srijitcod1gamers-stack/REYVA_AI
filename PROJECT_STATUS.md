# REYVA AI project status

The application and migrated data are deployed at https://reyva-ai.pages.dev. This report separates working software from scientific release requirements.

## Delivered

- Native NOAA GEFS 0.25-degree rainfall, gust and pressure grids replace 16-site circles in production. The domain is 68-98E / 6-36N; there are 14,641 native cells and eight daily forecast steps from 72 to 240 hours. Five ensemble members are used.
- Contiguous threshold footprints replace generated rings. Area uses spherical cell areas. Overlap/distance association replaces the path that linked unrelated sampled maxima. Missing objects show no polygon and zero area at that time.
- The historical explorer exposes 12 prepared NOAA reforecast / CHIRPS cases, with actual initialization and verification dates. These are 96-hour rainfall verification windows, not full cyclone reconstructions.
- Downscaling lab shows coarse forecasts, CHIRPS land observations, interpolation and measured model scores. Observation and interpolation layers are clearly distinguished from AI predictions.
- Impact intelligence exports footprint GeoJSON and finds mapped hospitals, clinics, schools and fire stations inside it. Facilities appear as map points after assessment. Facility representative-point checks use a 190,805-object regional OpenStreetMap / Overpass snapshot stored in B2; mapping completeness and observed damage are not inferred. Population totals remain unavailable.
- Private B2 migration contains 953 objects, including 921 prepared raw/artifact files, about 1.044 GB. Five representative remote checksums were verified, including trained weights. Local originals are retained.
- D1 has the dataset registry and current forecast metadata, alongside events, alerts and trajectories.
- GitHub Actions has a six-hour NOAA refresh workflow, encrypted B2 secrets and atomic publication. Its first cloud run completed successfully and advanced production from the 06Z to the 12Z October 1 cycle. A separate weekly workflow refreshes the facility snapshot. It publishes dataset pointers after referenced grids. Cycles older than 36 hours are rejected instead of displayed as current.

## Model release result

GPU availability was verified: NVIDIA GeForce GTX 1650, CUDA enabled. The downscaler was re-evaluated over entire regional land grids with deterministic diffusion noise. The graph model was retrained for 80 epochs after correcting dry cells incorrectly labelled as extremes.

| Held-out test metric                |  Model | Declared baseline | Result                       |
| ----------------------------------- | -----: | ----------------: | ---------------------------- |
| Rainfall MAE (mm)                   |  1.390 |             1.761 | Lower average error          |
| Rainfall 99th-percentile error (mm) | 27.404 |            23.508 | Worse extreme-rainfall skill |
| Graph mask F1                       |  0.136 |             0.120 | Below required 0.5           |

Both models remain withheld. This project is operational as a native-grid screening and forecast-verification application; it is **not yet a validated 5 km AI extreme-weather forecasting system**. Live EFI also needs lead-matched operational climatology. A private hosted ML service has not been deployed. No probability, population exposure or validated AI output is fabricated.

Remaining work includes publishing a private inference service after the release gates pass, plus scientific development: expand independent extreme-event and lead-time training pairs, improve rare-event loss/calibration, repeat held-out verification and only then release inference. CHIRPS does not provide ocean reference rainfall. Full historical time sequences and authoritative census/asset coverage are additional datasets, not features that can be created from the current single-window cases.

## Verification and operation

Production API responses and all five pages were checked against the migrated datasets. TypeScript build, Worker typecheck, formatting, nine unit tests, eighteen Python tests and five browser tests passed. Windows Playwright preview teardown required terminating only its preview process after the tests completed.

Run locally: `npm.cmd run dev:all`. API mode needs the B2 settings in `cloudflare/.dev.vars`. Refresh and publish a native cycle: `npm.cmd run ml:refresh`. Publish prepared data and model reports: `npm.cmd run ml:publish`. Secrets are excluded from Git and browser variables.

To inspect the changes, open the deployed site and use Ctrl+F5. For a live-cycle check, compare forecast initialization and valid time in the header, or inspect `/api/health`. Historical cases and model reports are available independently of a live forecast outage.

Facility source documentation: https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances

CI dependency repair: event partitioning lives in the lightweight validation module, so data-validation checks no longer import PyTorch. Native publication also refuses to replace a newer remote forecast cycle with older local data.

Verified cloud runs: forecast publication https://github.com/srijitcod1gamers-stack/REYVA_AI/actions/runs/36906485790 and final application/ML contract CI https://github.com/srijitcod1gamers-stack/REYVA_AI/actions/runs/36914355700 both passed. Facility ingestion uses resumable sections, bounded requests, backoff and spatial query splitting; incomplete or outdated snapshots are refused.

Live facility check: GRID-RAINFALL-2 at T+72h intersected 259 mapped facilities (43 hospitals, 212 schools, 4 clinics). The 190,805-facility catalog was published as 42 immutable B2 tiles before its pointer. Facility counts describe mapped potential exposure, not confirmed damage. Forecast freshness does not establish forecast accuracy; verification requires matching predictions against subsequent observations.

Selecting a different native event opens its peak lead time and prevents displaying another event's cached frame during loading. Facility assessment is disabled until the selected forecast time has loaded.
