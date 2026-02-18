// server/repos/invoicesRepo.js
// Репозиторій для роботи з рахунками і лічильниками в MySQL

const { query, pool } = require("../db.js");

// ---- локальний helper для DML (UPDATE/DELETE/INSERT) ----
async function exec(sqlText, params = []) {
  const [res] = await pool.execute(sqlText, params);
  return res;
}

// ---------- ЛІЧИЛЬНИК НОМЕРІВ ----------

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

function extractPaymentMethod(inv) {
  const raw =
    inv?.payment_method ??
    inv?.paymentMethod ??
    inv?.payment_method_name ??
    inv?.paymentMethodName ??
    inv?.paymentMethodLabel ??
    inv?._payment_method ??
    inv?._paymentMethod;

  if (raw == null) return null;

  const s = String(raw).trim().toLowerCase();

  if (s === "cash" || s === "gotowka" || s === "gotówka") return "cash";
  if (s === "card" || s === "karta") return "card";
  if (s === "transfer" || s === "przelew") return "transfer";

  return null;
}
function validateInvoiceItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Invoice must contain at least one item");
  }

  for (const it of items) {
    if (!it || typeof it !== "object") {
      throw new Error("Invalid invoice item structure");
    }
    if (!String(it.name || "").trim()) {
      throw new Error("Invoice item name is required");
    }
  }
}

// ---------- INSERT ----------

async function insertInvoice(inv) {
  const clientName =
    inv.clientName || inv.client || inv.buyer_name || inv.buyer || "";

  if (!inv.clientId) {
    throw new Error("clientId is required for invoice");
  }
  const resolvedClientId = inv.clientId;

  const itemsSource = Array.isArray(inv.items)
    ? inv.items
    : Array.isArray(inv.items_json)
    ? inv.items_json
    : typeof inv.items_json === "string"
    ? JSON.parse(inv.items_json)
    : [];

  validateInvoiceItems(itemsSource);
  const items_json = JSON.stringify(itemsSource);

  const netNum = toNumber(inv.net, 0);
  const grossNum = toNumber(inv.gross, 0);

  const paymentMethod = extractPaymentMethod(inv);

  const sqlText = `
    INSERT INTO invoices
      (number, clientId, clientName, issueDate, dueDate, net, gross, status,
       payment_method, filename, folder, items_json,
       buyer_address, buyer_nip, buyer_pesel)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      clientId=VALUES(clientId),
      clientName=VALUES(clientName),
      issueDate=VALUES(issueDate),
      dueDate=VALUES(dueDate),
      net=VALUES(net),
      gross=VALUES(gross),
      status=VALUES(status),
      payment_method = IF(VALUES(payment_method) IS NULL, payment_method, VALUES(payment_method)),
      filename=VALUES(filename),
      folder=VALUES(folder),
      items_json=VALUES(items_json),
      buyer_address=VALUES(buyer_address),
      buyer_nip=VALUES(buyer_nip),
      buyer_pesel=VALUES(buyer_pesel)
  `;

  const params = [
    String(inv.number || "").trim(),
    resolvedClientId,
    String(clientName || "").trim(),
    inv.issueDate || null,
    inv.dueDate || null,
    netNum,
    grossNum,
    inv.status || "issued",
    paymentMethod,
    String(
      inv.filename ||
        `FAKTURA_${String(inv.number || "").replaceAll("/", "_")}.pdf`
    ).toUpperCase(),
    inv.folder || null,
    items_json,
    inv.buyer_address || inv.address || null,
    inv.buyer_nip || null,
    inv.buyer_pesel || null,
  ];

  await exec(sqlText, params);
}

// ---------- UPDATE ----------

