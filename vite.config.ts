import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` matters for GitHub Pages, where the app is served from /<repo>/.
// Override with BASE_PATH=/ for any other host.
const base = process.env.BASE_PATH ?? '/vi-damage-calculator/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
