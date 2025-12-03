// server/repos/invoicesRepo.js
// Репозиторій для роботи з рахунками і лічильниками в MySQL

const { query, pool } = require("../db.js");

// ---- локальний helper для DML (UPDATE/DELETE/INSERT), щоб мати affectedRows ----
async function exec(sqlText, params = []) {
  const [res] = await pool.execute(sqlText, params);
  // res: ResultSetHeader з affectedRows/insertId тощо
  return res;
}

// ---------- ЛІЧИЛЬНИК НОМЕРІВ (invoice_counters) ----------

async function getCounter(ym) {
  const rows = await query(
    "SELECT next FROM invoice_counters WHERE ym = ? LIMIT 1",
    [ym]
  );
  if (rows.length === 0) return null;
  return rows[0].next;
}

async function setCounter(ym, nextVal) {
  await exec(
    `
    INSERT INTO invoice_counters (ym, next)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE next = VALUES(next)
    `,
    [ym, nextVal]
  );
}

// ---------- УТИЛІТИ ----------

const toNumber = (v, def = 0) => {
  if (v == null) return def;
  if (typeof v === "number") return Number.isFinite(v) ? v : def;
  let s = String(v).trim();
  if (!s) return def;
  s = s.replace(/\s+/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
};

// ---------- INSERT / UPDATE ІНВОЙСА (invoices) ----------

async function insertInvoice(inv) {
  const clientName =
    inv.clientName || inv.client || inv.buyer_name || inv.buyer || "";

  const items_json = JSON.stringify(Array.isArray(inv.items) ? inv.items : []);

  const netNum = toNumber(inv.net, 0);
  const grossNum = toNumber(inv.gross, 0);

  const sqlText = `INSERT INTO invoices
       (number, clientName, issueDate, dueDate, net, gross, status, filename, folder,
        items_json, buyer_address, buyer_nip, buyer_pesel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         clientName=VALUES(clientName),
         issueDate=VALUES(issueDate),
         dueDate=VALUES(dueDate),
         net=VALUES(net),
         gross=VALUES(gross),
         status=VALUES(status),
         filename=VALUES(filename),
         folder=VALUES(folder),
         items_json=VALUES(items_json),
         buyer_address=VALUES(buyer_address),
         buyer_nip=VALUES(buyer_nip),
         buyer_pesel=VALUES(buyer_pesel)`;

  const params = [
    String(inv.number || "").trim(),
    String(clientName || "").trim(),
    inv.issueDate || null,
    inv.dueDate || null,
    netNum,
    grossNum,
    inv.status || "issued",
    String(
      inv.filename ||
        `Faktura_${String(inv.number || "").replaceAll("/", "_")}.pdf`
    ),
    inv.folder || null,
    items_json,
    inv.buyer_address || inv.address || null,
    inv.buyer_nip || null,
    inv.buyer_pesel || null,
  ];

  await exec(sqlText, params);
}

async function getInvoiceByNumber(num) {
  const rows = await query(
    `
    SELECT
      id,
      number,
      clientId,
      clientName,
      issueDate,
      dueDate,
      net,
      gross,
      status,
      filename,
      folder,
      buyer_address,
      buyer_nip,
      buyer_pesel,
      items_json
    FROM invoices
    WHERE number = ?
    LIMIT 1
    `,
    [num]
  );
  if (rows.length === 0) return null;
  return rows[0];
}

async function getAllCounters() {
  const rows = await query(
    "SELECT ym, next FROM invoice_counters ORDER BY ym ASC"
  );
  return rows;
}

async function getInvoicesByYm(y, m) {
  const suffix = `/${m}/${y}`;
  const rows = await query(
    `
    SELECT id, number
    FROM invoices
    WHERE number LIKE ?
    `,
    [`%${suffix}`]
  );
  return rows;
}

async function queryAllInvoices() {
  const rows = await query(
    `
      SELECT
        id,
        number,
        clientId,
        clientName,
        issueDate,
        dueDate,
        net,
        gross,
        status,
        filename,
        folder,
        buyer_address,
        buyer_nip,
        buyer_pesel,
        items_json
      FROM invoices
      ORDER BY id DESC
      `
  );
  return rows;
}

async function queryInvoiceByFilename(filename) {
  const rows = await query(
    `
      SELECT
        id,
        number,
        clientId,
        clientName,
        issueDate,
        dueDate,
        net,
        gross,
        status,
        filename,
        folder,
        buyer_address,
        buyer_nip,
        buyer_pesel,
        items_json
      FROM invoices
      WHERE filename = ?
      `,
    [filename]
  );
  // server.cjs очікує МАСИВ, щоб робити dbRows[0]
  return rows;
}

async function deleteByFilename(filename) {
  const res = await exec(`DELETE FROM invoices WHERE filename=? LIMIT 1`, [
    String(filename || ""),
  ]);
  return (res.affectedRows || 0) > 0;
}

async function deleteByNumber(number) {
  const res = await exec(`DELETE FROM invoices WHERE number=? LIMIT 1`, [
    String(number || ""),
  ]);
  return (res.affectedRows || 0) > 0;
}

async function updateByNumber(number, inv) {
  const clientName =
    inv.clientName || inv.client || inv.buyer_name || inv.buyer || "";

  const items_json = JSON.stringify(Array.isArray(inv.items) ? inv.items : []);

  const netNum = toNumber(inv.net, 0);
  const grossNum = toNumber(inv.gross, 0);

  const sqlText = `
    UPDATE invoices SET
      clientName=?,
      issueDate=?,
      dueDate=?,
      net=?,
      gross=?,
      status=?,
      filename=?,
      folder=?,
      items_json=?,
      buyer_address=?,
      buyer_nip=?,
      buyer_pesel=?
    WHERE number=?`;
  const params = [
    String(clientName || "").trim(),
    inv.issueDate || null,
    inv.dueDate || null,
    netNum,
    grossNum,
    inv.status || "issued",
    String(
      inv.filename ||
        `Faktura_${String(inv.number || number || "").replaceAll("/", "_")}.pdf`
    ),
    inv.folder || null,
    items_json,
    inv.buyer_address || inv.address || null,
    inv.buyer_nip || null,
    inv.buyer_pesel || null,
    String(number || "").trim(),
  ];
  const res = await exec(sqlText, params);
  return (res.affectedRows || 0) > 0;
}

async function updateStatusByNumber(number, status) {
  const ok = ["issued", "paid", "overdue"];
  const st = ok.includes(String(status)) ? String(status) : "issued";
  const res = await exec("UPDATE invoices SET status=? WHERE number=?", [
    st,
    number,
  ]);
  return (res.affectedRows || 0) > 0;
}

// Зміна номера рахунку (і пов’язаних полів)
async function renumberInvoice(oldNumber, inv) {
  const newNumber = String(inv.number || "").trim();
  if (!newNumber) return false;

  const clientName =
    inv.clientName || inv.client || inv.buyer_name || inv.buyer || "";
  const items_json = JSON.stringify(Array.isArray(inv.items) ? inv.items : []);
  const netNum = toNumber(inv.net, 0);
  const grossNum = toNumber(inv.gross, 0);

  const newFilename = String(
    inv.filename || `Faktura_${String(newNumber).replaceAll("/", "_")}.pdf`
  );

  const sqlText = `
    UPDATE invoices SET
      number=?,
      filename=?,
      clientName=?,
      issueDate=?,
      dueDate=?,
      net=?,
      gross=?,
      status=?,
      folder=?,
      items_json=?,
      buyer_address=?,
      buyer_nip=?,
      buyer_pesel=?
    WHERE number=?`;
  const params = [
    newNumber,
    newFilename,
    String(clientName || "").trim(),
    inv.issueDate || null,
    inv.dueDate || null,
    toNumber(inv.net, 0),
    toNumber(inv.gross, 0),
    inv.status || "issued",
    inv.folder || null,
    items_json,
    inv.buyer_address || inv.address || null,
    inv.buyer_nip || null,
    inv.buyer_pesel || null,
    String(oldNumber || "").trim(),
  ];
  const res = await exec(sqlText, params);
  return (res.affectedRows || 0) > 0;
}

async function findByFilenames(files) {
  if (!Array.isArray(files) || !files.length) return [];

  const cleaned = files.map((f) => String(f || "").trim()).filter(Boolean);

  if (!cleaned.length) return [];

  const placeholders = cleaned.map(() => "?").join(", ");
  const rows = await query(
    `
      SELECT
        id,
        number,
        clientId,
        clientName,
        issueDate,
        dueDate,
        net,
        gross,
        status,
        filename,
        folder,
        buyer_address,
        buyer_nip,
        buyer_pesel,
        items_json
      FROM invoices
      WHERE filename IN (${placeholders})
      `,
    cleaned
  );
  return rows;
}

module.exports = {
  getCounter,
  setCounter,
  insertInvoice,
  getInvoiceByNumber,
  getAllCounters,
  getInvoicesByYm,
  queryAllInvoices,
  queryInvoiceByFilename,
  deleteByFilename,
  deleteByNumber,
  updateByNumber,
  updateStatusByNumber,
  renumberInvoice,
  findByFilenames,
};
