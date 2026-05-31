## Add Holy Tree visualization

Render the Collatz network as a 2D graph next to the .inp preview, styled after the reference image (deep black background, magenta/pink branches, soft blue node halos, mirrored radial bloom).

### Layout change
- New tabbed right pane: **Visual** (default) | **INP text**
- Both share the same `built` state from `buildInp(opts)`

### Visualization
- New component `src/components/HolyTreeCanvas.tsx` — SVG (scales cleanly, no canvas DPR math)
- Reuse `layoutRadial` coordinates already produced; auto-fit viewBox to node bounds with padding
- Edges: thin magenta strokes (`oklch` pink/red), opacity scaled by depth so trunk reads bold and tips fade
- Nodes: small circles, blue→violet by depth, subtle glow via SVG `<filter>` gaussian blur
- Outfall node (1) highlighted larger in amber (matches existing primary token)
- Background: near-black panel, same border/rounding as InpPreview
- Hover a node → tooltip with integer value + depth
- Performance: for N up to 2000 this is a few thousand SVG elements — acceptable; if >1500 nodes, drop node circles and render edges only

### New layout mode toggle (small addition to form)
- "Layout: Radial | Symmetric bloom" — symmetric mirrors the tree left/right around node 1 to evoke the reference image's bilateral symmetry. Implemented in `layout.ts` as `layoutSymmetric()` (splits depth-1 children into two halves, places each subtree in its own half-plane).

### Files
- new `src/components/HolyTreeCanvas.tsx`
- edit `src/lib/swmm/layout.ts` — add `layoutSymmetric`
- edit `src/lib/swmm/inp.ts` — accept `layoutMode: "radial" | "symmetric"` in `InpOptions`, use it for `[COORDINATES]` and expose chosen `coords` from `buildInp`
- edit `src/components/GeneratorForm.tsx` — layout toggle
- edit `src/routes/index.tsx` — tabs (shadcn `Tabs`) with Visual + INP panes

### Out of scope
- 3D / WebGL rendering
- Pan/zoom controls (auto-fit only)
- Animated flow simulation
