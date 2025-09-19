import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const API = env.VITE_API_URL || "http://localhost:3000";

  // однакові параметри для всіх цілей проксі
  const tgt = {
    target: API,
    changeOrigin: true, // важливо для дев-проксі: підміняє Origin на бекенд
    secure: false, // дозволяє самопідписані сертифікати (на випадок HTTPS)
  };

  return {
    plugins: [react()],
    server: {
      host: true, // дозволяє відкривати з LAN (192.168.x.x), не тільки localhost
      port: 5173,
      proxy: {
        // базові JSON-API
        "/clients": tgt,
        "/clients/save": tgt, // ⬅️ залишаю як у вас
        "/save-clients": tgt,
        "/settings": tgt,
        "/invoices": tgt,
        "/save-invoices": tgt,
        "/saved-invoices": tgt,

        // сервіси (для підказок інструментів)
        "/services": tgt,
        "/services.json": tgt,
        "/save-services": tgt,

        // протоколи + PDF
        "/protocols": tgt, // охоплює /:clientId/:month і /:clientId/:month/pdf
        "/sign-queue": tgt,

        // файли та завантаження
        "/generated": tgt,
        "/download-invoice": tgt,
        "/signatures": tgt,
        "/download-multiple": tgt, // ⬅️ додав, щоб архів теж ішов через проксі

        // інші роутери
        "/analytics": tgt,
        "/upload": tgt,
        "/gen": tgt,
        "/export-epp": tgt,
      },
      cors: true, // CORS для дев-асетів Vite (не впливає на бек, але не завадить)
    },

    // гарантуємо наявність змінної в рантаймі фронта
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(API),
    },
  };
});
