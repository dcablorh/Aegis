import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  resolve: {
    alias: {
      "@aegis/shared-types": path.resolve(__dirname, "../../packages/shared-types/src/index.ts"),
      "@aegis/rhea-client": path.resolve(__dirname, "../../packages/rhea-client/src/index.ts"),
      "@aegis/intents-client": path.resolve(__dirname, "../../packages/intents-client/src/index.ts"),
    },
  },
});
