import { Plus, Trash2 } from "lucide-react";

type Props = {
  order: string[];
  selectedLayerId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
};

export function LayerList({ order, selectedLayerId, onSelect, onAdd, onDelete }: Props) {
  return (
    <details className="panel" open>
      <summary>
        <h3 className="panel-title">Layers</h3>
        {/* summary 内のボタン: preventDefault で details のトグルを抑止 */}
        <button
          className="panel-summary-action"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onAdd();
          }}
          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <Plus size={14} /> Add layer
        </button>
      </summary>
      <div className="panel-body" style={{ display: "flex", flexDirection: "column" }}>
        {/* 上 = 前面表示 (描画順序の末尾)。border のダブりを避けるため隣接行は上 border を消す */}
        {[...order].reverse().map((layerId, indexFromTop) => {
          const drawingIndex = order.length - 1 - indexFromTop;
          const isSelected = layerId === selectedLayerId;
          return (
            <div
              key={layerId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: 4,
                border: "1px solid #ccc",
                borderTopWidth: indexFromTop === 0 ? 1 : 0,
                background: isSelected ? "#e6f2ff" : "transparent",
                cursor: "pointer",
              }}
              onClick={() => onSelect(layerId)}
            >
              <span style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}>
                #{drawingIndex} {layerId.slice(0, 6)}
              </span>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(layerId);
                }}
                title="Delete layer"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </details>
  );
}
