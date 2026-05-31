interface Props {
  inp: string;
  nodeCount: number;
  conduitCount: number;
}

export function InpPreview({ inp, nodeCount, conduitCount }: Props) {
  const lines = inp.split("\n");
  const preview = lines.slice(0, 200).join("\n");
  const truncated = lines.length > 200;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
          <span><span className="text-primary">{nodeCount}</span> nodes</span>
          <span><span className="text-primary">{conduitCount}</span> conduits</span>
          <span><span className="text-primary">{lines.length}</span> lines</span>
        </div>
        <span className="text-xs font-mono text-muted-foreground">collatz_holy_tree.inp</span>
      </div>
      <pre className="flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-foreground/90">
        {preview}
        {truncated && (
          <span className="block pt-2 text-primary">
            … {lines.length - 200} more lines (in download)
          </span>
        )}
      </pre>
    </div>
  );
}
