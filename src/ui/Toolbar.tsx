import { Save, Undo2, Redo2, RotateCcw } from 'lucide-react';

type Props = {
  color: string;
  width: number;
  canUndo: boolean;
  canRedo: boolean;
  onColorChange: (c: string) => void;
  onWidthChange: (w: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onReset: () => void;
};

export function Toolbar({
  color,
  width,
  canUndo,
  canRedo,
  onColorChange,
  onWidthChange,
  onUndo,
  onRedo,
  onSave,
  onReset,
}: Props) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8 }}>
      <input
        type="color"
        value={color}
        onChange={(e) => onColorChange(e.target.value)}
        aria-label="色"
      />
      <input
        type="range"
        min={1}
        max={64}
        value={width}
        onChange={(e) => onWidthChange(Number(e.target.value))}
        aria-label="太さ"
      />
      <span style={{ width: 28, textAlign: 'right' }}>{width}px</span>
      <button onClick={onUndo} disabled={!canUndo} title="Undo">
        <Undo2 size={16} />
      </button>
      <button onClick={onRedo} disabled={!canRedo} title="Redo">
        <Redo2 size={16} />
      </button>
      <button onClick={onSave} title="Save (OPFS)">
        <Save size={16} />
      </button>
      <button onClick={onReset} title="Reset all storage">
        <RotateCcw size={16} />
      </button>
    </div>
  );
}
