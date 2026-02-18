// clients.kartoteka.pdf.js
const fs = require("fs");
const path = require("path");
const { query: sql } = require("./server/db.js");
const PDFDocument = require("pdfkit");

// DB loader
async function loadClientsFromDB() {
  const rows = await sql(
    `
    SELECT
      id,
      name,
      address,
      type,
      nip,
      pesel,
      email,
      phone,
      billingMode,
      logistics,
      subscription        AS subscription,         -- текстова назва абонементу
      subscriptionAmount  AS subscription_quota,   -- квота/ліміт
      agreementStart      AS signed_at,            -- дата підписання
      agreementEnd        AS expires_at,           -- дата закінчення
      archived
    FROM clients
    ORDER BY name ASC
    `
  );

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    address: c.address || "",
    type: c.type || "op",
    nip: c.nip || "",
    pesel: c.pesel || "",
    email: c.email || "",
    phone: c.phone || "",
    billingMode: c.billingMode || "",
    subscription: c.subscription || "",
    subscription_quota: Number(c.subscription_quota || 0),
    signed_at: c.signed_at || null,
    expires_at: c.expires_at || null,
    archived: !!c.archived,
  }));
}

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");

/* ===== helpers ===== */
function readJsonOrDefault(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function findFirstExisting(paths) {
  for (const p of paths) if (p && fs.existsSync(p)) return p;
  return null;
}
function normClient(c) {
  const type = (c?.type || "op").toLowerCase() === "firma" ? "firma" : "op";
  const id = String(
    c?.id ??
      c?.ID ??
      c?.Id ??
      c?.iD ??
      c?.["Id"] ??
      c?.["ID "] ??
      c?.[" id"] ??
      ""
  ).trim();
  const name = String(c?.name || c?.Klient || "").trim();
  const address = String(c?.address || c?.Adres || "").trim();
  const nip = String(c?.nip || c?.NIP || "").trim();
  const pesel = String(c?.pesel || c?.PESEL || "").trim();
  const email = String(c?.email || c?.Email || "").trim();
  const phone = String(c?.phone ?? c?.Telefon ?? "").trim();
  const billingMode = (c?.billingMode || "").toLowerCase();
  const archived = !!c?.archived;
  const subscription = c?.subscription ?? c?.Abonament ?? c?.abonament ?? "";

  return {
    id: id || name || "-",
    name,
    type,
    idnum: nip || pesel || "",
    address,
    phone,
    email,
    billingMode,
    archived,
    hasAbon: !!String(subscription).trim(),
  };
}
function trunc(doc, text, width, fontName, fontSize) {
  const s = String(text ?? "");
  if (!s) return "";
  doc.font(fontName).fontSize(fontSize);
  const w = doc.widthOfString(s);
  if (w <= width) return s;
  const ell = "…";
  const ellW = doc.widthOfString(ell);
  if (ellW >= width) return "";
  let lo = 0,
    hi = s.length;
  while (lo < hi) {
    const mid = ((lo + hi + 1) / 2) | 0;
    const sub = s.slice(0, mid);
    if (doc.widthOfString(sub) + ellW <= width) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + ell;
}

/* ===== main ===== */
async function createClientsKartotekaPDF(req, res) {
  const all = (await loadClientsFromDB()).map(normClient);

  // 👉 якщо передали список clientIds — працюємо тільки з ними
  const pickedIds = Array.isArray(req.body?.clientIds)
    ? req.body.clientIds.map(String)
    : null;

  let rows = all.filter(
    (c) => !c.archived && (c.billingMode === "abonament" || c.hasAbon)
  );

  if (pickedIds && pickedIds.length) {
    rows = rows.filter((c) => pickedIds.includes(String(c.id)));

    // ✅ сортування ТІЛЬКИ для вибраних клієнтів — за назвою
    rows.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "pl", {
        sensitivity: "base",
        numeric: true,
      })
    );
  }

  if (!rows.length) {
    return res
      .status(404)
      .json({ error: "Brak klientów abonamentowych do wydruku." });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="kartoteka_${pickedIds ? "wybrani" : "wszyscy"}.pdf"`
  );

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32 });
  doc.pipe(res);

  // шрифти
  const fontRegular = findFirstExisting([
    path.join(__dirname, "assets", "DejaVuSans.ttf"),
    path.join(__dirname, "public", "fonts", "DejaVuSans.ttf"),
    path.join(process.cwd(), "public", "fonts", "DejaVuSans.ttf"),
  ]);
  const fontBold = findFirstExisting([
    path.join(__dirname, "assets", "DejaVuSans-Bold.ttf"),
    path.join(__dirname, "public", "fonts", "DejaVuSans-Bold.ttf"),
    path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf"),
    fontRegular,
  ]);
  if (fontRegular) doc.registerFont("Regular", fontRegular);
  if (fontBold) doc.registerFont("Bold", fontBold);
  const F_REG = fontRegular ? "Regular" : "Helvetica";
  const F_BOLD = fontBold ? "Bold" : "Helvetica-Bold";

  /* ===== шапка ===== */
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const today = new Date().toISOString().slice(0, 10);

  doc.font(F_BOLD).fontSize(16).text("Kartoteka klientów Steryl Serwis", {
    align: "center",
  });
  doc.moveDown(0.6);

  const left = [
    "Nazwa firmy: Correct Solution sp. z o.o.",
    "Adres: os. Dywizjonu 303 62F, 31-875 Kraków",
    "NIP: 6751516747",
  ].join("\n");
  const right = `Data aktualizacji: ${today}`;

  const colW = Math.floor(pageW / 2) - 8;
  const x0 = doc.x;
  const y0 = doc.y;

  doc.font(F_REG).fontSize(11);
  doc.text(left, x0, y0, { width: colW, align: "left" });
  doc.text(right, x0 + colW + 16, y0, { width: colW, align: "right" });

  const leftH = doc.heightOfString(left, { width: colW, align: "left" });
  const rightH = doc.heightOfString(right, { width: colW, align: "right" });
  const firmBlockBottom = y0 + Math.max(leftH, rightH);
  doc.y = firmBlockBottom + 20;

  /* ===== таблиця ===== */
  const cols = [
    { key: "idx", title: "#", w: 40, align: "center" },
    { key: "id", title: "ID klienta", w: 90, align: "left" },
    { key: "name", title: "Nazwa klienta", w: 150, align: "left" },
    { key: "type", title: "Typ", w: 80, align: "center" },
    { key: "idnum", title: "NIP/PESEL", w: 130, align: "left" },
    { key: "address", title: "Adres", w: 208, align: "left" },
    { key: "phone", title: "Telefon", w: 80, align: "left" },
  ];
  const totalW = cols.reduce((a, c) => a + c.w, 0);
  const startX = x0;
  let y = doc.y;

  const headerH = 24;
  doc
    .roundedRect(startX, y, totalW, headerH, 4)
    .fillAndStroke("#f1f5f9", "#e5e7eb");
  doc.fillColor("#111827").font(F_BOLD).fontSize(10.5);
  let cx = startX + 8;
  cols.forEach((c) => {
    doc.text(c.title, cx, y + 7, { width: c.w - 16, align: c.align || "left" });
    cx += c.w;
  });
  y += headerH + 10;

  doc.font(F_REG).fillColor("#111827").fontSize(9.5);
  const PAD_Y = 6;
  const PAD_X = 8;

  function drawHeader() {
    doc
      .roundedRect(startX, y, totalW, headerH, 4)
      .fillAndStroke("#f1f5f9", "#e5e7eb");
    doc.fillColor("#111827").font(F_BOLD).fontSize(10.5);
    let hx = startX + 8;
    cols.forEach((c) => {
      doc.text(c.title, hx, y + 7, {
        width: c.w - 16,
        align: c.align || "left",
      });
      hx += c.w;
    });
    y += headerH + 10;
    doc.font(F_REG).fillColor("#111827").fontSize(9.5);
  }

  function ensurePage(nextRowHeight) {
    const bottom = doc.page.height - doc.page.margins.bottom;
    if (y + nextRowHeight + 10 > bottom) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 32 });
      y = doc.y;
      drawHeader();
    }
  }

  rows.forEach((r, i) => {
    const cellTexts = cols.map((c) => {
      if (c.key === "idx") return String(i + 1);
      if (c.key === "type")
        return r.type === "firma" ? "firma" : "os. prywatna";
      return String(r[c.key] || "");
    });

    const cellHeights = cellTexts.map((txt, idx) => {
      const c = cols[idx];
      return doc.heightOfString(txt, {
        width: c.w - PAD_X * 2,
        align: c.align || "left",
      });
    });

    const textBlockH = Math.max(...cellHeights);
    const rowH = Math.max(textBlockH + PAD_Y * 2, 22);

    ensurePage(rowH);

    if (i % 2 === 0) {
      doc.rect(startX, y, totalW, rowH).fill("#e5e7eb");
      doc.fillColor("#111827");
    }

    let cellX = startX + PAD_X;
    cellTexts.forEach((txt, idx) => {
      const c = cols[idx];
      doc.text(txt, cellX, y + PAD_Y, {
        width: c.w - PAD_X * 2,
        align: c.align || "left",
      });
      cellX += c.w;
    });

    y += rowH;
  });

  doc.end();
}

module.exports = { createClientsKartotekaPDF };
