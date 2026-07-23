import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Thresholds } from "@/lib/thresholds";

interface Props {
  value: Thresholds;
  onChange: (t: Thresholds) => void;
  onReset: () => void;
}

export function ThresholdsPanel({ value, onChange, onReset }: Props) {
  const set = <K extends keyof Thresholds>(k: K, v: Thresholds[K]) =>
    onChange({ ...value, [k]: v });
  const num = (k: keyof Thresholds) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!isNaN(v)) set(k, v as Thresholds[typeof k]);
  };
  return (
    <div className="rounded-md border border-border bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Metric thresholds</h3>
          <p className="text-xs text-muted-foreground">
            Values at or above <span className="text-destructive">bad</span> color the metric red
            and (optionally) stop a batch run. Above <span className="text-accent">warn</span> colors amber.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReset}>
          Reset
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Flow continuity · warn (%)">
          <Input type="number" step="0.1" value={value.flowContinuityWarnPct} onChange={num("flowContinuityWarnPct")} />
        </Field>
        <Field label="Flow continuity · bad (%)">
          <Input type="number" step="0.1" value={value.flowContinuityBadPct} onChange={num("flowContinuityBadPct")} />
        </Field>
        <Field label="Runoff continuity · warn (%)">
          <Input type="number" step="0.1" value={value.runoffContinuityWarnPct} onChange={num("runoffContinuityWarnPct")} />
        </Field>
        <Field label="Runoff continuity · bad (%)">
          <Input type="number" step="0.1" value={value.runoffContinuityBadPct} onChange={num("runoffContinuityBadPct")} />
        </Field>
        <Field label="Flooded nodes · warn (>)">
          <Input type="number" value={value.floodedNodesWarn} onChange={num("floodedNodesWarn")} />
        </Field>
        <Field label="Flooded nodes · bad (≥)">
          <Input type="number" value={value.floodedNodesBad} onChange={num("floodedNodesBad")} />
        </Field>
        <Field label="Max surcharge · warn (h)">
          <Input type="number" step="0.5" value={value.maxSurchargeWarnHrs} onChange={num("maxSurchargeWarnHrs")} />
        </Field>
        <Field label="Max surcharge · bad (h)">
          <Input type="number" step="0.5" value={value.maxSurchargeBadHrs} onChange={num("maxSurchargeBadHrs")} />
        </Field>
      </div>
      <label className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={value.stopOnBad}
          onChange={(e) => set("stopOnBad", e.target.checked)}
        />
        <span>
          In a batch run, <strong>stop after the first run</strong> that hits a{" "}
          <span className="text-destructive">bad</span> threshold.
        </span>
      </label>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
