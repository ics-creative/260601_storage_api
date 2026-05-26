import { useEffect, useState } from "react";
import { countOps, getHead, getMaxSeq, peekRecentOps } from "../storage/history";
import { listFiles } from "../storage/snapshot";
import type { LogEntry } from "../core/types";

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

function formatBytes(byteCount: number): string {
  if (byteCount < 1024) return `${byteCount} B`;
  if (byteCount < 1024 * 1024) return `${(byteCount / 1024).toFixed(1)} KB`;
  return `${(byteCount / 1024 / 1024).toFixed(1)} MB`;
}

function describeOp(entry: LogEntry): string {
  if (entry.op.type === "stroke") return `stroke(${entry.op.points.length}pt)`;
  if (entry.op.type === "addLayer") return `addLayer(${entry.op.layerId.slice(0, 6)})`;
  return `deleteLayer(${entry.op.layerId.slice(0, 6)})`;
}

export function DebugPanel({ refreshKey }: Props) {
  const [localStorageRaw, setLocalStorageRaw] = useState<string | null>(null);
  const [indexedDbInfo, setIndexedDbInfo] = useState<IdbInfo | null>(null);
  const [opfsInfo, setOpfsInfo] = useState<OpfsInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLocalStorageRaw(localStorage.getItem("paint:settings"));

      const [count, maxSeq, head, recent, files] = await Promise.all([
        countOps(),
        getMaxSeq(),
        getHead(),
        peekRecentOps(RECENT_LIMIT),
        listFiles(),
      ]);
      if (cancelled) return;
      setIndexedDbInfo({ count, maxSeq, head, recent });
      setOpfsInfo(files);
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
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: 1.5,
        color: "#555",
        borderTop: "1px solid #ddd",
      }}
    >
      <Section title="LocalStorage">
        {localStorageRaw ? (
          <>
            <div>paint:settings ({formatBytes(localStorageRaw.length)})</div>
            <pre style={preStyle}>{localStorageRaw}</pre>
          </>
        ) : (
          <div>(empty)</div>
        )}
      </Section>

      <Section title="IndexedDB (paint-db)">
        {indexedDbInfo ? <IdbView info={indexedDbInfo} /> : <div>...</div>}
      </Section>

      <Section title="OPFS">
        {opfsInfo ? <OpfsTree info={opfsInfo} /> : <div>...</div>}
      </Section>
    </div>
  );
}

const preStyle: React.CSSProperties = {
  margin: "2px 0 0",
  padding: 4,
  background: "#f4f4f4",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  fontFamily: "inherit",
  fontSize: "inherit",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: "bold", marginBottom: 2 }}>{title}</div>
      {children}
    </div>
  );
}

function IdbView({ info }: { info: IdbInfo }) {
  const omittedCount = info.count - info.recent.length;
  const headIsInRecentList = info.recent.some((entry) => entry.seq === info.head);

  // ▶ は全角幅。1スペースで埋めて、非ヘッド行の半角3スペースと視覚的に揃える
  const HEAD_MARK = "▶ ";
  const NO_MARK = "   ";
  const lines: string[] = [];
  if (omittedCount > 0) lines.push(`${NO_MARK}… (${omittedCount} older)`);
  if (!headIsInRecentList) {
    lines.push(`${HEAD_MARK}${String(info.head).padStart(3)}  (cursor.head)`);
  }
  for (const entry of info.recent) {
    const mark = entry.seq === info.head ? HEAD_MARK : NO_MARK;
    lines.push(`${mark}${String(entry.seq).padStart(3)}  ${describeOp(entry)}`);
  }
  if (info.recent.length === 0 && headIsInRecentList === false && info.head === 0) {
    lines.push("   (empty)");
  }

  return (
    <>
      <div>
        log : {info.count} entries (max seq={info.maxSeq})
      </div>
      <pre style={preStyle}>{lines.join("\n")}</pre>
    </>
  );
}

function OpfsTree({ info }: { info: OpfsInfo }) {
  const lines: string[] = ["/"];
  // 表示順: meta.json → layers/ (中身)
  const entries: {
    name: string;
    size: number;
    isDir?: boolean;
    children?: { name: string; size: number }[];
  }[] = [];
  if (info.meta) entries.push({ name: "meta.json", size: info.meta.size });
  if (info.layers.length > 0) {
    entries.push({ name: "layers", size: 0, isDir: true, children: info.layers });
  }

  if (entries.length === 0) {
    return <pre style={preStyle}>/ (empty)</pre>;
  }

  entries.forEach((entry, entryIndex) => {
    const isLastEntry = entryIndex === entries.length - 1;
    const branch = isLastEntry ? "└─" : "├─";
    if (entry.isDir) {
      lines.push(`${branch} ${entry.name}/`);
      const childIndent = isLastEntry ? "   " : "│  ";
      entry.children!.forEach((child, childIndex) => {
        const isLastChild = childIndex === entry.children!.length - 1;
        const childBranch = isLastChild ? "└─" : "├─";
        lines.push(`${childIndent}${childBranch} ${child.name}  ${formatBytes(child.size)}`);
      });
    } else {
      lines.push(`${branch} ${entry.name}  ${formatBytes(entry.size)}`);
    }
  });

  return <pre style={preStyle}>{lines.join("\n")}</pre>;
}
