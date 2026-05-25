import { CANVAS_SIZE, type Point, type StrokeOp } from "./types";

/**
 * レイヤー用のキャンバスは DOM外の OffscreenCanvas を使用。
 * HTMLCanvasElement と違って DOMツリーに乗らないので、再合成や
 * `getImageData`/`putImageData` 用の純粋なピクセルバッファとして扱いやすい。
 */
export function createLayerCanvas(): OffscreenCanvas {
  return new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE);
}

// CanvasRenderingContext2D (DOM canvas) と OffscreenCanvasRenderingContext2D は
// 描画APIはほぼ共通だが型が別。両者を受け取る関数のためにユニオン型で受ける
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function setupStrokeStyle(ctx: Ctx2D, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

export function drawStroke(canvas: OffscreenCanvas, stroke: StrokeOp): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || stroke.points.length === 0) return;
  setupStrokeStyle(ctx, stroke.color, stroke.width);
  ctx.beginPath();
  const [first, ...rest] = stroke.points;
  ctx.moveTo(first.x, first.y);
  if (rest.length === 0) {
    // 1点だけのストロークは moveTo した位置に lineTo して点を打つ
    ctx.lineTo(first.x, first.y);
  } else {
    for (const p of rest) ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

export function drawSegment(
  canvas: OffscreenCanvas,
  prev: Point,
  curr: Point,
  color: string,
  width: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  setupStrokeStyle(ctx, color, width);
  ctx.beginPath();
  ctx.moveTo(prev.x, prev.y);
  ctx.lineTo(curr.x, curr.y);
  ctx.stroke();
}

export function clearCanvas(canvas: OffscreenCanvas): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * 表示用 DOM canvas にレイヤー群を背景→前面の順で重ねて描く。
 *
 * `drawImage` は OffscreenCanvas を CanvasImageSource として直接受け取れるため、
 * 中間バッファ無しでレイヤー canvas → 表示 canvas に転送できる。
 */
export function composite(
  displayCanvas: HTMLCanvasElement,
  order: string[],
  canvases: Map<string, OffscreenCanvas>,
  background: string = "#ffffff",
): void {
  const ctx = displayCanvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, displayCanvas.width, displayCanvas.height);
  for (const id of order) {
    const c = canvases.get(id);
    if (c) ctx.drawImage(c, 0, 0);
  }
}

/** 直前点との距離が `minDist` 未満なら入力を捨てる。点列の間引き用。 */
export function shouldKeepPoint(prev: Point | null, curr: Point, minDist: number): boolean {
  if (!prev) return true;
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  return dx * dx + dy * dy >= minDist * minDist;
}

/**
 * キャンバスを「圧縮済み raw RGBA」Blob に変換する。
 *
 * `getImageData` で取り出した生ピクセル (Uint8ClampedArray, 4MB/枚) を
 * `CompressionStream('deflate-raw')` でストリーム圧縮する。
 *
 * - 完全ロスレス (raw pixels + deflate なので情報損失なし)
 * - 透明領域が多いと deflate が効いて大幅に縮む (ペン描画なら数十KB程度)
 *
 * キャンバスサイズは固定 (CANVAS_SIZE) 前提で寸法情報は保存しない。
 */
export async function canvasToBlob(canvas: OffscreenCanvas): Promise<Blob> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  // ImageData.data は内部の Uint8ClampedArray を直接参照する (コピー無し)。
  // Blob のコンストラクタは TypedArray をそのまま受け付けてバイト列化する
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const raw = new Blob([imageData.data]);
  // ReadableStream を `pipeThrough` で圧縮ストリームに繋いで、最終的に
  // `Response.blob()` でバッファに集約する定石パターン。
  // 'deflate-raw' は zlib ヘッダを持たない素の deflate (容量を最小化)
  return await new Response(raw.stream().pipeThrough(new CompressionStream("deflate-raw"))).blob();
}

/**
 * `canvasToBlob` が作った Blob を新規キャンバスに復元する。
 *
 * 圧縮時と逆の手順: `DecompressionStream` で展開 → `ArrayBuffer` を
 * `Uint8ClampedArray` で覆って `ImageData` を作り → `putImageData` で書き戻す。
 */
export async function blobToCanvas(blob: Blob): Promise<OffscreenCanvas> {
  const ab = await new Response(
    blob.stream().pipeThrough(new DecompressionStream("deflate-raw")),
  ).arrayBuffer();
  const c = createLayerCanvas();
  const ctx = c.getContext("2d")!;
  // ArrayBuffer は所有権を渡す形で Uint8ClampedArray にラップする (コピー無し)
  const data = new Uint8ClampedArray(ab);
  ctx.putImageData(new ImageData(data, c.width, c.height), 0, 0);
  return c;
}
