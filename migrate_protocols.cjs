// migrate_protocols.cjs
// Одноразовий імпорт protocols.json -> MySQL

require("dotenv").config();
const fs = require("fs");
const path = require("path");

// ми вже маємо pool/query в server/db.js, то просто його юзаємо тут
const { query, pool } = require("./server/db.js");

async function run() {
  const PROTOCOLS_FILE = path.join(__dirname, "data", "protocols.json");

  // 1. зчитуємо файл
  let raw;
  try {
    raw = fs.readFileSync(PROTOCOLS_FILE, "utf8");
  } catch (e) {
    console.error("❌ Не можу прочитати data/protocols.json:", e.message);
    process.exit(1);
  }

  let arr;
  try {
    arr = JSON.parse(raw);
  } catch (e) {
    console.error("❌ JSON у protocols.json зламаний:", e.message);
    process.exit(1);
  }

  if (!Array.isArray(arr)) {
    console.error("❌ Очікував масив у protocols.json");
    process.exit(1);
  }

  console.log(`📦 Знайшов протоколів (clientId+month): ${arr.length}`);

  for (const proto of arr) {
    const clientId = String(proto.id || "").trim();
    const month = String(proto.month || "").trim();
    const summarized = proto.summarized ? 1 : 0;
    const entries = Array.isArray(proto.entries) ? proto.entries : [];

    if (!clientId || !month) {
      console.warn("⚠️ Пропускаю протокол без clientId/month:", proto);
      continue;
    }

    // 2. вставляємо або знаходимо запис у таблиці protocols
    //    у нас є UNIQUE(clientId, month), тому робимо upsert
    //    MySQL 8 => INSERT ... ON DUPLICATE KEY UPDATE
    let protocolId;
    {
      // вставка
      const insertSql = `
        INSERT INTO protocols (clientId, month, summarized)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE summarized = VALUES(summarized)
      `;
      await query(insertSql, [clientId, month, summarized]);

      // тепер витягуємо id (можливо вже існувало)
      const rows = await query(
        `SELECT id FROM protocols WHERE clientId=? AND month=?`,
        [clientId, month]
      );
      if (!rows.length) {
        console.error("❌ не можу отримати protocol_id після INSERT", {
          clientId,
          month,
        });
        continue;
      }
      protocolId = rows[0].id;
    }

    console.log(
      `→ [${clientId} ${month}] protocol_id=${protocolId}, entries=${entries.length}`
    );

    // 3. чистимо старі рядки цього протоколу в protocol_entries
    await query(`DELETE FROM protocol_entries WHERE protocol_id=?`, [
      protocolId,
    ]);

    // 4. вставляємо кожен entry з масиву entries
    let idx = 0;
    for (const e of entries) {
      // базові поля
      const date = e.date || "";
      const packages = Number(e.packages || 0) || 0;
      const delivery =
        e.delivery == null || e.delivery === "" ? null : String(e.delivery);
      const shipping = e.shipping ? 1 : 0;
      const comment = e.comment || "";

      const returnDate = e.returnDate || "";
      const returnPackages = Number(e.returnPackages || 0) || 0;
      const returnDelivery =
        e.returnDelivery == null || e.returnDelivery === ""
          ? null
          : String(e.returnDelivery);
      const returnShipping = e.returnShipping ? 1 : 0;

      // складні поля збережемо у JSON-колонки
      const tools_json = JSON.stringify(e.tools || []);
      const returnTools_json = JSON.stringify(e.returnTools || []);
      const signatures_json = JSON.stringify(e.signatures || {});
      const queue_json = JSON.stringify(e.queue || {});

      await query(
        `
        INSERT INTO protocol_entries (
          protocol_id,
          entry_index,
          date,
          packages,
          delivery,
          shipping,
          comment,
          returnDate,
          returnPackages,
          returnDelivery,
          returnShipping,
          tools_json,
          returnTools_json,
          signatures_json,
          queue_json
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `,
        [
          protocolId,
          idx,
          date,
          packages,
          delivery,
          shipping,
          comment,
          returnDate,
          returnPackages,
          returnDelivery,
          returnShipping,
          tools_json,
          returnTools_json,
          signatures_json,
          queue_json,
        ]
      );

      idx++;
    }
  }

  console.log("✅ Готово. Протоколи та записи залиті в MySQL.");
  // закінчуємо пул
  await pool.end();
}

run().catch((err) => {
  console.error("💥 Помилка під час міграції:", err);
  process.exit(1);
});
