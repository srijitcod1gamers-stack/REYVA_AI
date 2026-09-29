import { lazy, Suspense, useEffect } from 'react';
import {
  ArrowUpRight,
  Download,
  Hospital,
  MapPin,
  School,
  ShieldCheck,
  Users,
  Wheat,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWeather } from '../providers/WeatherProvider';
import { infrastructure } from '../../shared/fixtures';
import { Badge, DemoTag, Metric, PageHeading, SectionLabel } from '../components/ui/Primitives';
import { ImpactDetail } from '../components/events/EventIntelligence';
import { download, number } from '../utils/format';
import { distanceKm } from '../../shared/simulation';
import type { Coordinate } from '../../shared/types';
const MapCanvas = lazy(() => import('../components/map/MapCanvas'));
export default function Impact() {
  const w = useWeather(),
    navigate = useNavigate();
  useEffect(() => {
    if (w.selected.provenance.kind === 'forecast') return;
    if (!w.layers.has('population')) w.toggleLayer('population');
    if (!w.layers.has('hospitals')) w.toggleLayer('hospitals');
  }, []);
  if (w.selected.provenance.kind === 'forecast') return <LiveImpact />;
  return (
    <div className="page">
      <PageHeading
        eyebrow="WEATHER HAZARD → HUMAN IMPACT"
        title="Impact intelligence"
        description={`Understand potential exposure across ${w.selected.region.toLowerCase()} at T+${w.hour}h.`}
        actions={
          <>
            <DemoTag />
            <button
              className="secondary-button"
              onClick={() =>
                download(`${w.selected.id}-impact.json`, {
                  event_id: w.selected.id,
                  forecast: w.frame.timestamp,
                  impact: w.frame.impact,
                  provenance: w.selected.provenance,
                })
              }
            >
              <Download size={14} /> Export assessment
            </button>
          </>
        }
      />
      <div className="impact-kpis">
        {[
          { label: 'Potentially exposed people', value: number(w.frame.impact.population), icon: Users },
          { label: 'Settlements in footprint', value: w.frame.impact.villages, icon: MapPin },
          { label: 'Hospitals', value: w.frame.impact.hospitals, icon: Hospital },
          { label: 'Cropland exposed', value: number(w.frame.impact.croplandHa), icon: Wheat },
        ].map((m) => (
          <div className="panel" key={m.label}>
            <m.icon size={19} />
            <Metric label={m.label} value={m.value} unit={m.icon === Wheat ? 'ha' : ''} />
          </div>
        ))}
      </div>
      <div className="impact-layout">
        <div>
          <div className="impact-map panel">
            <Suspense fallback={<div className="loading-line" />}>
              <MapCanvas />
            </Suspense>
            <span className="map-data-tag">SYNTHETIC ASSETS · NOT VERIFIED FACILITIES</span>
          </div>
          <div className="panel asset-list">
            <SectionLabel>Priority assets · illustrative locations</SectionLabel>
            {infrastructure.slice(0, 5).map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  w.inspectLocation(a.coordinates, a.name);
                  navigate('/');
                }}
              >
                <span className="event-icon">
                  <Hospital size={16} />
                </span>
                <span>
                  <strong>{a.name}</strong>
                  <small>
                    {a.coordinates[1].toFixed(3)}°N, {a.coordinates[0].toFixed(3)}°E
                  </small>
                </span>
                <Badge severity="HIGH" />
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
        </div>
        <aside className="panel impact-side">
          <SectionLabel extra={<ShieldCheck size={16} />}>Response planning</SectionLabel>
          <ImpactDetail />
        </aside>
      </div>
    </div>
  );
}
function LiveImpact() {
  const w = useWeather();
  const ring = w.frame.polygons[0].geometry.coordinates[0];
  const radius = Math.round(
    Math.max(...ring.map((point) => distanceKm(w.frame.centroid, point as Coordinate))),
  );
  const area = Math.round(Math.PI * radius * radius);
  return (
    <div className="page">
      <PageHeading
        eyebrow="HAZARD FOOTPRINT SCREENING"
        title="Affected-area estimate"
        description={`Approximate footprint around ${w.selected.region} at T+${w.hour}h.`}
        actions={<DemoTag>GEOMETRIC ESTIMATE · NOT VALIDATED</DemoTag>}
      />
      <div className="impact-kpis">
        <div className="panel">
          <Metric label="Screening severity" value={w.frame.severity} />
        </div>
        <div className="panel">
          <Metric label="Approximate radius" value={radius} unit="km" />
        </div>
        <div className="panel">
          <Metric label="Approximate area" value={number(area)} unit="km²" />
        </div>
        <div className="panel">
          <Metric label="Rainfall / 24h" value={w.frame.metrics.rainfall} unit="mm" />
        </div>
      </div>
      <div className="impact-layout">
        <div className="impact-map panel">
          <Suspense fallback={<div className="loading-line" />}>
            <MapCanvas />
          </Suspense>
          <span className="map-data-tag">SAMPLED GEFS VALUES · APPROXIMATE RINGS</span>
        </div>
        <aside className="panel impact-side">
          <SectionLabel>Interpretation</SectionLabel>
          <p className="muted">
            The highlighted outline is a screening radius around a sampled forecast location. It is not
            an exact affected boundary, a 5 km model field, or a population exposure calculation.
          </p>
          <p className="muted">
            For a deployable impact analysis, intersect validated hazard polygons with current
            population, facility and road datasets.
          </p>
          <button
            className="secondary-button full"
            onClick={() =>
              download(`${w.selected.id}-footprint.geojson`, {
                type: 'FeatureCollection',
                features: w.frame.polygons,
              })
            }
          >
            <Download size={14} /> Export approximate GeoJSON
          </button>
        </aside>
      </div>
    </div>
  );
}
