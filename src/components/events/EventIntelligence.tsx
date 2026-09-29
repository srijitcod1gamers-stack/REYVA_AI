import { useCallback, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  ChevronRight,
  CloudRain,
  Crosshair,
  Download,
  GitCompareArrows,
  Hospital,
  Info,
  MapPin,
  MoveUpRight,
  School,
  ShieldCheck,
  Users,
  Waves,
  Wind,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWeather } from '../../providers/WeatherProvider';
import { Badge, DemoTag, Metric, Modal, SectionLabel } from '../ui/Primitives';
import { compact, download, number, utc } from '../../utils/format';
import { deltaFor } from '../../../shared/simulation';

export function EventIntelligence() {
  const w = useWeather(),
    navigate = useNavigate(),
    [tab, setTab] = useState('Overview'),
    [why, setWhy] = useState(false);
  const close = useCallback(() => setWhy(false), []),
    frame = w.frame,
    delta = deltaFor(frame);
  const rainfall =
      w.units === 'metric' ? frame.metrics.rainfall : (frame.metrics.rainfall / 25.4).toFixed(1),
    wind = w.units === 'metric' ? frame.metrics.wind : Math.round(frame.metrics.wind * 0.621371);
  if (!w.replay && w.selected.provenance.kind === 'forecast') return <LiveIntelligence />;
  if (w.location)
    return (
      <aside className="intelligence-panel location-panel">
        <div className="intelligence-eyebrow">
          <span>
            <MapPin size={13} /> LOCATION INTELLIGENCE
          </span>
          <button
            className="icon-button"
            onClick={w.clearLocation}
            aria-label="Close location inspector"
          >
            <X size={17} />
          </button>
        </div>
        <h2>{w.location.name}</h2>
        <p className="muted mono">
          {w.location.coordinates[1].toFixed(3)}° N, {w.location.coordinates[0].toFixed(3)}° E
        </p>
        <div className="event-status-row">
          <Badge severity={w.location.severity} />
          <DemoTag />
        </div>
        <div className="location-probability">
          <strong>
            {Math.round(w.location.probability * 100)}
            <small>%</small>
          </strong>
          <span>Modeled rainfall probability</span>
        </div>
        <div className="location-metrics">
          <Metric
            label="Expected rainfall"
            value={`${w.location.rainfall.min}–${w.location.rainfall.max}`}
            unit="mm"
          />
          <Metric label="Wind speed" value={w.location.wind} unit="km/h" />
          <Metric
            label="Arrival window"
            value={`${w.location.arrivalHours[0]}–${w.location.arrivalHours[1]}`}
            unit="h"
          />
          <Metric label="Distance from core" value={w.location.distanceKm} unit="km" />
        </div>
        <SectionLabel>Potential impact</SectionLabel>
        <p className="location-impact">{w.location.impact}.</p>
        <div className="info-note">
          <Info size={16} />
          <span>
            Synthetic proximity-based estimate for the selected event. Confidence {w.location.confidence}
            %. Not a safety advisory.
          </span>
        </div>
        <div className="provenance-line">
          {utc(frame.timestamp)} UTC · {w.selected.id}
        </div>
        <button
          className="secondary-button full"
          onClick={() => download(`location-risk-${w.selected.id}.json`, w.location)}
        >
          <Download size={14} /> Export location risk
        </button>
        <button className="text-button" onClick={w.clearLocation}>
          Return to event intelligence <ArrowRight size={14} />
        </button>
      </aside>
    );
  return (
    <aside className="intelligence-panel">
      <div className="intelligence-eyebrow">
        <span>
          <Crosshair size={13} /> EVENT INTELLIGENCE
        </span>
        <span className="mono">{w.selected.id}</span>
      </div>
      <div className="event-title-row">
        <h2>{w.replay && w.selected.id === 'WX-024' ? 'Cyclone Amphan' : w.selected.name}</h2>
        <Wind size={25} />
      </div>
      <p className="event-location">
        <MapPin size={12} />
        {w.selected.region}
        <span>·</span>
        {frame.centroid[1].toFixed(1)}°N, {frame.centroid[0].toFixed(1)}°E
      </p>
      <div className="event-status-row">
        <Badge severity={frame.severity} />
        <span className="trend-pill">
          <ArrowUpRight size={12} />
          {w.selected.status}
        </span>
        <button className="why-button" onClick={() => setWhy(true)}>
          Why {frame.severity.toLowerCase()}? <Info size={11} />
        </button>
      </div>
      <div className="detail-tabs" role="tablist" aria-label="Event intelligence sections">
        {['Overview', 'Ensemble', 'Impact'].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="intelligence-scroll">
        {tab === 'Overview' && w.mode === 'meteorology' ? (
          <>
            <div className="key-metrics">
              <Metric label="AI confidence" value={frame.confidence} unit="%" hint="Ensemble-informed" />
              <Metric
                label="Lead time"
                value={Math.max(0, w.selected.leadTime - (w.hour - 96))}
                unit="h"
                hint="Until modeled arrival"
              />
            </div>
            <div className="weather-metrics">
              <Metric
                label="Rainfall / 24h"
                value={rainfall}
                unit={w.units === 'metric' ? 'mm' : 'in'}
              />
              <Metric label="Max wind" value={wind} unit={w.units === 'metric' ? 'km/h' : 'mph'} />
              <Metric label="Pressure" value={frame.metrics.pressure} unit="hPa" />
            </div>
            <section className="panel-section">
              <SectionLabel
                extra={
                  <span className="mint">
                    {frame.ensemble.agreeing}/{frame.ensemble.total}
                  </span>
                }
              >
                Ensemble agreement
              </SectionLabel>
              <div
                className="ensemble-bars"
                aria-label={`${frame.ensemble.agreeing} of 23 members agree`}
              >
                {Array.from({ length: 23 }, (_, i) => (
                  <i
                    key={i}
                    className={i < frame.ensemble.agreeing ? 'agrees' : ''}
                    style={{ height: `${25 + Math.sin(i * 0.65) * 10 + i * 0.4}px` }}
                  />
                ))}
              </div>
              <div className="ensemble-caption">
                <span>{frame.ensemble.agreeing} members indicate an extreme event</span>
                <b>{frame.confidence >= 80 ? 'HIGH' : 'MODERATE'}</b>
              </div>
              <button
                className="inline-link"
                onClick={() => {
                  if (!w.layers.has('ensemble')) w.toggleLayer('ensemble');
                  setTab('Ensemble');
                }}
              >
                Explore ensemble spread <ChevronRight size={12} />
              </button>
            </section>
            <section className="forecast-delta">
              <SectionLabel extra={<GitCompareArrows size={14} />}>
                Forecast delta <span className="subtle">vs. previous run</span>
              </SectionLabel>
              <div className="delta-title">
                <MoveUpRight size={15} />
                <strong>Threat escalating</strong>
                <span>+{delta.change} pp</span>
              </div>
              <div className="delta-probability">
                <span>Extreme rainfall probability</span>
                <b>
                  {delta.previous}% <ArrowRight size={13} /> <strong>{delta.current}%</strong>
                </b>
              </div>
              <div className="delta-detail">
                <span>Center shifted</span>
                <b>{delta.shiftKm} km NW</b>
              </div>
              <div className="delta-detail">
                <span>Expected arrival</span>
                <b>6 hours earlier</b>
              </div>
              <button
                className={`compare-button ${w.compare ? 'selected' : ''}`}
                onClick={() => w.setCompare(!w.compare)}
              >
                <GitCompareArrows size={13} />
                {w.compare ? 'Hide previous run' : 'Compare forecast runs'}
                <ArrowUpRight size={12} />
              </button>
            </section>
            <section className="panel-section exposure-preview">
              <SectionLabel extra={<Users size={14} />}>Potential exposure</SectionLabel>
              <div>
                <strong>{compact(frame.impact.population)}</strong>
                <span>people in the risk footprint</span>
              </div>
              <div className="exposure-totals">
                <span>
                  <MapPin size={13} />
                  {frame.impact.villages} settlements
                </span>
                <span>
                  <Hospital size={13} />
                  {frame.impact.hospitals} hospitals
                </span>
              </div>
            </section>
          </>
        ) : tab === 'Ensemble' ? (
          <EnsembleDetail />
        ) : (
          <ImpactDetail />
        )}
      </div>
      <div className="intelligence-bottom">
        <button className="primary-button full" onClick={() => navigate(`/events/${w.selected.id}`)}>
          Open full intelligence <ArrowUpRight size={15} />
        </button>
        <p>
          <span className="status-dot" />
          Synthetic forecast · {utc(frame.timestamp)} UTC
        </p>
      </div>
      {why && (
        <Modal title="Explainable event intelligence" close={close}>
          <ExplainableAI />
        </Modal>
      )}
    </aside>
  );
}
function LiveIntelligence() {
  const w = useWeather();
  const navigate = useNavigate();
  const event = w.selected;
  const frame = w.frame;
  if (w.location)
    return (
      <aside className="intelligence-panel location-panel">
        <div className="intelligence-eyebrow">
          <span>
            <MapPin size={13} /> LOCATION FORECAST
          </span>
          <button
            className="icon-button"
            onClick={w.clearLocation}
            aria-label="Close location inspector"
          >
            <X size={17} />
          </button>
        </div>
        <h2>{w.location.name}</h2>
        <p className="muted mono">
          {w.location.coordinates[1].toFixed(3)}° N, {w.location.coordinates[0].toFixed(3)}° E
        </p>
        <div className="event-status-row">
          <Badge severity={w.location.severity} />
          <span className="muted">GEFS ensemble mean</span>
        </div>
        <div className="location-metrics">
          <Metric label="Rainfall / 24h" value={w.location.rainfall.max} unit="mm" />
          <Metric label="Wind gust" value={w.location.wind} unit="km/h" />
          <Metric label="Forecast step" value={`T+${w.hour}`} unit="h" />
          <Metric label="From tracked site" value={w.location.distanceKm} unit="km" />
        </div>
        <div className="info-note">
          <Info size={16} />
          <span>{w.location.impact} This is not a public warning.</span>
        </div>
        <button
          className="secondary-button full"
          onClick={() => download(`location-risk-${event.id}.json`, w.location)}
        >
          <Download size={14} /> Export coordinate forecast
        </button>
        <button className="text-button" onClick={w.clearLocation}>
          Return to event <ArrowRight size={14} />
        </button>
      </aside>
    );
  return (
    <aside className="intelligence-panel">
      <div className="intelligence-eyebrow">
        <span>
          <Crosshair size={13} /> FORECAST SCREENING
        </span>
        <span className="mono">{event.id}</span>
      </div>
      <div className="event-title-row">
        <h2>{event.name}</h2>
        <Wind size={25} />
      </div>
      <p className="event-location">
        <MapPin size={12} />
        {event.region}
        <span>·</span>
        {frame.centroid[1].toFixed(1)}°N, {frame.centroid[0].toFixed(1)}°E
      </p>
      <div className="event-status-row">
        <Badge severity={frame.severity} />
        <span className="trend-pill">{event.status}</span>
      </div>
      <div className="intelligence-scroll">
        <div className="key-metrics">
          <Metric label="Forecast lead" value={w.hour} unit="h" hint="Day 3–10" />
          <Metric label="Sample sites" value={16} hint="Regional screening grid" />
        </div>
        <div className="weather-metrics">
          <Metric label="Rainfall / 24h" value={frame.metrics.rainfall} unit="mm" />
          <Metric label="Wind gust" value={frame.metrics.wind} unit="km/h" />
          <Metric label="Pressure" value={frame.metrics.pressure} unit="hPa" />
        </div>
        <section className="panel-section">
          <SectionLabel>Tracked sampled maximum</SectionLabel>
          <p className="muted">
            The path links the highest screening signal among 16 sampled locations at each six-hour step.
            It is not a continuous storm-centre analysis.
          </p>
        </section>
        {frame.ensembleSpread && (
          <section className="panel-section">
            <SectionLabel>GEFS member spread · standard deviation</SectionLabel>
            <div className="weather-metrics">
              <Metric label="Hourly rain" value={frame.ensembleSpread.precipitationHourly} unit="mm" />
              <Metric label="Wind gust" value={frame.ensembleSpread.windGust} unit="km/h" />
              <Metric label="Temperature" value={frame.ensembleSpread.temperature} unit="°C" />
            </div>
          </section>
        )}
        <section className="panel-section">
          <SectionLabel>Approximate affected area</SectionLabel>
          <p className="muted">
            Colored rings are screening footprints around sampled coordinates. Their borders and area
            have not been validated against a native-resolution weather grid.
          </p>
        </section>
        <section className="panel-section">
          <SectionLabel>Model status</SectionLabel>
          <p className="muted">
            Live GEFS ensemble mean fields are connected. Calibrated event probability, historical
            anomaly index, GNN tracking and 5 km diffusion output still require trained models and
            verification data.
          </p>
        </section>
      </div>
      <div className="intelligence-bottom">
        <button className="primary-button full" onClick={() => navigate('/alerts')}>
          Open screening advisories <ArrowUpRight size={15} />
        </button>
        <p>
          <span className="status-dot" /> GEFS forecast · {utc(frame.timestamp)} UTC
        </p>
      </div>
    </aside>
  );
}
export function EnsembleDetail() {
  const w = useWeather();
  return (
    <div className="detail-section">
      <div className="big-number mint">
        {w.frame.ensemble.agreeing}
        <small> / 23</small>
      </div>
      <p className="muted">Synthetic members agree on an extreme event.</p>
      <div className="ensemble-member-grid">
        {Array.from({ length: 23 }, (_, i) => (
          <span key={i} className={i < w.frame.ensemble.agreeing ? 'agrees' : ''}>
            M{String(i + 1).padStart(2, '0')}
          </span>
        ))}
      </div>
      <div className="location-metrics">
        <Metric label="Model spread" value={w.frame.ensemble.spreadKm} unit="km" />
        <Metric label="Probability" value={Math.round(w.frame.ensemble.probability * 100)} unit="%" />
        <Metric label="Confidence" value={w.frame.confidence} unit="%" />
        <Metric
          label="Confidence trend"
          value={`${w.frame.ensemble.trend > 0 ? '+' : ''}${w.frame.ensemble.trend}`}
          unit="pp"
        />
      </div>
      <button className="secondary-button full" onClick={() => w.toggleLayer('ensemble')}>
        {w.layers.has('ensemble') ? 'Hide' : 'Show'} ensemble tracks on map
      </button>
      <div className="info-note">
        <Info size={16} />
        <span>
          The envelope widens with lead time. These 23 generated tracks illustrate forecast uncertainty,
          not calibrated probabilities.
        </span>
      </div>
    </div>
  );
}
export function ImpactDetail() {
  const w = useWeather(),
    i = w.frame.impact;
  return (
    <div className="detail-section">
      <SectionLabel>Potentially exposed population</SectionLabel>
      <div className="big-number">{number(i.population)}</div>
      <span className="muted">Within the simulated geographic risk zone</span>
      <div className="impact-list">
        {[
          [MapPin, 'Settlements', i.villages],
          [Hospital, 'Hospitals', i.hospitals],
          [School, 'Schools', i.schools],
          [ArrowRight, 'Major road corridors', i.roads],
          [Waves, 'River sections', i.riverSections],
        ].map(([Icon, label, value]) => {
          const I = Icon as typeof MapPin;
          return (
            <div key={String(label)}>
              <I size={16} />
              <span>{String(label)}</span>
              <b>{String(value)}</b>
            </div>
          );
        })}
      </div>
      <Metric label="Agriculture exposed" value={number(i.croplandHa)} unit="ha" />
      <button
        className="secondary-button full"
        onClick={() => {
          if (!w.layers.has('population')) w.toggleLayer('population');
          if (!w.layers.has('hospitals')) w.toggleLayer('hospitals');
          w.notify('Simulated exposure assets are visible on the map');
        }}
      >
        Show exposed assets on map <ArrowUpRight size={14} />
      </button>
      <div className="response-suggestions">
        <SectionLabel>Decision support</SectionLabel>
        <p>AI-generated decision-support suggestions</p>
        <ul>
          <li>Review shelter readiness in priority settlements.</li>
          <li>Assess access to hospitals and road corridors.</li>
          <li>Monitor river levels and official agency bulletins.</li>
        </ul>
        <small>Demonstration suggestions. Not official emergency orders.</small>
      </div>
    </div>
  );
}
export function ExplainableAI() {
  const { frame } = useWeather();
  const rows = [
    { label: 'Rainfall anomaly', value: `+${frame.metrics.anomaly}%`, contribution: 92 },
    { label: 'Wind anomaly', value: '+41%', contribution: 71 },
    { label: 'Pressure anomaly', value: 'Significant', contribution: 65 },
    { label: 'Moisture convergence', value: 'Very high', contribution: 82 },
    { label: 'Historical percentile', value: '99.3', contribution: 96 },
    { label: 'Ensemble agreement', value: `${frame.confidence}%`, contribution: frame.confidence },
    { label: 'Topographic amplification', value: 'Moderate', contribution: 38 },
  ];
  return (
    <div className="explanation">
      <DemoTag>ILLUSTRATIVE ATTRIBUTIONS</DemoTag>
      <p className="muted">
        A transparent view of the signals contributing to the synthetic severity classification.
      </p>
      {rows.map((r) => (
        <div className="contribution" key={r.label}>
          <div>
            <span>{r.label}</span>
            <b>{r.value}</b>
          </div>
          <div className="contribution-track">
            <i style={{ width: `${r.contribution}%` }} />
          </div>
        </div>
      ))}
      <div className="explanation-result">
        <BrainCircuit size={21} />
        <span>Final classification</span>
        <Badge severity={frame.severity} />
      </div>
      <p className="fine-print">
        Prototype explanation. These contributions are illustrative; no trained model attribution or
        historical validation has been performed.
      </p>
    </div>
  );
}
