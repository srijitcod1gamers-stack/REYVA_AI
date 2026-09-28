import { readFile, writeFile } from 'node:fs/promises';

// Region extends beyond India to keep the Bay of Bengal track and neighboring context.
const region = { west: 48, east: 122, south: -10, north: 47 };
const sources = {
  countries: 'ne_50m_admin_0_countries.geojson',
  states: 'ne_50m_admin_1_states_provinces_lines.geojson',
  rivers: 'ne_50m_rivers_lake_centerlines.geojson',
};
const sourceRoot = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';

function bounds(geometry) {
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity;
  function visit(value) {
    if (typeof value[0] === 'number') {
      const [lon, lat] = value;
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    } else for (const child of value) visit(child);
  }
  visit(geometry.coordinates);
  return { west, east, south, north };
}
function intersects(a, b) {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}
for (const [kind, file] of Object.entries(sources)) {
  let source;
  try {
    source = JSON.parse(await readFile(`public/geo/${kind}.geojson`, 'utf8'));
  } catch {
    const response = await fetch(sourceRoot + file);
    if (!response.ok) throw new Error(`Natural Earth returned ${response.status}`);
    source = await response.json();
  }
  const features = source.features
    .filter((feature) => feature.geometry && intersects(bounds(feature.geometry), region))
    .map((feature) => ({
      type: 'Feature',
      properties:
        kind === 'countries' ? { name: feature.properties?.ADMIN || feature.properties?.NAME } : {},
      geometry: feature.geometry,
    }));
  const result = { type: 'FeatureCollection', features };
  await writeFile(`public/geo/${kind}-region.geojson`, JSON.stringify(result));
  console.log(
    `${kind}: ${source.features.length} → ${features.length} features; ${JSON.stringify(result).length} bytes`,
  );
}
