import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  autoSizeUniform,
  compareDiameterModes,
  defaultSizingConstraints,
  standardDiametersFor,
  type AutoSizeOutcome,
  type SizingAttempt,
  type SizingConstraints,
  type ModeRunSummary,
} from "@/lib/swmm/sizing";
import type { InpOptions } from "@/lib/swmm/inp";
import type { EngineResult } from "@/lib/swmm/engine";

interface Props {
  opts: InpOptions;
  onApplyDiameter: (d: number, progressive: boolean) => void;
  onResult?: (r: EngineResult) => void;
}

export function SizingPanel({ opts, onApplyDiameter, onResult }: Props) {
  const [constraints, setConstraints] = useState<SizingConstraints>(defaultSizingConstraints);
  const [running, setRunning] = useState<null | "auto" | "compare">(null);
  const [progress, setProgress] = useState<string>("");
  const [auto, setAuto] = useState<AutoSizeOutcome | null>(null);
  const [compare, setCompare] = useState<{ uniform: ModeRunSummary; progressive: ModeRunSummary } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const runAuto = async () => {
    setRunning("auto");
    setErr(null);
    setAuto(null);
    try {
      const diameters = standardDiametersFor(opts.flowUnits);
      const out = await autoSizeUniform(opts, constraints, diameters, (idx, total, a) => {
        setProgress(`try ${idx}/${total}: Ø${a.diameter} → ${a.passed ? "OK" : a.reason}`);
      });
      setAuto(out);
      if (out.finalResult) onResult?.(out.finalResult);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(null);
      setProgress("");
    }
  };

  const runCompare = async () => {
    setRunning("compare");
    setErr(null);
    setCompare(null);
    try {
      const c = await compareDiameterModes(opts, (label) => setProgress(`running ${label}…`));
      setCompare(c);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(null);
      setProgress("");
    }
  };

  const unitLen = opts.flowUnits === "CFS" ? "ft" : "m";
  const unitVel = opts.flowUnits === "CFS" ? "ft/s" : "m/s";

  return (
    <div className="h-full min-h-0 space-y-4 overflow-auto pr-1">
      <div className="rounded-md border border-border bg-card/60 p-4">
        <h3 className="mb-3 font-mono text-xs uppercase tracking-wider text-primary">
          Auto-size (uniform) — pick smallest standard Ø
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Iteratively runs the EPA SWMM 5.2.4 engine on standard diameters (ascending)
          and returns the smallest that satisfies every constraint. Each attempt is a
          full dynamic-wave run, so wall time scales with the number of tries.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Field label={`Max d/D`}>
            <Input
              type="number" step="0.05" min={0.1} max={1.5}
              value={constraints.maxDepthRatio}
              onChange={(e) => setConstraints({ ...constraints, maxDepthRatio: Number(e.target.value) })}
            />
          </Field>
          <Field label={`Max velocity (${unitVel})`}>
            <Input
              type="number" step="0.5" min={0}
              value={constraints.maxVelocity}
              onChange={(e) => setConstraints({ ...constraints, maxVelocity: Number(e.target.value) })}
            />
          </Field>
          <Field label="Max flooded nodes">
            <Input
              type="number" step="1" min={0}
              value={constraints.maxFloodedNodes}
              onChange={(e) => setConstraints({ ...constraints, maxFloodedNodes: Number(e.target.value) })}
            />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={runAuto} disabled={running !== null}>
            {running === "auto" ? "Auto-sizing…" : "Run auto-size"}
          </Button>
          {running === "auto" && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {progress}
            </span>
          )}
          {auto && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {auto.chosen
                ? `chosen Ø ${auto.chosen.diameter} ${unitLen}`
                : `no candidate passed — using largest tried Ø ${auto.attempts[auto.attempts.length - 1]?.diameter} ${unitLen}`}
            </span>
          )}
        </div>
        {auto && auto.attempts.length > 0 && (
          <div className="mt-3 overflow-auto rounded border border-border">
            <table className="w-full font-mono text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground uppercase tracking-wider">
                <tr>
                  <Th>Ø ({unitLen})</Th>
                  <Th>Flooded</Th>
                  <Th>Max d/D</Th>
                  <Th>Max V ({unitVel})</Th>
                  <Th>Continuity %</Th>
                  <Th>Runtime (ms)</Th>
                  <Th>Result</Th>
                </tr>
              </thead>
              <tbody>
                {auto.attempts.map((a, i) => (
                  <AttemptRow
                    key={i}
                    a={a}
                    chosen={auto.chosen?.diameter === a.diameter}
                  />
                ))}
              </tbody>
            </table>
            {auto.chosen && (
              <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/20 p-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onApplyDiameter(auto.chosen!.diameter, false)}
                >
                  Apply Ø {auto.chosen.diameter} {unitLen} to generator
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-md border border-border bg-card/60 p-4">
        <h3 className="mb-3 font-mono text-xs uppercase tracking-wider text-primary">
          Uniform vs √upstream progressive — one-click compare
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Runs the current settings twice: once with a uniform diameter, once with
          progressive sizing (Ø × √upstream nodes, capped by the max multiplier).
        </p>
        <div className="flex items-center gap-3">
          <Button onClick={runCompare} disabled={running !== null}>
            {running === "compare" ? "Comparing…" : "Compare modes"}
          </Button>
          {running === "compare" && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {progress}
            </span>
          )}
        </div>
        {compare && (
          <div className="mt-3 overflow-auto rounded border border-border">
            <table className="w-full font-mono text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground uppercase tracking-wider">
                <tr>
                  <Th>Metric</Th>
                  <Th>Uniform</Th>
                  <Th>Progressive √up</Th>
                  <Th>Δ (P − U)</Th>
                </tr>
              </thead>
              <tbody>
                <CompareRow label="Base Ø" u={compare.uniform.diameter} p={compare.progressive.diameter} suffix={" " + unitLen} />
                <CompareRow label="Max d/D" u={compare.uniform.maxDepthRatio} p={compare.progressive.maxDepthRatio} digits={2} highlight="lower" />
                <CompareRow label={`Max V (${unitVel})`} u={compare.uniform.maxVelocity} p={compare.progressive.maxVelocity} digits={2} />
                <CompareRow label="Flooded nodes" u={compare.uniform.flooded} p={compare.progressive.flooded} highlight="lower" />
                <CompareRow label="Max surcharge (h)" u={compare.uniform.maxSurchargeHours ?? 0} p={compare.progressive.maxSurchargeHours ?? 0} digits={2} highlight="lower" />
                <CompareRow label="Flow continuity %" u={compare.uniform.continuityPct ?? 0} p={compare.progressive.continuityPct ?? 0} digits={3} />
                <CompareRow label="Runtime (ms)" u={compare.uniform.runtimeMs} p={compare.progressive.runtimeMs} digits={0} />
              </tbody>
            </table>
            <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/20 p-2">
              <Button size="sm" variant="outline" onClick={() => onApplyDiameter(compare.uniform.diameter, false)}>
                Apply uniform
              </Button>
              <Button size="sm" variant="outline" onClick={() => onApplyDiameter(compare.progressive.diameter, true)}>
                Apply progressive
              </Button>
            </div>
          </div>
        )}
      </div>

      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-1 text-left font-normal">{children}</th>;
}

function AttemptRow({ a, chosen }: { a: SizingAttempt; chosen: boolean }) {
  const cls = chosen
    ? "bg-primary/15 text-primary"
    : a.passed
      ? "text-foreground"
      : "text-muted-foreground";
  return (
    <tr className={`border-t border-border ${cls}`}>
      <td className="px-2 py-1">{a.diameter}</td>
      <td className="px-2 py-1">{a.flooded}</td>
      <td className="px-2 py-1">{a.maxDepthRatio.toFixed(2)}</td>
      <td className="px-2 py-1">{a.maxVelocity.toFixed(2)}</td>
      <td className="px-2 py-1">{a.continuityPct != null ? a.continuityPct.toFixed(3) : "—"}</td>
      <td className="px-2 py-1">{a.runtimeMs.toFixed(0)}</td>
      <td className="px-2 py-1">
        {a.passed ? (
          <span className="rounded border border-primary/40 bg-primary/10 px-1 text-primary">
            {chosen ? "chosen" : "pass"}
          </span>
        ) : (
          <span className="text-accent">{a.reason}</span>
        )}
      </td>
    </tr>
  );
}

function CompareRow({
  label, u, p, digits = 0, suffix = "", highlight,
}: {
  label: string; u: number; p: number; digits?: number; suffix?: string;
  highlight?: "lower" | "higher";
}) {
  const delta = p - u;
  const better =
    highlight === "lower" ? (delta < 0 ? "p" : delta > 0 ? "u" : null)
    : highlight === "higher" ? (delta > 0 ? "p" : delta < 0 ? "u" : null)
    : null;
  const fmt = (n: number) => n.toFixed(digits) + suffix;
  return (
    <tr className="border-t border-border">
      <td className="px-2 py-1 text-muted-foreground">{label}</td>
      <td className={`px-2 py-1 ${better === "u" ? "text-primary" : ""}`}>{fmt(u)}</td>
      <td className={`px-2 py-1 ${better === "p" ? "text-primary" : ""}`}>{fmt(p)}</td>
      <td className={`px-2 py-1 ${delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-accent" : "text-primary"}`}>
        {delta > 0 ? "+" : ""}{fmt(delta)}
      </td>
    </tr>
  );
}
