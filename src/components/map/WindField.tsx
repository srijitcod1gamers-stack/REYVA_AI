import { useEffect, useRef } from 'react';
import type { Map as LibreMap } from 'maplibre-gl';
import type { Coordinate } from '../../../shared/types';

export function WindField({
  map,
  center,
  enabled,
}: {
  map: LibreMap | null;
  center: Coordinate;
  enabled: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    centerRef = useRef(center);
  centerRef.current = center;
  useEffect(() => {
    if (!enabled || !map || !ref.current) return;
    const canvas = ref.current,
      context = canvas.getContext('2d');
    if (!context) return;
    let animation = 0,
      previous = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const particles = Array.from({ length: 230 }, (_, i) => ({
      angle: i * 2.39996,
      radius: 0.24 + (((i * 73) % 230) / 230) * 7.2,
      speed: 0.000022 + (i % 13) * 0.000002,
      phase: (i % 100) / 100,
    }));
    const draw = (time: number) => {
      if (time - previous < 85 && !reduced) {
        animation = requestAnimationFrame(draw);
        return;
      }
      previous = time;
      const box = map.getContainer().getBoundingClientRect(),
        ratio = Math.min(devicePixelRatio, 2);
      if (
        canvas.width !== Math.round(box.width * ratio) ||
        canvas.height !== Math.round(box.height * ratio)
      ) {
        canvas.width = Math.round(box.width * ratio);
        canvas.height = Math.round(box.height * ratio);
        canvas.style.width = `${box.width}px`;
        canvas.style.height = `${box.height}px`;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, box.width, box.height);
      const [lng, lat] = centerRef.current;
      for (const p of particles) {
        const a = p.angle + (reduced ? 0 : time * p.speed),
          r = p.radius;
        context.beginPath();
        for (let k = 0; k < 5; k++) {
          const theta = a - k * 0.012;
          const position = map.project([
            lng + Math.cos(theta) * r * 1.12,
            lat + Math.sin(theta) * r * 0.94,
          ]);
          if (k === 0) context.moveTo(position.x, position.y);
          else context.lineTo(position.x, position.y);
        }
        context.strokeStyle = `rgba(191,222,218,${0.12 + p.phase * 0.3})`;
        context.lineWidth = p.radius < 2 ? 1.0 : 0.7;
        context.stroke();
      }
      if (!reduced) animation = requestAnimationFrame(draw);
    };
    const redrawOnMove = () => {
      if (reduced) draw(0);
    };
    animation = requestAnimationFrame(draw);
    map.on('move', redrawOnMove);
    return () => {
      cancelAnimationFrame(animation);
      map.off('move', redrawOnMove);
    };
  }, [map, enabled]);
  return enabled ? <canvas ref={ref} className="wind-canvas" aria-hidden="true" /> : null;
}
