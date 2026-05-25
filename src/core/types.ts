export const CANVAS_SIZE = 1024;

export type Settings = {
  color: string;
  width: number;
  selectedLayerId: string | null;
};

export type Point = { x: number; y: number };

export type StrokeOp = {
  type: "stroke";
  layerId: string;
  color: string;
  width: number;
  points: Point[];
};

export type AddLayerOp = {
  type: "addLayer";
  layerId: string;
};

export type DeleteLayerOp = {
  type: "deleteLayer";
  layerId: string;
};

export type Op = StrokeOp | AddLayerOp | DeleteLayerOp;

export type LogEntry = {
  seq: number;
  op: Op;
};

export type LayerState = {
  order: string[];
  canvases: Map<string, OffscreenCanvas>;
};
