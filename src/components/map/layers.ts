import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, Color, PickingInfo } from '@deck.gl/core';
import type { Coordinate, ForecastFrame, WeatherEvent, WeatherVariable } from '../../../shared/types';
import { irregularRing } from '../../../shared/simulation';
import { infrastructure, places } from '../../../shared/fixtures';
import type { LayerId } from '../../providers/WeatherProvider';

type Band = { polygon: Coordinate[]; color: Color; elevation: number };
type MapLine = { path: Coordinate[]; color?: Color };
export const variableInfo: Record<
  WeatherVariable,
  { label: string; unit: string; ticks: string[]; colors: string[] }
> = {
  rainfall: {
    label: 'Accumulated rainfall',
    unit: 'mm / 24h',
    ticks: ['0', '10', '25', '50', '100', '200+'],
    colors: ['#263c69', '#396baa', '#42b4ad', '#d6d16a', '#f0a052', '#df6063'],
  },
  temperature: {
    label: 'Surface temperature',
    unit: '°C',
    ticks: ['−10', '0', '15', '25', '35', '45+'],
    colors: ['#707dd5', '#589ed0', '#77c8ba', '#d6cb79', '#dc9056', '#d56565'],
  },
  wind: {
    label: '10 m wind speed',
    unit: 'km/h',
    ticks: ['0', '20', '40', '60', '100', '150+'],
    colors: ['#324761', '#3d7997', '#43b4bb', '#69cbbb', '#accb88', '#eed186'],
  },
  pressure: {
    label: 'Mean sea level pressure',
    unit: 'hPa',
    ticks: ['960', '975', '990', '1005', '1020', '1035'],
    colors: ['#b573a2', '#967fba', '#717cbc', '#527ea4', '#509c9b', '#80b7a0'],
  },
  humidity: {
    label: 'Relative humidity',
    unit: '%',
    ticks: ['0', '20', '40', '60', '80', '100'],
    colors: ['#413e55', '#505676', '#546e92', '#548bab', '#58adae', '#79cec1'],
  },
  anomaly: {
    label: 'Extreme anomaly score',
    unit: '%',
    ticks: ['0', '20', '40', '60', '80', '100'],
    colors: ['#354c5f', '#527c81', '#aaa16a', '#d9b55d', '#e99255', '#df626b'],
  },
  ensemble: {
    label: 'Ensemble agreement',
    unit: '%',
    ticks: ['0', '20', '40', '60', '80', '100'],
    colors: ['#374862', '#406386', '#448397', '#52a3a2', '#6bbfa9', '#94d8af'],
  },
};
function rgb(hex: string, alpha = 160): Color {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    alpha,
  ];
}
function fieldBands(frame: ForecastFrame, variable: WeatherVariable): Band[] {
  const palette = variableInfo[variable].colors;
  return Array.from({ length: 38 }, (_, i) => {
    const t = i / 37,
      radius = 3.45 * (1 - t * 0.92) * (0.8 + frame.metrics.rainfall / 700);
    const center: Coordinate = [frame.centroid[0] - (1 - t) * 0.4, frame.centroid[1] + (1 - t) * 0.4];
    return {
      polygon: irregularRing(center, radius, frame.hour + i * 2.8, 1.07),
      color: rgb(palette[Math.min(5, Math.floor(t * 6))], i === 0 ? 30 : 23 + t * 28),
      elevation: frame.metrics.rainfall * t * 170,
    };
  });
}
const grid: MapLine[] = [
  ...Array.from({ length: 16 }, (_, i) => ({
    path: [
      [50 + i * 5, -10],
      [50 + i * 5, 50],
    ] as Coordinate[],
  })),
  ...Array.from({ length: 13 }, (_, i) => ({
    path: [
      [50, -10 + i * 5],
      [125, -10 + i * 5],
    ] as Coordinate[],
  })),
];
const countries = [
  { name: 'I N D I A', coordinates: [79.5, 23.2] },
  { name: 'BANGLADESH', coordinates: [90.5, 24.2] },
  { name: 'MYANMAR', coordinates: [96.5, 21] },
  { name: 'NEPAL', coordinates: [83.7, 28.5] },
  { name: 'BHUTAN', coordinates: [90.5, 27.7] },
  { name: 'SRI LANKA', coordinates: [80.7, 7.5] },
  { name: 'PAKISTAN', coordinates: [69.5, 29] },
  { name: 'THAILAND', coordinates: [101.1, 17] },
];
const oceans = [
  { name: 'B A Y   O F   B E N G A L', coordinates: [87.4, 13.5] },
  { name: 'A R A B I A N   S E A', coordinates: [66.7, 15.6] },
];
export interface LayerOptions {
  frame: ForecastFrame;
  event: WeatherEvent;
  events: WeatherEvent[];
  variable: WeatherVariable;
  visible: Set<LayerId>;
  compare: boolean;
  view: string;
  onPick: (coordinates: Coordinate, name: string) => void;
  resolution?: number;
}
export function createLayers({
  frame,
  event,
  events,
  variable,
  visible,
  compare,
  view,
  onPick,
  resolution,
}: LayerOptions): Layer[] {
  const paths = event.trajectory.map((p) => p.coordinates),
    past = event.trajectory.filter((p) => p.hour <= frame.hour).map((p) => p.coordinates);
  const layers: Layer[] = [
    new PathLayer<MapLine>({
      id: 'coordinate-grid',
      data: grid,
      getPath: (d) => d.path,
      getColor: [113, 151, 169, 16],
      getWidth: 1,
      widthUnits: 'pixels',
    }),
  ];
  if (resolution) {
    const cell = resolution === 12 ? 0.38 : 0.15;
    const cells: Band[] = [];
    for (let x = -3; x < 3; x += cell)
      for (let y = -3; y < 3; y += cell) {
        const t = Math.max(0, 1 - Math.sqrt(x * x + y * y * 0.8) / 3),
          value =
            t * (resolution === 12 ? 0.83 : 1) +
            Math.sin(x * 11) * Math.cos(y * 9) * (resolution === 5 ? 0.07 : 0.015);
        if (t < 0.06) continue;
        const lng = frame.centroid[0] + x,
          lat = frame.centroid[1] + y;
        cells.push({
          polygon: [
            [lng, lat],
            [lng + cell * 0.98, lat],
            [lng + cell * 0.98, lat + cell * 0.98],
            [lng, lat + cell * 0.98],
          ],
          color: rgb(variableInfo.rainfall.colors[Math.max(0, Math.min(5, Math.floor(value * 6)))], 195),
          elevation: 0,
        });
      }
    layers.push(
      new PolygonLayer<Band>({
        id: 'resolution-field',
        data: cells,
        getPolygon: (d) => d.polygon,
        getFillColor: (d) => d.color,
        stroked: false,
      }),
    );
  } else
    layers.push(
      new PolygonLayer<Band>({
        id: 'weather-field',
        data: fieldBands(frame, variable),
        getPolygon: (d) => d.polygon,
        getFillColor: (d) => d.color,
        stroked: false,
        extruded: view === 'atmosphere',
        getElevation: (d) => d.elevation,
        material: false,
        transitions: { getPolygon: 240, getElevation: 240 },
      }),
    );
  if (visible.has('ensemble')) {
    const cone = [
      ...paths.map((p, i) => [p[0] - i * 0.045, p[1]] as Coordinate),
      ...[...paths].reverse().map((p, j) => [p[0] + (paths.length - 1 - j) * 0.045, p[1]] as Coordinate),
    ];
    layers.push(
      new PolygonLayer({
        id: 'uncertainty-cone',
        data: [cone],
        getPolygon: (d) => d,
        getFillColor: [112, 196, 202, 17],
        getLineColor: [137, 210, 211, 65],
        lineWidthMinPixels: 1,
      }),
    );
    const members = Array.from({ length: 23 }, (_, i) => ({
      path: paths.map(
        (p, j) =>
          [
            p[0] + Math.sin(i * 5.13) * j * 0.043 + Math.sin(j / 7 + i) * 0.09,
            p[1] + Math.cos(i * 7.2) * j * 0.02,
          ] as Coordinate,
      ),
    }));
    layers.push(
      new PathLayer<MapLine>({
        id: 'ensemble-members',
        data: members,
        getPath: (d) => d.path,
        getColor: [156, 216, 216, 60],
        widthMinPixels: 0.7,
      }),
    );
  }
  if (visible.has('risk'))
    layers.push(
      new PolygonLayer({
        id: 'risk-zones',
        data: frame.polygons,
        getPolygon: (d) => d.geometry.coordinates[0],
        getFillColor: (d, { index }): Color =>
          d.properties.severity === 'SEVERE'
            ? [246, 103, 109, index === 2 ? 24 : 12]
            : d.properties.severity === 'HIGH'
              ? [252, 153, 92, index === 2 ? 22 : 15]
              : [247, 177, 92, index === 2 ? 20 : 9],
        getLineColor: (d, { index }): Color =>
          d.properties.severity === 'SEVERE'
            ? [255, 133, 139, index === 2 ? 235 : 175]
            : d.properties.severity === 'HIGH'
              ? [244, 153, 100, index === 2 ? 225 : 190]
              : [239, 191, 105, index === 2 ? 210 : 135],
        getLineWidth: 1.2,
        lineWidthUnits: 'pixels',
        pickable: true,
        onClick: (info: PickingInfo) => {
          if (info.coordinate)
            onPick(
              info.coordinate.slice(0, 2) as Coordinate,
              info.object?.properties.label ?? event.name,
            );
        },
        transitions: { getPolygon: 250 },
      }),
    );
  if (compare)
    layers.push(
      new PathLayer<MapLine>({
        id: 'previous-run',
        data: [
          { path: irregularRing([frame.centroid[0] + 0.38, frame.centroid[1] - 0.2], 1.3, frame.hour) },
        ],
        getPath: (d) => d.path,
        getColor: [188, 171, 229, 210],
        getWidth: 2,
        widthUnits: 'pixels',
      }),
    );
  if (variable === 'pressure')
    layers.push(
      new PathLayer<MapLine>({
        id: 'pressure-contours',
        data: Array.from({ length: 9 }, (_, i) => ({
          path: irregularRing(frame.centroid, 0.8 + i * 0.58, frame.hour, 0.95),
        })),
        getPath: (d) => d.path,
        getColor: [197, 205, 230, 160],
        getWidth: 1,
        widthUnits: 'pixels',
      }),
    );
  if (visible.has('trajectory')) {
    const future: MapLine[] = [];
    for (let i = 0; i < paths.length - 1; i++) {
      const a = paths[i],
        b = paths[i + 1];
      future.push({ path: [a, [a[0] + (b[0] - a[0]) * 0.5, a[1] + (b[1] - a[1]) * 0.5]] });
    }
    layers.push(
      new PathLayer<MapLine>({
        id: 'future-track',
        data: future,
        getPath: (d) => d.path,
        getColor: [218, 234, 227, 165],
        getWidth: 1.8,
        widthUnits: 'pixels',
      }),
    );
    layers.push(
      new PathLayer<MapLine>({
        id: 'primary-track',
        data: [{ path: [...past, frame.centroid] }],
        getPath: (d) => d.path,
        getColor: [231, 244, 225, 250],
        getWidth: 2.5,
        widthUnits: 'pixels',
      }),
    );
    const days = event.trajectory.filter((p) => p.hour % 24 === 0);
    layers.push(
      new ScatterplotLayer({
        id: 'forecast-points',
        data: days,
        getPosition: (d) => d.coordinates,
        getRadius: 3,
        radiusUnits: 'pixels',
        getFillColor: (d) => (d.hour <= frame.hour ? [236, 242, 216] : [33, 48, 53]),
        stroked: true,
        getLineColor: [219, 230, 213, 230],
        lineWidthMinPixels: 1,
        pickable: true,
        onClick: (info: PickingInfo) => {
          if (info.object) onPick(info.object.coordinates, `T+${info.object.hour}h forecast point`);
        },
      }),
    );
    layers.push(
      new TextLayer({
        id: 'forecast-day-labels',
        data: days.filter((_, i) => i % 2 === 0),
        getPosition: (d) => d.coordinates,
        getText: (d) => `D${d.hour / 24}`,
        getColor: [210, 224, 213, 190],
        getSize: 10,
        getPixelOffset: [18, 0],
        fontFamily: 'IBM Plex Mono',
        fontWeight: 400,
      }),
    );
  }
  if (visible.has('population') || visible.has('hospitals'))
    layers.push(
      new ScatterplotLayer({
        id: 'exposed-assets',
        data: infrastructure.filter((d) => visible.has('population') || d.type === 'hospital'),
        getPosition: (d) => d.coordinates,
        getRadius: (d) => (d.type === 'hospital' ? 5 : 3),
        radiusUnits: 'pixels',
        getFillColor: (d) => (d.type === 'hospital' ? [135, 207, 240] : [236, 197, 132]),
        getLineColor: [18, 33, 40],
        stroked: true,
        lineWidthMinPixels: 1.5,
        pickable: true,
        onClick: (info: PickingInfo) => {
          if (info.object) onPick(info.object.coordinates, info.object.name);
        },
      }),
    );
  if (visible.has('agriculture'))
    layers.push(
      new PolygonLayer({
        id: 'demo-cropland',
        data: infrastructure.filter((d) => d.type === 'settlement'),
        getPolygon: (d) => irregularRing(d.coordinates, 0.12, 40),
        getFillColor: [144, 190, 96, 85],
        getLineColor: [169, 207, 128, 170],
        lineWidthMinPixels: 1,
      }),
    );
  if (visible.has('roads'))
    layers.push(
      new PathLayer<MapLine>({
        id: 'demo-road-corridors',
        data: [
          {
            path: [
              [83.3, 17.69],
              [84.1, 18.4],
              [85.2, 19.2],
              [85.82, 20.3],
              [86.5, 20.9],
              [87.55, 21.63],
              [88.36, 22.57],
            ],
          },
        ],
        getPath: (d) => d.path,
        getColor: [231, 198, 141, 195],
        getWidth: 2.5,
        widthUnits: 'pixels',
      }),
    );
  layers.push(
    new TextLayer({
      id: 'country-labels',
      data: countries,
      getPosition: (d) => d.coordinates as Coordinate,
      getText: (d) => d.name,
      getSize: (d) => (d.name.startsWith('I N') ? 19 : 10),
      getColor: [146, 167, 179, 190],
      fontFamily: 'DM Sans',
      fontWeight: 500,
    }),
  );
  layers.push(
    new TextLayer({
      id: 'ocean-labels',
      data: oceans,
      getPosition: (d) => d.coordinates as Coordinate,
      getText: (d) => d.name,
      getSize: 10,
      getColor: [118, 150, 166, 115],
      fontFamily: 'DM Sans',
    }),
  );
  layers.push(
    new ScatterplotLayer({
      id: 'city-points',
      data: places,
      getPosition: (d) => d.coordinates,
      getRadius: 2,
      radiusUnits: 'pixels',
      getFillColor: [164, 183, 193, 210],
    }),
  );
  layers.push(
    new TextLayer({
      id: 'city-labels',
      data: places,
      getPosition: (d) => d.coordinates,
      getText: (d) => d.name,
      getSize: 10,
      getColor: [174, 194, 204, 220],
      getPixelOffset: [0, 11],
      fontFamily: 'DM Sans',
    }),
  );
  layers.push(
    new ScatterplotLayer({
      id: 'other-events',
      data: events.filter((e) => e.id !== event.id),
      getPosition: (d) => d.centroid,
      getRadius: 6,
      radiusUnits: 'pixels',
      getFillColor: [226, 168, 92, 40],
      stroked: true,
      getLineColor: [237, 182, 106, 200],
      lineWidthMinPixels: 1.5,
      pickable: true,
      onClick: (info: PickingInfo) => {
        if (info.object) onPick(info.object.centroid, info.object.name);
      },
    }),
  );
  layers.push(
    new ScatterplotLayer({
      id: 'event-centroid-halo',
      data: [frame.centroid],
      getPosition: (d) => d,
      getRadius: 15,
      radiusUnits: 'pixels',
      getFillColor: [250, 237, 210, 25],
      stroked: true,
      getLineColor: [255, 239, 213, 160],
      lineWidthMinPixels: 1,
    }),
  );
  layers.push(
    new ScatterplotLayer({
      id: 'event-centroid',
      data: [frame.centroid],
      getPosition: (d) => d,
      getRadius: 5,
      radiusUnits: 'pixels',
      getFillColor: [255, 243, 216],
      stroked: true,
      getLineColor: [91, 66, 57],
      lineWidthMinPixels: 2,
    }),
  );
  layers.push(
    new TextLayer({
      id: 'event-centroid-label',
      data: [frame.centroid],
      getPosition: (d) => d,
      getText: () => `${event.id} · ${frame.severity}`,
      getColor: [255, 229, 198, 245],
      getSize: 10,
      getPixelOffset: [49, -22],
      fontFamily: 'IBM Plex Mono',
      fontWeight: 500,
      outlineWidth: 3,
      outlineColor: [14, 26, 34, 235],
    }),
  );
  return layers;
}
