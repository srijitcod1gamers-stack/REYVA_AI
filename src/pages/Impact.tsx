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
const MapCanvas = lazy(() => import('../components/map/MapCanvas'));
export default function Impact() {
  const w = useWeather(),
    navigate = useNavigate();
  useEffect(() => {
    if (!w.layers.has('population')) w.toggleLayer('population');
    if (!w.layers.has('hospitals')) w.toggleLayer('hospitals');
  }, []);
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
