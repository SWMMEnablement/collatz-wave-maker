import type { InpOptions } from "@/lib/swmm/inp";

interface Props {
  opts: InpOptions;
}

export function DocsView({ opts }: Props) {
  return (
    <div className="h-full overflow-auto rounded-md border border-border bg-card p-6">
      <article className="prose prose-sm max-w-none space-y-6 text-sm leading-relaxed text-foreground">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
            documentation
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            How the SWMM5 .inp is generated from Collatz
          </h2>
          <p className="mt-2 text-muted-foreground">
            A walk-through of every transformation, from the 3n+1 rule to a
            valid EPA SWMM5 input file.
          </p>
        </header>

        <section className="space-y-2">
          <h3 className="text-base font-semibold text-primary">1. The Collatz map</h3>
          <p>
            For every positive integer <code className="font-mono">n</code> we apply
            one rule:
          </p>
          <pre className="rounded bg-muted p-3 font-mono text-xs">
{`next(n) = n / 2          if n is even
next(n) = 3 * n + 1      if n is odd`}
          </pre>
          <p>
            Repeatedly applying <code className="font-mono">next</code> to any
            seed eventually reaches <code className="font-mono">1</code> (so far,
            for every integer ever tested — the conjecture is still open).
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold text-primary">2. From sequences to the Holy Tree</h3>
          <p>
            We pick a cap <code className="font-mono">N = {opts.maxSeed}</code> and
            walk the Collatz sequence for every seed{" "}
            <code className="font-mono">s = 2..N</code>. As we walk, we record
            two things in <code className="font-mono">buildTree</code>:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>nodes</strong> — every integer we visit (always including{" "}
              <code className="font-mono">1</code>).
            </li>
            <li>
              <strong>edges</strong> — a directed map{" "}
              <code className="font-mono">n → next(n)</code>. Each integer has
              exactly one outgoing edge, so the union of all sequences is a tree
              whose root is <code className="font-mono">1</code>. This is the
              "Holy Tree" of Collatz.
            </li>
          </ul>
          <p>
            We then BFS the reverse edges from{" "}
            <code className="font-mono">1</code> to assign each node a{" "}
            <strong>depth</strong> — its hop-distance to the root. Depth drives
            elevation in the SWMM model so the network actually flows downhill.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold text-primary">3. Mapping the tree to SWMM5 objects</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-mono uppercase text-muted-foreground">Collatz</th>
                  <th className="py-2 pr-4 font-mono uppercase text-muted-foreground">SWMM5 section</th>
                  <th className="py-2 font-mono uppercase text-muted-foreground">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="py-2 pr-4 font-mono">integer n &gt; 1</td>
                  <td className="py-2 pr-4 font-mono">[JUNCTIONS]</td>
                  <td className="py-2">A manhole / node in the drainage network.</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono">integer 1</td>
                  <td className="py-2 pr-4 font-mono">[OUTFALLS]</td>
                  <td className="py-2">The single sink — every Collatz path ends here.</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono">edge n → next(n)</td>
                  <td className="py-2 pr-4 font-mono">[CONDUITS]</td>
                  <td className="py-2">A pipe carrying flow downstream.</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono">conduit</td>
                  <td className="py-2 pr-4 font-mono">[XSECTIONS]</td>
                  <td className="py-2">Circular pipe with the configured diameter.</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono">each junction</td>
                  <td className="py-2 pr-4 font-mono">[DWF]</td>
                  <td className="py-2">Dry-weather flow injects baseflow at every node.</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono">tree layout</td>
                  <td className="py-2 pr-4 font-mono">[COORDINATES]</td>
                  <td className="py-2">XY positions for SWMM's map view.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold text-primary">4. Elevations from depth</h3>
          <p>
            For each node we set its invert (pipe-bottom elevation) from its
            tree depth:
          </p>
          <pre className="rounded bg-muted p-3 font-mono text-xs">
{`invert(n) = baseInvert + depth(n) * invertDrop
         = ${opts.baseInvert} + depth(n) * ${opts.invertDrop}`}
          </pre>
          <p>
            The root (node 1) sits at <code className="font-mono">baseInvert</code>.
            Every step away from the root adds{" "}
            <code className="font-mono">invertDrop</code> of elevation, so the
            full tree slopes monotonically down to the outfall — a requirement
            for kinematic-wave routing.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold text-primary">5. Hydraulics options</h3>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Flow units:</strong>{" "}
              <code className="font-mono">{opts.flowUnits}</code>
            </li>
            <li>
              <strong>Conduit length:</strong>{" "}
              <code className="font-mono">{opts.conduitLength}</code> per edge
            </li>
            <li>
              <strong>Manning roughness:</strong>{" "}
              <code className="font-mono">{opts.roughness}</code>
            </li>
            <li>
              <strong>Pipe diameter:</strong>{" "}
              <code className="font-mono">{opts.diameter}</code>
            </li>
            <li>
              <strong>Max node depth:</strong>{" "}
              <code className="font-mono">{opts.maxDepth}</code>
            </li>
            <li>
              <strong>DWF baseflow / node:</strong>{" "}
              <code className="font-mono">{opts.dwfBaseflow}</code>
              {opts.dwfPattern && (
                <>
                  {" "}with pattern{" "}
                  <code className="font-mono">"{opts.dwfPattern}"</code>
                </>
              )}
            </li>
          </ul>
          <p>
            Routing is fixed to <code className="font-mono">KINWAVE</code> and
            link offsets are <code className="font-mono">DEPTH</code> — both
            match the simple tree topology with no loops or backwater.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold text-primary">6. Section-by-section build order</h3>
          <ol className="list-decimal space-y-1 pl-6">
            <li><code className="font-mono">[TITLE]</code> / <code className="font-mono">[OPTIONS]</code> / <code className="font-mono">[EVAPORATION]</code> — fixed boilerplate plus the form's flow units.</li>
            <li><code className="font-mono">[JUNCTIONS]</code> — every tree node except 1, with invert from depth.</li>
            <li><code className="font-mono">[OUTFALLS]</code> — exactly one entry, node 1, type FREE.</li>
            <li><code className="font-mono">[CONDUITS]</code> — one row per edge, named <code className="font-mono">C1..Ck</code>, in tree-walk order.</li>
            <li><code className="font-mono">[XSECTIONS]</code> — same conduits, CIRCULAR with the configured diameter.</li>
            <li><code className="font-mono">[DWF]</code> — baseflow at every junction, optional pattern.</li>
            <li><code className="font-mono">[REPORT]</code> — request all nodes and links.</li>
            <li><code className="font-mono">[COORDINATES]</code> / <code className="font-mono">[VERTICES]</code> — from the layout engine so the network draws nicely.</li>
          </ol>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold text-primary">7. Current build stats</h3>
          <p className="font-mono text-xs">
            seeds 1..{opts.maxSeed} → tree with one outfall, junctions + conduits
            counted in the <strong>INP text</strong> tab. Change any field on the
            left to regenerate live; download the file with the button under the
            form, or hit <strong>Run SWMM5</strong> on the Engine tab to execute it.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-base font-semibold text-primary">8. Source files</h3>
          <ul className="list-disc space-y-1 pl-6 font-mono text-xs">
            <li>src/lib/collatz.ts — sequence + tree construction</li>
            <li>src/lib/swmm/layout.ts — XY positions for the tree</li>
            <li>src/lib/swmm/inp.ts — assembles all SWMM5 sections</li>
            <li>src/lib/swmm/engine.ts — runs the wasm / stub engine</li>
          </ul>
        </section>
      </article>
    </div>
  );
}
