import { Button } from "@/components/ui/button";
import { AlertCircle, AlertTriangle, CheckCircle2, Download } from "lucide-react";
import type { InpOptions } from "@/lib/swmm/inp";
import type { ValidationReport } from "@/lib/swmm/validate";

interface Props {
  inp: string;
  nodeCount: number;
  conduitCount: number;
  opts: InpOptions;
  endTimeSec: number;
  validation: ValidationReport;
  onDownload: () => void;
}

function fmtHMS(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
}

export function InpPreview({
  inp,
  nodeCount,
  conduitCount,
  opts,
  endTimeSec,
  validation,
  onDownload,
}: Props) {
  const lines = inp.split("\n");
  const preview = lines.slice(0, 200).join("\n");
  const truncated = lines.length > 200;

  const endH = endTimeSec / 3600;
  const rise = opts.trapRiseFrac * endH;
  const plateau = opts.trapPlateauFrac * endH;
  const fall = opts.trapFallFrac * endH;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card">
      {/* Summary header */}
      <div className="border-b border-border px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
            <span><span className="text-primary">{nodeCount}</span> nodes</span>
            <span><span className="text-primary">{conduitCount}</span> conduits</span>
            <span><span className="text-primary">{lines.length}</span> lines</span>
          </div>
          <div className="flex items-center gap-2">
            <ValidationBadge validation={validation} />
            <Button size="sm" onClick={onDownload} disabled={!validation.ok} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Download .inp
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-4">
          <SummaryCell label="Run length" value={`${fmtHMS(endTimeSec)} (${endH.toFixed(1)} h)`} />
          <SummaryCell
            label="Trapezoid"
            value={`↑${rise.toFixed(1)}h · ▬${plateau.toFixed(1)}h · ↓${fall.toFixed(1)}h`}
          />
          <SummaryCell
            label="Peak inflow"
            value={`${opts.peakInflow} ${opts.flowUnits}`}
          />
          <SummaryCell
            label="DWF default"
            value={`${opts.dwfBaseflow} ${opts.flowUnits}${opts.dwfPattern ? ` · "${opts.dwfPattern}"` : ""}`}
          />
          <SummaryCell label="Coord scale" value={`×${opts.coordScale}`} />
          <SummaryCell label="Flow routing" value="DYNWAVE · Δt 10s" />
          <SummaryCell label="Outfall" value="Node 1 (FREE)" />
          <SummaryCell label="Layout" value={opts.layoutMode} />
        </div>

        {validation.issues.length > 0 && (
          <ul className="space-y-1 border-t border-border pt-2">
            {validation.issues.map((i, idx) => (
              <li
                key={idx}
                className={`flex items-start gap-2 text-xs font-mono ${
                  i.level === "error" ? "text-destructive" : "text-accent"
                }`}
              >
                {i.level === "error" ? (
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <span>
                  <span className="uppercase tracking-wider">[{i.section}]</span> {i.message}
                </span>
              </li>
            ))}
          </ul>
        )}
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

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground/90">{value}</span>
    </div>
  );
}

function ValidationBadge({ validation }: { validation: ValidationReport }) {
  if (validation.ok && validation.warnings === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-mono text-primary">
        <CheckCircle2 className="h-3.5 w-3.5" /> valid
      </span>
    );
  }
  if (!validation.ok) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1 text-[11px] font-mono text-destructive">
        <AlertCircle className="h-3.5 w-3.5" /> {validation.errors} error{validation.errors === 1 ? "" : "s"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-accent/50 bg-accent/10 px-2 py-1 text-[11px] font-mono text-accent">
      <AlertTriangle className="h-3.5 w-3.5" /> {validation.warnings} warning{validation.warnings === 1 ? "" : "s"}
    </span>
  );
}
