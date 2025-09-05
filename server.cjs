// server.cjs
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const analyticsRouter = require("./routes/analytics");
const { createProtocolPDF, createProtocolZip } = require("./protocol.pdf.js");

// ⬇️ НОВЕ: підключаємо генератор .epp і форматери 2 знаки (використовується у PDF-утиліті)
const { generateEPPContent, to2 } = require("./epp.js");

const app = express();

/* -----------------------------
 * Шляхові константи
 * ----------------------------- */
const DATA_DIR = path.join(__dirname, "data");
const GENERATED_DIR = path.join(__dirname, "generated");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const INVOICES_FILE = path.join(DATA_DIR, "invoices.json");
const SERVICES_FILE = path.join(DATA_DIR, "services.json");
const PROTOCOLS_FILE = path.join(DATA_DIR, "protocols.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

/* ✅ ДОДАНО: директорія для підписів */
const SIGNATURES_DIR = path.join(__dirname, "signatures");

/* ✅ ДОДАНО: генерація PDF-фактур */
const { generatePDF } = require("./faktura.pdf.js");

/* ===========================
 * Утиліти PDF та інвойсів
 * =========================== */

function findInvoicePathDeep(filename) {
  const stack = [GENERATED_DIR];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name === filename) return full;
    }
  }
  return null;
}

function findGeneratedFileDeep(filename) {
  const safe = path.basename(String(filename || ""));
  const stack = [GENERATED_DIR];
  while (stack.length) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && e.name === safe) {
        return full;
      }
    }
  }
  return null;
}

function safeSeg(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getAllInvoices() {
  if (!fs.existsSync(INVOICES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(INVOICES_FILE, "utf8"));
  } catch {
    return [];
  }
}

function getInvoiceByFilename(filename) {
  const safe = path.basename(String(filename || ""));
  const all = getAllInvoices();
  return all.find((i) => (i.filename || "") === safe) || null;
}

/* Дані продавця (для шаблону) */
const SELLER = {
  name: "CORRECT SOLUTION SP. Z O.O.",
  nip: "6751516747",
  address: "Osiedle Dywizjonu 303 62F, 31-875 Kraków",
};

function invoiceToPdfData(inv) {
  const buyer_identifier = inv.buyer_nip
    ? `NIP: ${inv.buyer_nip}`
    : inv.buyer_pesel
    ? `PESEL: ${inv.buyer_pesel}`
    : "";

  const net = inv.net || "";
  const gross = inv.gross || "";
  const vat =
    net && gross
      ? to2(
          Number(String(gross).replace(",", ".")) -
            Number(String(net).replace(",", "."))
        )
      : "";

  return {
    number: inv.number || "",
    place: "",
    issue_date: inv.issueDate || inv.issue_date || "",
    sale_date: inv.issueDate || inv.issue_date || "",
    due_date: inv.dueDate || inv.due_date || "",

    seller_name: SELLER.name,
    seller_address: SELLER.address,
    seller_nip: SELLER.nip,

    buyer_name: inv.client || inv.buyer_name || "",
    buyer_address: inv.buyer_address || inv.address || "",
    buyer_identifier,

    items: Array.isArray(inv.items) ? inv.items : [],

    net_sum: net || "",
    vat_sum: vat || "",
    gross_sum: gross || "",

    amount_due: gross || "",
    amount_in_words: "",
    paid_amount: "",
    payment_method: "",
    bank: "",
    account: "",
    issuer: "Dmytro Sirenko",
  };
}

/* Створення PDF, якщо немає */
async function ensurePdfForInvoice(inv) {
  if (!inv || !inv.number) return null;

  const folderSafe = inv.folder ? safeSeg(inv.folder) : "";
  const outDir = folderSafe
    ? path.join(GENERATED_DIR, folderSafe)
    : GENERATED_DIR;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const filename =
    inv.filename || `Faktura_${String(inv.number).replaceAll("/", "_")}.pdf`;
  const outputPath = path.join(outDir, path.basename(filename));

  const found = findInvoicePathDeep(path.basename(filename));
  if (found && fs.existsSync(found)) return found;

  const data = invoiceToPdfData(inv);
  await generatePDF(data, outputPath);

  const final = findInvoicePathDeep(path.basename(filename)) || outputPath;
  return final;
}

/* Ініціалізація директорій/файлів */
for (const dir of [DATA_DIR, GENERATED_DIR, SIGNATURES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(CLIENTS_FILE)) fs.writeFileSync(CLIENTS_FILE, "[]", "utf8");
if (!fs.existsSync(INVOICES_FILE))
  fs.writeFileSync(INVOICES_FILE, "[]", "utf8");
if (!fs.existsSync(SERVICES_FILE))
  fs.writeFileSync(SERVICES_FILE, "[]", "utf8");
if (!fs.existsSync(PROTOCOLS_FILE))
  fs.writeFileSync(PROTOCOLS_FILE, "[]", "utf8");

if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(
      {
        perPiecePriceGross: 6.0,
        courierPriceGross: 0,
        shippingPriceGross: 0,
        defaultVat: 23,
        currentIssueMonth: new Date().toISOString().slice(0, 7),
      },
      null,
      2
    ),
    "utf8"
  );
}

