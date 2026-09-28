import { Database, ExternalLink, FileJson, Globe2, Layers, Mountain } from 'lucide-react';
import { DemoTag, PageHeading, SectionLabel } from '../components/ui/Primitives';
const sources = [
  {
    name: 'NCMRWF Research Data Service',
    detail:
      'Historical Indian weather and reanalysis. Access, variables, resolution, and licensing must be checked for the selected dataset.',
    status: 'External catalog · not ingested',
    url: 'https://rds.ncmrwf.gov.in/datasets',
    icon: Globe2,
  },
  {
    name: 'Global ensemble forecasts',
    detail:
      'Adapter accepts ensemble GRIB / NetCDF fields. No operational forecast feed is connected to this prototype.',
    status: 'Integration interface ready',
    url: 'https://www.ecmwf.int/en/forecasts/datasets',
    icon: Layers,
  },
  {
    name: 'Natural Earth',
    detail:
      'Bundled country boundaries, administrative lines, and rivers. Generalized cartographic geography, not legally authoritative boundaries.',
    status: 'Bundled · public domain',
    url: 'https://www.naturalearthdata.com/about/terms-of-use/',
    icon: Globe2,
  },
  {
    name: 'CARTO / OpenStreetMap',
    detail:
      'Optional online basemap context. Local geographic data remains available without the tile service.',
    status: 'Optional external tiles',
    url: 'https://www.openstreetmap.org/copyright',
    icon: Layers,
  },
  {
    name: 'Exposure & infrastructure',
    detail:
      'Current population, hospital, school, cropland, and road entities are synthetic. Connect authoritative layers before operational analysis.',
    status: 'Simulated fixtures',
    url: 'https://www.worldpop.org/',
    icon: Database,
  },
  {
    name: 'Elevation & terrain',
    detail:
      'Optional MapTiler Mapterhorn DEM powers 3D terrain when online; Rasterio prepares future self-hosted DEM tiles for R2. Intensity height encodes rainfall, not atmospheric altitude.',
    status: 'Optional external DEM',
    url: 'https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/',
    icon: Mountain,
  },
];
export default function DataSources() {
  return (
    <div className="page">
      <PageHeading
        eyebrow="PROVENANCE BEFORE PREDICTION"
        title="Data sources & trust"
        description="Know what is observed, modeled, generated, and simulated at every step."
        actions={<DemoTag>NO OPERATIONAL FEED CONNECTED</DemoTag>}
      />
      <div className="provenance-banner panel">
        <FileJson size={24} />
        <div>
          <strong>Every weather value in this prototype is simulated.</strong>
          <p>
            The fixed 27 September 2026 model run enables reproducible demonstrations. Historical replay
            is inspired by Amphan, not validated against its observed track.
          </p>
        </div>
      </div>
      <div className="data-source-grid">
        {sources.map((s) => (
          <article className="panel source-card" key={s.name}>
            <s.icon size={23} />
            <span className="source-status">{s.status}</span>
            <h3>{s.name}</h3>
            <p>{s.detail}</p>
            <a href={s.url} target="_blank" rel="noreferrer">
              Open source catalog <ExternalLink size={13} />
            </a>
          </article>
        ))}
      </div>
      <section className="panel data-contract">
        <SectionLabel>Clear provenance by design</SectionLabel>
        <div className="provenance-kinds">
          {[
            'Observed',
            'Forecast',
            'AI generated',
            'Interpolated',
            'Downscaled',
            'Simulated demo data',
          ].map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
        <p className="muted">
          Each API response carries source, model run, data kind, and a disclaimer. No model-performance
          result should be reported as validated until independent scientific evaluation is complete.
        </p>
      </section>
    </div>
  );
}
