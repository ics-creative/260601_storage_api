/**
 * LocalStorage を使った設定の永続化。
 *
 * - 同期API: `getItem` / `setItem` / `removeItem` は即時に値を返す。
 *   描画ループ中など頻繁な呼び出しは避けるべきだが、設定値の保存程度なら問題ない
 * - 文字列のみ保存可能。オブジェクトは JSON.stringify で文字列化する
 * - 容量は概ねオリジンあたり 5MB 程度 (ブラウザ依存)
 * - 同一オリジンの全タブで共有され、他タブの変更は `storage` イベントで通知される
 */
import type { Settings } from "../core/types";

const STORAGE_KEY = "paint:settings";

/**
 * 保存済みの設定を読み出す。未保存なら `null`。
 *
 * `localStorage.getItem` は値が存在しなければ `null` を返す仕様。
 * 値は常に string なので JSON.parse でオブジェクト化する。
 * 壊れたJSONを掴むと例外で初期値に倒すので try/catch する。
 */
export function loadSettings(): Settings | null {
  const rawJson = localStorage.getItem(STORAGE_KEY);
  if (!rawJson) return null;
  try {
    return JSON.parse(rawJson) as Settings;
  } catch {
    return null;
  }
}

/**
 * 設定を上書き保存する。
 *
 * `setItem` は同じキーがあれば上書き、無ければ新規作成。
 * 容量上限を超えると `QuotaExceededError` を投げるが、今回扱う値は十分小さいので catch しない。
 */
export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * 設定エントリを削除する (リセット時に使用)。
 *
 * `removeItem` はキーが無くてもエラーにならない。
 * 全削除したい場合は `localStorage.clear()` だが、他用途の値も消すので使わない。
 */
export function clearSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}
