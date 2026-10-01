import { lazy, Suspense, useEffect, useRef, useState } from 'react';
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
import { datasetRequest } from './Historical';
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
  const ring = w.frame.polygons[0]?.geometry.coordinates[0] ?? [];
  const radius = Math.round(
    Math.max(0, ...ring.map((point) => distanceKm(w.frame.centroid, point as Coordinate))),
  );
  const area = Math.round(w.frame.areaKm2 ?? Math.PI * radius * radius);
  const [exposure, setExposure] = useState<{
    assets: { id: string; name: string; kind: string; coordinates: Coordinate }[];
    counts: Record<string, number>;
    method: string;
    fetched_at: string;
  } | null>(null);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const assessmentVersion = useRef(0);
  useEffect(() => {
    assessmentVersion.current++;
    setExposure(null);
    setError('');
    setLoading(false);
  }, [w.selected.id, w.frame.hour]);
  async function assess() {
    const version = ++assessmentVersion.current;
    setLoading(true);
    setError('');
    try {
      const result = await datasetRequest<NonNullable<typeof exposure>>(
        `/exposure?event_id=${w.selected.id}&hour=${w.frame.hour}`,
      );
      if (version === assessmentVersion.current) setExposure(result);
    } catch (e) {
      if (version === assessmentVersion.current)
        setError(e instanceof Error ? e.message : 'Assessment failed');
    } finally {
      if (version === assessmentVersion.current) setLoading(false);
    }
  }
  return (
    <div className="page">
      <PageHeading
        eyebrow="HAZARD FOOTPRINT SCREENING"
        title="Hazard footprint and facility exposure"
        description={`Forecast threshold area at T+${w.frame.hour}h. Find mapped facilities inside this area for response planning.`}
        actions={<DemoTag>{w.frame.grid ? 'NATIVE GRID FOOTPRINT' : 'SCREENING ESTIMATE'}</DemoTag>}
      />
      <div className="impact-kpis">
        <div className="panel">
          <Metric label="Screening severity" value={w.frame.severity} />
        </div>
        <div className="panel">
          <Metric label="Approximate radius" value={radius} unit="km" />
        </div>
        <div className="panel">
          <Metric
            label={w.frame.grid ? 'Threshold-exceedance area' : 'Approximate area'}
            value={number(area)}
            unit="km²"
          />
        </div>
        <div className="panel">
          <Metric label="Rainfall / 24h" value={w.frame.metrics.rainfall} unit="mm" />
        </div>
      </div>
      <div className="impact-layout">
        <div className="impact-map panel">
          <Suspense fallback={<div className="loading-line" />}>
            <MapCanvas focus facilities={exposure?.assets} />
          </Suspense>
          <span className="map-data-tag">
            {w.frame.grid ? 'NATIVE GEFS CELLS / THRESHOLD FOOTPRINT' : 'SAMPLED GEFS VALUES'}
          </span>
        </div>
        <aside className="panel impact-side">
          <SectionLabel>Response planning</SectionLabel>
          {w.frame.grid && (
            <>
              <button
                className="primary-button full"
                disabled={loading || (Boolean(w.frame.grid) && w.frame.hour !== w.hour)}
                onClick={assess}
              >
                {loading ? 'Checking mapped facilities...' : 'Find exposed facilities'}
              </button>
              {error && <p role="alert">{error}</p>}
              {exposure && (
                <div className="exposure-results">
                  <p>{exposure.assets.length} mapped facilities inside the footprint.</p>
                  {Object.entries(exposure.counts).map(([kind, count]) => (
                    <p key={kind}>
                      {kind}: <b>{count}</b>
                    </p>
                  ))}
                  <p className="fine-print">{exposure.method}</p>
                  {exposure.assets.length > 30 && (
                    <p className="fine-print">
                      Showing the first 30 facilities. Export includes every mapped facility found.
                    </p>
                  )}
                  {exposure.assets.slice(0, 30).map((a) => (
                    <a
                      key={a.id}
                      href={`https://www.openstreetmap.org/${a.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {a.name} / {a.kind}
                    </a>
                  ))}
                  <button
                    className="secondary-button full"
                    onClick={() => download(`${w.selected.id}-facility-exposure.json`, exposure)}
                  >
                    Export facility assessment
                  </button>
                  <small>
                    ©{' '}
                    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                      OpenStreetMap contributors
                    </a>{' '}
                    (ODbL), snapshot retrieved {exposure.fetched_at}
                  </small>
                </div>
              )}
            </>
          )}
          <SectionLabel>Interpretation</SectionLabel>
          <p className="muted">
            The outline contains contiguous native cells exceeding 25 mm/24h rainfall or 50 km/h gusts.
            Area is the sum of those cells, accounting for latitude. An empty outline means the selected
            object is absent at this forecast step.
          </p>
          <p className="muted">
            Check hospitals, clinics, schools and fire stations whose mapped positions lie inside the
            forecast footprint. OpenStreetMap coverage can be incomplete. Population totals require a
            separate census dataset and are not estimated here.
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
            <Download size={14} /> Export footprint GeoJSON
          </button>
        </aside>
      </div>
    </div>
  );
}
