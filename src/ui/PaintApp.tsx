import { useEffect, useRef, useState } from "react";
import { CANVAS_SIZE, type LayerState, type Op, type Settings } from "../core/types";
import { applyOne, emptyState, replayLayer } from "../core/replay";
import { blobToCanvas, canvasToBlob, createLayerCanvas } from "../core/canvas";
import { loadSettings, saveSettings } from "../storage/settings";
import {
  appendOp,
  getHead,
  getMaxSeq,
  getOp,
  listOpsBetween,
  listOpsUpTo,
  setHead as setHeadDb,
  truncateAfter,
} from "../storage/history";
import { loadSnapshot, saveSnapshot } from "../storage/snapshot";
import { resetAll } from "../reset";
import { CanvasView } from "./CanvasView";
import { Toolbar } from "./Toolbar";
import { LayerList } from "./LayerList";
import { DebugPanel } from "./DebugPanel";

const DEFAULT_SETTINGS: Settings = {
  color: "#000000",
  width: 4,
  selectedLayerId: null,
};

function newLayerId(): string {
  return crypto.randomUUID();
}

export function PaintApp() {
  const stateRef = useRef<LayerState>(emptyState());
  const [version, setVersion] = useState(0);
  const [head, setHead] = useState(0);
  const [maxSeq, setMaxSeq] = useState(0);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const initStartedRef = useRef(false);

  const bump = () => setVersion((v) => v + 1);

  // ユーザー由来の設定変更を行うラッパー。LocalStorage への書き込みを伴う。
  // 起動時の loadSettings から復元したまま変更されない場合は何も書かないことで、
  // 設定キーは「初めて変更した瞬間」に LocalStorage に出現する。
  const updateSettings = (updater: (s: Settings) => Settings) => {
    setSettings((s) => {
      const next = updater(s);
      saveSettings(next);
      return next;
    });
    bump(); // LocalStorage 変更を DebugPanel に即反映させる
  };

  // 起動シーケンス
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    void init();
    async function init() {
      const loaded = loadSettings() ?? DEFAULT_SETTINGS;
      const dbHead = await getHead();
      const dbMax = await getMaxSeq();

      const snap = await loadSnapshot();
      const state = stateRef.current;

      // OPFSスナップショットがあれば Blob を canvas に復元 (展開は並列実行)
      if (snap) {
        const decoded = await Promise.all(
          snap.layers.map(async ({ id, blob }) => ({ id, canvas: await blobToCanvas(blob) })),
        );
        for (const { id, canvas } of decoded) state.canvases.set(id, canvas);
        state.order = snap.layers.map((l) => l.id);
      }

      // スナップショットを基準点とし、未保存ログ (savedAt 超のop) があれば確認
      // スナップショット無しは savedAt=0 として同じ流れで扱う
      const savedAt = snap?.meta.savedAtSeq ?? 0;
      if (dbMax > savedAt) {
        const apply = window.confirm(
          `OPFS スナップショットより新しい操作ログが IndexedDB に ${dbMax - savedAt} 件あります。復元しますか？\n` +
            `IndexedDB has ${dbMax - savedAt} operations newer than the OPFS snapshot. Restore?\n` +
            `\n` +
            `OK: 差分を適用して復元 / Apply diff and restore\n` +
            `Cancel: 未保存分を破棄 / Discard unsaved ops`,
        );
        if (apply) {
          const diff = await listOpsBetween(savedAt, dbMax);
          for (const e of diff) applyOne(state, e.op);
          await setHeadDb(dbMax);
          setHead(dbMax);
          setMaxSeq(dbMax);
        } else {
          await truncateAfter(savedAt);
          setHead(savedAt);
          setMaxSeq(savedAt);
        }
      } else {
        setHead(dbHead);
        setMaxSeq(dbMax);
      }

      // レイヤーが1枚もない場合は初期レイヤーを追加
      if (state.order.length === 0) {
        const id = newLayerId();
        const seq = await appendOp({ type: "addLayer", layerId: id });
        applyOne(state, { type: "addLayer", layerId: id });
        setHead(seq);
        setMaxSeq(seq);
        loaded.selectedLayerId = id;
      } else if (!loaded.selectedLayerId || !state.canvases.has(loaded.selectedLayerId)) {
        loaded.selectedLayerId = state.order[state.order.length - 1];
      }

      setSettings(loaded);
      bump();
      setReady(true);
    }
  }, []);

  async function handleStrokeEnd(stroke: {
    layerId: string;
    color: string;
    width: number;
    points: { x: number; y: number }[];
  }) {
    const op: Op = { type: "stroke", ...stroke };
    const seq = await appendOp(op);
    // canvas はリアルタイム描画で更新済み
    setHead(seq);
    setMaxSeq(seq);
    bump();
  }

  async function handleAddLayer() {
    const id = newLayerId();
    const op: Op = { type: "addLayer", layerId: id };
    const seq = await appendOp(op);
    applyOne(stateRef.current, op);
    setHead(seq);
    setMaxSeq(seq);
    updateSettings((s) => ({ ...s, selectedLayerId: id }));
    bump();
  }

  async function handleDeleteLayer(id: string) {
    const state = stateRef.current;
    if (!state.canvases.has(id)) return;
    const op: Op = { type: "deleteLayer", layerId: id };
    const seq = await appendOp(op);
    const idxBefore = state.order.indexOf(id);
    applyOne(state, op);
    setHead(seq);
    setMaxSeq(seq);
    // 削除後の選択: 同じインデックス、なければ末尾、なければ null
    let nextId: string | null = null;
    if (state.order.length > 0) {
      nextId =
        state.order[Math.min(idxBefore, state.order.length - 1)] ??
        state.order[state.order.length - 1];
    }
    updateSettings((s) => ({ ...s, selectedLayerId: nextId }));
    bump();
  }

  async function handleUndo() {
    if (head <= 0) return;
    const entry = await getOp(head);
    if (!entry) return;
    const newHead = head - 1;
    const state = stateRef.current;
    const op = entry.op;

    if (op.type === "addLayer") {
      // 追加を取り消し: レイヤーを除去
      state.canvases.delete(op.layerId);
      state.order = state.order.filter((x) => x !== op.layerId);
    } else if (op.type === "deleteLayer") {
      // 削除を取り消し: 復元してそのレイヤー宛strokeをリプレイ
      const c = createLayerCanvas();
      state.canvases.set(op.layerId, c);
      state.order.push(op.layerId);
      const past = await listOpsUpTo(newHead);
      replayLayer(state, op.layerId, past);
    } else {
      // stroke 取り消し: 該当レイヤーをクリアして newHead までのstrokeをリプレイ
      const past = await listOpsUpTo(newHead);
      replayLayer(state, op.layerId, past);
    }

    await setHeadDb(newHead);
    setHead(newHead);

    // 操作対象レイヤーを選択（存在すれば）
    const targetId = op.layerId;
    const nextSelected = state.canvases.has(targetId)
      ? targetId
      : (state.order[state.order.length - 1] ?? null);
    updateSettings((s) => ({ ...s, selectedLayerId: nextSelected }));
    bump();
  }

  async function handleRedo() {
    if (head >= maxSeq) return;
    const newHead = head + 1;
    const entry = await getOp(newHead);
    if (!entry) return;
    applyOne(stateRef.current, entry.op);
    await setHeadDb(newHead);
    setHead(newHead);

    const targetId = entry.op.layerId;
    const nextSelected = stateRef.current.canvases.has(targetId)
      ? targetId
      : (stateRef.current.order[stateRef.current.order.length - 1] ?? null);
    updateSettings((s) => ({ ...s, selectedLayerId: nextSelected }));
    bump();
  }

  async function handleSave() {
    const state = stateRef.current;
    // 各レイヤーの圧縮は独立に並列実行できる。順序は state.order の通り維持される
    const layers = (
      await Promise.all(
        state.order.map(async (id) => {
          const c = state.canvases.get(id);
          if (!c) return null;
          return { id, blob: await canvasToBlob(c) };
        }),
      )
    ).filter((l): l is { id: string; blob: Blob } => l !== null);
    await saveSnapshot(layers, { savedAtSeq: head, layerOrder: state.order });
    bump(); // OPFSの中身が変わったのでデバッグ表示を更新
    window.alert(
      `${layers.length} 枚のレイヤーを OPFS に保存しました。\n` +
        `Saved ${layers.length} layer(s) to OPFS.`,
    );
  }

  async function handleReset() {
    if (
      !window.confirm(
        "全ストレージをクリアしてリロードします。\n" +
          "All storages will be cleared and the page will reload.",
      )
    )
      return;
    await resetAll();
  }

  if (!ready) {
    return <div style={{ padding: 16 }}>Loading…</div>;
  }

  // LayerState は HTMLCanvasElement の Map を含む共有可変オブジェクト。
  // 各操作で直接ミューテートし bump() で再レンダリングに同期させる設計のため、
  // render 時に ref の最新内容をローカル変数経由で参照する。
  const state = stateRef.current;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100svh" }}>
      <Toolbar
        color={settings.color}
        width={settings.width}
        canUndo={head > 0}
        canRedo={head < maxSeq}
        onColorChange={(color) => updateSettings((s) => ({ ...s, color }))}
        onWidthChange={(width) => updateSettings((s) => ({ ...s, width }))}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSave={handleSave}
        onReset={handleReset}
      />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 360,
            overflow: "auto",
          }}
        >
          <LayerList
            order={state.order}
            selectedLayerId={settings.selectedLayerId}
            onSelect={(id) => updateSettings((s) => ({ ...s, selectedLayerId: id }))}
            onAdd={handleAddLayer}
            onDelete={handleDeleteLayer}
          />
          <DebugPanel refreshKey={version} />
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 8,
          }}
        >
          <CanvasView
            key={version /* 強制再構築は不要だが state 参照が共有なので version を活用 */}
            state={state}
            selectedLayerId={settings.selectedLayerId}
            color={settings.color}
            width={settings.width}
            onStrokeEnd={handleStrokeEnd}
          />
        </div>
      </div>
      <div style={{ padding: 4, fontSize: 11, color: "#888", fontFamily: "monospace" }}>
        head={head} max={maxSeq} layers={state.order.length} canvas={CANVAS_SIZE}px
      </div>
    </div>
  );
}
