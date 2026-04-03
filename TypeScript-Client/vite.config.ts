import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    host: true, // Listen on all interfaces (LAN access)
    headers: {
      // Default: no aggressive caching — browser will revalidate
      'Cache-Control': 'no-cache',
    },
  },
  plugins: [
    {
      name: 'wz-cache-headers',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Aggressive caching only for WZ data (never changes)
          if (req.url?.includes('/wz_client/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
          next();
        });
      },
    },
  ],
});
