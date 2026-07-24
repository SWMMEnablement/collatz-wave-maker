import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GeneratorForm } from "@/components/GeneratorForm";
import { InpPreview } from "@/components/InpPreview";
import { HolyTreeCanvas } from "@/components/HolyTreeCanvas";
import { HglView } from "@/components/HglView";
import { EngineRunner } from "@/components/EngineRunner";
import { DocsView } from "@/components/DocsView";
import { RunHistoryPanel } from "@/components/RunHistoryPanel";
import { BatchRunner } from "@/components/BatchRunner";
import { ComparePanel } from "@/components/ComparePanel";
import { SizingPanel } from "@/components/SizingPanel";

import { buildInp, defaultOptions, type BuildResult, type InpOptions } from "@/lib/swmm/inp";
import { validateInp } from "@/lib/swmm/validate";
import { buildGeoJson } from "@/lib/swmm/geojson";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { useThresholds } from "@/lib/thresholds";
import { makeHistoryEntry, useRunHistory } from "@/lib/runHistory";
import type { EngineResult } from "@/lib/swmm/engine";
import type { RptSummary } from "@/lib/swmm/rpt";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Collatz SWMM5 INP Generator" },
      {
        name: "description",
        content:
          "Generate EPA SWMM5 .inp input files from the Collatz 'Holy Tree' — every integer is a junction, every 3n+1/n÷2 step is a conduit.",
      },
      { property: "og:title", content: "Collatz SWMM5 INP Generator" },
      {
        property: "og:description",
        content: "Holy Tree from Collatz sequences, rendered as a SWMM5 stormwater network.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PageWrapper,
});

