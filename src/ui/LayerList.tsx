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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, minWidth: 160 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Layers</strong>
        <button onClick={onAdd} title="Add layer">
          <Plus size={14} />
        </button>
      </div>
      {/* 上 = 前面表示 (描画順序の末尾) */}
      {[...order].reverse().map((id, idxFromTop) => {
        const idx = order.length - 1 - idxFromTop;
        return (
          <div
            key={id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: 4,
              border: '1px solid',
              borderColor: id === selectedLayerId ? '#08f' : '#ccc',
              background: id === selectedLayerId ? '#e6f2ff' : 'transparent',
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
