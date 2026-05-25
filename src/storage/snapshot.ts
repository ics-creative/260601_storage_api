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
 *   /layers/{layerId}.bin   各レイヤーの raw RGBA を deflate-raw 圧縮したもの
 *   /meta.json              保存時の seq とレイヤー順序
 */

const LAYERS_DIR = 'layers';
const META_FILE = 'meta.json';
const LAYER_EXT = '.bin';

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
 * 全レイヤー Blob とメタ情報を OPFS に書き出す (保存ボタン押下時)。
 *
 * - 旧スナップショットの残骸を残さないため、`layers/` を毎回削除してから作り直す
 * - 書き込み手順は `getFileHandle({create:true})` → `createWritable()` で
 *   `FileSystemWritableFileStream` を取得 → `write(blob)` → `close()`
 * - レイヤー間は独立して書けるので `Promise.all` で並列化する
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

  await Promise.all(
    layers.map(async ({ id, blob }) => {
      const fh = await layersDir.getFileHandle(`${id}${LAYER_EXT}`, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    }),
  );

  const metaFh = await root.getFileHandle(META_FILE, { create: true });
  const w = await metaFh.createWritable();
  await w.write(new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  await w.close();
}

/**
 * 保存済みスナップショットの Blob 群とメタ情報を読み込んで返す。
 * スナップショットが無ければ `null`。
 *
 * Blob の中身は `core/canvas.ts#blobToCanvas` で復元する想定なので、
 * このモジュールはデコードに関与しない。
 *
 * - `getFileHandle()` は対象が無いと例外 (NotFoundError) を投げるので try/catch で判定
 * - レイヤー読み込みも互いに独立なので並列化する
 */
export async function loadSnapshot(): Promise<{
  meta: SnapshotMeta;
  layers: { id: string; blob: Blob }[];
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
  if (!layersDir) return { meta, layers: [] };

  const results = await Promise.all(
    meta.layerOrder.map(async (id) => {
      try {
        const fh = await layersDir.getFileHandle(`${id}${LAYER_EXT}`);
        const file = await fh.getFile();
        return { id, blob: file as Blob };
      } catch {
        return null; // 個別ファイル欠損は無視
      }
    }),
  );
  return {
    meta,
    layers: results.filter((r): r is { id: string; blob: Blob } => r !== null),
  };
}

/**
 * デバッグ表示用に、スナップショット領域のファイル一覧を軽量に取得する。
 *
 * `loadSnapshot` と違いバイト列を読み出さず、ファイル名とサイズだけ収集する。
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
