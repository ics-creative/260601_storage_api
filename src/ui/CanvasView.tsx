import { useEffect, useRef } from 'react';
import {
  CANVAS_SIZE,
  type LayerState,
  type Point,
  type StrokeOp,
} from '../core/types';
import { composite, drawSegment, shouldKeepPoint } from '../core/canvas';

const MIN_POINT_DIST = 1.5;

type Props = {
  state: LayerState;
  selectedLayerId: string | null;
  color: string;
  width: number;
  onStrokeEnd: (stroke: Omit<StrokeOp, 'type'>) => void;
};

export function CanvasView({ state, selectedLayerId, color, width, onStrokeEnd }: Props) {
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{
    points: Point[];
    last: Point | null;
  } | null>(null);

  useEffect(() => {
    const c = displayRef.current;
    if (!c) return;
    composite(c, state.order, state.canvases);
  }, [state]);

  function toCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const c = displayRef.current!;
    const rect = c.getBoundingClientRect();
    const scaleX = c.width / rect.width;
    const scaleY = c.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!selectedLayerId || !state.canvases.has(selectedLayerId)) return;
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const p = toCanvasPoint(e);
    drawingRef.current = { points: [p], last: p };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drawingRef.current;
    if (!d || !selectedLayerId) return;
    const p = toCanvasPoint(e);
    if (!shouldKeepPoint(d.last, p, MIN_POINT_DIST)) return;
    const layer = state.canvases.get(selectedLayerId);
    if (layer && d.last) {
      drawSegment(layer, d.last, p, color, width);
      const display = displayRef.current;
      if (display) composite(display, state.order, state.canvases);
    }
    d.points.push(p);
    d.last = p;
  }

  function onPointerUp() {
    const d = drawingRef.current;
    drawingRef.current = null;
    if (!d || !selectedLayerId) return;
    if (d.points.length === 1) {
      // 単一クリックは点として描画
      const layer = state.canvases.get(selectedLayerId);
      if (layer) {
        drawSegment(layer, d.points[0], d.points[0], color, width);
        const display = displayRef.current;
        if (display) composite(display, state.order, state.canvases);
      }
    }
    onStrokeEnd({
      layerId: selectedLayerId,
      color,
      width,
      points: d.points,
    });
  }

  return (
    <canvas
      ref={displayRef}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        display: 'block',
        width: 'min(100%, calc(100svh - 80px))',
        aspectRatio: '1 / 1',
        height: 'auto',
        background: '#fff',
        border: '1px solid #ccc',
        touchAction: 'none',
      }}
    />
  );
}
