// server/repos/protocolsRepo.js
const { query } = require("../db.js");

/*
  ensureSchema:
  1) створює базові таблиці, якщо їх немає;
  2) докидає відсутні колонки без "IF NOT EXISTS" (через INFORMATION_SCHEMA);
  3) ставить індекси/зовнішній ключ, якщо їх немає;
  4) мігрує стару колонку protocolId -> protocol_id (якщо траплялась історично).
*/
async function ensureSchema() {
  // 1) Базові таблиці (якщо їх ще не було)
  await query(`
    CREATE TABLE IF NOT EXISTS protocols (
      id INT AUTO_INCREMENT PRIMARY KEY,
      clientId VARCHAR(191) NOT NULL,
      month CHAR(7) NOT NULL,
      summarized TINYINT(1) NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_client_month (clientId, month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Робимо максимально повний набір полів, але це спрацює лише коли таблиці нема.
  await query(`
    CREATE TABLE IF NOT EXISTS protocol_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      protocol_id INT NULL,
      date VARCHAR(10) NULL,
      packages INT NOT NULL DEFAULT 0,
      delivery VARCHAR(191) DEFAULT NULL,
      shipping TINYINT(1) NOT NULL DEFAULT 0,
      comment TEXT,
      tools_json JSON,
      signatures_json JSON,
      courierPending TINYINT(1) NOT NULL DEFAULT 0,
      pointPending TINYINT(1) NOT NULL DEFAULT 0,
      courierPlannedDate DATE DEFAULT NULL,
      returnDate DATE DEFAULT NULL,
      returnPackages INT DEFAULT NULL,
      returnDelivery VARCHAR(191) DEFAULT NULL,
      returnShipping TINYINT(1) NOT NULL DEFAULT 0,
      returnTools_json JSON,
      transferClientSig VARCHAR(255) DEFAULT NULL,
      transferStaffSig VARCHAR(255) DEFAULT NULL,
      returnClientSig VARCHAR(255) DEFAULT NULL,
      returnStaffSig VARCHAR(255) DEFAULT NULL,
      queue_json JSON,
      entry_index INT DEFAULT NULL,
      idx INT DEFAULT NULL,
      INDEX idx_protocol_date (protocol_id, date),
      CONSTRAINT fk_protocol_entries_protocols
        FOREIGN KEY (protocol_id) REFERENCES protocols(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 2) Додати відсутні колонки через INFORMATION_SCHEMA
  const cols = await query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'protocol_entries'
  `);
  const have = new Set(cols.map((r) => r.COLUMN_NAME));

  // перелік потрібних колонок і їх DDL
  const needed = {
    protocol_id: "ADD COLUMN protocol_id INT NULL",
    date: "ADD COLUMN date VARCHAR(10) NULL",
    packages: "ADD COLUMN packages INT NOT NULL DEFAULT 0",
    delivery: "ADD COLUMN delivery VARCHAR(191) NULL",
    shipping: "ADD COLUMN shipping TINYINT(1) NOT NULL DEFAULT 0",
    comment: "ADD COLUMN comment TEXT",
    tools_json: "ADD COLUMN tools_json JSON",
    signatures_json: "ADD COLUMN signatures_json JSON",
    courierPending: "ADD COLUMN courierPending TINYINT(1) NOT NULL DEFAULT 0",
    pointPending: "ADD COLUMN pointPending TINYINT(1) NOT NULL DEFAULT 0",
    courierPlannedDate: "ADD COLUMN courierPlannedDate DATE NULL",
    returnDate: "ADD COLUMN returnDate DATE NULL",
    returnPackages: "ADD COLUMN returnPackages INT NULL",
    returnDelivery: "ADD COLUMN returnDelivery VARCHAR(191) NULL",
    returnShipping: "ADD COLUMN returnShipping TINYINT(1) NOT NULL DEFAULT 0",
    returnTools_json: "ADD COLUMN returnTools_json JSON NULL",
    transferClientSig: "ADD COLUMN transferClientSig VARCHAR(255) NULL",
    transferStaffSig: "ADD COLUMN transferStaffSig VARCHAR(255) NULL",
    returnClientSig: "ADD COLUMN returnClientSig VARCHAR(255) NULL",
    returnStaffSig: "ADD COLUMN returnStaffSig VARCHAR(255) NULL",
    queue_json: "ADD COLUMN queue_json JSON NULL",
    entry_index: "ADD COLUMN entry_index INT NULL",
    idx: "ADD COLUMN idx INT NULL",
  };

  const addStmts = [];
  for (const [col, ddl] of Object.entries(needed)) {
    if (!have.has(col)) addStmts.push(ddl);
  }
  if (addStmts.length) {
    await query(`ALTER TABLE protocol_entries ${addStmts.join(", ")}`);
  }

  // 3) Міграція зі старої назви колонки protocolId -> protocol_id (якщо така існувала)
  const hasProtocolIdOld = have.has("protocolId");
  if (hasProtocolIdOld) {
    await query(`
      UPDATE protocol_entries
      SET protocol_id = COALESCE(protocol_id, protocolId)
      WHERE (protocol_id IS NULL OR protocol_id = 0) AND protocolId IS NOT NULL
    `);
  }

  // 4) Індекс (якщо його нема)
  const indexes = await query(`
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'protocol_entries'
      AND INDEX_NAME = 'idx_protocol_date'
    LIMIT 1
  `);
  if (indexes.length === 0) {
    await query(
      `CREATE INDEX idx_protocol_date ON protocol_entries (protocol_id, date)`
    );
  }

  // 5) Зовнішній ключ (якщо його нема). Обгортаємо у try — може впасти, якщо є «сміття» у даних.
  const fks = await query(`
    SELECT CONSTRAINT_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'protocol_entries'
      AND COLUMN_NAME = 'protocol_id'
      AND REFERENCED_TABLE_NAME = 'protocols'
      AND REFERENCED_COLUMN_NAME = 'id'
    LIMIT 1
  `);
  if (fks.length === 0) {
    try {
      await query(`
        ALTER TABLE protocol_entries
        ADD CONSTRAINT fk_protocol_entries_protocols
        FOREIGN KEY (protocol_id) REFERENCES protocols(id) ON DELETE CASCADE
      `);
    } catch (e) {
      console.warn("FK add skipped:", e.sqlMessage || e.message);
    }
  }
}

ensureSchema().catch((e) => console.error("protocols schema error:", e));

/* Створити/оновити заголовок (clientId+month унікальні) */
async function upsertProtocolHeader({ clientId, month, summarized }) {
  await query(
    `
    INSERT INTO protocols (clientId, month, summarized, createdAt, updatedAt)
    VALUES (?, ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      summarized = VALUES(summarized),
      updatedAt = NOW()
    `,
    [clientId, month, summarized ? 1 : 0]
  );

  const rows = await query(
    `SELECT id FROM protocols WHERE clientId = ? AND month = ? LIMIT 1`,
    [clientId, month]
  );
  return rows.length ? rows[0].id : null;
}

/* Повністю замінити записи протоколу */
async function replaceProtocolEntries(protocolId, entriesArray) {
  await query(`DELETE FROM protocol_entries WHERE protocol_id = ?`, [
    protocolId,
  ]);

  for (const e of entriesArray || []) {
    await query(
      `
      INSERT INTO protocol_entries
        (protocol_id, date, packages, delivery, shipping, comment,
         tools_json, signatures_json, courierPending, pointPending,
         courierPlannedDate, returnDate, returnPackages, returnDelivery,
         returnShipping, returnTools_json, queue_json, entry_index, idx)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        protocolId,
        e.date || null,
        Number(e.packages || 0),
        e.delivery || null,
        e.shipping ? 1 : 0,
        e.comment || "",
        JSON.stringify(e.tools || []),
        JSON.stringify(e.signatures || {}),
        e.queue?.courierPending ? 1 : 0,
        e.queue?.pointPending ? 1 : 0,
        e.queue?.courierPlannedDate || null,
        e.returnDate || null,
        e.returnPackages ?? null,
        e.returnDelivery || null,
        e.returnShipping ? 1 : 0,
        JSON.stringify(e.returnTools || []),
        JSON.stringify(e.queue || {}),
        Number.isInteger(e.entry_index) ? e.entry_index : null,
        Number.isInteger(e.idx) ? e.idx : null,
      ]
    );
  }
}

