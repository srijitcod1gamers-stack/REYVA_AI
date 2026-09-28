import { Component, useEffect, useRef, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, ArrowUpRight, X } from 'lucide-react';
import type { Severity } from '../../../shared/types';

export function Badge({ severity }: { severity: Severity }) {
  return (
    <span className={`severity severity-${severity.toLowerCase()}`}>
      <span className="severity-square" />
      {severity}
    </span>
  );
}
export function DemoTag({ children = 'SIMULATED DATA' }: { children?: ReactNode }) {
  return <span className="demo-tag">{children}</span>;
}
export function SectionLabel({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="section-label">
      <span>{children}</span>
      {extra}
    </div>
  );
}
export function Metric({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
      {hint && <span className="metric-hint">{hint}</span>}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{actions}</div>
    </div>
  );
}
export function Sparkline({ color = '#6ad8bd', variant = 0 }: { color?: string; variant?: number }) {
  const paths = [
    'M0 29 L10 24 L20 27 L30 18 L40 22 L50 10 L60 15 L70 6 L80 9 L90 2',
    'M0 26 L10 28 L20 17 L30 21 L40 13 L50 19 L60 9 L70 12 L80 3 L90 7',
    'M0 16 L10 11 L20 18 L30 14 L40 18 L50 12 L60 16 L70 13 L80 17 L90 14',
    'M0 3 L10 9 L20 7 L30 15 L40 11 L50 20 L60 16 L70 26 L80 23 L90 29',
  ];
  return (
    <svg className="sparkline" viewBox="0 0 90 34" aria-label="Simulated trend">
      <path d={paths[variant % 4]} fill="none" stroke={color} strokeWidth="1.7" />
    </svg>
  );
}
export function Modal({
  title,
  children,
  close,
  className = '',
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const list = panel.current?.querySelectorAll<HTMLElement>(
          'button, input, select, a[href], [tabindex="0"]',
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === panel.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [close]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panel}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={close}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application error', error, info);
  }
  render() {
    return this.state.error ? (
      <div className="boot-screen">
        <AlertTriangle size={32} />
        <h1>This view couldn’t load</h1>
        <p>Please reload to reinitialize the visualization.</p>
        <button className="primary-button" onClick={() => window.location.reload()}>
          Reload application <ArrowUpRight size={16} />
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
