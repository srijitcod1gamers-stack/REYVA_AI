# Weather model service

This FastAPI service is private. The React website calls the TypeScript Cloudflare Worker; the Worker calls this service over HTTPS using `ML_API_KEY`. No forecast or model is bundled. The service returns 503 until a checkpoint, matching validation report, and live gridded forecast catalog exist.

## Public SIH data route

The repository now includes a reproducible public-data pipeline for the selected SIH route:

```text
NOAA GEFSv12 reforecasts + CHIRPS v3 observations
  -> month-matched 2000-2019 model/observed climatology
  -> EFI anomaly fields + CHIRPS 95th-percentile masks
  -> event-separated tracker/downscaler catalogs
  -> held-out validation gates
  -> current NOAA GEFS gridded live catalog
  -> FastAPI -> TypeScript Worker -> dashboard
```

The default [public manifest](public-manifest.json) contains twelve named Indian Ocean severe-weather evaluation windows. They are 24-hour rainfall verification windows, not asserted landfall timestamps. The pipeline uses the same five members (`c00`, `p01`-`p04`) in the retrospective and live archives. It sums all NOAA interval messages in each 24-hour window instead of treating a six-hour `90-96 hour acc` message as a daily total.

The downscaler catalog also includes forty evenly sampled climatology pairs marked `split: train`. They increase training diversity but can never enter validation or test splits; the named historical events remain the held-out release evidence.

CHIRPS is a land precipitation product. Its ocean NoData cells are carried as an explicit validity mask; downscaler loss, downscaler metrics and tracker metrics use only CHIRPS-covered land cells. The pipeline does not convert ocean NoData to zero rainfall, and approved reports state this validation scope.

Install Python 3.12 dependencies and inspect the exact workload before downloading:

```powershell
uv sync --project ml_service --extra test --python 3.12
npm.cmd run ml:plan
```

The fast SIH manifest prepares the 20-year, month-matched climatology for May, October, November, and December, covering the valid times of all twelve configured cyclone cases. It then prepares the labelled event files and the current live forecast catalog. This reduces preparation from 720 to 240 climatology cases. Live EFI is available only when a forecast's valid month has been prepared; add the other months to `climatology_months` for year-round operation.

```powershell
ml_service/.venv/Scripts/python.exe -m ml_service.public_data prepare-climatology
ml_service/.venv/Scripts/python.exe -m ml_service.public_data prepare-events
ml_service/.venv/Scripts/python.exe -m ml_service.public_data prepare-live --leads 72,96,120,144,168,192,216,240
```

`npm.cmd run ml:prepare` runs those three stages in order. Downloads resume at completed monthly/event outputs unless `--force` is passed. Raw GRIB messages are range-requested through NOAA `.idx` byte offsets; CHIRPS is read as a Cloud Optimized GeoTIFF window for `[68E, 6N, 98E, 36N]`. Generated data and catalogs stay under `ml_service/data/public/` and are ignored by Git.

Train only after both catalogs exist:

```powershell
ml_service/.venv/Scripts/python.exe -m ml_service.train --catalog ml_service/data/public/training-catalog.json --output ml_service/artifacts --epochs 20
ml_service/.venv/Scripts/python.exe -m ml_service.train_tracker --catalog ml_service/data/public/tracking-catalog.json --output ml_service/artifacts --epochs 20
```

If training finishes but the final evaluation is interrupted, resume the saved downscaler checkpoint without repeating optimization:

```powershell
ml_service/.venv/Scripts/python.exe -m ml_service.train --catalog ml_service/data/public/training-catalog.json --output ml_service/artifacts --evaluate-only
```

