import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src/dashboard",
  base: "/",
  build: {
    outDir: "../../dashboard-build",
    emptyOutDir: true,
  },
});
