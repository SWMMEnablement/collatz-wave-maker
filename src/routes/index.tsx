import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { GeneratorForm } from "@/components/GeneratorForm";
import { InpPreview } from "@/components/InpPreview";
import { buildInp, defaultOptions, type InpOptions } from "@/lib/swmm/inp";

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
    ],
  }),
  component: Page,
});

function Page() {
  const [opts, setOpts] = useState<InpOptions>(defaultOptions);

  const built = useMemo(() => buildInp(opts), [opts]);

  const download = () => {
    const blob = new Blob([built.inp], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collatz_holy_tree_n${opts.maxSeed}.inp`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="mb-10 flex items-end justify-between gap-6 border-b border-border pb-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
              Holy Tree · SWMM5
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              Collatz <span className="text-primary">→</span> SWMM5 .inp generator
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Every integer in 1..N becomes a junction. Every Collatz step
              (n/2 or 3n+1) becomes a conduit. Node 1 is the outfall — all
              flows dr