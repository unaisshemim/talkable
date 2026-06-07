import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: false,
    outDir: "dist",
    rollupOptions: {
      input: {
        content: "src/content/content.tsx"
      },
      output: {
        assetFileNames(assetInfo) {
          if (assetInfo.name === "content.css") {
            return "src/content/content.css";
          }

          return "assets/[name][extname]";
        },
        chunkFileNames: "src/content/[name].js",
        entryFileNames: "src/content/content.js"
      }
    }
  }
});