/* -----------------------------
 * CORS і парсери
 * ----------------------------- */
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error("CORS error: Origin not allowed"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: process.env.JSON_LIMIT || "25mb" }));

app.use((req, _res, next) => {
  console.log(`[API] ${req.method} ${req.url}`);
  next();
});

/* -----------------------------
 * /generated — віддача/генерація PDF
 * ----------------------------- */
app.get("/generated/:filename", async (req, res, next) => {
  const p = findInvoicePathDeep(req.params.filename);
  if (p) {
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${req.params.filename}"`
    );
    return res.sendFile(p);
  }
  try {
    const inv = getInvoiceByFilename(req.params.filename);
    if (inv) {
      const genPath = await ensurePdfForInvoice(inv);
      if (genPath && fs.existsSync(genPath)) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="${path.basename(genPath)}"`
        );
        return res.sendFile(genPath);
      }
    }
  } catch (e) {
    console.error("❌ /generated first handler error:", e);
  }
  return next();
});

app.use("/generated", express.static(GENERATED_DIR));

app.get("/generated/:filename", async (req, res) => {
  const fileFromRoot = path.join(
    GENERATED_DIR,
    path.basename(req.params.filename)
  );
  try {
    if (fs.existsSync(fileFromRoot)) {
      res.setHeader("Content-Type", "application/pdf");
      return res.sendFile(fileFromRoot);
    }
    const deep = findGeneratedFileDeep(req.params.filename);
    if (deep) {
      res.setHeader("Content-Type", "application/pdf");
      return res.sendFile(deep);
    }
    const inv = getInvoiceByFilename(req.params.filename);
    if (inv) {
      const genPath = await ensurePdfForInvoice(inv);
      if (genPath && fs.existsSync(genPath)) {
        res.setHeader("Content-Type", "application/pdf");
        return res.sendFile(genPath);
      }
    }
    return res.status(404).send("Nie znaleziono faktury.");
  } catch (e) {
    console.error("❌ /generated fallback error:", e);
    return res.status(500).send("Internal server error");
  }
});

app.use("/signatures", express.static(SIGNATURES_DIR));

app.use("/analytics", analyticsRouter);

/* -----------------------------
 * Маршрути генерації/завантаження інвойсів
 * ----------------------------- */
const uploadRouter = require("./routes/uploadInvoices");
app.use("/upload", uploadRouter);

const genRouter = require("./routes/generateFromClients");
app.use("/gen", genRouter);

/* -----------------------------
 * API: Налаштування (settings)
 * ----------------------------- */
app.get("/settings", (_req, res) => {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const json = JSON.parse(raw);
    res.json(json);
  } catch (e) {
    console.error("❌ Error reading settings:", e);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

app.post("/settings", (req, res) => {
  try {
    const s = req.body || {};
    const prev = fs.existsSync(SETTINGS_FILE)
      ? JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))
      : {};

    const out = {
      ...prev,
      perPiecePriceGross: Number(
        s.perPiecePriceGross ?? prev.perPiecePriceGross ?? 6
      ),
      defaultVat: Number(s.defaultVat ?? prev.defaultVat ?? 23),
      courierPriceGross: Number(
        s.courierPriceGross ?? prev.courierPriceGross ?? 0
      ),
      shippingPriceGross: Number(
        s.shippingPriceGross ?? prev.shippingPriceGross ?? 0
      ),
      currentIssueMonth:
        typeof s.currentIssueMonth === "string" &&
        /^\d{4}-\d{2}$/.test(s.currentIssueMonth)
          ? s.currentIssueMonth
          : prev.currentIssueMonth || new Date().toISOString().slice(0, 7),
    };

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(out, null, 2), "utf8");
    res.json({ success: true, settings: out });
  } catch (e) {
    console.error("❌ Error saving settings:", e);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

/* -----------------------------
 * API: Клієнти
 * ----------------------------- */
app.post("/save-clients", (req, res) => {
  const clients = req.body;
  if (!Array.isArray(clients)) {
    return res.status(400).json({ error: "Invalid data format" });
  }
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), "utf8");
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error saving clients:", err);
    res.status(500).json({ error: "Failed to save clients" });
  }
});

app.post("/clients/save", (req, res) => {
  const clients = req.body;
  if (!Array.isArray(clients)) {
    return res.status(400).json({ error: "Invalid data format" });
  }
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2), "utf8");
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error saving clients (alias):", err);
    res.status(500).json({ error: "Failed to save clients" });
  }
});

app.get("/clients", (_req, res) => {
  try {
    if (!fs.existsSync(CLIENTS_FILE)) return res.json([]);
    const data = fs.readFileSync(CLIENTS_FILE, "utf8");
    res.json(JSON.parse(data));
  } catch (err) {
    console.error("❌ Error reading clients:", err);
    res.status(500).json({ error: "Failed to load clients" });
  }
});

/* -----------------------------
 * Допоміжна утиліта — підсумки по протоколу
 * ----------------------------- */
function collectMonth(proto /* {entries:[] } */, month /* "YYYY-MM" */) {
  const entries = Array.isArray(proto?.entries) ? proto.entries : [];
  let packages = 0,
    courier = 0,
    shipments = 0;
  for (const e of entries) {
    packages += Number(e?.packages || 0) || 0;
    if (e?.shipping) shipments += 1;
    const d = String(e?.delivery || "");
    if (d === "odbior" || d === "dowoz") courier += 1;
    else if (d === "odbior+dowoz") courier += 2;
  }
  return { packages, courier, shipments };
}

/* -----------------------------
 * API: Скан PDF у /generated
 * ----------------------------- */
app.get("/saved-invoices", (_req, res) => {
  const invoices = [];
  function readFolder(folderPath, parent = "") {
    if (!fs.existsSync(folderPath)) return;
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      const relativePath = path.join(parent, entry.name);
      if (entry.isDirectory()) readFolder(fullPath, relativePath);
      else if (entry.name.toLowerCase().endsWith(".pdf"))
        invoices.push(relativePath);
    }
  }
  readFolder(GENERATED_DIR);
  res.json(invoices);
});

/* -----------------------------
 * API: invoices.json (метадані)
 * ----------------------------- */
app.get("/invoices", (_req, res) => {
  try {
    if (!fs.existsSync(INVOICES_FILE)) return res.json([]);
    res.json(JSON.parse(fs.readFileSync(INVOICES_FILE, "utf8")));
  } catch (e) {
    console.error("❌ Error reading invoices:", e);
    res.status(500).json({ error: "Failed to load invoices" });
  }
});

app.post("/save-invoices", async (req, res) => {
  const invoices = req.body;
  if (!Array.isArray(invoices)) {
    return res.status(400).json({ error: "Invalid invoices payload" });
  }
  try {
    fs.writeFileSync(INVOICES_FILE, JSON.stringify(invoices, null, 2), "utf8");
    res.json({ success: true });

    setImmediate(async () => {
      for (const inv of invoices) {
        try {
          const fname =
            inv.filename ||
            `Faktura_${String(inv.number || "").replaceAll("/", "_")}.pdf`;
          const exists = findInvoicePathDeep(path.basename(fname));
          if (!exists) {
            await ensurePdfForInvoice(inv);
          }
        } catch (e) {
          console.warn(
            "⚠️ PDF gen after save failed for",
            inv?.number,
            e?.message || e
          );
        }
      }
    });
  } catch (err) {
    console.error("❌ Error saving invoices:", err);
    res.status(500).json({ error: "Failed to save invoices" });
  }
});

app.get("/download-invoice/:filename", async (req, res) => {
  const fn = path.basename(req.params.filename);
  try {
    let p = findInvoicePathDeep(fn);
    if (!p) {
      const inv = getInvoiceByFilename(fn);
      if (inv) {
        p = await ensurePdfForInvoice(inv);
      }
    }
    if (p && fs.existsSync(p)) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${fn}"`);
      return res.sendFile(p);
    }
    return res.status(404).send("Nie znaleziono faktury.");
  } catch (e) {
    console.error("❌ /download-invoice error:", e);
    return res.status(500).send("Internal server error");
  }
});

