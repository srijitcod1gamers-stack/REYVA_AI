import { ChevronLeft, ChevronRight, Clock3, Pause, Play, RotateCcw } from 'lucide-react';
import { useWeather } from '../../providers/WeatherProvider';
import { utc } from '../../utils/format';

export function TimelineController() {
  const w = useWeather(),
    percent = ((w.hour - 72) / 168) * 100;
  return (
    <section className="timeline" aria-label="Forecast timeline">
      <div className="timeline-top">
        <div className="timeline-title">
          <Clock3 size={14} />
          <span>FORECAST TIMELINE</span>
          <span className="timeline-range">4D EXPLORER</span>
        </div>
        <div className="timeline-current">
          <b>T+{w.frame.hour}h</b>
          <span>{utc(w.frame.timestamp)} UTC</span>
          <span className="forecast-chip">
            {w.replay
              ? 'HISTORICAL SIMULATION'
              : w.selected.provenance.kind === 'forecast'
                ? 'LIVE ENSEMBLE'
                : 'FORECAST · DEMO'}
          </span>
        </div>
      </div>
      <div className="timeline-main">
        <div className="playback-controls">
          <button
            className="play-button"
            onClick={() => {
              if (w.hour >= 240) w.setHour(72);
              w.setPlaying(!w.playing);
            }}
            aria-label={w.playing ? 'Pause forecast animation' : 'Play forecast animation'}
          >
            {w.playing ? (
              <Pause size={17} fill="currentColor" />
            ) : (
              <Play size={17} fill="currentColor" />
            )}
          </button>
          <div>
            <button
              aria-label="Previous forecast step"
              onClick={() => {
                w.setPlaying(false);
                w.setHour(w.hour - (w.frame.grid ? 24 : 6));
              }}
              disabled={w.hour <= 72}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              aria-label="Next forecast step"
              onClick={() => {
                w.setPlaying(false);
                w.setHour(w.hour + (w.frame.grid ? 24 : 6));
              }}
              disabled={w.hour >= 240}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <select
            aria-label="Playback speed"
            value={w.speed}
            onChange={(e) => w.setSpeed(Number(e.target.value))}
          >
            {[0.5, 1, 2, 4].map((s) => (
              <option value={s} key={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
        <div className="timeline-track-area">
          <div className="timeline-days">
            {Array.from({ length: 8 }, (_, i) => (
              <button
                key={i}
                className={Math.floor(w.hour / 24) === i + 3 ? 'active' : ''}
                onClick={() => w.setHour(72 + i * 24)}
              >
                <span>DAY {i + 3}</span>
                <small>T+{72 + i * 24}h</small>
              </button>
            ))}
          </div>
          <div className="timeline-track">
            <div className="timeline-ticks">
              {Array.from({ length: 57 }, (_, i) => (
                <i key={i} />
              ))}
            </div>
            <div className="timeline-progress" style={{ width: `${percent}%` }} />
            <input
              aria-label="Forecast hour"
              type="range"
              min="72"
              max="240"
              step={w.frame.grid ? 24 : 1}
              value={w.hour}
              onChange={(e) => {
                w.setPlaying(false);
                w.setHour(Number(e.target.value));
              }}
            />
          </div>
        </div>
        <button
          className="timeline-reset"
          aria-label="Reset timeline"
          onClick={() => {
            w.setHour(72);
            w.setPlaying(false);
          }}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <div className="timeline-footer">
        <span>
          <i className="tiny-square" />
          Drag to explore how the event evolves
        </span>
        <div>
          <span className="track-key" />
          Screened trajectory
          <span className="track-key dashed" />
          Forecast continuation
          <span className="uncertainty-key" />
          Uncertainty
        </div>
      </div>
    </section>
  );
}