/* Завантажити протокол з усіма записами */
async function getProtocol(clientId, month) {
  const head = await query(
    `SELECT id, clientId, month, summarized, createdAt, updatedAt
     FROM protocols
     WHERE clientId = ? AND month = ?
     LIMIT 1`,
    [clientId, month]
  );
  if (!head.length) return null;

  const proto = head[0];

  const rows = await query(
    `SELECT
        id,
        date,
        packages,
        delivery,
        shipping,
        comment,
        tools_json,
        signatures_json,
        courierPending,
        pointPending,
        courierPlannedDate,
        returnDate,
        returnPackages,
        returnDelivery,
        returnShipping,
        returnTools_json,
        transferClientSig,
        transferStaffSig,
        returnClientSig,
        returnStaffSig,
        queue_json,
        entry_index,
        idx
     FROM protocol_entries
     WHERE protocol_id = ?
     ORDER BY date ASC, id ASC`,
    [proto.id]
  );

  const safeParse = (val, fb) => {
    try {
      if (val == null) return fb;
      if (typeof val === "object") return val ?? fb;
      const s = String(val);
      if (!s.trim()) return fb;
      return JSON.parse(s);
    } catch {
      return fb;
    }
  };

  const toISO10 = (v) => {
    if (!v) return null;
    if (v instanceof Date && v.toISOString) return v.toISOString().slice(0, 10);
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };

  return {
    clientId: proto.clientId,
    month: proto.month,
    summarized: !!proto.summarized,
    entries: rows.map((r) => ({
      id: r.id,
      date: toISO10(r.date),
      packages: Number(r.packages || 0),
      delivery: r.delivery || null,
      shipping: !!r.shipping,
      comment: r.comment || "",
      tools: safeParse(r.tools_json, []),
      signatures: safeParse(r.signatures_json, {}),
      queue: (() => {
        const q = safeParse(r.queue_json, null);
        if (q && typeof q === "object") {
          return {
            courierPending: !!q.courierPending,
            pointPending: !!q.pointPending,
            courierPlannedDate: toISO10(q.courierPlannedDate),
          };
        }
        return {
          courierPending: !!r.courierPending,
          pointPending: !!r.pointPending,
          courierPlannedDate: toISO10(r.courierPlannedDate),
        };
      })(),
      returnDate: toISO10(r.returnDate),
      returnPackages: r.returnPackages ?? null,
      returnDelivery: r.returnDelivery || null,
      returnShipping: !!r.returnShipping,
      returnTools: safeParse(r.returnTools_json, []),
      transferClientSig: r.transferClientSig || null,
      transferStaffSig: r.transferStaffSig || null,
      returnClientSig: r.returnClientSig || null,
      returnStaffSig: r.returnStaffSig || null,
      entry_index: Number.isInteger(r.entry_index) ? r.entry_index : null,
      idx: Number.isInteger(r.idx) ? r.idx : null,
    })),
  };
}

async function getProtocolsForClientsAndMonth(clientIds, month) {
  if (!Array.isArray(clientIds) || !clientIds.length) return [];

  const placeholders = clientIds.map(() => "?").join(",");

  const rows = await query(
    `
    SELECT clientId
    FROM protocols
    WHERE month = ?
      AND clientId IN (${placeholders})
    `,
    [month, ...clientIds]
  );

  return rows;
}


module.exports = {
  upsertProtocolHeader,
  replaceProtocolEntries,
  getProtocol,
  getProtocolsForClientsAndMonth,
};
