import { CANVAS_SIZE, type Point, type StrokeOp } from './types';

export function createLayerCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CANVAS_SIZE;
  c.height = CANVAS_SIZE;
  return c;
}

function setupStrokeStyle(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

export function drawStroke(canvas: HTMLCanvasElement, stroke: StrokeOp): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || stroke.points.length === 0) return;
  setupStrokeStyle(ctx, stroke.color, stroke.width);
  ctx.beginPath();
  const [first, ...rest] = stroke.points;
  ctx.moveTo(first.x, first.y);
  if (rest.length === 0) {
    ctx.lineTo(first.x, first.y);
  } else {
    for (const p of rest) ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

export function drawSegment(
  canvas: HTMLCanvasElement,
  prev: Point,
  curr: Point,
  color: string,
  width: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  setupStrokeStyle(ctx, color, width);
  ctx.beginPath();
  ctx.moveTo(prev.x, prev.y);
  ctx.lineTo(curr.x, curr.y);
  ctx.stroke();
}

export function clearCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function composite(
  displayCanvas: HTMLCanvasElement,
  order: string[],
  canvases: Map<string, HTMLCanvasElement>,
  background: string = '#ffffff',
): void {
  const ctx = displayCanvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, displayCanvas.width, displayCanvas.height);
  for (const id of order) {
    const c = canvases.get(id);
    if (c) ctx.drawImage(c, 0, 0);
  }
}

export function shouldKeepPoint(prev: Point | null, curr: Point, minDist: number): boolean {
  if (!prev) return true;
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  return dx * dx + dy * dy >= minDist * minDist;
}

export async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}
