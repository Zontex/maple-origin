import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  build: {
    // The game ships as one ~3MB bundle (~390KB gzipped over the wire) by
    // design — it loads once and runs for hours, so code-splitting buys
    // nothing. Silence the content-website-oriented chunk-size warning.
    chunkSizeWarningLimit: 4000,
  },
  server: {
    host: true, // Listen on all interfaces (LAN access)
    // NOTE: deliberately no `headers` here. Vite applies server.headers from
    // inside its static-file middleware, which runs AFTER plugin middleware —
    // so a global Cache-Control here silently overwrote the immutable header
    // the wz-cache-headers plugin sets, and every WZ file revalidated on
    // every load. Both defaults are now set in that plugin instead.
    watch: {
      // Never watch the 22k+ converted WZ JSON files — without fsevents the
      // watcher stat-polls every file continuously (multi-core CPU burn,
      // 30s static asset responses). The WZ data never changes at runtime.
      // wz_client_backup is a full copy of it, kept outside publicDir so it
      // never lands in a build — but the watcher covers the project root, so
      // it still needs ignoring here.
      ignored: ['**/public/wz_client/**', '**/wz_client_backup/**'],
    },
  },
  plugins: [
    {
      name: 'wz-cache-headers',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // WZ data is content-addressed by path and never changes at runtime,
          // so it can be cached hard — this is what makes the 3.9GB tree a
          // one-time download instead of 22k revalidations per session.
          // Everything else revalidates so source edits show up immediately.
          res.setHeader(
            'Cache-Control',
            req.url?.includes('/wz_client/')
              ? 'public, max-age=31536000, immutable'
              : 'no-cache'
          );
          next();
        });
      },
    },
  ],
});
