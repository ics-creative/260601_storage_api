import { useEffect, useRef } from "react";
import { CANVAS_SIZE, type LayerState, type Point, type StrokeOp } from "../core/types";
import { composite, drawSegment, shouldKeepPoint } from "../core/canvas";

const MIN_POINT_DIST = 1.5;

type Props = {
  state: LayerState;
  selectedLayerId: string | null;
  color: string;
  width: number;
  onStrokeEnd: (stroke: Omit<StrokeOp, "type">) => void;
};

export function CanvasView({ state, selectedLayerId, color, width, onStrokeEnd }: Props) {
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{
    points: Point[];
    last: Point | null;
  } | null>(null);

  useEffect(() => {
    const displayCanvas = displayRef.current;
    if (!displayCanvas) return;
    composite(displayCanvas, state.order, state.canvases);
  }, [state]);

  function toCanvasPoint(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const displayCanvas = displayRef.current!;
    const rect = displayCanvas.getBoundingClientRect();
    const scaleX = displayCanvas.width / rect.width;
    const scaleY = displayCanvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!selectedLayerId || !state.canvases.has(selectedLayerId)) return;
    (event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId);
    const point = toCanvasPoint(event);
    drawingRef.current = { points: [point], last: point };
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const drawing = drawingRef.current;
    if (!drawing || !selectedLayerId) return;
    const point = toCanvasPoint(event);
    if (!shouldKeepPoint(drawing.last, point, MIN_POINT_DIST)) return;
    const layerCanvas = state.canvases.get(selectedLayerId);
    if (layerCanvas && drawing.last) {
      drawSegment(layerCanvas, drawing.last, point, color, width);
      const displayCanvas = displayRef.current;
      if (displayCanvas) composite(displayCanvas, state.order, state.canvases);
    }
    drawing.points.push(point);
    drawing.last = point;
  }

  function onPointerUp() {
    const drawing = drawingRef.current;
    drawingRef.current = null;
    if (!drawing || !selectedLayerId) return;
    if (drawing.points.length === 1) {
      // 単一クリックは点として描画
      const layerCanvas = state.canvases.get(selectedLayerId);
      if (layerCanvas) {
        drawSegment(layerCanvas, drawing.points[0], drawing.points[0], color, width);
        const displayCanvas = displayRef.current;
        if (displayCanvas) composite(displayCanvas, state.order, state.canvases);
      }
    }
    onStrokeEnd({
      layerId: selectedLayerId,
      color,
      width,
      points: drawing.points,
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
        display: "block",
        width: "min(100%, calc(100svh - 80px))",
        aspectRatio: "1 / 1",
        height: "auto",
        background: "#fff",
        border: "1px solid #ccc",
        touchAction: "none",
        cursor: "crosshair",
      }}
    />
  );
}
