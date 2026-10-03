import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["zod", "three", "react", "react-dom"] },
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" } },
});