async function updateByNumber(number, inv) {
  const clientName =
    inv.clientName || inv.client || inv.buyer_name || inv.buyer || "";

  const itemsSource = Array.isArray(inv.items)
    ? inv.items
    : Array.isArray(inv.items_json)
    ? inv.items_json
    : typeof inv.items_json === "string"
    ? JSON.parse(inv.items_json)
    : [];

  validateInvoiceItems(itemsSource);
  const items_json = JSON.stringify(itemsSource);

  const netNum = toNumber(inv.net, 0);
  const grossNum = toNumber(inv.gross, 0);

  const paymentMethod = extractPaymentMethod(inv);

  const sqlText = `
    UPDATE invoices SET
      clientId=?,
      clientName=?,
      issueDate=?,
      dueDate=?,
      net=?,
      gross=?,
      status=?,
      payment_method = IF(? IS NULL, payment_method, ?),
      filename=?,
      folder=?,
      items_json=?,
      buyer_address=?,
      buyer_nip=?,
      buyer_pesel=?
    WHERE number=?
  `;

  const params = [
    inv.clientId,
    String(clientName || "").trim(),
    inv.issueDate || null,
    inv.dueDate || null,
    netNum,
    grossNum,
    inv.status || "issued",
    paymentMethod,
    paymentMethod,
    String(
      inv.filename || `FAKTURA_${String(number || "").replaceAll("/", "_")}.pdf`
    ).toUpperCase(),
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

// ---------- RENNUMBER ----------

async function renumberInvoice(oldNumber, inv) {
  const newNumber = String(inv.number || "").trim();
  if (!newNumber) return false;

  const clientName =
    inv.clientName || inv.client || inv.buyer_name || inv.buyer || "";

  const itemsSource = Array.isArray(inv.items)
    ? inv.items
    : Array.isArray(inv.items_json)
    ? inv.items_json
    : typeof inv.items_json === "string"
    ? JSON.parse(inv.items_json)
    : [];

  validateInvoiceItems(itemsSource);
  const items_json = JSON.stringify(itemsSource);

  const netNum = toNumber(inv.net, 0);
  const grossNum = toNumber(inv.gross, 0);

  const paymentMethod = extractPaymentMethod(inv);

  const newFilename = String(
    inv.filename ||
      `FAKTURA_${String(newNumber || "").replaceAll("/", "_")}.pdf`
  ).toUpperCase();

  const sqlText = `
    UPDATE invoices SET
      number=?,
      clientId=?,
      filename=?,
      clientName=?,
      issueDate=?,
      dueDate=?,
      net=?,
      gross=?,
      status=?,
      payment_method=?,
      folder=?,
      items_json=?,
      buyer_address=?,
      buyer_nip=?,
      buyer_pesel=?
    WHERE number=?
  `;

  const params = [
    newNumber,
    inv.clientId,
    newFilename,
    String(clientName || "").trim(),
    inv.issueDate || null,
    inv.dueDate || null,
    netNum,
    grossNum,
    inv.status || "issued",
    paymentMethod,
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

// ---------- QUERIES ----------

async function getInvoiceByNumber(num) {
  const rows = await query(`SELECT * FROM invoices WHERE number=? LIMIT 1`, [
    num,
  ]);
  return rows[0] || null;
}

async function queryAllInvoices() {
  return query(`SELECT * FROM invoices ORDER BY id DESC`);
}
async function queryInvoiceByFilename(filename) {
  return query("SELECT * FROM invoices WHERE filename = ?", [
    String(filename || "").toUpperCase(),
  ]);
}

async function deleteByFilename(filename) {
  const res = await exec(`DELETE FROM invoices WHERE filename=? LIMIT 1`, [
    String(filename || "").toUpperCase(),
  ]);

  return (res.affectedRows || 0) > 0;
}

async function deleteByNumber(number) {
  const res = await exec(`DELETE FROM invoices WHERE number=? LIMIT 1`, [
    String(number || ""),
  ]);
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

async function getInvoicesForClientsAndMonth(clientIds, month) {
  if (!Array.isArray(clientIds) || !clientIds.length) return [];

  const placeholders = clientIds.map(() => "?").join(",");

  const rows = await query(
    `
   SELECT
  id,
  clientId,
  clientName,
  number,
  dueDate,
  filename,
  folder
FROM invoices
WHERE LEFT(issueDate, 7) = ?
  AND clientId IN (${placeholders})
ORDER BY issueDate DESC

    `,
    [month, ...clientIds]
  );

  return rows;
}

module.exports = {
  getCounter,
  setCounter,
  insertInvoice,
  updateByNumber,
  renumberInvoice,
  getInvoiceByNumber,
  queryAllInvoices,
  queryInvoiceByFilename,
  deleteByFilename,
  deleteByNumber,
  updateStatusByNumber,
  getInvoicesForClientsAndMonth,
};
