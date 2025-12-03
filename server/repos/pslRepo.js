// server/repos/pslRepo.js
const { query: sql } = require("../db.js");

/* Безпечний парсер JSON: приймає і рядок, і вже-об'єкт */
function parseJsonSafe(val, fallback) {
  try {
    if (val == null) return fallback;
    if (typeof val === "object") return Array.isArray(val) ? val : fallback;
    const s = String(val || "").trim();
    if (!s) return fallback;
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/* Нормалізація рядка таблиці до нового формату */
function normRow(r) {
  const qty = r?.qty ?? r?.packages ?? r?.packs ?? r?.count ?? r?.ilosc ?? "";
  const ship =
    r?.shipOrCourier ??
    r?.ship ??
    r?.courier ??
    r?.shippingCost ??
    r?.deliveryCost ??
    r?.wysylka ??
    "";
  return {
    id: r?.id || Math.random().toString(36).slice(2, 10),
    clientId: String(r?.clientId || r?.client_id || "").trim(),
    clientName: String(
      r?.clientName || r?.client || r?.name || r?.Klient || ""
    ).trim(),
    qty: qty === "" ? "" : Number(qty) || 0,
    shipOrCourier: ship === "" ? "" : Number(ship) || 0,
    sterilCost: Number(r?.sterilCost || 0) || 0,
    total: Number(r?.total || 0) || 0,
    isNew: false,
  };
}

/* Чи має масив «осмислені» дані, а не один пустий рядок */
function hasMeaningfulRows(arr) {
  return (arr || []).some(
    (r) =>
      String(r?.clientName || "").trim() !== "" ||
      r?.qty !== "" ||
      r?.shipOrCourier !== ""
  );
}

module.exports = {
  // ===== Workspace (єдине полотно) =====
  async getWorkspace() {
    const wsRows = await sql(`SELECT rows_json FROM psl_workspace WHERE id=1`);
    let wsRaw = [];
    if (wsRows.length) {
      wsRaw = parseJsonSafe(wsRows[0].rows_json, []);
    }
    const wsNorm = Array.isArray(wsRaw) ? wsRaw.map(normRow) : [];
    return { ym: null, rows: wsNorm };
  },

  async upsertWorkspace(rows) {
    await sql(
      `INSERT INTO psl_workspace (id, rows_json, updatedAt)
       VALUES (1, ?, NOW())
       ON DUPLICATE KEY UPDATE rows_json=VALUES(rows_json), updatedAt=NOW()`,
      [JSON.stringify(Array.isArray(rows) ? rows : [])]
    );
  },

  // ===== Місячні чернетки (сумісність) =====
  async upsertDraft(ym, rows) {
    await sql(
      `INSERT INTO psl_drafts (ym, rows_json, updatedAt)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE rows_json=VALUES(rows_json), updatedAt=NOW()`,
      [ym, JSON.stringify(Array.isArray(rows) ? rows : [])]
    );
  },

  async getDraft(ym) {
    const rows = await sql(
      `SELECT rows_json FROM psl_drafts WHERE ym=? LIMIT 1`,
      [ym]
    );
    if (!rows.length) return [];
    return parseJsonSafe(rows[0].rows_json, []);
  },

  async clearDraft(ym) {
    await sql(`DELETE FROM psl_drafts WHERE ym=?`, [ym]);
  },

  // ===== Фіналізація =====
  async finalize({ id, ym, title, rows, totals, pricePerPack, createdAt }) {
    const qty = Number(totals?.qty || 0) || 0;
    const steril = Number(totals?.steril || 0) || 0;
    const ship = Number(totals?.ship || 0) || 0;
    const total = Number(totals?.total || 0) || 0;
    const ppp = Number(pricePerPack || 0) || 0;
    const created =
      (createdAt && String(createdAt).slice(0, 19).replace("T", " ")) ||
      new Date().toISOString().slice(0, 19).replace("T", " ");

    await sql(
      `INSERT INTO psl_saved
       (id, ym, title, rows_json, totals_qty, totals_steril, totals_ship, totals_total, pricePerPack, createdAt, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         ym=VALUES(ym),
         title=VALUES(title),
         rows_json=VALUES(rows_json),
         totals_qty=VALUES(totals_qty),
         totals_steril=VALUES(totals_steril),
         totals_ship=VALUES(totals_ship),
         totals_total=VALUES(totals_total),
         pricePerPack=VALUES(pricePerPack),
         createdAt=VALUES(createdAt),
         deleted=0`,
      [
        id,
        ym,
        title || ym,
        JSON.stringify(Array.isArray(rows) ? rows : []),
        qty,
        steril,
        ship,
        total,
        ppp,
        created,
      ]
    );
    return id;
  },

  async savedIndex() {
    const rows = await sql(
      `SELECT id, ym, title, totals_qty, totals_total, createdAt
       FROM psl_saved
       WHERE COALESCE(deleted,0)=0
       ORDER BY ym DESC, createdAt DESC`
    );
    return rows.map((r) => ({
      id: r.id,
      ym: r.ym,
      title: r.title,
      totals: {
        qty: Number(r.totals_qty || 0),
        total: Number(r.totals_total || 0),
      },
      createdAt: r.createdAt,
    }));
  },

  async getSaved(id) {
    const rows = await sql(
      `SELECT * FROM psl_saved WHERE id=? AND COALESCE(deleted,0)=0 LIMIT 1`,
      [id]
    );
    if (!rows.length) return null;
    const r = rows[0];
    const arr = parseJsonSafe(r.rows_json, []);
    return {
      id: r.id,
      ym: r.ym,
      title: r.title,
      rows: arr,
      totals: {
        qty: Number(r.totals_qty || 0),
        steril: Number(r.totals_steril || 0),
        ship: Number(r.totals_ship || 0),
        total: Number(r.totals_total || 0),
      },
      pricePerPack: Number(r.pricePerPack || 0),
      createdAt: r.createdAt,
    };
  },

  async deleteSaved(id) {
    await sql(`UPDATE psl_saved SET deleted=1 WHERE id=?`, [id]);
  },

  async summary(fromISO, toISO) {
    const rows = await sql(
      `SELECT totals_qty, totals_steril, totals_ship, totals_total
       FROM psl_saved
       WHERE COALESCE(deleted,0)=0
         AND CONCAT(ym, '-01') BETWEEN DATE_FORMAT(?, '%Y-%m-01') AND DATE_FORMAT(?, '%Y-%m-01')`,
      [fromISO, toISO]
    );
    return rows.reduce(
      (acc, r) => {
        acc.totalQty += Number(r.totals_qty || 0);
        acc.totalSteril += Number(r.totals_steril || 0);
        acc.totalShip += Number(r.totals_ship || 0);
        acc.totalGross += Number(r.totals_total || 0);
        return acc;
      },
      { totalQty: 0, totalSteril: 0, totalShip: 0, totalGross: 0 }
    );
  },
};
