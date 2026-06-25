# Clicker Generator

Browser-based generator that turns an image into a print-ready **3MF** of a multicolor "clicker" — a 3D-printed pressable button built around a real **Cherry MX** mechanical switch. 100% client-side, deployed on GitHub Pages (no backend, no hosting cost).

**Live site:** https://vostoklabs.github.io/Clicker-Generator/

## How it works

1. Upload an image — it's quantized into a small color palette and traced into 2D regions.
2. A geometry worker (the [manifold-3d](https://github.com/elalish/manifold) WASM kernel, off the main thread) builds a watertight, multicolor cap + body around a real MX switch socket/stem.
3. three.js renders a live preview; export produces a print-ready multicolor **3MF**.

All geometry is in millimeters, and every exported solid is watertight / manifold.

## Develop

```bash
npm install
npm run dev       # local dev server (http://localhost:5173)
npm run build     # typecheck + production build -> dist/
npm run preview   # serve the production build locally
npm run typecheck # types only
```

Requires Node 20+. Stack: **Vite + TypeScript + three.js**, with **manifold-3d** (WASM) as the geometry kernel running in a Web Worker. three.js is display-only.

## Deploy

Pushing to `main` triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which builds the static site and publishes `dist/` to GitHub Pages.

One-time setup: in the repo, go to **Settings → Pages → Source** and select **GitHub Actions**. `vite.config.ts` uses `base: './'` (relative paths) so the build works at any Pages URL without reconfiguration.
