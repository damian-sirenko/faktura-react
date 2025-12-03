// scripts/migratePslToDb.cjs
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { query: sql } = require("../server/db.js");

function to2(n) {
  const v = Number(String(n ?? 0).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

async function ensureSchema() {
  await sql(`
    CREATE TABLE IF NOT EXISTS psl_drafts (
      ym CHAR(7) NOT NULL PRIMARY KEY,
      rows_json JSON NOT NULL,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await sql(`
    CREATE TABLE IF NOT EXISTS psl_saved (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      ym CHAR(7) NOT NULL,
      title VARCHAR(255) NOT NULL,
      rows_json JSON NOT NULL,
      totals_qty INT NOT NULL DEFAULT 0,
      totals_steril DECIMAL(10,2) NOT NULL DEFAULT 0,
      totals_ship DECIMAL(10,2) NOT NULL DEFAULT 0,
      totals_total DECIMAL(10,2) NOT NULL DEFAULT 0,
      pricePerPack DECIMAL(10,2) NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

(async () => {
  try {
    await ensureSchema();

    const DB = path.join(__dirname, "..", "data", "psl.db.json");
    if (!fs.existsSync(DB)) {
      console.log("Не знайдено data/psl.db.json — нічого переносити.");
      process.exit(0);
    }
    const raw = fs.readFileSync(DB, "utf8");
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      console.error("Невірний JSON у psl.db.json");
      process.exit(1);
    }

    const drafts = obj?.drafts || {};
    const saved = obj?.saved || {};
    const index = obj?.index || [];

    // drafts
    for (const [ym, draft] of Object.entries(drafts)) {
      const rows = Array.isArray(draft?.rows) ? draft.rows : [];
      await sql(
        `INSERT INTO psl_drafts (ym, rows_json, updatedAt)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE rows_json=VALUES(rows_json), updatedAt=NOW()`,
        [ym, JSON.stringify(rows)]
      );
    }

    // saved
    for (const [id, snap] of Object.entries(saved)) {
      const ym = String(snap?.ym || "").slice(0, 7);
      const title = snap?.title || ym || id;
      const rows = Array.isArray(snap?.rows) ? snap.rows : [];
      const totals = snap?.totals || {};
      const qty = Number(totals?.qty || 0) || 0;
      const steril = to2(totals?.steril || totals?.sterile || 0);
      const ship = to2(totals?.ship || totals?.shipping || 0);
      const total = to2(totals?.total || 0);
      const ppp = to2(snap?.pricePerPack || 0);
      const createdAt =
        (snap?.createdAt &&
          String(snap.createdAt).slice(0, 19).replace("T", " ")) ||
        new Date().toISOString().slice(0, 19).replace("T", " ");

      await sql(
        `INSERT INTO psl_saved
         (id, ym, title, rows_json, totals_qty, totals_steril, totals_ship, totals_total, pricePerPack, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            ym=VALUES(ym),
            title=VALUES(title),
            rows_json=VALUES(rows_json),
            totals_qty=VALUES(totals_qty),
            totals_steril=VALUES(totals_steril),
            totals_ship=VALUES(totals_ship),
            totals_total=VALUES(totals_total),
            pricePerPack=VALUES(pricePerPack),
            createdAt=VALUES(createdAt)`,
        [
          id,
          ym,
          title,
          JSON.stringify(rows),
          qty,
          steril,
          ship,
          total,
          ppp,
          createdAt,
        ]
      );
    }

    // index — нічого окремо не створюємо: воно обчислюється з psl_saved

    console.log("✅ PSL міграцію завершено.");
    process.exit(0);
  } catch (e) {
    console.error("❌ Помилка міграції PSL:", e?.message || e);
    process.exit(1);
  }
})();
