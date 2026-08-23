import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { formatHongKongBuildVersion } from "./shared/buildVersion";

const APP_BUILD_VERSION = formatHongKongBuildVersion(new Date());

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/oxbridge-vocab/",
  define: {
    __APP_BUILD_VERSION__: JSON.stringify(APP_BUILD_VERSION),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  preview: {
    allowedHosts: true,
  },
});
