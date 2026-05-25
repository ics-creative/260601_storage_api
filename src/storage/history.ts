/**
 * IndexedDB を使った操作ログの永続化。
 *
 * - 非同期API: 全操作は `IDBRequest` を返し、`onsuccess` / `onerror` イベントで結果を受け取る
 * - データは構造化クローン可能なJS値をそのまま保存できる (文字列化不要)
 * - トランザクション単位で読み書き。`oncomplete` までは確定しない
 * - ObjectStore = テーブル相当。keyPath / autoIncrement / index などを設定できる
 * - スキーマ変更は version を上げて `onupgradeneeded` で対応
 *
 * 本ファイルでは 2 つのストアを使う:
 * - log: 各操作 (stroke/addLayer/deleteLayer) を時系列で保持 (seq 自動採番)
 * - cursor: 現在の Undo/Redo カーソル位置 (head seq) を保持
 */
import type { LogEntry, Op } from '../core/types';

/** IndexedDB の DB名。同一オリジン内でDBを識別する */
const DB_NAME = 'paint-db';
/** DBのスキーマバージョン。上げると onupgradeneeded が発火しスキーマ移行できる */
const DB_VERSION = 1;
/** 操作ログを格納する ObjectStore 名 */
const STORE_LOG = 'log';
/** カーソル位置 (head) を格納する ObjectStore 名 */
const STORE_CURSOR = 'cursor';
/** cursor ストア内で head seq を引くためのキー名 */
const CURSOR_KEY = 'head';

/** IDBRequest を Promise 化する小道具 (IDB は素ではコールバックAPI) */
function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Transaction の完了を Promise 化する */
function promisifyTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * DBを開く (なければ初回起動で作成)。接続は使い回す。
 *
 * - `indexedDB.open(name, version)` で IDBOpenDBRequest を取得
 * - 既存DBより version が新しいか、DBが存在しない場合に `onupgradeneeded` が発火する。
 *   ObjectStore の作成や index の追加など、スキーマ変更はここでしか行えない
 * - `onsuccess` で IDBDatabase が手に入る
 * - `onversionchange`: 別接続が同じDBにより新しい version で open した、または
 *   `deleteDatabase` を呼んだ時に発火。自分の接続を閉じないと相手がブロックされるため、
 *   ここで close する
 */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_LOG)) {
        // keyPath: 'seq' で各レコードの seq プロパティを主キーとする
        // autoIncrement で seq を自動採番させる (put時に seq を未指定にすれば連番が入る)
        db.createObjectStore(STORE_LOG, { keyPath: 'seq', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_CURSOR)) {
        // keyPath なしのストア。put(value, key) でキーを明示する形になる
        db.createObjectStore(STORE_CURSOR);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/**
 * 操作 Op を末尾に追記し、新しい seq を返す。
 *
 * Redo スタックを破棄する意味で、現在の head より新しい (= 未来の) ログを先に削除してから追記する。
 * これにより、Undo して新規操作した時に再現できない「分岐」が残らないようにする。
 *
 * - `IDBKeyRange.lowerBound(head, true)` で head より大きいキーの範囲を表現
 * - `openCursor` でその範囲を1件ずつ走査し、`cur.delete()` で削除
 * - `logStore.add({ op })` で seq 未指定にすることで autoIncrement に任せる
 * - 同一 transaction 内で複数ストアを更新することで原子性を担保
 */
export async function appendOp(op: Op): Promise<number> {
  const db = await openDb();
  const tx = db.transaction([STORE_LOG, STORE_CURSOR], 'readwrite');
  const logStore = tx.objectStore(STORE_LOG);
  const cursorStore = tx.objectStore(STORE_CURSOR);

  const head = (await promisifyRequest<number | undefined>(cursorStore.get(CURSOR_KEY))) ?? 0;

  // head より未来のログを削除 (Redoスタック破棄)
  await new Promise<void>((resolve, reject) => {
    const range = IDBKeyRange.lowerBound(head, true);
    const cReq = logStore.openCursor(range);
    cReq.onsuccess = () => {
      const cur = cReq.result;
      if (cur) {
        cur.delete();
        cur.continue();
      } else {
        resolve();
      }
    };
    cReq.onerror = () => reject(cReq.error);
  });

  const newSeq = await promisifyRequest<IDBValidKey>(logStore.add({ op }));
  cursorStore.put(newSeq, CURSOR_KEY);
  await promisifyTx(tx);
  return newSeq as number;
}

/**
 * 現在の head (Undo/Redo カーソル) seq を取得。未設定なら 0。
 *
 * cursor ストアは keyPath 無しなので、`get(key)` で外部キーを指定して値を引く形式。
 */
export async function getHead(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE_CURSOR, 'readonly');
  const v = await promisifyRequest<number | undefined>(tx.objectStore(STORE_CURSOR).get(CURSOR_KEY));
  return v ?? 0;
}

/**
 * head seq を更新 (Undo/Redo 実行時に呼ぶ)。
 *
 * `put(value, key)` は既存値があれば上書き。`add` だと既存キーで失敗するので、上書きには `put` を使う。
 */
export async function setHead(seq: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_CURSOR, 'readwrite');
  tx.objectStore(STORE_CURSOR).put(seq, CURSOR_KEY);
  await promisifyTx(tx);
}

