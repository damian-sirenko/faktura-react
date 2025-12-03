// importClientsOnce.js
// Одноразовий міграційний скрипт: зчитує data/clients.json і закидає в MySQL.clients

require("dotenv").config(); // щоб підхопити DB_HOST/DB_USER/... з .env

const fs = require("fs");
const path = require("path");
const { query, pool } = require("./server/db.js"); // вже існує

(async () => {
  try {
    // 1. читаємо файл data/clients.json
    const dataPath = path.join(__dirname, "data", "clients.json");
    if (!fs.existsSync(dataPath)) {
      console.error("❌ clients.json не знайдено:", dataPath);
      process.exit(1);
    }

    const raw = fs.readFileSync(dataPath, "utf8");
    let clients;
    try {
      clients = JSON.parse(raw);
    } catch (e) {
      console.error("❌ clients.json пошкоджений / не валідний JSON");
      console.error(e);
      process.exit(1);
    }

    if (!Array.isArray(clients)) {
      console.error("❌ Очікував масив у clients.json");
      process.exit(1);
    }

    console.log(`📦 Знайдено клієнтів: ${clients.length}`);

    // 2. Чистимо таблицю clients, щоб не було дублів
    console.log("🧹 Очищаю таблицю clients...");
    await query("DELETE FROM clients");

    // 3. Вставляємо усіх
    console.log("⬆️ Заливаю в MySQL...");
    for (const c of clients) {
      // нормалізація значень на випадок якщо в json ключі трохи інші
      const row = {
        id:
          c.id ||
          c.ID ||
          c.slug ||
          c.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ||
          "",
        name: c.name || c.client || c.Client || c.buyer_name || "",
        address: c.address || c.buyer_address || "",
        type:
          c.type === "firma" || c.type === "op"
            ? c.type
            : c.nip
            ? "firma"
            : "op",
        nip: c.nip || c.buyer_nip || "",
        pesel: c.pesel || c.buyer_pesel || "",
        email: c.email || "",
        phone: c.phone || "",
        agreementStart: c.agreementStart || "",
        agreementEnd: c.agreementEnd || "",
        subscription: c.subscription || "",
        subscriptionAmount:
          c.subscriptionAmount != null
            ? c.subscriptionAmount
            : c.abonamentKwota != null
            ? c.abonamentKwota
            : 0,
        notice: c.notice ? 1 : 0,
        comment: c.comment || "",
        billingMode: c.billingMode || "",
        logistics: c.logistics || c.logistyka || "",
        courierPriceMode: c.courierPriceMode || "",
        courierPriceGross:
          c.courierPriceGross != null ? c.courierPriceGross : null,
        shippingPriceMode: c.shippingPriceMode || "",
        shippingPriceGross:
          c.shippingPriceGross != null ? c.shippingPriceGross : null,
        archived: c.archived ? 1 : 0,
        archivedAt: c.archivedAt || "",
      };

      // Вставка одного клієнта
      await query(
        `
        INSERT INTO clients (
          id,
          name,
          address,
          type,
          nip,
          pesel,
          email,
          phone,
          agreementStart,
          agreementEnd,
          subscription,
          subscriptionAmount,
          notice,
          comment,
          billingMode,
          logistics,
          courierPriceMode,
          courierPriceGross,
          shippingPriceMode,
          shippingPriceGross,
          archived,
          archivedAt
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `,
        [
          row.id,
          row.name,
          row.address,
          row.type,
          row.nip,
          row.pesel,
          row.email,
          row.phone,
          row.agreementStart,
          row.agreementEnd,
          row.subscription,
          row.subscriptionAmount,
          row.notice,
          row.comment,
          row.billingMode,
          row.logistics,
          row.courierPriceMode,
          row.courierPriceGross,
          row.shippingPriceMode,
          row.shippingPriceGross,
          row.archived,
          row.archivedAt,
        ]
      );
    }

    console.log("✅ Готово. Клієнти залиті в MySQL.");
  } catch (err) {
    console.error("💥 Помилка при імпорті клієнтів:", err);
  } finally {
    // акуратно закриваємо пул MySQL, щоб процес вийшов
    await pool.end();
    process.exit(0);
  }
})();
