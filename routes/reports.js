const express = require("express");
const router = express.Router();
const { query } = require("../server/db");

/*
  Нормалізація назв послуг у потрібні категорії
*/
function normalizeService(name) {
  const n = String(name || "").toLowerCase();

  if (n.includes("abonament") || n.includes("wg abonamentu"))
    return "Abonament";

  if (n.includes("pakiet") && n.includes("poza"))
    return "Pakiety poza abonamentem";

  if (n.includes("wysy")) return "Wysyłka";

  if (n.includes("kurier") || n.includes("dojazd")) return "Kurier";

  return "Inne";
}

/*
  POST /reports/invoices-breakdown
  body: { files: [ "Faktura_ST-001_07_2025.pdf", ... ] }
*/
router.post("/invoices-breakdown", async (req, res) => {
  try {
    const { files } = req.body || {};

    if (!Array.isArray(files) || files.length === 0) {
      return res.json({ services: [], grandTotal: 0 });
    }

    const placeholders = files.map(() => "?").join(",");

    const rows = await query(
      `
      SELECT
        j.name AS service,
        SUM(
          IFNULL(
            j.gross_total,
            IF(
              j.price_gross IS NOT NULL
              AND j.quantity IS NOT NULL,
              j.price_gross * j.quantity,
              0
            )
          )
        ) AS total
      FROM invoices i
      JOIN JSON_TABLE(
        i.items_json,
        '$[*]' COLUMNS (
          name VARCHAR(255) PATH '$.name',
          gross_total DECIMAL(12,2) PATH '$.gross_total',
          price_gross DECIMAL(12,2) PATH '$.price_gross',
          quantity DECIMAL(12,2) PATH '$.quantity'
        )
      ) j
      WHERE i.filename IN (${placeholders})
      GROUP BY j.name
      `,
      files
    );

    const map = new Map();
    let grandTotal = 0;

    for (const r of rows) {
      const key = normalizeService(r.service);
      const val = Number(r.total || 0);
      grandTotal += val;
      map.set(key, (map.get(key) || 0) + val);
    }

    const services = Array.from(map.entries()).map(([name, total]) => ({
      name,
      total,
    }));

    res.json({
      services,
      grandTotal,
    });
  } catch (e) {
    console.error("❌ invoices-breakdown error:", e);
    res.status(500).json({ error: "Błąd raportu" });
  }
});

module.exports = router;
