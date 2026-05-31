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
import type { InpOptions } from "@/lib/swmm/inp";
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

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label>Max seed N</Label>
          <span className="font-mono text-sm text-primary">{value.maxSeed}</span>
        </div>
        <Slider
          min={2}
          max={2000}
          step={1}
          value={[value.maxSeed]}
          onValueChange={([v]) => set("maxSeed", v)}
        />
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
