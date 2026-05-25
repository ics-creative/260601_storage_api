import { useEffect, useRef, useState } from 'react';
import {
  CANVAS_SIZE,
  type LayerState,
  type Op,
  type Settings,
} from '../core/types';
import { applyOne, emptyState, replayLayer } from '../core/replay';
import { canvasToBlob, createLayerCanvas } from '../core/canvas';
import { loadSettings, saveSettings } from '../storage/settings';
import {
  appendOp,
  getHead,
  getMaxSeq,
  getOp,
  listOpsBetween,
  listOpsUpTo,
  setHead as setHeadDb,
  truncateAfter,
} from '../storage/history';
import { loadSnapshot, saveSnapshot } from '../storage/snapshot';
import { resetAll } from '../reset';
import { CanvasView } from './CanvasView';
import { Toolbar } from './Toolbar';
import { LayerList } from './LayerList';

const DEFAULT_SETTINGS: Settings = {
  color: '#000000',
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

  // 設定変更を都度 LocalStorage に保存
  useEffect(() => {
    if (!ready) return;
    saveSettings(settings);
  }, [settings, ready]);

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

      // OPFSスナップショットがあれば bitmap を canvas に復元
      if (snap) {
        for (const { id, bitmap } of snap.layers) {
          const c = createLayerCanvas();
          c.getContext('2d')!.drawImage(bitmap, 0, 0);
          state.canvases.set(id, c);
        }
        state.order = snap.layers.map((l) => l.id);
      }

      // スナップショットを基準点とし、未保存ログ (savedAt 超のop) があれば確認
      // スナップショット無しは savedAt=0 として同じ流れで扱う
      const savedAt = snap?.meta.savedAtSeq ?? 0;
      if (dbMax > savedAt) {
        const apply = window.confirm(
          `未保存の操作が ${dbMax - savedAt} 件あります。復元しますか？\n` +
            `[OK] 差分を適用して復元 / [キャンセル] 未保存分を破棄`,
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
        const seq = await appendOp({ type: 'addLayer', layerId: id });
        applyOne(state, { type: 'addLayer', layerId: id });
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

  async function handleStrokeEnd(stroke: { layerId: string; color: string; width: number; points: { x: number; y: number }[] }) {
    const op: Op = { type: 'stroke', ...stroke };
    const seq = await appendOp(op);
    // canvas はリアルタイム描画で更新済み
    setHead(seq);
    setMaxSeq(seq);
    bump();
  }

  async function handleAddLayer() {
    const id = newLayerId();
    const op: Op = { type: 'addLayer', layerId: id };
    const seq = await appendOp(op);
    applyOne(stateRef.current, op);
    setHead(seq);
    setMaxSeq(seq);
    setSettings((s) => ({ ...s, selectedLayerId: id }));
    bump();
  }

  async function handleDeleteLayer(id: string) {
    const state = stateRef.current;
    if (!state.canvases.has(id)) return;
    const op: Op = { type: 'deleteLayer', layerId: id };
    const seq = await appendOp(op);
    const idxBefore = state.order.indexOf(id);
    applyOne(state, op);
    setHead(seq);
    setMaxSeq(seq);
    // 削除後の選択: 同じインデックス、なければ末尾、なければ null
    let nextId: string | null = null;
    if (state.order.length > 0) {
      nextId = state.order[Math.min(idxBefore, state.order.length - 1)] ?? state.order[state.order.length - 1];
    }
    setSettings((s) => ({ ...s, selectedLayerId: nextId }));
    bump();
  }

  async function handleUndo() {
    if (head <= 0) return;
    const entry = await getOp(head);
    if (!entry) return;
    const newHead = head - 1;
    const state = stateRef.current;
    const op = entry.op;

    if (op.type === 'addLayer') {
      // 追加を取り消し: レイヤーを除去
      state.canvases.delete(op.layerId);
      state.order = state.order.filter((x) => x !== op.layerId);
    } else if (op.type === 'deleteLayer') {
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
      : state.order[state.order.length - 1] ?? null;
    setSettings((s) => ({ ...s, selectedLayerId: nextSelected }));
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
      : stateRef.current.order[stateRef.current.order.length - 1] ?? null;
    setSettings((s) => ({ ...s, selectedLayerId: nextSelected }));
    bump();
  }

  async function handleSave() {
    const state = stateRef.current;
    const layers: { id: string; blob: Blob }[] = [];
    for (const id of state.order) {
      const c = state.canvases.get(id);
      if (c) layers.push({ id, blob: await canvasToBlob(c) });
    }
    await saveSnapshot(layers, { savedAtSeq: head, layerOrder: state.order });
  }

  async function handleReset() {
    if (!window.confirm('全ストレージをクリアしてリロードします')) return;
    await resetAll();
  }

  if (!ready) {
    return <div style={{ padding: 16 }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100svh' }}>
      <Toolbar
        color={settings.color}
        width={settings.width}
        canUndo={head > 0}
        canRedo={head < maxSeq}
        onColorChange={(color) => setSettings((s) => ({ ...s, color }))}
        onWidthChange={(width) => setSettings((s) => ({ ...s, width }))}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSave={handleSave}
        onReset={handleReset}
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <LayerList
          order={stateRef.current.order}
          selectedLayerId={settings.selectedLayerId}
          onSelect={(id) => setSettings((s) => ({ ...s, selectedLayerId: id }))}
          onAdd={handleAddLayer}
          onDelete={handleDeleteLayer}
        />
        <div
          style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 8,
          }}
        >
          <CanvasView
            key={version /* 強制再構築は不要だが state 参照が共有なので version を活用 */}
            state={stateRef.current}
            selectedLayerId={settings.selectedLayerId}
            color={settings.color}
            width={settings.width}
            onStrokeEnd={handleStrokeEnd}
          />
        </div>
      </div>
      <div style={{ padding: 4, fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
        head={head} max={maxSeq} layers={stateRef.current.order.length} canvas={CANVAS_SIZE}px
      </div>
    </div>
  );
}
