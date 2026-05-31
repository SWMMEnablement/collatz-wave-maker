import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GeneratorForm } from "@/components/GeneratorForm";
import { InpPreview } from "@/components/InpPreview";
import { HolyTreeCanvas } from "@/components/HolyTreeCanvas";
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
        <header className="mb-10 border-b border-border pb-6">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Holy Tree · SWMM5
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
            Collatz <span className="text-primary">→</span> SWMM5 .inp generator
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Every integer in 1..N becomes a junction. Every Collatz step
            (n/2 or 3n+1) becomes a conduit. Node 1 is the outfall — all
            flows drain to it. A stub WASM SWMM5 engine slot is wired and
            ready for a real <code className="font-mono text-primary">swmm5.wasm</code> drop-in.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-6">
            <GeneratorForm value={opts} onChange={setOpts} />
            <Button onClick={download} className="w-full" size="lg">
              Download .inp
            </Button>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              engine: stub · wasm slot: /public/wasm/
            </p>
          </aside>

          <section className="h-[75vh] min-h-[520px]">
            <Tabs defaultValue="visual" className="flex h-full flex-col">
              <TabsList className="self-start">
                <TabsTrigger value="visual">Visual</TabsTrigger>
                <TabsTrigger value="inp">INP text</TabsTrigger>
              </TabsList>
              <TabsContent value="visual" className="mt-3 flex-1 min-h-0">
                <HolyTreeCanvas tree={built.tree} coords={built.coords} />
              </TabsContent>
              <TabsContent value="inp" className="mt-3 flex-1 min-h-0">
                <InpPreview
                  inp={built.inp}
                  nodeCount={built.nodeCount}
                  conduitCount={built.conduitCount}
                />
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </div>
    </main>
  );
}
