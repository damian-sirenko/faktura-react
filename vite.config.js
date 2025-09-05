// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // аналітика
      "/analytics": { target: "http://localhost:3000", changeOrigin: true },

      // клієнти
      "/clients": { target: "http://localhost:3000", changeOrigin: true },
      "/save-clients": { target: "http://localhost:3000", changeOrigin: true },
      "/clients/save": { target: "http://localhost:3000", changeOrigin: true },

      // інвойси
      "/invoices": { target: "http://localhost:3000", changeOrigin: true },
      "/save-invoices": { target: "http://localhost:3000", changeOrigin: true },
      "/download-invoice": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/download-multiple": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/export-epp": { target: "http://localhost:3000", changeOrigin: true },

      // генерація/завантаження
      "/gen": { target: "http://localhost:3000", changeOrigin: true },
      "/upload": { target: "http://localhost:3000", changeOrigin: true },

      // довідники/налаштування
      "/services": { target: "http://localhost:3000", changeOrigin: true },
      "/save-services": { target: "http://localhost:3000", changeOrigin: true },
      "/settings": { target: "http://localhost:3000", changeOrigin: true },

      // протоколи (API + PDF + ZIP)
      "/protocols": { target: "http://localhost:3000", changeOrigin: true },

      // черга підписів + статика підписів
      "/sign-queue": { target: "http://localhost:3000", changeOrigin: true },
      "/signatures": { target: "http://localhost:3000", changeOrigin: true },

      // статика PDF
      "/generated": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
