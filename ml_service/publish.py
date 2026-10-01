"""Export prepared native grids and migrate verified files to private Backblaze B2.

Run from the repository root: python -m ml_service.publish export|upload.
No training artifact is promoted; its measured validation status is published.
"""
import argparse
import hashlib
import hmac
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

import numpy as np
import rasterio.features
from rasterio.transform import from_origin
from scipy.ndimage import label

from .data import open_field

ROOT = Path('ml_service/data/public')
OUTPUT = ROOT / 'published'


def write(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(body, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    for attempt in range(8):
        try:
            temporary.replace(path)
            break
        except PermissionError:
            if attempt == 7:
                raise
            time.sleep(.25 * (attempt + 1))


def grid(field):
    values = np.asarray(field.values, dtype=float)
    return {'latitudes': np.asarray(field.lat).round(5).tolist(),
            'longitudes': np.asarray(field.lon).round(5).tolist(),
            'values': [[round(float(v), 2) if np.isfinite(v) else None for v in row] for row in values]}


def footprints(field, threshold):
    values = np.asarray(field.values)
    components, count = label(np.isfinite(values) & (values >= threshold))
    dy = float(np.median(np.diff(field.lat)))
    dx = float(np.median(np.diff(field.lon)))
    transform = from_origin(float(field.lon.min()) - dx / 2, float(field.lat.max()) + dy / 2, dx, dy)
    objects = []
    for identity in range(1, count + 1):
        ys, xs = np.where(components == identity)
        if len(ys) < 4:
            continue
        cell_areas = 6371.0088 ** 2 * math.radians(dx) * (
            np.sin(np.radians(field.lat.values[ys] + dy / 2)) - np.sin(np.radians(field.lat.values[ys] - dy / 2)))
        weights = values[ys, xs]
        centroid = [float(np.average(field.lon.values[xs], weights=weights)),
                    float(np.average(field.lat.values[ys], weights=weights))]
        polygons = [shape for shape, val in rasterio.features.shapes(
            (components[::-1] == identity).astype('uint8'), transform=transform) if val == 1]
        objects.append({'centroid': centroid, 'area_km2': round(float(cell_areas.sum()), 1),
                        'cells': len(ys), 'peak': round(float(weights.max()), 2),
                        'geometries': polygons})
    return sorted(objects, key=lambda item: item['peak'], reverse=True)


def export_live():
    catalog = json.loads((ROOT / 'live-catalog.json').read_text())
    init = catalog['initialization']
    cycle = datetime.fromisoformat(init).strftime('%Y%m%d%H')
    frames = []
    for run in catalog['runs']:
        hour = run['hour']
        folder = Path(run['forecast']).parent
        rain = open_field(run['forecast'], run['variable'])
        gust = open_field(str(folder / 'forecast-wind-gust.nc'), 'wind_gust') * 3.6
        pressure = open_field(str(folder / 'forecast-pressure-msl.nc'), 'pressure_msl') / 100
        key = f'raster/live/{cycle}/{hour}.json'
        write(OUTPUT / key, {'hour': hour, 'valid_time': run['valid_time'], 'initialization': init,
            'source': run['source'], 'ensemble_members': 5, 'resolution_degrees': float(np.median(np.diff(rain.lat))),
            'accumulation_hours': 24, 'fields': {'rainfall': grid(rain), 'wind': grid(gust), 'pressure': grid(pressure)},
            'objects': {'rainfall': footprints(rain, 25), 'wind': footprints(gust, 50)},
            'climatology': 'Live EFI withheld until lead-matched climatology is available'})
        frames.append({'hour': hour, 'valid_time': run['valid_time'], 'key': key})
    live = {'initialization': init, 'published_at': datetime.now(timezone.utc).isoformat(),
            'bounds': [68, 6, 98, 36], 'resolution_degrees': .25, 'ensemble_members': 5, 'frames': frames}
    write(OUTPUT / 'raster/live/latest.json', live)
    return live


def export():
    live = export_live()
    historical = []
    training = json.loads((ROOT / 'training-catalog.json').read_text())['samples']
    for sample in training:
        if sample.get('split') == 'train':
            continue
        case = sample['event_id']
        forecast = open_field(sample['forecast'], sample['forecast_variable'])
        observed = open_field(sample['observation'], sample['observation_variable'])
        interpolated = forecast.interp(lat=observed.lat, lon=observed.lon)
        valid = np.isfinite(observed.values) & np.isfinite(interpolated.values)
        errors = (interpolated.values - observed.values)[valid]
        metrics = {'mae_mm': round(float(np.abs(errors).mean()), 3),
                   'rmse_mm': round(float(np.sqrt(np.square(errors).mean())), 3),
                   'observed_cells': int(valid.sum()), 'scope': 'CHIRPS-covered land cells; whole regional grid'}
        initial = (np.datetime64(sample['valid_time'].replace('Z', '')) - np.timedelta64(sample['lead_hours'], 'h'))
        key = f'replay/{case}/96.json'
        write(OUTPUT / key, {'id': case, 'hour': 96, 'initialization': str(initial) + 'Z',
            'valid_time': sample['valid_time'], 'accumulation_hours': 24,
            'source': 'NOAA GEFSv12 five-member reforecast / CHIRPS v3 RNL observations',
            'forecast': grid(forecast), 'observation': grid(observed), 'interpolation': grid(interpolated),
            'metrics': metrics, 'objects': footprints(forecast, 25),
            'resolution_degrees': {'forecast': float(np.median(np.diff(forecast.lat))), 'observation': .05},
            'note': 'Actual 24-hour verification case, not a full reconstructed cyclone track'})
        historical.append({'id': case, 'name': case.replace('-', ' ').title(), 'valid_time': sample['valid_time'],
                           'hours': [96], 'key': key, 'metrics': metrics})
    write(OUTPUT / 'replay/catalog.json', {'cases': historical, 'source': 'Prepared NOAA GEFS / CHIRPS files'})
    reports = {}
    for key, name in [('model', 'validation.json'), ('tracker', 'tracker-validation.json')]:
        path = Path('ml_service/artifacts') / name
        report = json.loads(path.read_text()) if path.exists() else {'approved': False}
        reports[key] = {**report, 'ready': bool(report.get('approved')), 'evaluation_note': ('Whole-region held-out evaluation includes all CHIRPS-covered land cells' if 'complete regional' in report.get('validation_scope', '') else 'Legacy downscaler test used one 64x64 land patch per case; not whole-region skill') if key == 'model' else 'Held-out CHIRPS-labelled rainfall screening; not independently validated storm tracking'}
    write(OUTPUT / 'model-output/status.json', {'service': 'published-validation-reports', **reports,
        'live_catalog_connected': True, 'training_samples': len(training), 'historical_cases': len(historical),
        'inference_connected': False, 'published_at': datetime.now(timezone.utc).isoformat()})
    inventory = []
    for path in ROOT.rglob('*'):
        if path.is_file() and 'published' not in path.parts and path.suffix in ('.nc', '.json'):
            inventory.append(path)
    inventory.extend(p for p in Path('ml_service/artifacts').rglob('*') if p.is_file())
    write(OUTPUT / 'model-output/inventory.json', {'files': len(inventory),
        'bytes': sum(p.stat().st_size for p in inventory), 'training_samples': len(training),
        'tracking_samples': 12, 'historical_cases': len(historical), 'live': live,
        'model_approved': reports['model'].get('approved', False), 'tracker_approved': reports['tracker'].get('approved', False)})
    print(f'Exported {len(live['frames'])} native forecast grids and {len(historical)} observed historical cases', flush=True)


def secrets():
    import os
    settings = dict(os.environ)
    path = Path('cloudflare/.dev.vars')
    if path.exists():
        for line in path.read_text().splitlines():
            if '=' in line and not line.strip().startswith('#'):
                key, value = line.split('=', 1)
                settings.setdefault(key.strip(), value.strip().strip('\"\''))
    for name in ('B2_ENDPOINT', 'B2_REGION', 'B2_BUCKET', 'B2_KEY_ID', 'B2_APPLICATION_KEY'):
        if not settings.get(name):
            raise ValueError(f'Missing {name}; configure cloudflare/.dev.vars or host environment')
    return settings


def request(settings, method, key, content=b'', content_type='application/octet-stream'):
    raw_endpoint = settings['B2_ENDPOINT'].strip()
    if '://' not in raw_endpoint and raw_endpoint.endswith('.backblazeb2.com'):
        raw_endpoint = 'https://' + raw_endpoint
    endpoint = urlparse(raw_endpoint)
    if endpoint.scheme != 'https' or endpoint.username or endpoint.password:
        raise ValueError('B2 endpoint must be an HTTPS origin')
    path = '/' + quote(settings['B2_BUCKET'], safe='') + '/' + quote(key, safe='/')
    now = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    digest = hashlib.sha256(content).hexdigest()
    scope = now[:8] + '/' + settings['B2_REGION'] + '/s3/aws4_request'
    signed = 'host;x-amz-content-sha256;x-amz-date'
    headers = f'host:{endpoint.netloc}\nx-amz-content-sha256:{digest}\nx-amz-date:{now}\n'
    canonical = '\n'.join([method, path, '', headers, signed, digest])
    message = '\n'.join(['AWS4-HMAC-SHA256', now, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    signing = ('AWS4' + settings['B2_APPLICATION_KEY']).encode()
    for part in (now[:8], settings['B2_REGION'], 's3', 'aws4_request'):
        signing = hmac.new(signing, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(signing, message.encode(), hashlib.sha256).hexdigest()
    req = Request(endpoint.scheme + '://' + endpoint.netloc + path, method=method,
        data=content if method == 'PUT' else None, headers={'x-amz-date': now,
        'x-amz-content-sha256': digest, 'Content-Type': content_type,
        'Authorization': f'AWS4-HMAC-SHA256 Credential={settings["B2_KEY_ID"]}/{scope}, SignedHeaders={signed}, Signature={signature}'})
    return urlopen(req, timeout=180)


def upload(raw=False):
    settings = secrets()
    manifest_path = OUTPUT / 'migration-state.json'
    completed = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    rows = [(path, path.relative_to(OUTPUT).as_posix()) for path in OUTPUT.rglob('*.json')
            if path.name != 'migration-state.json']
    if raw:
        rows.extend((p, 'archive/' + p.as_posix()) for p in ROOT.rglob('*')
                    if p.is_file() and 'published' not in p.parts and p.suffix in ('.nc', '.json'))
        rows.extend((p, 'archive/' + p.as_posix()) for p in Path('ml_service/artifacts').rglob('*') if p.is_file())
    # Publish pointers only after all referenced immutable data have been stored.
    pointers = [(p, k) for p, k in rows if k.endswith('latest.json') or k == 'replay/catalog.json']
    rows = [(p, k) for p, k in rows if (p, k) not in pointers]
    def transfer(row):
        path, key = row
        content = path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        if completed.get(key) == digest:
            return key, digest, False
        for attempt in range(4):
            try:
                with request(settings, 'PUT', key, content, 'application/json' if path.suffix == '.json' else 'application/octet-stream'):
                    pass
                with request(settings, 'HEAD', key) as response:
                    if int(response.headers['Content-Length']) != len(content):
                        raise ValueError('B2 uploaded length differs from source')
                return key, digest, True
            except HTTPError as error:
                if error.code in (401, 403):
                    raise RuntimeError('B2 key does not allow migration writes; supply a bucket-scoped write key') from None
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
            except OSError:
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
    total = len(rows) + len(pointers)
    with ThreadPoolExecutor(max_workers=4) as executor:
        for index, (key, digest, changed) in enumerate(executor.map(transfer, rows), 1):
            completed[key] = digest
            write(manifest_path, completed)
            if changed or index % 50 == 0:
                print(f'[migration {index}/{total}] {key}', flush=True)
    for row in pointers:
        key, digest, _ = transfer(row)
        completed[key] = digest
        write(manifest_path, completed)
    print(f'Migration complete: {total} objects, pointers published last', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['export', 'upload', 'refresh'])
    parser.add_argument('--raw', action='store_true', help='Also migrate prepared NetCDF files and model artifacts to private archive/')
    args = parser.parse_args()
    if args.command == 'refresh':
        from .public_data import prepare_live
        manifest = json.loads(Path('ml_service/public-manifest.json').read_text())
        prepare_live(manifest, ROOT, list(range(72, 241, 24)))
        export_live()
        upload()
    elif args.command == 'export':
        export()
    else:
        upload(args.raw)
