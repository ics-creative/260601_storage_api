import { Save, Undo2, Redo2, X } from "lucide-react";

type Props = {
  color: string;
  width: number;
  canUndo: boolean;
  canRedo: boolean;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onReset: () => void;
};

const buttonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
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
    <div
      className="toolbar"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        alignItems: "center",
        padding: 8,
      }}
    >
      <input
        className="toolbar-color-input"
        type="color"
        value={color}
        onChange={(event) => onColorChange(event.target.value)}
        aria-label="色"
      />
      <input
        className="toolbar-slider-input"
        type="range"
        min={1}
        max={64}
        value={width}
        onChange={(event) => onWidthChange(Number(event.target.value))}
        aria-label="太さ"
      />
      <span style={{ width: 28, textAlign: "right" }}>{width}px</span>
      <button onClick={onUndo} disabled={!canUndo} style={buttonStyle}>
        <Undo2 className="toolbar-button-icon" size={14} /> Undo
      </button>
      <button onClick={onRedo} disabled={!canRedo} style={buttonStyle}>
        <Redo2 className="toolbar-button-icon" size={14} /> Redo
      </button>
      <button onClick={onSave} style={buttonStyle}>
        <Save className="toolbar-button-icon" size={14} /> Save
      </button>
      <button onClick={onReset} style={buttonStyle}>
        <X className="toolbar-button-icon" size={14} /> Reset
      </button>
    </div>
  );
}
