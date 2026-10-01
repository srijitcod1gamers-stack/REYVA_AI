> This audit records the starting state. The migration and subsequent fixes are described in PROJECT_STATUS.md.

# REYVA AI website audit — 1 October 2026

The deployed site is a working live forecast screening prototype. The prepared NOAA/CHIRPS pipeline and trained models exist locally, but their outputs are not connected to production. The full SIH anomaly detection → tracking → validated downscaling → impact pipeline is therefore incomplete.

## What each screen currently does

| Screen / question              | Verified explanation                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where are the changes?         | The previous release corrected live/API labels, production API URLs and periodic refresh. It did not enable validated ML inference or add historical event playback from the prepared datasets.                                                                                                                                          |
| Command center: small circles  | Blue circles represent 16 sampled weather locations; their rendering radius is fixed at 43 km. Orange rings are generated geometric screening outlines. Neither represents a native weather raster or an observed storm size. The line joins the strongest sampled location at each time; it can jump between unrelated weather systems. |
| Downscaling: ML unconfigured   | The deployed `/api/ml/status` returns HTTP 503. The Worker requires an HTTPS ML service URL and matching key. Separately, both local checkpoints have `approved: false`, so connecting them alone would still not enable inference.                                                                                                      |
| Impact intelligence            | Intended to identify people, facilities and roads exposed to a hazard. Currently the live page calculates an approximate radius and `π × radius²` around a generated ring. It does not measure actual affected area or intersect population/facility datasets. Useful only as a rough geographic preview.                                |
| Historical replay: only Amphan | `/replay` selects a single hardcoded Amphan-inspired synthetic scenario. The prepared historical cases are training/evaluation files and have no replay loader or event selector. The four events in the replay event list are illustrative fixtures.                                                                                    |
| Why only some regions?         | Automated screening scans 16 fixed locations around India and the Indian Ocean. Clicking another coordinate requests its forecast, but does not extend automatic scanning there. Prepared training data are cropped to 68–98°E and 6–36°N. The fast climatology scope covers May, October, November and December.                        |

## Where the prepared work is

All paths below are relative to the repository root.

- `ml_service/data/public/climatology/`: historical model/observation climatology, caches and training pairs; metadata describes 240 cases over 2000–2019 for four months.
- `ml_service/data/public/events/`: 12 named historical verification cases with precipitation, EFI, wind gust, pressure and observed masks.
- `ml_service/data/public/training-catalog.json`: 52 samples (12 event cases plus 40 training-only climatology cases).
- `ml_service/data/public/tracking-catalog.json`: 12 labelled tracker samples.
- `ml_service/data/public/live-catalog.json`: eight forecast leads for the 30 September 2026, 06 UTC NOAA cycle. This is a saved snapshot, not an automatically refreshed production feed.
- `ml_service/artifacts/`: downscaler weights, tracker weights and both validation reports.

Every referenced file exists. Both checkpoint hashes match their reports. These files are excluded from Git and are not served by the deployed dashboard; B2 secret configuration alone does not upload or connect them.

The downscaler's held-out test MAE is **12.271 mm**, versus **12.241 mm** for interpolation; it failed the release gate. The tracker's test F1 is **0.138**, versus a required minimum **0.5**, and its validation F1 is below the baseline. Neither model is currently accurate enough to release under the project's checks.

## Is the live forecast OK?

Production health, events and forecast endpoints returned HTTP 200 during this audit. The frame for 4 October at 00 UTC contained 16 samples and reported 8 mm/24h at the selected maximum. This confirms a working live data connection, not measured forecast skill. LOW severity is a rule-based screening classification; an 8% screening index is not an 8% probability or accuracy score.

The provider supplies ensemble mean/spread values; these summarize model members rather than independent verification observations. See the [Open-Meteo ensemble mean documentation](https://open-meteo.com/en/docs/ensemble-mean-api). Forecast accuracy requires archived forecasts compared with observations at matching locations, times and rainfall accumulation windows. That verification is not implemented for the deployed live feed.

## Defects and remaining work

1. Replace the 16-site scan and generated rings with gridded hazard detection and connected-component footprints; associate detected objects across times.
2. Improve the training dataset and evaluate new model versions independently, then deploy the accepted FastAPI artifacts over HTTPS and connect the Worker. Keep rejected outputs withheld.
3. Add real historical data playback and a case selector. Training files do not automatically become replay data.
4. Implement population/facility/road intersections for meaningful impact estimates.
5. Correct misleading metadata: forecast `run` currently uses the first forecast timestamp rather than verified model initialization; displayed 31-member metadata is assigned in code; replay can still show “GEFS forecast loaded”; demo assets can remain visible in live maps. The selected event's peak-region label can differ from the current frame location.
6. Correct lead-time climatology before releasing live EFI: climatology is prepared at 96 hours, while live EFI currently reuses it across 72–240 hours. Add source freshness and missing-value checks, and schedule gridded catalog refresh.

This audit made no website changes. It identifies why the screenshots still show these limitations and what must be implemented before claiming the complete SIH pipeline.