/**
 * log ストアに存在する最大 seq を返す (Redo 可能判定用)。
 *
 * `openCursor(null, 'prev')` で末尾から開く特殊技で、最初の cursor がそのまま最大キーを指す。
 * `getAll` で全件取って末尾を見るよりオーバーヘッドが小さい。
 */
export async function getMaxSeq(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE_LOG, 'readonly');
  const cursor = await promisifyRequest(tx.objectStore(STORE_LOG).openCursor(null, 'prev'));
  return cursor ? (cursor.key as number) : 0;
}

/**
 * `1..seq` のログエントリを昇順で返す (Undo時のレイヤー再構築に使用)。
 *
 * `IDBKeyRange.upperBound(seq)` は `<= seq` のレンジ。
 * `getAll(range)` は対象のレコードを一括取得する便利API。
 */
export async function listOpsUpTo(seq: number): Promise<LogEntry[]> {
  if (seq <= 0) return [];
  const db = await openDb();
  const tx = db.transaction(STORE_LOG, 'readonly');
  const store = tx.objectStore(STORE_LOG);
  const range = IDBKeyRange.upperBound(seq);
  const all = await promisifyRequest(store.getAll(range));
  return all as LogEntry[];
}

/**
 * `(fromExclusive..toInclusive]` のログエントリを昇順で返す (OPFS復元後の差分適用に使用)。
 *
 * `IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen)` の lowerOpen=true で
 * 下端を含まないレンジを表現できる。
 */
export async function listOpsBetween(fromExclusive: number, toInclusive: number): Promise<LogEntry[]> {
  if (toInclusive <= fromExclusive) return [];
  const db = await openDb();
  const tx = db.transaction(STORE_LOG, 'readonly');
  const range = IDBKeyRange.bound(fromExclusive, toInclusive, true, false);
  const all = await promisifyRequest(tx.objectStore(STORE_LOG).getAll(range));
  return all as LogEntry[];
}

/**
 * 指定 seq のログエントリを 1件取得 (Redoで適用するOpを引く時に使用)。
 *
 * `store.get(key)` は該当キーが無ければ `undefined` を返す (例外ではない)。
 */
export async function getOp(seq: number): Promise<LogEntry | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_LOG, 'readonly');
  const v = await promisifyRequest(tx.objectStore(STORE_LOG).get(seq));
  return (v as LogEntry | undefined) ?? null;
}

/**
 * `seq` より大きい seq のログを全削除し、head を `seq` に揃える。
 *
 * OPFS復元時の確認で「未保存分を破棄」を選んだ際に呼ぶ。
 * 削除対象が広範囲になるので、`getAll` + `delete` ループではなく cursor 走査でメモリを節約する。
 */
export async function truncateAfter(seq: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_LOG, STORE_CURSOR], 'readwrite');
  const store = tx.objectStore(STORE_LOG);
  await new Promise<void>((resolve, reject) => {
    const range = IDBKeyRange.lowerBound(seq, true);
    const cReq = store.openCursor(range);
    cReq.onsuccess = () => {
      const cur = cReq.result;
      if (cur) {
        cur.delete();
        cur.continue();
      } else resolve();
    };
    cReq.onerror = () => reject(cReq.error);
  });
  tx.objectStore(STORE_CURSOR).put(seq, CURSOR_KEY);
  await promisifyTx(tx);
}

/**
 * DB を丸ごと削除する (リセット時)。
 *
 * `objectStore.clear()` ではレコードは消えるが autoIncrement カウンタは残るため、
 * リセット後に seq=1 から再開させたければ `deleteDatabase` を使う必要がある。
 *
 * `deleteDatabase` は他に開いている接続があると `onblocked` が発火し、
 * 全接続が close されるまで完了しない。
 * `openDb` 内で `db.onversionchange = () => db.close()` を仕込んであるため、
 * 同一プロセス内の他接続は自発的に閉じ、最終的に `onsuccess` が発火する。
 */
export async function clearAll(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      // 他接続が onversionchange で閉じるのを待つだけで OK
    };
  });
}
