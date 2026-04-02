import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    host: true, // Listen on all interfaces (LAN access)
    // Pre-transform large static JSON files
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  },
});
