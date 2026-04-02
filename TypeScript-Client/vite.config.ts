import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    // Pre-transform large static JSON files
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  },
});
