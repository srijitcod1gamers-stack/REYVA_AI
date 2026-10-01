"""Publish a complete, resumable regional OSM facility snapshot to private B2.

Only a fully downloaded snapshot replaces the catalog. Counts represent mapped
facility points, never population, damage or completeness of community mapping.
"""
import hashlib
import json
import math
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from .publish import ROOT, request, secrets, write


def fetch_bbox(south, west, north, east):
    bbox = f'({south},{west},{north},{east})'
    # Exact tag queries use the provider's index and avoid expensive global regex scans.
    query = '[out:json][timeout:25];(' + ''.join(
        f'nwr[amenity={kind}]{bbox};' for kind in ('hospital', 'clinic', 'school', 'fire_station')
    ) + ');out center qt 100001;'
    url = 'https://overpass-api.de/api/interpreter?data=' + quote(query)
    last_error = None
    for attempt in range(4):
        try:
            req = Request(url, headers={'User-Agent': 'REYVA-AI-SIH/1.0 (regional facility snapshot)'})
            with urlopen(req, timeout=40) as response:
                body = json.load(response)
            if 'elements' not in body or body.get('remark') or len(body['elements']) > 100000:
                raise ValueError('Incomplete OSM query response')
            return body
        except HTTPError as error:
            if error.code not in (408, 429, 500, 502, 503, 504):
                raise
            if error.code == 429:
                time.sleep(min(120, 30 * (attempt + 1)))
            last_error = error
            if error.code != 429 and attempt >= 1:
                break
        except (URLError, TimeoutError, OSError, ValueError) as error:
            last_error = error
            if attempt >= 1:
                break
        time.sleep(2)
    if east - west > 4 and not (isinstance(last_error, HTTPError) and last_error.code == 429):
        middle = (west + east) / 2
        print(f'[facilities] Splitting slow query at latitude {south}, longitude {middle}', flush=True)
        left = fetch_bbox(south, west, north, middle)
        right = fetch_bbox(south, middle, north, east)
        return {'elements': left['elements'] + right['elements']}
    raise RuntimeError(f'Facility source failed for latitude {south}; cached sections retained') from last_error


def publish(force=False):
    cache = ROOT / 'facilities-cache'
    assets = {}
    oldest = datetime.now(timezone.utc).isoformat()
    def fetch_strip(south):
        path = cache / f'latitude-{south}.json'
        if not force and path.exists() and time.time() - path.stat().st_mtime < 7 * 86400:
            body = json.loads(path.read_text(encoding='utf-8'))
        else:
            body = fetch_bbox(south, 67, south + 1, 99)
            body['retrieved_at'] = datetime.now(timezone.utc).isoformat()
            write(path, body)
            print(f'[facilities downloaded] latitude {south}; {len(body["elements"])} mapped records', flush=True)
            time.sleep(1)
        return south, body
    with ThreadPoolExecutor(max_workers=1) as executor:
        sections = list(executor.map(fetch_strip, range(5, 37)))
    for south, body in sections:
        oldest = min(oldest, body['retrieved_at'])
        for item in body['elements']:
            center = item.get('center', item)
            lat, lon = center.get('lat'), center.get('lon')
            tags = item.get('tags', {})
            if lat is None or lon is None or not (5 <= lat <= 37 and 67 <= lon <= 99):
                continue
            key = f'{item["type"]}/{item["id"]}'
            assets[key] = {'id': key, 'name': tags.get('name', 'Unnamed ' + tags.get('amenity', 'facility')),
                           'kind': tags.get('amenity', 'facility'), 'coordinates': [lon, lat]}
        print(f'[facilities {south - 4}/32] latitude {south}; {len(assets)} distinct mapped facilities', flush=True)
    tiles = {}
    for asset in assets.values():
        lon, lat = asset['coordinates']
        tile = f'{math.floor(lat / 5) * 5}/{math.floor(lon / 5) * 5}'
        tiles.setdefault(tile, []).append(asset)
    settings = secrets()
    version = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    keys = {}
    for tile, rows in tiles.items():
        content = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        key = f'geojson/facilities/{version}/{tile}.json'
        with request(settings, 'PUT', key, content, 'application/json'):
            pass
        with request(settings, 'HEAD', key) as response:
            if int(response.headers['Content-Length']) != len(content):
                raise ValueError('Facility upload length mismatch')
        keys[tile] = {'key': key, 'sha256': hashlib.sha256(content).hexdigest(), 'count': len(rows)}
    catalog = {'source': 'OpenStreetMap / Overpass', 'license': 'ODbL-1.0',
               'bounds': [67, 5, 99, 37], 'tile_degrees': 5, 'tiles': keys,
               'facilities': len(assets), 'retrieved_at': oldest,
               'published_at': datetime.now(timezone.utc).isoformat(), 'complete_query': True}
    content = json.dumps(catalog, separators=(',', ':')).encode('utf-8')
    with request(settings, 'PUT', 'geojson/facilities/latest.json', content, 'application/json'):
        pass
    print(f'Published {len(assets)} OSM facilities in {len(keys)} tiles; catalog published last', flush=True)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true')
    publish(parser.parse_args().force)
