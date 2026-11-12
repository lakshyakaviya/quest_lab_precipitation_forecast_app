import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Deployed as a GitHub Pages *project* site, so built assets live under the repo path.
// Dev stays at the root so `npm run dev` opens at localhost:5173/.
const REPO_BASE = "/quest_lab_precipitation_forecast_app/";

export default defineConfig(({ command }) => ({
  base: command === "build" ? REPO_BASE : "/",
  plugins: [react()],
  server: { port: 5173 },
  build: {
    outDir: "dist",
    // The forecast cube is already float16-compact; don't inline it as base64.
    assetsInlineLimit: 4096,
  },
}));