function PageWrapper() {
  return (
    <ThemeProvider>
      <Page />
    </ThemeProvider>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

function Page() {
  const [opts, setOpts] = useState<InpOptions>(defaultOptions);
  const [selectedNodes, setSelectedNodes] = useState<Set<number> | null>(null);
  const [engineResult, setEngineResult] = useState<EngineResult | null>(null);
  const [tab, setTab] = useState<string>("visual");
  const built = useMemo(() => buildInp(opts), [opts]);
  const validation = useMemo(() => validateInp(opts, built), [opts, built]);
  const [thresholds, setThresholds, resetThresholds] = useThresholds();
  const history = useRunHistory();

  const handleRunComplete = useCallback(
    (b: BuildResult, o: InpOptions, r: EngineResult, m: RptSummary) => {
      const entry = makeHistoryEntry(o, b, r, m);
      history.add(entry, r);
    },
    [history],
  );

  const reopenRun = useCallback(
    (id: string) => {
      const r = history.getResult(id);
      if (r) {
        setEngineResult(r);
        setTab("engine");
      }
    },
    [history],
  );

  const nodeStatus = useMemo(() => {
    if (!engineResult) return null;
    const m = new Map<number, "normal" | "surcharge" | "flooding">();
    const cap = opts.maxDepth;
    for (const s of engineResult.series) {
      let mx = 0;
      for (const d of s.depth) if (d > mx) mx = d;
      let status: "normal" | "surcharge" | "flooding" = "normal";
      if (mx >= cap * 1.02) status = "flooding";
      else if (mx >= cap * 0.98) status = "surcharge";
      m.set(s.node, status);
    }
    return m;
  }, [engineResult, opts.maxDepth]);

  const download = useCallback(() => {
    const blob = new Blob([built.inp], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collatz_holy_tree_n${opts.maxSeed}.inp`;
    a.click();
    URL.revokeObjectURL(url);
  }, [built.inp, opts.maxSeed]);

  const downloadGeoJson = useCallback(() => {
    const fc = buildGeoJson(built);
    const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collatz_holy_tree_n${opts.maxSeed}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  }, [built, opts.maxSeed]);


  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="mb-10 border-b border-border pb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
                Holy Tree · SWMM5
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
                Collatz <span className="text-primary">→</span> SWMM5 .inp generator
              </h1>
            </div>
            <ThemeToggle />
          </div>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Integers <span className="text-primary">2 through N</span> are used as
            seeds. Every distinct trajectory value they encounter becomes a
            junction, so the network typically has many more nodes than seeds.
            Every Collatz step (n/2 or 3n+1) becomes a conduit, and node&nbsp;1
            is the FREE outfall that all flows drain toward.
          </p>
          <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
            <span className="font-mono uppercase tracking-wider text-accent">Model status:</span>{" "}
            the <code className="font-mono">.inp</code>, GeoJSON, and geometric HGL preview
            are generated deterministically from the topology. The{" "}
            <strong className="text-primary">EPA SWMM 5.2.4 engine ships as WASM</strong>{" "}
            (vendored, browser-adapted from <code className="font-mono">@fileops/swmm-wasm</code>)
            under <code className="font-mono text-primary">/wasm/swmm5.js</code> and runs in a
            Web Worker — the Engine tab reports continuity error, flooded nodes, and max
            surcharge from the actual <code className="font-mono">.rpt</code>, and exposes
            the WASM SHA-256 plus a downloadable run manifest.
          </p>
          <p className="mt-2 max-w-2xl text-xs text-accent/90">
            <span className="font-mono uppercase tracking-wider">Synthetic-model notice:</span>{" "}
            this is a mathematical network for education, computational art, and
            solver testing. Coordinates, elevations, lengths, inflows, rainfall,
            catchments, and conduit dimensions are generated assumptions — not
            infrastructure design.
          </p>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            The Collatz conjecture (3n+1 problem) is an unsolved puzzle: for any
            positive integer <em>n</em>, halve it when even and set it to 3n+1 when
            odd. Every seed tested so far eventually reaches 1, but no one has proved
            it always does.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Presets:
            </span>
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => setOpts((prev) => ({ ...prev, ...p.patch }))}
                title={p.title}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-6">
            <GeneratorForm value={opts} onChange={setOpts} />
            <Button
              onClick={download}
              className="w-full"
              size="lg"
              disabled={!validation.ok}
              title={validation.ok ? "Download .inp" : "Fix validation errors before downloading"}
            >
              Download .inp
            </Button>
            <Button
              onClick={downloadGeoJson}
              variant="outline"
              className="w-full"
              size="sm"
              title="Download nodes + conduits as GeoJSON for QGIS / ArcGIS"
            >
              Download .geojson (GIS)
            </Button>
            {!validation.ok && (
              <p className="text-xs text-destructive">
                {validation.errors} validation error{validation.errors === 1 ? "" : "s"} — see INP tab.
              </p>
            )}

            <div className="rounded-md border border-border bg-card/60 p-3 space-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <div>seeds: <span className="text-primary">{built.seedCount}</span> (2..{opts.maxSeed})</div>
              <div>generated junctions: <span className="text-primary">{built.generatedCount}</span></div>
              <div>leaves: <span className="text-primary">{built.leafCount}</span></div>
              <div>inflow @ {opts.inflowScope}: <span className="text-primary">{built.inflowNodes.length}</span> nodes</div>
              {opts.subcatchments && (
                <div>subs @ {opts.subcatchmentScope}: <span className="text-primary">{built.subcatchmentCount}</span> · {built.effectiveSubArea.toFixed(3)} {opts.flowUnits === "CFS" ? "ac" : "ha"} ea</div>
              )}
              <div className="pt-1">engine: <span className="text-primary">EPA SWMM 5.2.4 · WASM</span></div>
              <div>inp size: <span className="text-primary">{(new Blob([built.inp]).size / 1024).toFixed(1)} KiB</span></div>
              <div>integer mode: <span className={built.tree.diagnostics.safeIntegerOk ? "text-primary" : "text-destructive"}>BigInt-guarded · f64 keys</span> · cap {built.tree.diagnostics.iterationCap.toLocaleString()}/seed</div>
              <div>max trajectory value: <span className="text-primary" title={built.tree.diagnostics.maxTrajectoryValue}>{shortNumber(built.tree.diagnostics.maxTrajectoryValue)}</span></div>
              {built.tree.diagnostics.unsafeTruncatedSeeds.length > 0 && (
                <div className="text-destructive">unsafe-integer truncated: {built.tree.diagnostics.unsafeTruncatedSeeds.length} seed(s)</div>
              )}
              {built.tree.diagnostics.iterationCappedSeeds.length > 0 && (
                <div className="text-accent">iteration-capped: {built.tree.diagnostics.iterationCappedSeeds.length} seed(s)</div>
              )}
              {opts.maxSeed >= 2000 && (
                <div className="text-accent">large-model warning: {opts.maxSeed} seeds may slow the browser</div>
              )}
            </div>
          </aside>

          <section>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="visual">Visual <Badge tone="ok">GENERATED</Badge></TabsTrigger>
                <TabsTrigger value="hgl">HGL <Badge tone={engineResult ? "ok" : "warn"}>{engineResult ? "ENGINE" : "GEOMETRY PREVIEW"}</Badge></TabsTrigger>
                <TabsTrigger value="inp">INP text <Badge tone="ok">GENERATED</Badge></TabsTrigger>
                <TabsTrigger value="engine">Engine <Badge tone={engineResult ? "ok" : "warn"}>{engineResult ? `SWMM5 · ${engineResult.engine.toUpperCase()}` : "WASM READY"}</Badge></TabsTrigger>
                <TabsTrigger value="sizing">Sizing</TabsTrigger>
                <TabsTrigger value="batch">Batch</TabsTrigger>
                <TabsTrigger value="history">History {history.entries.length > 0 && <Badge tone="ok">{history.entries.length}</Badge>}</TabsTrigger>
                <TabsTrigger value="compare">Compare</TabsTrigger>

                <TabsTrigger value="docs">Docs</TabsTrigger>
              </TabsList>
              <TabsContent value="visual" className="mt-3">
                <div className="h-[75vh] min-h-[520px]">
                  <HolyTreeCanvas
                    tree={built.tree}
                    coords={built.coords}
                    selectedNodes={selectedNodes}
                    onSelectionChange={setSelectedNodes}
                    nodeStatus={nodeStatus}
                  />
                </div>
              </TabsContent>
              <TabsContent value="hgl" className="mt-3">
                <div className="h-[75vh] min-h-[520px]">
                  <HglView
                    tree={built.tree}
                    inverts={built.inverts}
                    opts={opts}
                    engineResult={engineResult}
                  />
                </div>
              </TabsContent>
              <TabsContent value="inp" className="mt-3">
                <div className="h-[75vh] min-h-[520px]">
                  <InpPreview
                    inp={built.inp}
                    nodeCount={built.nodeCount}
                    conduitCount={built.conduitCount}
                    opts={opts}
                    endTimeSec={built.endTimeSec}
                    validation={validation}
                    onDownload={download}
                  />
                </div>
              </TabsContent>
              <TabsContent value="engine" className="mt-3">
                <div className="h-[75vh] min-h-[520px]">
                  <EngineRunner
                    built={built}
                    opts={opts}
                    selectedNodes={selectedNodes}
                    result={engineResult}
                    onResult={setEngineResult}
                    thresholds={thresholds}
                    onRunComplete={handleRunComplete}
                  />
                </div>
              </TabsContent>
              <TabsContent value="sizing" className="mt-3">
                <div className="h-[75vh] min-h-[520px]">
                  <SizingPanel
                    opts={opts}
                    onApplyDiameter={(d, progressive) =>
                      setOpts((prev) => ({ ...prev, diameter: d, progressiveSizing: progressive }))
                    }
                    onResult={(r) => { setEngineResult(r); setTab("engine"); }}
                  />
                </div>
              </TabsContent>
              <TabsContent value="batch" className="mt-3">

                <div className="h-[75vh] min-h-[520px]">
                  <BatchRunner
                    baseOpts={opts}
                    thresholds={thresholds}
                    onSaveHistory={(entry, result) => history.add(entry, result)}
                    onReopen={reopenRun}
                    hasStoredResult={(id) => !!history.getResult(id)}
                  />
                </div>
              </TabsContent>
              <TabsContent value="history" className="mt-3">
                <div className="h-[75vh] min-h-[520px]">
                  <RunHistoryPanel
                    entries={history.entries}
                    onReopen={reopenRun}
                    onRemove={history.remove}
                    onClear={history.clear}
                    hasStoredResult={(id) => !!history.getResult(id)}
                    thresholds={thresholds}
                    setThresholds={setThresholds}
                    resetThresholds={resetThresholds}
                  />
                </div>
              </TabsContent>
              <TabsContent value="compare" className="mt-3">
                <div className="h-[75vh] min-h-[520px]">
                  <ComparePanel
                    entries={history.entries}
                    thresholds={thresholds}
                    onReopen={reopenRun}
                    hasStoredResult={(id) => !!history.getResult(id)}
                  />
                </div>
              </TabsContent>
              <TabsContent value="docs" className="mt-3">
                <div className="h-[75vh] min-h-[520px]">
                  <DocsView opts={opts} />
                </div>
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </div>
    </main>
  );
}

const PRESETS: Array<{ label: string; title: string; patch: Partial<InpOptions> }> = [
  { label: "N=10",    title: "Tiny network — 20 nodes, quick preview",         patch: { maxSeed: 10 } },
  { label: "N=27",    title: "Classic Collatz record (seed 27 → 111 steps)",   patch: { maxSeed: 27 } },
  { label: "N=100",   title: "Default — 251 generated junctions",              patch: { maxSeed: 100 } },
  { label: "N=1000",  title: "Big network — ~2k nodes",                        patch: { maxSeed: 1000 } },
  { label: "Stress",  title: "Stress test — 5000 seeds, may slow rendering",   patch: { maxSeed: 5000 } },
];

function Badge({ tone, children }: { tone: "ok" | "warn" | "err"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-primary/40 bg-primary/10 text-primary"
      : tone === "warn"
      ? "border-accent/50 bg-accent/10 text-accent"
      : "border-destructive/50 bg-destructive/10 text-destructive";
  return (
    <span className={`ml-2 rounded-sm border px-1 py-0.5 font-mono text-[8px] uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}
