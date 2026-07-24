import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  autoSizeUniform,
  CancelledError,
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
import { getEngineProvenance } from "@/lib/swmm/provenance";
import { GENERATOR_VERSION } from "@/lib/swmm/manifest";

interface Props {
  opts: InpOptions;
  onApplyDiameter: (d: number, progressive: boolean) => void;
  onResult?: (r: EngineResult) => void;
}

export function SizingPanel({ opts, onApplyDiameter, onResult }: Props) {
  const [constraints, setConstraints] = useState<SizingConstraints>(defaultSizingConstraints);
  const [running, setRunning] = useState<null | "auto" | "compare">(null);
  const [progress, setProgress] = useState<string>("");
  const [pct, setPct] = useState<number>(0);
  const [auto, setAuto] = useState<AutoSizeOutcome | null>(null);
  const [compare, setCompare] = useState<{ uniform: ModeRunSummary; progressive: ModeRunSummary } | null>(null);
  // Live-streaming state — updated as each attempt / mode row finishes.
  const [liveAttempts, setLiveAttempts] = useState<SizingAttempt[]>([]);
  const [liveCompare, setLiveCompare] = useState<Partial<{ uniform: ModeRunSummary; progressive: ModeRunSummary }>>({});
  // Resume state — attempts loaded from a previously exported manifest.
  const [resumeAttempts, setResumeAttempts] = useState<SizingAttempt[]>([]);
  const [resumeCompare, setResumeCompare] = useState<Partial<{ uniform: ModeRunSummary; progressive: ModeRunSummary }>>({});
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resumeFileRef = useRef<HTMLInputElement | null>(null);

  const cancel = () => {
    abortRef.current?.abort();
    setProgress("cancelling…");
  };

  const runAuto = async (options: { fresh?: boolean } = {}) => {
    setRunning("auto");
    setErr(null);
    setAuto(null);
    setPct(0);
    const prior = options.fresh ? [] : resumeAttempts;
    setLiveAttempts([...prior]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const diameters = standardDiametersFor(opts.flowUnits);
      const out = await autoSizeUniform(
        opts,
        constraints,
        diameters,
        {
          onProgress: (idx, total, a, epct) => {
            const stepPct = ((idx - 1) + (epct ?? 0) / 100) / total * 100;
            setPct(Math.min(99, stepPct));
            setProgress(`try ${idx}/${total}: Ø${a.diameter}${a.reason === "running" ? ` · engine ${Math.round(epct ?? 0)}%` : ` → ${a.passed ? "OK" : a.reason || "fail"}`}`);
          },
          onAttempt: (attempt) => {
            setLiveAttempts((prev) => [...prev, attempt]);
          },
        },
        ac.signal,
        prior,
      );
      setPct(100);
      setAuto(out);
      setLiveAttempts(out.attempts);
      if (options.fresh) setResumeAttempts([]);
      if (out.finalResult) onResult?.(out.finalResult);
    } catch (e) {
      if (e instanceof CancelledError) setErr("cancelled — you can resume from the attempts above via Restart from here");
      else setErr((e as Error).message);
    } finally {
      setRunning(null);
      setProgress("");
      abortRef.current = null;
    }
  };

  const runCompare = async (options: { fresh?: boolean } = {}) => {
    setRunning("compare");
    setErr(null);
    setCompare(null);
    setPct(0);
    const prior = options.fresh ? {} : resumeCompare;
    setLiveCompare({ ...prior });
    const skip: Array<"uniform" | "progressive"> = [];
    if (prior.uniform) skip.push("uniform");
    if (prior.progressive) skip.push("progressive");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const c = await compareDiameterModes(
        opts,
        {
          onProgress: (label, epct) => {
            const base = label === "uniform" ? 0 : 50;
            setPct(Math.min(99, base + (epct ?? 0) / 2));
            setProgress(`running ${label}… ${Math.round(epct ?? 0)}%`);
          },
          onModeDone: (m) => {
            setLiveCompare((prev) => ({ ...prev, [m.mode]: m }));
          },
        },
        ac.signal,
        skip,
        prior,
      );
      setPct(100);
      setCompare(c);
      setLiveCompare(c);
      if (options.fresh) setResumeCompare({});
    } catch (e) {
      if (e instanceof CancelledError) setErr("cancelled — you can resume from partial rows above");
      else setErr((e as Error).message);
    } finally {
      setRunning(null);
      setProgress("");
      abortRef.current = null;
    }
  };

  // Use the latest available data for rendering (live > completed).
  const attemptsView: SizingAttempt[] = liveAttempts.length ? liveAttempts : (auto?.attempts ?? []);
  const compareView = auto || compare
    ? (compare ?? undefined)
    : undefined;
  const compareLive = liveCompare.uniform && liveCompare.progressive
    ? { uniform: liveCompare.uniform, progressive: liveCompare.progressive }
    : compareView;

  const restartAutoFromHere = () => {
    // Freeze current live attempts as the resume set and re-run — the engine
    // will skip diameters already present and continue from the next one.
    setResumeAttempts(liveAttempts.length ? liveAttempts : (auto?.attempts ?? []));
    setAuto(null);
    void runAuto();
  };

  const restartCompareFromHere = () => {
    setResumeCompare(liveCompare);
    setCompare(null);
    void runCompare();
  };

  const onResumeFile = async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (json.kind === "auto_size_uniform" && Array.isArray(json.attempts)) {
        setResumeAttempts(json.attempts as SizingAttempt[]);
        setLiveAttempts(json.attempts as SizingAttempt[]);
        setErr(null);
      } else if (json.kind === "compare_uniform_vs_progressive") {
        // Rebuild the ModeRunSummary shape enough for the compare table + skip.
        const rebuild = (m: Record<string, unknown> | undefined, mode: "uniform" | "progressive"): ModeRunSummary | undefined => {
          if (!m) return undefined;
          return {
            mode,
            diameter: Number(m.diameter),
            maxDepthRatio: Number(m.max_depth_ratio),
            maxVelocity: Number(m.max_velocity),
            flooded: Number(m.flooded),
            maxSurchargeHours: m.max_surcharge_hours == null ? null : Number(m.max_surcharge_hours),
            continuityPct: m.flow_continuity_pct == null ? null : Number(m.flow_continuity_pct),
            runtimeMs: Number(m.runtime_ms),
            engineExitCode: (m.engine_exit_code as number | null) ?? null,
            analysisErrors: (m.analysis_errors as string[]) ?? [],
            analysisWarnings: (m.analysis_warnings as string[]) ?? [],
            engineLogTail: (m.engine_log_tail as string) ?? "",
            // Placeholders — not needed for compare-only resume/display.
            built: undefined as unknown as ModeRunSummary["built"],
            result: undefined as unknown as ModeRunSummary["result"],
            metrics: undefined as unknown as ModeRunSummary["metrics"],
          };
        };
        const restored = {
          uniform: rebuild(json.uniform, "uniform"),
          progressive: rebuild(json.progressive, "progressive"),
        };
        setResumeCompare(restored);
        setLiveCompare(restored);
        setErr(null);
      } else {
        setErr("unrecognized manifest (expected sizing or compare manifest.json)");
      }
    } catch (e) {
      setErr("failed to parse manifest: " + (e as Error).message);
    }
  };


  const unitLen = opts.flowUnits === "CFS" ? "ft" : "m";
  const unitVel = opts.flowUnits === "CFS" ? "ft/s" : "m/s";

  const buildSizingManifest = async () => {
    if (!auto) return null;
    const prov = await getEngineProvenance();
    return {
      schema_version: "1.0" as const,
      kind: "auto_size_uniform" as const,
      generator_version: GENERATOR_VERSION,
      generated_at: new Date().toISOString(),
      base_options: opts,
      constraints,
      candidate_diameters: standardDiametersFor(opts.flowUnits),
      chosen_diameter: auto.chosen?.diameter ?? null,
      chosen_passed: !!auto.chosen,
      attempts: auto.attempts,
      final_metrics: {
        flow_continuity_pct: auto.finalMetrics.flowContinuityPct,
        runoff_continuity_pct: auto.finalMetrics.runoffContinuityPct,
        flooded_nodes: auto.finalMetrics.floodedNodes.map((n) => n.id),
        surcharged_nodes: auto.finalMetrics.surchargedNodes.map((n) => n.id),
        max_surcharge_hours: auto.finalMetrics.maxSurchargeHours,
      },
      engine: prov,
      units: { length: unitLen, velocity: unitVel },
    };
  };

  const buildCompareManifest = async () => {
    if (!compare) return null;
    const prov = await getEngineProvenance();
    const pack = (m: ModeRunSummary) => ({
      mode: m.mode,
      diameter: m.diameter,
      progressive: m.mode === "progressive",
      max_depth_ratio: m.maxDepthRatio,
      max_velocity: m.maxVelocity,
      flooded: m.flooded,
      max_surcharge_hours: m.maxSurchargeHours,
      flow_continuity_pct: m.continuityPct,
      runtime_ms: m.runtimeMs,
      engine_exit_code: m.engineExitCode,
      analysis_errors: m.analysisErrors,
      analysis_warnings: m.analysisWarnings,
      engine_log_tail: m.engineLogTail,
      flooded_node_ids: m.metrics?.floodedNodes.map((n) => n.id) ?? [],
      surcharged_node_ids: m.metrics?.surchargedNodes.map((n) => n.id) ?? [],
    });
    return {
      schema_version: "1.0" as const,
      kind: "compare_uniform_vs_progressive" as const,
      generator_version: GENERATOR_VERSION,
      generated_at: new Date().toISOString(),
      base_options: opts,
      uniform: pack(compare.uniform),
      progressive: pack(compare.progressive),
      delta: {
        flooded: compare.progressive.flooded - compare.uniform.flooded,
        max_depth_ratio: compare.progressive.maxDepthRatio - compare.uniform.maxDepthRatio,
        max_velocity: compare.progressive.maxVelocity - compare.uniform.maxVelocity,
        max_surcharge_hours:
          (compare.progressive.maxSurchargeHours ?? 0) - (compare.uniform.maxSurchargeHours ?? 0),
        runtime_ms: compare.progressive.runtimeMs - compare.uniform.runtimeMs,
      },
      engine: prov,
      units: { length: unitLen, velocity: unitVel },
    };
  };

  const download = (name: string, data: string, mime: string) => {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAutoManifest = async () => {
    const m = await buildSizingManifest();
    if (m) download(`sizing_manifest_n${opts.maxSeed}.json`, JSON.stringify(m, null, 2), "application/json");
  };
  const downloadCompareManifest = async () => {
    const m = await buildCompareManifest();
    if (m) download(`compare_manifest_n${opts.maxSeed}.json`, JSON.stringify(m, null, 2), "application/json");
  };

  const downloadAutoCsv = () => {
    if (!auto) return;
    const header = ["diameter", "flooded", "max_d_over_D", "max_velocity", "continuity_pct", "runtime_ms", "exit_code", "analysis_errors", "analysis_warnings", "passed", "reason", "engine_log_tail", "chosen"];
    const rows = auto.attempts.map((a) => [
      a.diameter, a.flooded, a.maxDepthRatio.toFixed(4), a.maxVelocity.toFixed(4),
      a.continuityPct != null ? a.continuityPct.toFixed(4) : "",
      a.runtimeMs.toFixed(0),
      a.engineExitCode ?? "",
      csvEscape((a.analysisErrors ?? []).join(" | ")),
      csvEscape((a.analysisWarnings ?? []).join(" | ")),
      a.passed ? "yes" : "no",
      csvEscape(a.reason),
      csvEscape(a.engineLogTail ?? ""),
      auto.chosen?.diameter === a.diameter ? "yes" : "no",
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    download(`sizing_attempts_n${opts.maxSeed}.csv`, csv, "text/csv");
  };

  const downloadCompareCsv = () => {
    if (!compare) return;
    const u = compare.uniform, p = compare.progressive;
    const rows: (string | number)[][] = [
      ["metric", "uniform", "progressive", "delta"],
      ["diameter_base", u.diameter, p.diameter, p.diameter - u.diameter],
      ["max_d_over_D", u.maxDepthRatio.toFixed(4), p.maxDepthRatio.toFixed(4), (p.maxDepthRatio - u.maxDepthRatio).toFixed(4)],
      ["max_velocity", u.maxVelocity.toFixed(4), p.maxVelocity.toFixed(4), (p.maxVelocity - u.maxVelocity).toFixed(4)],
      ["flooded_nodes", u.flooded, p.flooded, p.flooded - u.flooded],
      ["max_surcharge_hours", u.maxSurchargeHours ?? 0, p.maxSurchargeHours ?? 0, ((p.maxSurchargeHours ?? 0) - (u.maxSurchargeHours ?? 0)).toFixed(4)],
      ["flow_continuity_pct", u.continuityPct ?? "", p.continuityPct ?? "", ((p.continuityPct ?? 0) - (u.continuityPct ?? 0)).toFixed(4)],
      ["runtime_ms", u.runtimeMs.toFixed(0), p.runtimeMs.toFixed(0), (p.runtimeMs - u.runtimeMs).toFixed(0)],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    download(`compare_uniform_vs_progressive_n${opts.maxSeed}.csv`, csv, "text/csv");
  };

  const openPdfReport = async () => {
    const autoM = auto ? await buildSizingManifest() : null;
    const cmpM = compare ? await buildCompareManifest() : null;
    if (!autoM && !cmpM) return;
    const win = window.open("", "_blank");
    if (!win) return;
    const style = `
      body{font:12px -apple-system,BlinkMacSystemFont,sans-serif;color:#111;padding:24px;max-width:900px;margin:0 auto}
      h1{font-size:18px;margin:0 0 4px} h2{font-size:14px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:2px}
      table{border-collapse:collapse;width:100%;font-size:11px;margin:6px 0}
      th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}
      th{background:#f2f2f2}
      .meta{color:#555;font-size:10px}
      .ok{color:#0a7d3c;font-weight:600} .bad{color:#a11}
      @media print{.no-print{display:none}}
      button{padding:6px 12px;margin-right:8px}
    `;
    const autoHtml = autoM ? `
      <h2>Auto-size (uniform) — attempts</h2>
      <p class="meta">Chosen Ø: <strong>${autoM.chosen_diameter ?? "none passed"} ${unitLen}</strong> ·
      Constraints: d/D ≤ ${constraints.maxDepthRatio}, V ≤ ${constraints.maxVelocity} ${unitVel},
      flooded ≤ ${constraints.maxFloodedNodes}</p>
      <table><thead><tr>
        <th>Ø (${unitLen})</th><th>Flooded</th><th>Max d/D</th><th>Max V (${unitVel})</th>
        <th>Continuity %</th><th>Runtime (ms)</th><th>Result</th>
      </tr></thead><tbody>
      ${autoM.attempts.map((a) => `<tr>
        <td>${a.diameter}</td><td>${a.flooded}</td><td>${a.maxDepthRatio.toFixed(2)}</td>
        <td>${a.maxVelocity.toFixed(2)}</td>
        <td>${a.continuityPct != null ? a.continuityPct.toFixed(3) : "—"}</td>
        <td>${a.runtimeMs.toFixed(0)}</td>
        <td class="${a.passed ? "ok" : "bad"}">${a.passed ? (autoM.chosen_diameter === a.diameter ? "chosen" : "pass") : escapeHtml(a.reason)}</td>
      </tr>`).join("")}
      </tbody></table>` : "";
    const cmpHtml = cmpM ? `
      <h2>Uniform vs √upstream progressive</h2>
      <table><thead><tr><th>Metric</th><th>Uniform</th><th>Progressive</th><th>Δ (P − U)</th></tr></thead><tbody>
        ${cmpRow("Base Ø", cmpM.uniform.diameter, cmpM.progressive.diameter, unitLen)}
        ${cmpRow("Max d/D", cmpM.uniform.max_depth_ratio.toFixed(2), cmpM.progressive.max_depth_ratio.toFixed(2))}
        ${cmpRow(`Max V (${unitVel})`, cmpM.uniform.max_velocity.toFixed(2), cmpM.progressive.max_velocity.toFixed(2))}
        ${cmpRow("Flooded", cmpM.uniform.flooded, cmpM.progressive.flooded)}
        ${cmpRow("Max surcharge (h)", (cmpM.uniform.max_surcharge_hours ?? 0).toFixed(2), (cmpM.progressive.max_surcharge_hours ?? 0).toFixed(2))}
        ${cmpRow("Flow continuity %", (cmpM.uniform.flow_continuity_pct ?? 0).toFixed(3), (cmpM.progressive.flow_continuity_pct ?? 0).toFixed(3))}
        ${cmpRow("Runtime (ms)", cmpM.uniform.runtime_ms.toFixed(0), cmpM.progressive.runtime_ms.toFixed(0))}
      </tbody></table>` : "";
    const prov = (autoM?.engine ?? cmpM?.engine)!;
    win.document.write(`<!doctype html><html><head><title>Collatz SWMM5 Sizing Report</title><style>${style}</style></head><body>
      <div class="no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
      <h1>Collatz → SWMM5 Sizing Report</h1>
      <p class="meta">Generated ${new Date().toLocaleString()} · N=${opts.maxSeed} · units=${opts.flowUnits} · engine=${prov.engineName} ${prov.engineVersion} · wasm sha256 ${prov.assetSha256 ?? "n/a"}</p>
      ${autoHtml}${cmpHtml}
    </body></html>`);
    win.document.close();
  };

  const canExport = auto || compare;

  return (
    <div className="h-full min-h-0 space-y-4 overflow-auto pr-1">
      {(running || pct > 0) && (
        <div className="rounded-md border border-border bg-card/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {running ? `${running} · ${progress}` : "done"}
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-primary">{Math.round(pct)}%</span>
              {running && (
                <Button size="sm" variant="destructive" onClick={cancel}>Cancel</Button>
              )}
            </div>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => void runAuto({ fresh: true })} disabled={running !== null}>
            {running === "auto" ? "Auto-sizing…" : resumeAttempts.length ? "Restart fresh" : "Run auto-size"}
          </Button>
          {resumeAttempts.length > 0 && running === null && (
            <Button size="sm" variant="secondary" onClick={() => void runAuto()}>
              Resume from {resumeAttempts.length} attempt{resumeAttempts.length === 1 ? "" : "s"}
            </Button>
          )}
          {attemptsView.length > 0 && running === null && (
            <Button size="sm" variant="outline" onClick={restartAutoFromHere}>
              Restart from here
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => resumeFileRef.current?.click()}
            disabled={running !== null}
          >
            Load manifest…
          </Button>
          <input
            ref={resumeFileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onResumeFile(f);
              e.currentTarget.value = "";
            }}
          />
          {auto && (
            <>
              <Button size="sm" variant="outline" onClick={downloadAutoManifest}>manifest.json</Button>
              <Button size="sm" variant="outline" onClick={downloadAutoCsv}>attempts.csv</Button>
            </>
          )}
          {auto && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {auto.chosen
                ? `chosen Ø ${auto.chosen.diameter} ${unitLen}`
                : `no candidate passed — using largest tried Ø ${auto.attempts[auto.attempts.length - 1]?.diameter} ${unitLen}`}
            </span>
          )}
        </div>
        {attemptsView.length > 0 && (
          <div className="mt-3 overflow-auto rounded border border-border">
            {running === "auto" && (
              <div className="border-b border-border bg-muted/30 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                live · streaming {attemptsView.length} attempt{attemptsView.length === 1 ? "" : "s"} so far
              </div>
            )}
            <table className="w-full font-mono text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground uppercase tracking-wider">
                <tr>
                  <Th>Ø ({unitLen})</Th>
                  <Th>Flooded</Th>
                  <Th>Max d/D</Th>
                  <Th>Max V ({unitVel})</Th>
                  <Th>Continuity %</Th>
                  <Th>Exit</Th>
                  <Th>Runtime (ms)</Th>
                  <Th>Result</Th>
                </tr>
              </thead>
              <tbody>
                {attemptsView.map((a, i) => (
                  <AttemptRow
                    key={i}
                    a={a}
                    chosen={auto?.chosen?.diameter === a.diameter}
                  />
                ))}
              </tbody>
            </table>
            {auto?.chosen && (
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
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void runCompare({ fresh: true })} disabled={running !== null}>
            {running === "compare" ? "Comparing…" : (resumeCompare.uniform || resumeCompare.progressive) ? "Restart fresh" : "Compare modes"}
          </Button>
          {(resumeCompare.uniform || resumeCompare.progressive) && running === null && (
            <Button size="sm" variant="secondary" onClick={() => void runCompare()}>
              Resume compare
            </Button>
          )}
          {(liveCompare.uniform || liveCompare.progressive) && running === null && !compare && (
            <Button size="sm" variant="outline" onClick={restartCompareFromHere}>
              Restart from here
            </Button>
          )}
          {compare && (
            <>
              <Button size="sm" variant="outline" onClick={downloadCompareManifest}>manifest.json</Button>
              <Button size="sm" variant="outline" onClick={downloadCompareCsv}>compare.csv</Button>
            </>
          )}
        </div>
        {(liveCompare.uniform || liveCompare.progressive) && (
          <div className="mt-3 overflow-auto rounded border border-border">
            {running === "compare" && (
              <div className="border-b border-border bg-muted/30 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                live · {liveCompare.uniform ? "uniform ✓ " : "uniform… "}{liveCompare.progressive ? "progressive ✓" : "progressive…"}
              </div>
            )}
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
                <CompareRow label="Base Ø" u={liveCompare.uniform?.diameter} p={liveCompare.progressive?.diameter} suffix={" " + unitLen} />
                <CompareRow label="Max d/D" u={liveCompare.uniform?.maxDepthRatio} p={liveCompare.progressive?.maxDepthRatio} digits={2} highlight="lower" />
                <CompareRow label={`Max V (${unitVel})`} u={liveCompare.uniform?.maxVelocity} p={liveCompare.progressive?.maxVelocity} digits={2} />
                <CompareRow label="Flooded nodes" u={liveCompare.uniform?.flooded} p={liveCompare.progressive?.flooded} highlight="lower" />
                <CompareRow label="Max surcharge (h)" u={liveCompare.uniform?.maxSurchargeHours ?? undefined} p={liveCompare.progressive?.maxSurchargeHours ?? undefined} digits={2} highlight="lower" />
                <CompareRow label="Flow continuity %" u={liveCompare.uniform?.continuityPct ?? undefined} p={liveCompare.progressive?.continuityPct ?? undefined} digits={3} />
                <CompareRow label="Exit code" u={liveCompare.uniform?.engineExitCode ?? undefined} p={liveCompare.progressive?.engineExitCode ?? undefined} digits={0} />
                <CompareRow label="Solver errors" u={liveCompare.uniform?.analysisErrors.length} p={liveCompare.progressive?.analysisErrors.length} highlight="lower" />
                <CompareRow label="Solver warnings" u={liveCompare.uniform?.analysisWarnings.length} p={liveCompare.progressive?.analysisWarnings.length} />
                <CompareRow label="Runtime (ms)" u={liveCompare.uniform?.runtimeMs} p={liveCompare.progressive?.runtimeMs} digits={0} />
              </tbody>
            </table>
            {compare && (
              <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/20 p-2">
                <Button size="sm" variant="outline" onClick={() => onApplyDiameter(compare.uniform.diameter, false)}>
                  Apply uniform
                </Button>
                <Button size="sm" variant="outline" onClick={() => onApplyDiameter(compare.progressive.diameter, true)}>
                  Apply progressive
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {canExport && (
        <div className="rounded-md border border-border bg-card/60 p-4">
          <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-primary">
            One-click report
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Opens a printable report (attempt log + compare table) — use your
            browser's Save-as-PDF from the print dialog.
          </p>
          <Button size="sm" onClick={openPdfReport}>Open PDF report</Button>
        </div>
      )}

      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function cmpRow(label: string, u: string | number, p: string | number, suffix = ""): string {
  const un = typeof u === "number" ? u : parseFloat(u);
  const pn = typeof p === "number" ? p : parseFloat(p);
  const d = pn - un;
  return `<tr><td>${label}</td><td>${u}${suffix}</td><td>${p}${suffix}</td><td>${d > 0 ? "+" : ""}${d.toFixed(2)}${suffix}</td></tr>`;
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
  label: string; u: number | undefined; p: number | undefined; digits?: number; suffix?: string;
  highlight?: "lower" | "higher";
}) {
  const both = u != null && p != null;
  const delta = both ? (p as number) - (u as number) : 0;
  const better = !both ? null
    : highlight === "lower" ? (delta < 0 ? "p" : delta > 0 ? "u" : null)
    : highlight === "higher" ? (delta > 0 ? "p" : delta < 0 ? "u" : null)
    : null;
  const fmt = (n: number | undefined) => (n == null ? "…" : n.toFixed(digits) + suffix);
  return (
    <tr className="border-t border-border">
      <td className="px-2 py-1 text-muted-foreground">{label}</td>
      <td className={`px-2 py-1 ${better === "u" ? "text-primary" : ""}`}>{fmt(u)}</td>
      <td className={`px-2 py-1 ${better === "p" ? "text-primary" : ""}`}>{fmt(p)}</td>
      <td className={`px-2 py-1 ${!both ? "text-muted-foreground" : delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-accent" : "text-primary"}`}>
        {both ? `${delta > 0 ? "+" : ""}${fmt(delta)}` : "—"}
      </td>
    </tr>
  );
}
