import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Dev server proxies the API to the Bun server; `PORT` matches src/web/server.ts. */
const apiPort = process.env.PORT ?? "3000";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}` },
    },
  },
});
