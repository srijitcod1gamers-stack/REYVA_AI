import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Clock3, Play, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWeather } from '../../providers/WeatherProvider';

export function ReplayBanner() {
  const w = useWeather(),
    navigate = useNavigate(),
    [observations, setObservations] = useState(false),
    [demoRunning, setDemoRunning] = useState(false);
  const reached = useRef(new Set<string>());
  useEffect(() => {
    if (!demoRunning) return;
    if (w.hour >= 108 && !reached.current.has('ensemble')) {
      reached.current.add('ensemble');
      if (!w.layers.has('ensemble')) w.toggleLayer('ensemble');
    }
    if (w.hour >= 132 && !reached.current.has('delta')) {
      reached.current.add('delta');
      w.setCompare(true);
    }
    if (w.hour >= 168 && !reached.current.has('impact')) {
      reached.current.add('impact');
      w.setMode('response');
    }
    if (w.hour >= 240 && !reached.current.has('downscaling')) {
      reached.current.add('downscaling');
      w.setPlaying(false);
      setDemoRunning(false);
      w.notify('Replay complete · opening the AI downscaling comparison');
      navigate('/downscaling');
    }
  }, [demoRunning, w.hour]);
  const step = w.hour < 84 ? 0 : w.hour < 108 ? 1 : w.hour < 132 ? 2 : w.hour < 168 ? 3 : 4;
  return (
    <div className="replay-banner">
      <div className="replay-name">
        <Clock3 size={19} />
        <div>
          <strong>
            Cyclone Amphan <span>May 2020</span>
          </strong>
          <small>Historical-inspired synthetic replay · not a reconstruction</small>
        </div>
      </div>
      <div className="replay-stages">
        {['Scan', 'Discover', 'Track', 'Uncertainty', 'Impact'].map((s, i) => (
          <span key={s} className={i <= step ? 'complete' : ''}>
            {i < step ? <Check size={11} /> : <i />}
            {s}
            {i < 4 && <ArrowRight size={11} />}
          </span>
        ))}
      </div>
      <div className="replay-actions">
        <button
          className="secondary-button"
          onClick={() => {
            w.setHour(72);
            w.setPlaying(false);
            setDemoRunning(false);
          }}
          title="Reset replay"
        >
          <RotateCcw size={13} />
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            w.setHour(144);
            w.setPlaying(false);
            setDemoRunning(false);
            w.notify('Jumped to the simulated landfall window · 20 May 2020');
          }}
        >
          Landfall <ArrowRight size={12} />
        </button>
        <button
          className="primary-button"
          onClick={() => {
            reached.current.clear();
            w.setMode('meteorology');
            w.setCompare(false);
            w.setHour(72);
            w.setSpeed(2);
            setDemoRunning(true);
            w.setPlaying(true);
          }}
        >
          <Play size={12} />
          {demoRunning ? 'Restart demo' : 'Run demo'}
        </button>
        <button className="text-button" onClick={() => setObservations(!observations)}>
          Observations
        </button>
      </div>
      {observations && (
        <div className="replay-observations">
          <strong>Observation comparison is not connected.</strong> Import licensed best-track and
          station observations before calculating hindcast skill. This replay uses generated tracks and
          illustrative validation metrics.
        </div>
      )}
    </div>
  );
}
