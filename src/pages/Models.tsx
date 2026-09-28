import { useEffect, useState } from 'react';
import { ArrowDown, ArrowRight, Check, Cpu, Play, RotateCcw } from 'lucide-react';
import { pipelineSteps, physicsMetrics } from '../../shared/fixtures';
import { DemoTag, PageHeading, SectionLabel } from '../components/ui/Primitives';
export default function Models() {
  const [step, setStep] = useState(-1),
    [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () =>
        setStep((s) => {
          if (s >= pipelineSteps.length - 1) {
            setRunning(false);
            return s;
          }
          return s + 1;
        }),
      1000,
    );
    return () => clearInterval(timer);
  }, [running]);
  return (
    <div className="page">
      <PageHeading
        eyebrow="FROM RAW FIELDS TO RISK INTELLIGENCE"
        title="AI processing pipeline"
        description="A transparent architecture connecting weather science, machine learning, and geographic impact."
        actions={
          <>
            <DemoTag>ARCHITECTURE SIMULATION</DemoTag>
            <button
              className="primary-button"
              onClick={() => {
                setStep(0);
                setRunning(true);
              }}
              disabled={running}
            >
              <Play size={14} />
              {running ? 'Simulating workflow…' : 'Run pipeline demo'}
            </button>
          </>
        }
      />
      <div className="model-overview">
        <div className="panel">
          <Cpu size={23} />
          <div>
            <strong>Graph neural network</strong>
            <p>Spatial relationships & anomaly discovery</p>
            <span>PyTorch Geometric · model scaffold</span>
          </div>
        </div>
        <div className="panel">
          <Cpu size={23} />
          <div>
            <strong>Conditional diffusion</strong>
            <p>Ensemble-conditioned 12 → ~5 km refinement</p>
            <span>PyTorch · model scaffold</span>
          </div>
        </div>
      </div>
      <div className="pipeline-grid">
        {pipelineSteps.map((s, i) => (
          <div
            className={`pipeline-node panel ${i === step && running ? 'processing' : ''} ${i <= step ? 'completed' : ''}`}
            key={s.name}
          >
            <div className="pipeline-index">
              {i < step || (!running && step === pipelineSteps.length - 1) ? (
                <Check size={16} />
              ) : (
                String(i + 1).padStart(2, '0')
              )}
            </div>
            <div>
              <h3>{s.name}</h3>
              <p>{s.detail}</p>
              <span>{s.tech}</span>
            </div>
            <ArrowRight className="pipeline-arrow" size={17} />
          </div>
        ))}
      </div>
      <div className="pipeline-result panel">
        <div>
          <span className={`status-dot ${step < pipelineSteps.length - 1 ? 'muted-dot' : ''}`} />
          <strong>
            {running
              ? `Processing: ${pipelineSteps[step]?.name}`
              : step === pipelineSteps.length - 1
                ? 'Workflow demonstration complete'
                : 'Ready to demonstrate the architecture'}
          </strong>
        </div>
        <p>
          No models are trained or executed by this animation. The backend includes preprocessing,
          validation, geospatial functions, and model interfaces; inference requires trained weights and
          licensed inputs.
        </p>
      </div>
    </div>
  );
}
