import { useEffect, useState } from 'react';
import { countOps, getHead, getMaxSeq, peekRecentOps } from '../storage/history';
import { listFiles } from '../storage/snapshot';
import type { LogEntry } from '../core/types';

const RECENT_LIMIT = 5;

type IdbInfo = {
  count: number;
  maxSeq: number;
  head: number;
  recent: LogEntry[];
};

type OpfsInfo = Awaited<ReturnType<typeof listFiles>>;

type Props = {
  /** 値が変わるたびに読み直す (PaintApp の version を渡す) */
  refreshKey: number;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function describeOp(e: LogEntry): string {
  if (e.op.type === 'stroke') return `stroke(${e.op.points.length}pt)`;
  if (e.op.type === 'addLayer') return `addLayer(${e.op.layerId.slice(0, 6)})`;
  return `deleteLayer(${e.op.layerId.slice(0, 6)})`;
}

export function DebugPanel({ refreshKey }: Props) {
  const [lsRaw, setLsRaw] = useState<string | null>(null);
  const [idb, setIdb] = useState<IdbInfo | null>(null);
  const [opfs, setOpfs] = useState<OpfsInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLsRaw(localStorage.getItem('paint:settings'));

      const [count, maxSeq, head, recent, files] = await Promise.all([
        countOps(),
        getMaxSeq(),
        getHead(),
        peekRecentOps(RECENT_LIMIT),
        listFiles(),
      ]);
      if (cancelled) return;
      setIdb({ count, maxSeq, head, recent });
      setOpfs(files);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <div
      style={{
        padding: 8,
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.5,
        color: '#555',
        borderTop: '1px solid #ddd',
      }}
    >
      <Section title="LocalStorage">
        {lsRaw ? (
          <>
            <div>paint:settings ({formatBytes(lsRaw.length)})</div>
            <pre style={preStyle}>{lsRaw}</pre>
          </>
        ) : (
          <div>(empty)</div>
        )}
      </Section>

      <Section title="IndexedDB (paint-db)">
        {idb ? <IdbView info={idb} /> : <div>...</div>}
      </Section>

      <Section title="OPFS">
        {opfs ? <OpfsTree info={opfs} /> : <div>...</div>}
      </Section>
    </div>
  );
}

const preStyle: React.CSSProperties = {
  margin: '2px 0 0',
  padding: 4,
  background: '#f4f4f4',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  fontFamily: 'inherit',
  fontSize: 'inherit',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{title}</div>
      {children}
    </div>
  );
}

function IdbView({ info }: { info: IdbInfo }) {
  const omitted = info.count - info.recent.length;
  const headInList = info.recent.some((e) => e.seq === info.head);

  // ▶ は全角幅。1スペースで埋めて、非ヘッド行の半角3スペースと視覚的に揃える
  const HEAD_MARK = '▶ ';
  const NO_MARK = '   ';
  const lines: string[] = [];
  if (omitted > 0) lines.push(`${NO_MARK}… (${omitted} older)`);
  if (!headInList) lines.push(`${HEAD_MARK}${String(info.head).padStart(3)}  (cursor.head)`);
  for (const e of info.recent) {
    const mark = e.seq === info.head ? HEAD_MARK : NO_MARK;
    lines.push(`${mark}${String(e.seq).padStart(3)}  ${describeOp(e)}`);
  }
  if (info.recent.length === 0 && headInList === false && info.head === 0) {
    lines.push('   (empty)');
  }

  return (
    <>
      <div>
        log : {info.count} entries (max seq={info.maxSeq})
      </div>
      <pre style={preStyle}>{lines.join('\n')}</pre>
    </>
  );
}

function OpfsTree({ info }: { info: OpfsInfo }) {
  const lines: string[] = ['/'];
  // 表示順: meta.json → layers/ (中身)
  const entries: { name: string; size: number; isDir?: boolean; children?: { name: string; size: number }[] }[] = [];
  if (info.meta) entries.push({ name: 'meta.json', size: info.meta.size });
  if (info.layers.length > 0) {
    entries.push({ name: 'layers', size: 0, isDir: true, children: info.layers });
  }

  if (entries.length === 0) {
    return <pre style={preStyle}>/ (empty)</pre>;
  }

  entries.forEach((e, i) => {
    const last = i === entries.length - 1;
    const branch = last ? '└─' : '├─';
    if (e.isDir) {
      lines.push(`${branch} ${e.name}/`);
      const indent = last ? '   ' : '│  ';
      e.children!.forEach((c, j) => {
        const cLast = j === e.children!.length - 1;
        const cBranch = cLast ? '└─' : '├─';
        lines.push(`${indent}${cBranch} ${c.name}  ${formatBytes(c.size)}`);
      });
    } else {
      lines.push(`${branch} ${e.name}  ${formatBytes(e.size)}`);
    }
  });

  return <pre style={preStyle}>{lines.join('\n')}</pre>;
}
