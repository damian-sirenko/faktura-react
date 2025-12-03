// import_invoices_once.cjs
// Одноразовий імпорт JSON-фактур у MySQL (таблиця invoices).
// Запуск: node import_invoices_once.cjs

const fs = require("fs");
const path = require("path");
const { pool } = require("./server/db.js");

const SRC_PATH = path.join(__dirname, "data", "invoices.json");
const BATCH_SIZE = 200;

const S = (v, d = "") => (v == null ? d : String(v));
const J = (v) => {
  try {
    return JSON.stringify(v ?? []);
  } catch {
    return "[]";
  }
};

function normalize(inv) {
  const number =
    S(inv.number) || S(inv.invoiceNumber) || S(inv.nr) || S(inv.No) || "";

  const clientIdRaw =
    S(inv.clientId) || S(inv.client_id) || S(inv.clientID) || S(inv.cid) || "";

  const clientName =
    S(inv.clientName) ||
    S(inv.client) ||
    S(inv.buyer_name) ||
    S(inv.nabywca) ||
    "";

  const buyer_address =
    S(inv.buyer_address) ||
    S(inv.address) ||
    S(inv.buyerAddress) ||
    S(inv.Adres) ||
    "";

  const buyer_nip =
    S(inv.buyer_nip) || S(inv.nip) || S(inv.NIP) || S(inv.taxId) || "";
  const buyer_pesel = S(inv.buyer_pesel) || S(inv.pesel) || S(inv.PESEL) || "";

  const issueDate = S(inv.issueDate) || S(inv.issue_date) || S(inv.date) || "";
  const dueDate =
    S(inv.dueDate) || S(inv.due_date) || S(inv.paymentDue) || S(inv.term) || "";

  const gross =
    S(inv.gross_sum) ||
    S(inv.gross) ||
    S(inv.brutto) ||
    S(inv.total_gross) ||
    S(inv.total) ||
    "0,00";
  const net = S(inv.net_sum) || S(inv.net) || S(inv.netto) || "0,00";

  const status = (S(inv.status) || S(inv.state) || "issued").toLowerCase();
  const filename = S(inv.filename) || S(inv.file) || S(inv.pdf) || "";
  const folder = S(inv.folder) || "";

  const items = Array.isArray(inv.items)
    ? inv.items
    : Array.isArray(inv.items_json)
    ? inv.items_json
    : Array.isArray(inv.pozycje)
    ? inv.pozycje
    : [];

  return {
    number,
    clientIdRaw,
    clientName,
    buyer_address,
    buyer_nip,
    buyer_pesel,
    issueDate,
    dueDate,
    net,
    gross,
    status,
    filename,
    folder,
    items_json: J(items),
  };
}

async function loadClients() {
  // витягуємо id і name для мапінгу
  const [rows] = await pool.query("SELECT id, name FROM clients");
  const idSet = new Set(rows.map((r) => String(r.id)));
  // мапимо точним збігом імені
  const nameToId = new Map();
  for (const r of rows) {
    const key = (r.name || "").trim().toLowerCase();
    if (key && !nameToId.has(key)) nameToId.set(key, String(r.id));
  }
  return { idSet, nameToId };
}

function resolveClientId(rec, idSet, nameToId) {
  const raw = rec.clientIdRaw.trim();
  if (raw && idSet.has(raw)) return raw; // валідний існуючий id
  const byName = nameToId.get(rec.clientName.trim().toLowerCase());
  if (byName) return byName; // знайдено по імені
  return null; // важливо: NULL, а не ''
}

async function importBatch(batch) {
  if (!batch.length) return;

  const placeholders = batch
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");
  const sql = `
    INSERT INTO invoices
      (number, clientId, clientName, buyer_address, buyer_nip, buyer_pesel,
       issueDate, dueDate, net, gross, status, filename, folder, items_json)
    VALUES ${placeholders}
    ON DUPLICATE KEY UPDATE
      clientId=VALUES(clientId),
      clientName=VALUES(clientName),
      buyer_address=VALUES(buyer_address),
      buyer_nip=VALUES(buyer_nip),
      buyer_pesel=VALUES(buyer_pesel),
      issueDate=VALUES(issueDate),
      dueDate=VALUES(dueDate),
      net=VALUES(net),
      gross=VALUES(gross),
      status=VALUES(status),
      filename=VALUES(filename),
      folder=VALUES(folder),
      items_json=VALUES(items_json)
  `;

  const params = [];
  for (const r of batch) {
    params.push(
      r.number,
      r.clientId, // може бути null — це ок для FK (ON DELETE SET NULL)
      r.clientName,
      r.buyer_address,
      r.buyer_nip,
      r.buyer_pesel,
      r.issueDate,
      r.dueDate,
      r.net,
      r.gross,
      r.status,
      r.filename,
      r.folder,
      r.items_json
    );
  }
  await pool.query(sql, params);
}

async function main() {
  if (!fs.existsSync(SRC_PATH)) {
    console.error("Не знайдено файл:", SRC_PATH);
    process.exit(1);
  }

  const raw = fs.readFileSync(SRC_PATH, "utf8");
  let src;
  try {
    src = JSON.parse(raw);
  } catch (e) {
    console.error("Помилка парсингу JSON:", e.message);
    process.exit(1);
  }

  let list = [];
  if (Array.isArray(src)) list = src;
  else if (Array.isArray(src.invoices)) list = src.invoices;
  else if (Array.isArray(src.data)) list = src.data;
  else {
    console.error("Очікував масив або об’єкт з масивом (invoices|data).");
    process.exit(1);
  }

  console.log("Знайдено записів у JSON:", list.length);

  const { idSet, nameToId } = await loadClients();

  let ok = 0,
    skip = 0,
    fail = 0;
  let batch = [];

  for (let i = 0; i < list.length; i++) {
    try {
      const base = normalize(list[i]);
      if (!base.number) {
        skip++;
        continue;
      }

      const clientId = resolveClientId(base, idSet, nameToId); // null, або валідний id

      const row = {
        number: base.number,
        clientId,
        clientName: base.clientName,
        buyer_address: base.buyer_address,
        buyer_nip: base.buyer_nip,
        buyer_pesel: base.buyer_pesel,
        issueDate: base.issueDate,
        dueDate: base.dueDate,
        net: base.net,
        gross: base.gross,
        status: base.status,
        filename: base.filename,
        folder: base.folder,
        items_json: base.items_json,
      };

      batch.push(row);

      if (batch.length >= BATCH_SIZE) {
        await importBatch(batch);
        ok += batch.length;
        batch = [];
        if (ok % 1000 === 0) console.log(`Імпортовано: ${ok}...`);
      }
    } catch {
      fail++;
    }
  }

  if (batch.length) {
    await importBatch(batch);
    ok += batch.length;
  }

  console.log(
    `Готово. Успішно: ${ok}, пропущено без number: ${skip}, помилок: ${fail}`
  );
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
