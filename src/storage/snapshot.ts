/**
 * OPFS (Origin Private File System) を使ったレイヤースナップショットの保存/復元。
 *
 * - オリジン専用の隔離されたファイルシステム。ユーザーには見えず、devtoolsのみで覗ける
 * - バイナリをそのまま扱える (Blob / ArrayBuffer)。File System Access API と同じ
 *   `FileSystemDirectoryHandle` / `FileSystemFileHandle` 系のオブジェクトで操作する
 * - `navigator.storage.getDirectory()` で root の DirectoryHandle を取得し、
 *   そこから子ディレクトリ・ファイルを辿る
 * - 容量はオリジンの永続化ストレージ枠で、IndexedDB と同じく十分に大きい
 *
 * 本ファイルでは以下の構成で保存する:
 *   /layers/{layerId}.png   各レイヤーの PNG
 *   /meta.json              保存時の seq とレイヤー順序
 */

const LAYERS_DIR = 'layers';
const META_FILE = 'meta.json';

/** OPFS に保存するメタ情報 */
export type SnapshotMeta = {
  /** 保存時点での IndexedDB ログの head seq。リロード時の差分判定に使用 */
  savedAtSeq: number;
  /** レイヤーの描画順 (背面→前面) */
  layerOrder: string[];
};

/** OPFS ルートの DirectoryHandle を取得 */
async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return await navigator.storage.getDirectory();
}

/**
 * `layers/` ディレクトリの handle を取得。
 * `create: true` だと無い場合に作成、`false` だと無ければ例外 → null で返す
 */
async function getLayersDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  const root = await getRoot();
  try {
    return await root.getDirectoryHandle(LAYERS_DIR, { create });
  } catch {
    return null;
  }
}

/**
 * 全レイヤーを PNG として書き出し、メタ情報を保存する (保存ボタン押下時)。
 *
 * - 旧スナップショットの残骸を残さないため、`layers/` ディレクトリを毎回 `removeEntry`
 *   ({ recursive: true }) で消してから作り直す
 * - 書き込み手順は `getFileHandle({create:true})` → `createWritable()` で
 *   `FileSystemWritableFileStream` を取得 → `write(blob)` → `close()`
 * - `close()` を呼ぶまでファイルは確定しないので忘れずに await する
 */
export async function saveSnapshot(
  layers: { id: string; blob: Blob }[],
  meta: SnapshotMeta,
): Promise<void> {
  const root = await getRoot();

  try {
    await root.removeEntry(LAYERS_DIR, { recursive: true });
  } catch {
    // ディレクトリが無ければ何もしない
  }
  const layersDir = await root.getDirectoryHandle(LAYERS_DIR, { create: true });

  for (const { id, blob } of layers) {
    const fh = await layersDir.getFileHandle(`${id}.png`, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  const metaFh = await root.getFileHandle(META_FILE, { create: true });
  const w = await metaFh.createWritable();
  await w.write(new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  await w.close();
}

/**
 * 保存済みスナップショットを読み込み、各レイヤーを ImageBitmap として返す。
 * スナップショットが無ければ `null`。
 *
 * - `getFileHandle()` は対象が無いと例外 (NotFoundError) を投げるので try/catch で判定
 * - PNG → ImageBitmap は `createImageBitmap(blob)` で一発変換 (canvas に drawImage できる形)
 * - meta.layerOrder の順序通りに読み込むことで、復元後の重ね順を保証する
 */
export async function loadSnapshot(): Promise<{
  meta: SnapshotMeta;
  layers: { id: string; bitmap: ImageBitmap }[];
} | null> {
  const root = await getRoot();
  let metaFh: FileSystemFileHandle;
  try {
    metaFh = await root.getFileHandle(META_FILE);
  } catch {
    return null;
  }
  const metaFile = await metaFh.getFile();
  const meta = JSON.parse(await metaFile.text()) as SnapshotMeta;

  const layersDir = await getLayersDir(false);
  const layers: { id: string; bitmap: ImageBitmap }[] = [];
  if (layersDir) {
    for (const id of meta.layerOrder) {
      try {
        const fh = await layersDir.getFileHandle(`${id}.png`);
        const file = await fh.getFile();
        const bitmap = await createImageBitmap(file);
        layers.push({ id, bitmap });
      } catch {
        // 個別ファイル欠損は無視 (全消し状態と区別したいので例外を握りつぶす)
      }
    }
  }
  return { meta, layers };
}

/**
 * デバッグ表示用に、スナップショット領域のファイル一覧を軽量に取得する。
 *
 * `loadSnapshot` と違い ImageBitmap は作らず、ファイル名とバイト数のみ収集する。
 * meta はそのまま JSON.parse して返す。
 *
 * - `dir.values()` は `FileSystemHandle` の AsyncIterable を返す
 *   (`FileSystemDirectoryHandle` は AsyncIterable を実装)
 * - `handle.kind` で `'file'` / `'directory'` を判定できる
 */
export async function listFiles(): Promise<{
  meta: { size: number; data: SnapshotMeta } | null;
  layers: { name: string; size: number }[];
}> {
  const root = await getRoot();

  let meta: { size: number; data: SnapshotMeta } | null = null;
  try {
    const fh = await root.getFileHandle(META_FILE);
    const f = await fh.getFile();
    meta = { size: f.size, data: JSON.parse(await f.text()) as SnapshotMeta };
  } catch {
    // meta無し
  }

  const layers: { name: string; size: number }[] = [];
  const layersDir = await getLayersDir(false);
  if (layersDir) {
    for await (const entry of layersDir.values()) {
      if (entry.kind === 'file') {
        const f = await (entry as FileSystemFileHandle).getFile();
        layers.push({ name: entry.name, size: f.size });
      }
    }
  }
  return { meta, layers };
}

/**
 * OPFS 内のスナップショット関連エントリを削除する (リセット時)。
 *
 * `removeEntry` は対象が無いと例外を投げるので、それぞれ try/catch で握り潰す。
 * `{ recursive: true }` でディレクトリを中身ごと削除できる。
 */
export async function clearAll(): Promise<void> {
  const root = await getRoot();
  try {
    await root.removeEntry(LAYERS_DIR, { recursive: true });
  } catch {
    // 既に無ければ何もしない
  }
  try {
    await root.removeEntry(META_FILE);
  } catch {
    // 既に無ければ何もしない
  }
}
