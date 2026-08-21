import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// `base` matters for GitHub Pages, where the app is served from /<repo>/.
// Override with BASE_PATH=/ for any other host.
const base = process.env.BASE_PATH ?? '/vi-damage-calculator/';

/**
 * The two static pages next to the app answer to their bare names.
 *
 * They are written as `workshop.html` and `roadmap.html` so the build emits them
 * without any output rewriting, and this rewrites `/workshop` to the file in dev
 * so the address bar reads the way the pages are talked about. `/design` still
 * lands on the workshop: that was its name for a while and links to it exist.
 */
function prettyPages(): Plugin {
  const pages: Record<string, string> = {
    workshop: 'workshop',
    roadmap: 'roadmap',
    design: 'workshop',
  };
  return {
    name: 'pretty-static-pages',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = req.url?.split('?')[0]?.replace(/\/$/, '');
        const name = path?.replace(/^\//, '') ?? '';
        const file = pages[name];
        if (file) req.url = `/${file}.html`;
        next();
      });
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), prettyPages()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Without this the extra pages never reach dist: Vite's default input is
    // index.html alone, so the design lab was only ever visible in dev.
    // Paths are resolved against the project root, which keeps this working
    // without __dirname — Vite's native config loader warns about that.
    rollupOptions: {
      input: {
        main: 'index.html',
        workshop: 'workshop.html',
        roadmap: 'roadmap.html',
      },
    },
  },
});
