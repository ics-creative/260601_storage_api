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
      state.order = state.order.filter((layerId) => layerId !== op.layerId);
      return;
    }
    case "stroke": {
      const layerCanvas = state.canvases.get(op.layerId);
      if (layerCanvas) drawStroke(layerCanvas, op);
      return;
    }
  }
}

export function replayLayer(state: LayerState, layerId: string, entries: LogEntry[]): void {
  const layerCanvas = state.canvases.get(layerId);
  if (!layerCanvas) return;
  clearCanvas(layerCanvas);
  for (const entry of entries) {
    if (entry.op.type === "stroke" && entry.op.layerId === layerId) {
      drawStroke(layerCanvas, entry.op);
    }
  }
}
