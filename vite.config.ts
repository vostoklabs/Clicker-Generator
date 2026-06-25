import { defineConfig } from 'vite';

// Relative base so the static build works on ANY GitHub Pages URL
// (user/org page at '/', or a project page at '/<repo>/') with no reconfig.
export default defineConfig({
  base: './',
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
  // manifold-3d ships its own WASM; keep esbuild from trying to pre-bundle it.
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
});
