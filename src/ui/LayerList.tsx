import { Plus, Trash2 } from 'lucide-react';

type Props = {
  order: string[];
  selectedLayerId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
};

export function LayerList({ order, selectedLayerId, onSelect, onAdd, onDelete }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: 8 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <strong>Layers</strong>
        <button
          onClick={onAdd}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <Plus size={14} /> Add layer
        </button>
      </div>
      {/* 上 = 前面表示 (描画順序の末尾)。border のダブりを避けるため隣接行は上 border を消す */}
      {[...order].reverse().map((id, idxFromTop) => {
        const idx = order.length - 1 - idxFromTop;
        const isSelected = id === selectedLayerId;
        return (
          <div
            key={id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: 4,
              border: '1px solid #ccc',
              borderTopWidth: idxFromTop === 0 ? 1 : 0,
              background: isSelected ? '#e6f2ff' : 'transparent',
              cursor: 'pointer',
            }}
            onClick={() => onSelect(id)}
          >
            <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}>
              #{idx} {id.slice(0, 6)}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(id);
              }}
              title="Delete layer"
            >
              <Trash2 size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