/* -----------------------------
 * Download multiple PDF as ZIP
 * ----------------------------- */
app.post("/download-multiple", (req, res) => {
  const { files } = req.body || {};
  if (!Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: "Niepoprawna lista plików" });
  }

  const archiver = require("archiver");
  const archive = archiver("zip", { zlib: { level: 9 } });

  res.attachment("wybrane_faktury.zip");
  archive.on("error", (err) => {
    console.error("❌ Archiver error:", err);
    res.status(500).end();
  });
  archive.pipe(res);

  const rootEntries = fs.existsSync(GENERATED_DIR)
    ? fs.readdirSync(GENERATED_DIR, { withFileTypes: true })
    : [];
  const rootFiles = new Set(
    rootEntries.filter((e) => e.isFile()).map((e) => e.name)
  );
  const folders = rootEntries.filter((e) => e.isDirectory()).map((e) => e.name);

  for (const filename of files) {
    const safe = path.basename(String(filename || ""));
    const rootPath = path.join(GENERATED_DIR, safe);
    if (rootFiles.has(safe) && fs.existsSync(rootPath)) {
      archive.file(rootPath, { name: safe });
      continue;
    }
    let added = false;
    for (const folder of folders) {
      const fullPath = path.join(GENERATED_DIR, folder, safe);
      if (fs.existsSync(fullPath)) {
        archive.file(fullPath, { name: safe });
        added = true;
        break;
      }
    }
    if (!added) {
      console.warn("[ZIP] File not found:", safe);
    }
  }
  archive.finalize();
});