An artifact remains unusable if it fails either held-out gate. A GPU is strongly recommended for the diffusion training. The selected public sources are [NOAA GEFS reforecasts](https://registry.opendata.aws/noaa-gefs-reforecast/) and [CHIRPS v3](https://chc.ucsb.edu/data/chirps3). CHIRPS-GEFS may be displayed later as an external comparison product, but it is not used or labelled as REYVA's trained output.

## Data contract

Training uses `training-catalog.example.json` as a schema. Supply at least ten distinct historical events, each with a coarse NetCDF or GRIB2 forecast and a matching 0.05° observation/reference NetCDF or GRIB2. Each pair must cover the same valid time and accumulation window, use a recognized precipitation depth unit (`mm`, `kg m-2`, or `m`), and include 1D latitude/longitude coordinates. The target must be approximately 0.05° and strictly finer than the input. ERA5 alone does not qualify as a 5 km target.

`train.py` splits whole events into train, validation and held-out test groups. It trains a conditional DDPM with a peak-weighted loss and a mean-field consistency penalty, then compares it against bilinear interpolation. It approves the checkpoint only if validation and held-out test MAE improve and the held-out 99th-percentile error improves. These are minimum release gates, not a guarantee of operational forecast skill. Additional independent evaluation is needed before public warning use.

The `tracking.py` module defines a spherical grid graph with great-circle edge distances. It uses DGL message passing when a compatible DGL installation is present and PyTorch message passing otherwise. `train_tracker.py` trains it against observed binary anomaly masks, holds out whole events, and releases a checkpoint only when its F1 score beats the declared threshold baseline on validation and test events. No labelled masks or tracker weights are bundled. The current dashboard track still comes from sampled GEFS screening until a validated tracker is connected to that display.

Catalog `bounds` crop global files before loading them through Xarray/Dask.

`efi.py` computes the Extreme Forecast Index from ensemble members and a model-climate quantile grid using the ECMWF weighted CDF integral. Build the EFI feature from the ensemble forecast and matching calendar/lead-time climatology before creating the tracker catalog:

```powershell
ml_service/.venv/Scripts/python.exe -m ml_service.efi --forecast ml_service/data/neps-g.grib2 --forecast-variable tp --climate ml_service/data/model-climate.nc --climate-variable tp_quantiles --output ml_service/data/forecast-efi.nc
```

The model climate needs at least nine interior quantiles on exactly the same grid as the ensemble. The tracker example uses EFI as its first feature and compares the GNN against an EFI of 0.5 threshold baseline.

## Train and run

Use Python 3.12 and a GPU machine for training. From the repository root:

```powershell
uv sync --project ml_service --no-install-project --python 3.12
ml_service/.venv/Scripts/python.exe -m ml_service.train --catalog ml_service/training-catalog.json --output ml_service/artifacts --epochs 20
```

For the graph tracker, use `tracking-catalog.example.json` as the labelled catalog schema:

```powershell
ml_service/.venv/Scripts/python.exe -m ml_service.train_tracker --catalog ml_service/tracking-catalog.json --output ml_service/artifacts --epochs 20
```

The PyTorch path runs without DGL. On a Linux GPU server, install a [DGL build compatible with that server's PyTorch and CUDA versions](https://www.dgl.ai/pages/start.html) to use DGL message passing. DGL's available Windows wheels are older than its current Linux release, so the project does not force a potentially incompatible DGL install on Windows.

The training catalog's paths refer to your own files. Check the generated `ml_service/artifacts/validation.json`. A failed gate leaves `approved: false` and the API will refuse inference.

Create `ml_service/live-catalog.json` from `live-catalog.example.json`, pointing each event and lead hour to an actual current gridded forecast file. The existing Open-Meteo 16-point sample cannot fill this catalog. Then start the private service:

```powershell
$env:ML_INTERNAL_KEY = 'the-same-long-random-secret-as-ML_API_KEY'
$env:ML_ARTIFACT_DIR = 'ml_service/artifacts'
$env:ML_LIVE_CATALOG = 'ml_service/live-catalog.json'
ml_service/.venv/Scripts/python.exe -m uvicorn ml_service.app:app --host 127.0.0.1 --port 8000
```

Copy `cloudflare/.dev.vars.example` to `cloudflare/.dev.vars` and set `ML_API_KEY` to the same value. Run `npm.cmd run worker:dev` in another terminal. The Worker exposes `/api/ml/status`, `/api/ml/track/LIVE-RAIN?hour=96`, and `/api/downscaled/LIVE-RAIN?hour=96`. The downscaling response includes a 64×64 rainfall grid, source, valid time, and held-out metrics only after the artifact gate passes. The downscaling page renders this grid on the interactive map. The graph response is a screened coarse-grid centroid and bounds, not a calibrated hazard probability.

For deployment, host the FastAPI service on a private GPU service reachable over HTTPS. Set `ML_API_ORIGIN` as a Worker variable and `ML_API_KEY` as a Worker secret. Mount the verified artifacts and live forecast catalog on the GPU service. Keep these files out of Git.
