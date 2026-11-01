import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createStreamProxy } from "./stream-proxy.ts";

const apiTarget = "http://localhost:3001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api/events": createStreamProxy(apiTarget),
      "/api/chat": createStreamProxy(apiTarget),
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