/* =============================
 * PROTOCOLS
 * ============================= */
app.get(/^\/protocols\/([^\/]+)\/(\d{4}-\d{2})$/, (req, res) => {
  try {
    const clientId = decodeURIComponent(req.params[0]);
    const month = req.params[1];
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "Invalid month format" });
    }
    const all = readProtocols();
    const found = all.find((p) => p.id === clientId && p.month === month) || {
      id: clientId,
      month,
      entries: [],
    };
    const totals = computeMonthlyTotals(found);
    res.json({ ...found, totals });
  } catch (e) {
    console.error("❌ Error reading protocol:", e);
    res.status(500).json({ error: "Failed to load protocol" });
  }
});

app.get("/protocols", (_req, res) => {
  try {
    const all = readProtocols();
    res.json(all);
  } catch (e) {
    console.error("❌ Error reading protocols list:", e);
    res.status(500).json({ error: "Failed to load protocols list" });
  }
});

function readProtocols() {
  try {
    return JSON.parse(fs.readFileSync(PROTOCOLS_FILE, "utf8")) || [];
  } catch {
    return [];
  }
}
function writeProtocols(all) {
  fs.writeFileSync(PROTOCOLS_FILE, JSON.stringify(all, null, 2), "utf8");
}
function computeMonthlyTotals(proto) {
  const totalPackages = (proto.entries || []).reduce(
    (sum, e) => sum + (Number(e.packages || 0) || 0),
    0
  );
  return { totalPackages };
}

