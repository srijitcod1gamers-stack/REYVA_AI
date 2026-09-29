import { Check, ChevronDown, Layers2, X } from 'lucide-react';
import { useState } from 'react';
import { useWeather, type LayerId } from '../../providers/WeatherProvider';
import type { WeatherVariable } from '../../../shared/types';
import { variableInfo } from './layers';

const groups: { label: string; layers: { id: LayerId; label: string; note?: string }[] }[] = [
  {
    label: 'INTELLIGENCE',
    layers: [
      { id: 'risk', label: 'Dynamic risk polygons' },
      { id: 'trajectory', label: 'Event trajectory' },
      { id: 'ensemble', label: 'Ensemble & uncertainty' },
      { id: 'wind', label: 'Animated wind field' },
    ],
  },
  {
    label: 'EXPOSURE · SIMULATED',
    layers: [
      { id: 'population', label: 'Population & settlements' },
      { id: 'hospitals', label: 'Hospitals' },
      { id: 'roads', label: 'Road corridors' },
      { id: 'agriculture', label: 'Agriculture' },
    ],
  },
  {
    label: 'GEOGRAPHY',
    layers: [
      { id: 'boundaries', label: 'State boundaries' },
      { id: 'districts', label: 'District boundaries', note: 'Requires a data source' },
      { id: 'rivers', label: 'Rivers' },
      { id: 'topography', label: 'Terrain DEM', note: 'Online' },
    ],
  },
];
export function LayerManager() {
  const w = useWeather(),
    [open, setOpen] = useState(false);
  const choose = (id: LayerId) => {
    if (id === 'districts') w.notify('District boundaries require an authoritative source.');
    else if (id === 'topography') w.setView(w.view === '3d' ? '2d' : '3d');
    else w.toggleLayer(id);
  };
  return (
    <div className="layer-control">
      <button
        className={`map-pill ${open ? 'active' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Layers2 size={14} />
        Layers<span className="layer-count">{w.layers.size}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="layer-popover panel">
          <div className="layer-heading">
            <strong>Map layers</strong>
            <button className="icon-button" aria-label="Close layers" onClick={() => setOpen(false)}>
              <X size={15} />
            </button>
          </div>
          <div className="eyebrow">WEATHER FIELD</div>
          <div className="layer-variables">
            {Object.entries(variableInfo)
              .filter(([id]) => !w.frame.samples?.length || !['anomaly', 'ensemble'].includes(id))
              .map(([id, info]) => (
                <button
                  key={id}
                  className={w.variable === id ? 'selected' : ''}
                  onClick={() => {
                    w.setAiField('none');
                    w.setVariable(id as WeatherVariable);
                  }}
                >
                  {info.label}
                  {w.variable === id && w.aiField === 'none' && <Check size={12} />}
                </button>
              ))}
          </div>
          {groups
            .filter((g) => !w.frame.samples?.length || !g.label.startsWith('EXPOSURE'))
            .map((g) => (
              <div key={g.label}>
                <div className="eyebrow">{g.label}</div>
                {g.layers
                  .filter(
                    (l) =>
                      !w.frame.samples?.length ||
                      !['ensemble', 'wind', 'population', 'hospitals', 'roads', 'agriculture'].includes(
                        l.id,
                      ),
                  )
                  .map((l) => {
                    const on = l.id === 'topography' ? w.view === '3d' : w.layers.has(l.id);
                    return (
                      <button
                        className="layer-row"
                        key={l.id}
                        onClick={() => choose(l.id)}
                        role="switch"
                        aria-checked={on}
                        title={l.note}
                      >
                        <span>
                          {l.label}
                          {l.note && <small className="layer-note"> · {l.note}</small>}
                        </span>
                        <span className={`toggle ${on ? 'on' : ''}`}>
                          <i />
                        </span>
                      </button>
                    );
                  })}
              </div>
            ))}
          {!w.frame.samples?.length && (
            <>
              <div className="eyebrow">AI FIELDS · SIMULATED</div>
              <div className="layer-variables">
                {(
                  [
                    { id: 'none', label: 'Standard weather field' },
                    { id: 'original', label: '12 km original' },
                    { id: 'interpolation', label: '5 km interpolation' },
                    { id: 'ai', label: '5 km AI downscaled' },
                  ] as const
                ).map((field) => (
                  <button
                    key={field.id}
                    className={w.aiField === field.id ? 'selected' : ''}
                    onClick={() => {
                      w.setAiField(field.id);
                      if (field.id !== 'none') w.setVariable('rainfall');
                    }}
                  >
                    {field.label}
                    {w.aiField === field.id && <Check size={12} />}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="fine-print">
            {w.frame.samples?.length
              ? 'Colored circles are GEFS ensemble mean values at 16 sampled locations. Screening footprints are approximate, not official hazard polygons.'
              : 'District boundaries and verified infrastructure can be connected through the geospatial API. Field detail is illustrative, not validated.'}
          </p>
        </div>
      )}
    </div>
  );
}
export function MapLegend() {
  const w = useWeather(),
    info = variableInfo[w.variable];
  return (
    <div className="map-legend panel">
      <div>
        <strong>
          {w.aiField === 'none'
            ? w.frame.samples?.length && w.variable === 'wind'
              ? '10 m wind gusts'
              : info.label
            : `${w.aiField === 'original' ? '12 km' : '5 km'} ${w.aiField === 'ai' ? 'AI' : w.aiField} rainfall`}
        </strong>
        <span>{info.unit}</span>
      </div>
      <div
        className="legend-ramp"
        style={{ background: `linear-gradient(90deg, ${info.colors.join(',')})` }}
      />
      <div className="legend-ticks">
        {info.ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="legend-source">
        <span>{w.frame.samples?.length ? 'LIVE SAMPLED FIELD' : 'SIMULATED FIELD'}</span>
        <span>
          {w.frame.samples?.length
            ? 'GEFS 0.25° mean'
            : w.aiField === 'none'
              ? '12 km → ~5 km'
              : w.aiField.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
