import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type InpOptions,
  TRAPEZOID_PRESETS,
  STORM_OPTIONS,
  detectTrapezoidPreset,
  type TrapezoidPresetKey,
  type StormType,
} from "@/lib/swmm/inp";
import { LAYOUT_OPTIONS } from "@/lib/swmm/layout";

interface Props {
  value: InpOptions;
  onChange: (v: InpOptions) => void;
}

export function GeneratorForm({ value, onChange }: Props) {
  const set = <K extends keyof InpOptions>(k: K, v: InpOptions[K]) =>
    onChange({ ...value, [k]: v });

  const num = (k: keyof InpOptions) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(k, Number(e.target.value) as never);

  const currentPreset = detectTrapezoidPreset(value);
  const applyPreset = (key: TrapezoidPresetKey) => {
    if (key === "custom") return;
    const p = TRAPEZOID_PRESETS.find((x) => x.key === key);
    if (!p) return;
    onChange({
      ...value,
      trapRiseFrac: p.rise,
      trapPlateauFrac: p.plateau,
      trapFallFrac: p.fall,
    });
  };

  const fracSum = value.trapRiseFrac + value.trapPlateauFrac + value.trapFallFrac;
  const endH = value.endTimeSec / 3600;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label>Max seed N</Label>
          <span className="font-mono text-sm text-primary">{value.maxSeed}</span>
        </div>
        <Slider
          min={2}
          max={5000}
          step={1}
          value={[value.maxSeed]}
          onValueChange={([v]) => set("maxSeed", v)}
        />
        {value.maxSeed >= 2000 && (
          <p className="text-[11px] text-accent">
            ⚠ Large N — expect &gt;10k nodes. Rendering and WASM run may slow the browser.
          </p>
        )}
      </div>


      <div className="space-y-2">
        <Label>Flow units</Label>
        <Select
          value={value.flowUnits}
          onValueChange={(v) => set("flowUnits", v as InpOptions["flowUnits"])}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="CFS">CFS (ft³/s)</SelectItem>
            <SelectItem value="LPS">LPS (L/s)</SelectItem>
            <SelectItem value="CMS">CMS (m³/s)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Layout</Label>
        <Select
          value={value.layoutMode}
          onValueChange={(v) => set("layoutMode", v as InpOptions["layoutMode"])}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            {LAYOUT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label>End time (seconds)</Label>
          <span className="font-mono text-sm text-primary">
            {value.endTimeSec}s
            <span className="ml-2 text-muted-foreground">
              ({endH.toFixed(2)} h)
            </span>
          </span>
        </div>
        <Slider
          min={43200}
          max={86400}
          step={60}
          value={[Math.max(43200, value.endTimeSec)]}
          onValueChange={([v]) => set("endTimeSec", v)}
        />
        <Input
          type="number"
          min={43200}
          step={1}
          value={value.endTimeSec}
          onChange={num("endTimeSec")}
        />
        <p className="text-xs text-muted-foreground">Minimum 12 h so the trapezoidal inflow develops fully.</p>
      </div>

      {/* Trapezoidal inflow shape controls */}
      <div className="space-y-3 rounded-md border border-border bg-card/60 p-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Trapezoidal inflow shape
          </Label>
          <span className="font-mono text-[10px] uppercase text-primary">
            {currentPreset}
          </span>
        </div>
        <Select value={currentPreset} onValueChange={(v) => applyPreset(v as TrapezoidPresetKey)}>
          <SelectTrigger><SelectValue placeholder="Preset" /></SelectTrigger>
          <SelectContent>
            {TRAPEZOID_PRESETS.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                <div className="flex flex-col">
                  <span>{p.label}</span>
                  <span className="text-xs text-muted-foreground">{p.description}</span>
                </div>
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom (below)</SelectItem>
          </SelectContent>
        </Select>

        <FracSlider
          label="Rise"
          value={value.trapRiseFrac}
          onChange={(v) => set("trapRiseFrac", v)}
          endH={endH}
        />
        <FracSlider
          label="Plateau"
          value={value.trapPlateauFrac}
          onChange={(v) => set("trapPlateauFrac", v)}
          endH={endH}
        />
        <FracSlider
          label="Fall"
          value={value.trapFallFrac}
          onChange={(v) => set("trapFallFrac", v)}
          endH={endH}
        />
        <p className={`text-[11px] font-mono ${Math.abs(fracSum - 1) < 0.01 ? "text-muted-foreground" : fracSum > 1 ? "text-destructive" : "text-accent"}`}>
          Σ = {fracSum.toFixed(2)} of sim length
          {fracSum > 1 ? " — over 100% (invalid)" : fracSum < 0.99 ? " — tail holds at 0" : ""}
        </p>
      </div>

      <div className="space-y-2 rounded-md border border-border bg-card/60 p-3">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Trapezoidal inflow — apply to
        </Label>
        <Select
          value={value.inflowScope}
          onValueChange={(v) => set("inflowScope", v as InpOptions["inflowScope"])}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="seeds">
              <div className="flex flex-col">
                <span>Original seed nodes (2..N)</span>
                <span className="text-xs text-muted-foreground">One inflow per user seed — matches how "N" is interpreted.</span>
              </div>
            </SelectItem>
            <SelectItem value="leaves">
              <div className="flex flex-col">
                <span>Leaf junctions only</span>
                <span className="text-xs text-muted-foreground">Nodes at the tips of the tree (no upstream neighbours).</span>
              </div>
            </SelectItem>
            <SelectItem value="all">
              <div className="flex flex-col">
                <span>Every generated junction</span>
                <span className="text-xs text-muted-foreground">All non-outfall nodes — much heavier flow load.</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <Field label="Peak inflow / node">
          <Input type="number" step="0.1" value={value.peakInflow} onChange={num("peakInflow")} />
        </Field>
      </div>

      <Field label="Coordinate scale">
        <Input type="number" step="0.01" value={value.coordScale} onChange={num("coordScale")} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Base invert"><Input type="number" value={value.baseInvert} onChange={num("baseInvert")} /></Field>
        <Field label="Invert drop / step"><Input type="number" value={value.invertDrop} onChange={num("invertDrop")} /></Field>
        <Field label="Max depth"><Input type="number" value={value.maxDepth} onChange={num("maxDepth")} /></Field>
        <Field label="Conduit length"><Input type="number" value={value.conduitLength} onChange={num("conduitLength")} /></Field>
        <Field label="Roughness (n)"><Input type="number" step="0.001" value={value.roughness} onChange={num("roughness")} /></Field>
        <Field label="Diameter"><Input type="number" step="0.1" value={value.diameter} onChange={num("diameter")} /></Field>
        <Field label="DWF baseflow / node"><Input type="number" step="0.01" value={value.dwfBaseflow} onChange={num("dwfBaseflow")} /></Field>
        <Field label="DWF pattern (opt.)"><Input type="text" value={value.dwfPattern} onChange={(e) => set("dwfPattern", e.target.value)} /></Field>
      </div>

      {/* Progressive conduit sizing */}
      <div className="space-y-2 rounded-md border border-border bg-card/60 p-3">
        <label className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Progressive conduit sizing
          </span>
          <input
            type="checkbox"
            checked={value.progressiveSizing}
            onChange={(e) => set("progressiveSizing", e.target.checked)}
            className="h-4 w-4 accent-[var(--color-primary)]"
          />
        </label>
        <p className="text-[11px] text-muted-foreground">
          Scale conduit diameter by √(upstream nodes), so pipes near the outfall grow with accumulated flow.
        </p>
        {value.progressiveSizing && (
          <Field label={`Max diameter multiplier (×${value.maxDiameterMultiplier})`}>
            <Slider
              min={1}
              max={20}
              step={0.5}
              value={[value.maxDiameterMultiplier]}
              onValueChange={([v]) => set("maxDiameterMultiplier", v)}
            />
          </Field>
        )}
      </div>

      {/* Rainfall / storm */}
      <div className="space-y-3 rounded-md border border-border bg-card/60 p-3">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Rainfall / storm
        </Label>
        <Select
          value={value.stormType}
          onValueChange={(v) => set("stormType", v as StormType)}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {STORM_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                <div className="flex flex-col">
                  <span>{o.label}</span>
                  <span className="text-xs text-muted-foreground">{o.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value.stormType !== "none" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Depth (${value.flowUnits === "CFS" ? "in" : "mm"})`}>
              <Input type="number" step="0.1" min={0} value={value.stormDepth} onChange={num("stormDepth")} />
            </Field>
            <Field label="Duration (h)">
              <Input type="number" step="0.5" min={0} value={value.stormDurationHr} onChange={num("stormDurationHr")} />
            </Field>
            <Field label="Interval (min)">
              <Input type="number" step="1" min={1} value={value.rainIntervalMin} onChange={num("rainIntervalMin")} />
            </Field>
          </div>
        )}
      </div>

      {/* Subcatchments */}
      <div className="space-y-2 rounded-md border border-border bg-card/60 p-3">
        <label className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Auto-generate subcatchments
          </span>
          <input
            type="checkbox"
            checked={value.subcatchments}
            onChange={(e) => set("subcatchments", e.target.checked)}
            className="h-4 w-4 accent-[var(--color-primary)]"
          />
        </label>
        <p className="text-[11px] text-muted-foreground">
          Drops one subcatchment per junction (outlet = the junction) so rainfall turns into runoff.
        </p>
        {value.subcatchments && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Area / sub (${value.flowUnits === "CFS" ? "ac" : "ha"})`}>
              <Input type="number" step="0.1" min={0} value={value.subcatchmentArea} onChange={num("subcatchmentArea")} />
            </Field>
            <Field label="% Impervious">
              <Input type="number" step="1" min={0} max={100} value={value.imperviousPct} onChange={num("imperviousPct")} />
            </Field>
            <Field label={`Width (${value.flowUnits === "CFS" ? "ft" : "m"})`}>
              <Input type="number" step="10" min={0} value={value.subWidth} onChange={num("subWidth")} />
            </Field>
            <Field label="Slope %">
              <Input type="number" step="0.1" min={0} value={value.subSlope} onChange={num("subSlope")} />
            </Field>
          </div>
        )}
      </div>
    </div>

  );
}

function FracSlider({
  label,
  value,
  onChange,
  endH,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  endH: number;
}) {
  const hours = value * endH;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-primary">
          {(value * 100).toFixed(0)}%{" "}
          <span className="text-muted-foreground">({hours.toFixed(2)} h)</span>
        </span>
      </div>
      <Slider
        min={0}
        max={1}
        step={0.01}
        value={[Math.max(0, Math.min(1, value))]}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