function saveSignatureDataURL(dataURL, clientId, month, roleKey) {
  if (!dataURL || typeof dataURL !== "string") return null;
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataURL);
  if (!m) return null;
  const ext = m[1] === "jpeg" ? "jpg" : "png";
  const b64 = m[2];

  const safeClient = safeSeg(clientId);
  const safeMonth = safeSeg(month);

  const dir = path.join(SIGNATURES_DIR, safeClient, safeMonth);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const file = `${roleKey}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;
  const abs = path.join(dir, file);
  fs.writeFileSync(abs, Buffer.from(b64, "base64"));
  const pub = `/signatures/${encodeURIComponent(
    safeClient
  )}/${encodeURIComponent(safeMonth)}/${encodeURIComponent(file)}`;
  return pub;
}

app.get(/^\/protocols\/([^\/]+)\/(\d{4}-\d{2})\/pdf$/, (req, res) => {
  req.params.clientId = decodeURIComponent(req.params[0]);
  req.params.month = req.params[1];
  return createProtocolPDF(req, res);
});

app.get("/protocols/:month/zip", (req, res) => {
  return createProtocolZip(req, res);
});

app.post("/protocols/:clientId/:month", (req, res) => {
  try {
    const { clientId, month } = req.params;
    if (!/^\d{4}-\d{2}$/.test(month))
      return res.status(400).json({ error: "Invalid month format" });

    const entry = req.body || {};

    const date = entry.date ? String(entry.date) : null;
    if (!date) return res.status(400).json({ error: "Brak 'date' w wpisie" });

    const tools = Array.isArray(entry.tools)
      ? entry.tools.map((t) => ({
          name: String(t?.name || "").trim(),
          count: Number(t?.count || 0) || 0,
        }))
      : [];

    const packages = Number(entry.packages || 0) || 0;
    const delivery = entry.delivery || null;
    const shipping = Boolean(entry.shipping);
    const comment = String(entry.comment || "");

    let signatures = undefined;
    if (entry.signaturesData && typeof entry.signaturesData === "object") {
      const sd = entry.signaturesData;
      const transfer = {};
      const ret = {};
      if (sd.transfer && typeof sd.transfer === "object") {
        if (sd.transfer.client) {
          transfer.client = saveSignatureDataURL(
            sd.transfer.client,
            clientId,
            month,
            "transfer_client"
          );
        }
        if (sd.transfer.staff) {
          transfer.staff = saveSignatureDataURL(
            sd.transfer.staff,
            clientId,
            month,
            "transfer_staff"
          );
        }
      }
      if (sd.return && typeof sd.return === "object") {
        if (sd.return.client) {
          ret.client = saveSignatureDataURL(
            sd.return.client,
            clientId,
            month,
            "return_client"
          );
        }
        if (sd.return.staff) {
          ret.staff = saveSignatureDataURL(
            sd.return.staff,
            clientId,
            month,
            "return_staff"
          );
        }
      }
      const hasTransfer = transfer.client || transfer.staff;
      const hasReturn = ret.client || ret.staff;
      if (hasTransfer || hasReturn) {
        signatures = {};
        if (hasTransfer) signatures.transfer = transfer;
        if (hasReturn) signatures.return = ret;
      }
    }

    let queue = undefined;
    if (entry.queue && typeof entry.queue === "object") {
      queue = {
        courierPending: !!entry.queue.courierPending,
        pointPending: !!entry.queue.pointPending,
      };
    }

    const all = readProtocols();
    let proto = all.find((p) => p.id === clientId && p.month === month);
    if (!proto) {
      proto = { id: clientId, month, entries: [] };
      all.push(proto);
    }

    const newEntry = { date, tools, packages, delivery, shipping, comment };
    if (signatures) newEntry.signatures = signatures;
    if (queue) newEntry.queue = queue;

    proto.entries.push(newEntry);
    writeProtocols(all);

    const totals = computeMonthlyTotals(proto);
    res.json({ success: true, protocol: { ...proto, totals } });
  } catch (e) {
    console.error("❌ Error saving protocol:", e);
    res.status(500).json({ error: "Failed to save protocol entry" });
  }
});

app.delete("/protocols/:clientId/:month/:index", (req, res) => {
  try {
    const { clientId, month, index } = req.params;
    const idx = Number(index);
    const all = readProtocols();
    const proto = all.find((p) => p.id === clientId && p.month === month);
    if (!proto) return res.status(404).json({ error: "Protocol not found" });

    if (idx >= 0 && idx < proto.entries.length) {
      proto.entries.splice(idx, 1);
      writeProtocols(all);
    }
    const totals = computeMonthlyTotals(proto);
    res.json({ success: true, protocol: { ...proto, totals } });
  } catch (e) {
    console.error("❌ Error deleting protocol entry:", e);
    res.status(500).json({ error: "Failed to delete protocol entry" });
  }
});

app.post("/protocols/:clientId/:month/:index/queue", (req, res) => {
  try {
    const { clientId, month, index } = req.params;
    const { type, pending } = req.body || {};
    if (!["courier", "point"].includes(type))
      return res.status(400).json({ error: "Invalid type" });

    const idx = Number(index);
    const all = readProtocols();
    const proto = all.find((p) => p.id === clientId && p.month === month);
    if (!proto) return res.status(404).json({ error: "Protocol not found" });
    const entry = proto.entries[idx];
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    entry.queue = entry.queue || { courierPending: false, pointPending: false };
    if (type === "courier") entry.queue.courierPending = !!pending;
    if (type === "point") entry.queue.pointPending = !!pending;

    writeProtocols(all);
    res.json({ success: true, entry });
  } catch (e) {
    console.error("❌ Queue mark error:", e);
    res.status(500).json({ error: "Failed to update queue flag" });
  }
});

app.post("/protocols/:clientId/:month/:index/sign", (req, res) => {
  try {
    const { clientId, month, index } = req.params;
    const { leg, client: clientDataURL, staff: staffDataURL } = req.body || {};
    if (!["transfer", "return"].includes(leg))
      return res.status(400).json({ error: "Invalid leg" });

    const idx = Number(index);
    const all = readProtocols();
    const proto = all.find((p) => p.id === clientId && p.month === month);
    if (!proto) return res.status(404).json({ error: "Protocol not found" });
    const entry = proto.entries[idx];
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    entry.signatures = entry.signatures || {};
    entry.signatures[leg] = entry.signatures[leg] || {};

    if (clientDataURL) {
      entry.signatures[leg].client = saveSignatureDataURL(
        clientDataURL,
        clientId,
        month,
        `${leg}_client`
      );
    }
    if (staffDataURL) {
      entry.signatures[leg].staff = saveSignatureDataURL(
        staffDataURL,
        clientId,
        month,
        `${leg}_staff`
      );
    }

    const t = entry.signatures.transfer;
    const r = entry.signatures.return;
    const transferDone = !!(t && t.client && t.staff);
    const returnDone = !!(r && r.client && r.staff);
    if (transferDone && returnDone) {
      entry.queue = entry.queue || {
        courierPending: false,
        pointPending: false,
      };
      entry.queue.courierPending = false;
      entry.queue.pointPending = false;
    }

    writeProtocols(all);
    res.json({ success: true, entry });
  } catch (e) {
    console.error("❌ Sign save error:", e);
    res.status(500).json({ error: "Failed to save signatures" });
  }
});

app.post("/protocols/:clientId/:month/:index/return", (req, res) => {
  try {
    const { clientId, month, index } = req.params;
    const idx = Number(index);
    const body = req.body || {};

    const all = readProtocols();
    const proto = all.find((p) => p.id === clientId && p.month === month);
    if (!proto) return res.status(404).json({ error: "Protocol not found" });

    const entry = proto.entries[idx];
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    if (
      typeof body.returnDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.returnDate)
    ) {
      entry.returnDate = body.returnDate;
    }

    if (body.matchTransfer) {
      const src = Array.isArray(entry.tools) ? entry.tools : [];
      entry.returnTools = src.map((t) => ({
        name: String(t?.name || "").trim(),
        count: Number(t?.count || 0) || 0,
      }));
      entry.returnPackages = Number(
        body.returnPackages != null ? body.returnPackages : entry.packages || 0
      );
    } else if (Array.isArray(body.tools)) {
      entry.returnTools = body.tools.map((t) => ({
        name: String(t?.name || "").trim(),
        count: Number(t?.count || 0) || 0,
      }));
      if (body.returnPackages != null) {
        entry.returnPackages = Number(body.returnPackages) || 0;
      }
    } else if (body.returnPackages != null) {
      entry.returnPackages = Number(body.returnPackages) || 0;
    }

    if (
      body.returnDelivery == null ||
      ["odbior", "dowoz", "odbior+dowoz", null].includes(body.returnDelivery)
    ) {
      entry.returnDelivery =
        body.returnDelivery === undefined
          ? entry.returnDelivery
          : body.returnDelivery;
    }
    if (typeof body.returnShipping === "boolean") {
      entry.returnShipping = !!body.returnShipping;
    }

    writeProtocols(all);
    const totals = computeMonthlyTotals(proto);
    res.json({ success: true, entry, protocol: { ...proto, totals } });
  } catch (e) {
    console.error("❌ Return save error:", e);
    res.status(500).json({ error: "Failed to save return info" });
  }
});

app.post("/protocols/:clientId/:month/return/bulk", (req, res) => {
  try {
    const { clientId, month } = req.params;
    const { indices, returnDate } = req.body || {};
    if (!Array.isArray(indices) || !indices.length) {
      return res
        .status(400)
        .json({ error: "indices must be a non-empty array" });
    }
    if (
      typeof returnDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)
    ) {
      return res.status(400).json({ error: "Invalid returnDate" });
    }

    const all = readProtocols();
    const proto = all.find((p) => p.id === clientId && p.month === month);
    if (!proto) return res.status(404).json({ error: "Protocol not found" });

    for (const i of indices) {
      const idx = Number(i);
      if (!Number.isInteger(idx)) continue;
      const entry = proto.entries[idx];
      if (!entry) continue;
      entry.returnDate = returnDate;
    }

    writeProtocols(all);
    const totals = computeMonthlyTotals(proto);
    res.json({ success: true, protocol: { ...proto, totals } });
  } catch (e) {
    console.error("❌ Bulk returnDate update error:", e);
    res.status(500).json({ error: "Failed to bulk update returnDate" });
  }
});

app.patch("/protocols/:clientId/:month/:index", (req, res) => {
  try {
    const { clientId, month, index } = req.params;
    const idx = Number(index);
    const {
      date,
      comment,
      returnDate,
      returnTools,
      returnPackages,
      returnDelivery,
      returnShipping,
    } = req.body || {};

    const all = readProtocols();
    const proto = all.find((p) => p.id === clientId && p.month === month);
    if (!proto) return res.status(404).json({ error: "Protocol not found" });

    const entry = proto.entries[idx];
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      entry.date = date;
    }
    if (typeof comment === "string") {
      entry.comment = comment;
    }
    if (
      typeof returnDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(returnDate)
    ) {
      entry.returnDate = returnDate;
    }
    if (Array.isArray(returnTools)) {
      entry.returnTools = returnTools
        .filter((t) => t && (t.name || t.nazwa))
        .map((t) => ({
          name: String(t.name || t.nazwa || "").trim(),
          count: Number(t.count || t.ilosc || 0) || 0,
        }));
    }
    if (
      returnPackages !== undefined &&
      returnPackages !== null &&
      Number.isFinite(Number(returnPackages))
    ) {
      entry.returnPackages = Number(returnPackages);
    }
    if (returnDelivery === null || returnDelivery === undefined) {
      // skip
    } else if (
      ["odbior", "dowoz", "odbior+dowoz", ""].includes(String(returnDelivery))
    ) {
      entry.returnDelivery = returnDelivery || null;
    }
    if (typeof returnShipping === "boolean") {
      entry.returnShipping = !!returnShipping;
    }

    writeProtocols(all);
    const totals = computeMonthlyTotals(proto);
    res.json({ success: true, protocol: { ...proto, totals }, entry });
  } catch (e) {
    console.error("❌ Patch entry error:", e);
    res.status(500).json({ error: "Failed to patch protocol entry" });
  }
});

/* -----------------------------
 * EXPORT .EPP (InsERT GT/Nexo)
 * ----------------------------- */
app.post("/export-epp", (req, res) => {
  try {
    const { files } = req.body || {};
    const all = fs.existsSync(INVOICES_FILE)
      ? JSON.parse(fs.readFileSync(INVOICES_FILE, "utf8"))
      : [];
    const selected =
      Array.isArray(files) && files.length
        ? all.filter(
            (inv) => files.includes(inv.filename) || files.includes(inv.number)
          )
        : all;

    const txt = generateEPPContent(selected);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="export.epp"');
    res.end(Buffer.from(txt, "utf8"));
  } catch (e) {
    console.error("❌ EPP export error:", e);
    res.status(500).json({ error: "Błąd eksportu EPP" });
  }
});

/* -----------------------------
 * START
 * ----------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Backend running on http://localhost:${PORT}`)
);
