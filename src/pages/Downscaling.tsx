import { useEffect, useState } from 'react';
import Historical, { datasetRequest } from './Historical';

interface ModelReport {
  approved: boolean;
  ready: boolean;
  trained_at?: string;
  evaluation_note?: string;
  validation?: {
    model_mae_mm?: number;
    baseline_mae_mm?: number;
    f1?: number;
    threshold_baseline_f1?: number;
  };
  test?: {
    model_mae_mm?: number;
    baseline_mae_mm?: number;
    model_p99_error_mm?: number;
    baseline_p99_error_mm?: number;
    f1?: number;
    threshold_baseline_f1?: number;
  };
}
interface Status {
  model: ModelReport;
  tracker: ModelReport;
  training_samples: number;
  historical_cases: number;
  inference_connected: boolean;
}
export default function Downscaling() {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    datasetRequest<Status>('/ml/status', c.signal)
      .then(setStatus)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  return (
    <div className="model-workspace">
      <div className="page model-release">
        <div className="panel">
          <span className="eyebrow">MEASURED MODEL RELEASE STATUS</span>
          <h2>5 km rainfall model</h2>
          <p>
            {status?.model.approved
              ? 'Held-out validation passed.'
              : 'Trained checkpoint withheld: held-out skill has not passed the release gate.'}{' '}
            The prepared forecast and observation grids are available below for inspection.
          </p>
          {error && <p role="alert">{error}</p>}
          {status && (
            <div className="dataset-metrics">
              <div>
                <small>Downscaler test MAE</small>
                <strong>{status.model.test?.model_mae_mm?.toFixed(3) ?? '—'} mm</strong>
              </div>
              <div>
                <small>Interpolation test MAE</small>
                <strong>{status.model.test?.baseline_mae_mm?.toFixed(3) ?? '—'} mm</strong>
              </div>
              <div>
                <small>Graph tracker test F1</small>
                <strong>{status.tracker.test?.f1?.toFixed(3) ?? '—'}</strong>
              </div>
              <div>
                <small>Extreme-rainfall error: model / baseline</small>
                <strong>
                  {status.model.test?.model_p99_error_mm?.toFixed(3) ?? '—'} /{' '}
                  {status.model.test?.baseline_p99_error_mm?.toFixed(3) ?? '—'} mm
                </strong>
              </div>
              <div>
                <small>Prepared training / historical cases</small>
                <strong>
                  {status.training_samples} / {status.historical_cases}
                </strong>
              </div>
            </div>
          )}
          <p className="fine-print">{status?.model.evaluation_note}</p>
          <p className="fine-print">
            Release requires at least 5% lower held-out MAE and extreme-rainfall error, with no RMSE
            regression. Lower average error alone does not establish skill for extreme events.
          </p>
          <p className="fine-print">
            CHIRPS supplies a 0.05° observation reference. The interpolation layer is measured against
            observations; a trained forecast is released separately after validation. No accepted AI
            prediction is currently published.
          </p>
        </div>
      </div>
      <Historical lab />
    </div>
  );
}
