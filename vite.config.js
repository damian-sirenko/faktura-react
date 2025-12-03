import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Підтягуємо .env, .env.production, .env.test і т.д.
  const env = loadEnv(mode, process.cwd(), "");

  // Якщо є VITE_API_URL — беремо його, якщо ні — локальний бекенд
  const devTarget = env.VITE_API_URL || "http://localhost:3000";

  // Єдині настройки проксі
  const tgt = {
    target: devTarget,
    changeOrigin: true,
    secure: false,
  };

  return {
    plugins: [react()],

    server: {
      host: true,
      port: 5173,
      cors: true,
      historyApiFallback: true,

      proxy: {
        // базові JSON-API
        "/clients": tgt,
        "/clients/save": tgt,
        "/save-clients": tgt,
        "/settings": tgt,
        "/invoices": tgt,
        "/save-invoices": tgt,
        "/saved-invoices": tgt,

        // сервіси
        "/services": tgt,
        "/services.json": tgt,
        "/save-services": tgt,

        // протоколи + підписи/черга
        "/protocols": tgt,
        "/sign-queue": tgt,

        // PSL
        "/psl": tgt,

        // файли та завантаження
        "/generated": tgt,
        "/download-invoice": tgt,
        "/download-multiple": tgt,
        "/signatures": tgt,

        // інші роутери
        "/analytics": tgt,
        "/upload": tgt,
        "/gen": tgt,
        "/export-epp": tgt,
        "/export-invoice-list-pdf": tgt,
        "/api": tgt,
        "/auth": tgt,
        "/tools": tgt,
        "/tools/save": tgt,
      },
    },

    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(env.VITE_API_URL || ""),
    },
  };
});
