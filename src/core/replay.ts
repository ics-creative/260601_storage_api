import { clearCanvas, createLayerCanvas, drawStroke } from "./canvas";
import type { LayerState, LogEntry, Op } from "./types";

export function emptyState(): LayerState {
  return { order: [], canvases: new Map() };
}

export function applyOne(state: LayerState, op: Op): void {
  switch (op.type) {
    case "addLayer": {
      if (state.canvases.has(op.layerId)) return;
      state.canvases.set(op.layerId, createLayerCanvas());
      state.order.push(op.layerId);
      return;
    }
    case "deleteLayer": {
      state.canvases.delete(op.layerId);
      state.order = state.order.filter((id) => id !== op.layerId);
      return;
    }
    case "stroke": {
      const c = state.canvases.get(op.layerId);
      if (c) drawStroke(c, op);
      return;
    }
  }
}

export function replayLayer(state: LayerState, layerId: string, entries: LogEntry[]): void {
  const c = state.canvases.get(layerId);
  if (!c) return;
  clearCanvas(c);
  for (const e of entries) {
    if (e.op.type === "stroke" && e.op.layerId === layerId) {
      drawStroke(c, e.op);
    }
  }
}
