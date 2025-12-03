// invoices.list.pdf.js
// Eksport listy faktur do PDF (A4 landscape), dane z MySQL (fallback: data/invoices.json)

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const dayjs = require("dayjs");

// 1) Źródła danych
let invoicesRepo = null;
try {
  // DB (MySQL)
  invoicesRepo = require("./server/repos/invoicesRepo.js");
} catch {
  // brak repo — będzie fallback do JSON
}

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const INVOICES_FILE = path.join(DATA_DIR, "invoices.json");

// 2) Fonty DejaVu (PL znaki)
const ABS_HINTS_REG = [
  process.env.DEJAVU_SANS_REGULAR,
  path.join(process.cwd(), "public", "fonts", "DejaVuSans.ttf"),
  path.join(ROOT, "public", "fonts", "DejaVuSans.ttf"),
  path.join(ROOT, "assets", "DejaVuSans.ttf"),
];
const ABS_HINTS_BOLD = [
  process.env.DEJAVU_SANS_BOLD,
  path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf"),
  path.join(ROOT, "public", "fonts", "DejaVuSans-Bold.ttf"),
  path.join(ROOT, "assets", "DejaVuSans-Bold.ttf"),
];

const CANDIDATE_FONT_DIRS = [
  process.env.FONT_DIR && path.resolve(process.env.FONT_DIR),
  path.join(ROOT, "fonts"),
  path.join(ROOT, "public", "fonts"),
  path.join(ROOT, "..", "public", "fonts"),
  path.join(process.cwd(), "public", "fonts"),
].filter(Boolean);

function findFontFileByBasename(basename) {
  for (const dir of CANDIDATE_FONT_DIRS) {
    const p = path.join(dir, basename);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function pickFontPath(hintsAbs, fallbackBasename) {
  for (const p of hintsAbs) {
    if (p && fs.existsSync(p)) return p;
  }
  return fallbackBasename ? findFontFileByBasename(fallbackBasename) : null;
}

let FONT_REGULAR = pickFontPath(ABS_HINTS_REG, "DejaVuSans.ttf");
let FONT_BOLD = pickFontPath(ABS_HINTS_BOLD, "DejaVuSans-Bold.ttf");
let USE_FAKE_BOLD = false;
if (!FONT_BOLD && FONT_REGULAR) {
  FONT_BOLD = FONT_REGULAR;
  USE_FAKE_BOLD = true;
}
if (!FONT_REGULAR) {
  const tried = [
    ...ABS_HINTS_REG,
    ...CANDIDATE_FONT_DIRS.map((d) => path.join(d || "", "DejaVuSans.ttf")),
  ]
    .filter(Boolean)
    .join("\n - ");
  throw new Error(
    "Nie znaleziono DejaVuSans.ttf (wymagany do polskich znaków).\n" +
      "Sprawdzono:\n - " +
      tried
  );
}

// 3) Utils
function readJsonOrDefault(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw || !raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
const to2 = (x) => Number(String(x ?? 0).replace(",", ".")).toFixed(2);
const plMoney = (n) => to2(n).replace(".", ",");
const makeBreakable = (s) =>
  String(s ?? "")
    .replace(/\//g, "/\u200b")
    .replace(/-/g, "-\u200b")
    .replace(/([^\s]{16})(?=[^\s])/g, "$1\u200b");

function mapDbInvoiceRow(row) {
  let items = [];
  try {
    items = JSON.parse(row.items_json || "[]");
  } catch {}
  return {
    number: row.number,
    client: row.clientName,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    net: row.net,
    gross: row.gross,
    filename: row.filename,
    folder: row.folder,
    items,
    buyer_address: row.buyer_address,
    buyer_nip: row.buyer_nip,
    buyer_pesel: row.buyer_pesel,
    status: row.status, // "issued" | "paid" | "overdue"
  };
}

function normalizeFromJson(inv) {
  // struktura zgodna ze starym data/invoices.json
  return {
    number: inv.number || "",
    client: inv.client || "",
    issueDate: inv.issueDate || inv.issue_date || "",
    dueDate: inv.dueDate || inv.due_date || "",
    net: inv.net || 0,
    gross: inv.gross || 0,
    filename:
      inv.filename ||
      `Faktura_${String(inv.number || "").replaceAll("/", "_")}.pdf`,
    status: inv.status || "issued",
  };
}

// 4) Główna funkcja HTTP
async function createInvoiceListPDF(req, res) {
  try {
    // 4.1 Pobierz wszystkie faktury
    let all = [];
    if (invoicesRepo && typeof invoicesRepo.queryAllInvoices === "function") {
      const rows = await invoicesRepo.queryAllInvoices();
      all = rows.map(mapDbInvoiceRow);
    } else {
      // fallback: JSON (legacy)
      all = readJsonOrDefault(INVOICES_FILE, []).map(normalizeFromJson);
    }

    // 4.2 Filtrowanie wg req.body.files (opcjonalnie, ale bardziej odporne)
    const selectedListRaw = Array.isArray(req.body?.files)
      ? req.body.files
      : null;
    const selectedList = selectedListRaw
      ? selectedListRaw.map((x) => String(x || "").trim())
      : null;

    let selected = all;

    if (selectedList && selectedList.length) {
      selected = all.filter((i) => {
        const num = String(i.number || "").trim();
        const fname = String(i.filename || "").trim();
        const canonical = `Faktura_${num.replaceAll("/", "_")}.pdf`;

        return selectedList.some((entry) => {
          const e = String(entry || "").trim();
          if (!e) return false;

          // точні збіги
          if (e === num || e === fname || e === canonical) return true;

          // коли прилітає шлях типу "2025/11/Faktura_..."
          if (e.endsWith("/" + fname) || e.endsWith("/" + canonical))
            return true;

          return false;
        });
      });

      // якщо нічого не знайшли, але фронт щось прислав – краще віддати всі, ніж 404
      if (!selected.length) {
        selected = all;
      }
    }

    if (!selected.length) {
      // крайній випадок – взагалі немає жодної фактури в БД/JSON
      return res
        .status(404)
        .json({ error: "Nie znaleziono faktur do eksportu" });
    }

    // 4.3 Dane wierszy (z miękkimi podziałami)
    const rows = selected.map((inv) => {
      const number = String(inv.number || "");
      const title = makeBreakable(`Faktura ${number}`);
      const client = makeBreakable(String(inv.client || ""));
      const issue = String(inv.issueDate || "").slice(0, 10);
      const due = String(inv.dueDate || "").slice(0, 10);

      const netNum = Number(String(inv.net || 0).replace(",", "."));
      const grossNum = Number(String(inv.gross || 0).replace(",", "."));
      const vatNum =
        Number.isFinite(netNum) && Number.isFinite(grossNum)
          ? grossNum - netNum
          : 0;

      const net = plMoney(netNum);
      const gross = plMoney(grossNum);
      const vat = plMoney(vatNum);

      const status = String(inv.status || "issued")
        .replace("issued", "wystawiona")
        .replace("paid", "opłacona")
        .replace("overdue", "przeterminowana");

      return { title, client, issue, due, net, vat, gross, status };
    });

    // 4.4 Nagłówki odpowiedzi i inicjalizacja PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="lista_faktur.pdf"'
    );

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 36, // 0.5"
      bufferPages: true,
    });
    doc.pipe(res);

    // 4.5 Fonty
    doc.registerFont("Regular", FONT_REGULAR);
    doc.registerFont("Bold", FONT_BOLD);
    doc.font("Regular");

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = doc.page.margins.left;
    const usableW = pageW - margin - doc.page.margins.right;

    // 4.6 Tytuł
    doc
      .font(USE_FAKE_BOLD ? "Regular" : "Bold")
      .fontSize(USE_FAKE_BOLD ? 18 : 16);
    doc.fillColor("#000").text("Lista faktur", { align: "left" });

    doc.moveDown(0.2);
    doc
      .font("Regular")
      .fontSize(9)
      .fillColor("#444")
      .text(`Wygenerowano: ${dayjs().format("YYYY-MM-DD HH:mm")}`);
    doc.moveDown(0.6).fillColor("#000");

    // 4.7 Kolumny
    // Доступна ширина на A4 landscape з полями 36pt: ~ 841.89 - 72 ≈ 770pt.
    // Тримаймо суму колонок ~758pt, щоб не було переливань.
    const columns = [
      { key: "lp", header: "Lp.", w: 28, align: "right" },
      { key: "title", header: "Numer / Tytuł", w: 110, align: "left" },
      { key: "client", header: "Klient", w: 200, align: "left" },
      { key: "issue", header: "Wystawiono", w: 70, align: "center" },
      { key: "due", header: "Termin płatności", w: 80, align: "center" },
      { key: "net", header: "Kwota netto (zł)", w: 70, align: "right" },
      { key: "vat", header: "VAT (zł)", w: 60, align: "right" },
      { key: "gross", header: "Kwota brutto (zł)", w: 80, align: "right" },
      { key: "status", header: "Status", w: 60, align: "center" },
    ];
    const totalW = columns.reduce((s, c) => s + c.w, 0); // 758
    const x0 = margin;
    let y = doc.y + 4;

    function drawHeader() {
      const headerH = 36; // збільшив висоту
      doc.save();
      doc
        .roundedRect(x0, y, totalW, headerH, 4)
        .fill("#f0f3f8")
        .stroke("#e1e7f0");

      doc
        .fillColor("#000")
        .font(USE_FAKE_BOLD ? "Regular" : "Bold")
        .fontSize(9); // менший шрифт у шапці

      let cx = x0;
      for (const c of columns) {
        // трохи більше верхній відступ, щоб по центру виглядало
        doc.text(c.header, cx + 6, y + 10, { width: c.w - 12, align: c.align });
        cx += c.w;
      }
      doc.restore();

      y += headerH;
      doc
        .moveTo(x0, y)
        .lineTo(x0 + totalW, y)
        .lineWidth(0.5)
        .strokeColor("#c8d1e0")
        .stroke();
      doc.font("Regular").fontSize(9).fillColor("#000");
    }

    function pageBottom() {
      return pageH - doc.page.margins.bottom;
    }
    function ensurePage(nextRowH) {
      if (y + nextRowH > pageBottom()) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 36 });
        y = doc.y;
        drawHeader();
      }
    }

    drawHeader();

    // 4.9 Wiersze
    let sumNet = 0,
      sumVat = 0,
      sumGross = 0;

    rows.forEach((r, i) => {
      const row = {
        lp: String(i + 1),
        title: r.title,
        client: r.client,
        issue: r.issue,
        due: r.due,
        net: r.net,
        vat: r.vat,
        gross: r.gross,
        status: r.status,
      };

      sumNet += Number(String(r.net || "0").replace(",", ".")) || 0;
      sumVat += Number(String(r.vat || "0").replace(",", ".")) || 0;
      sumGross += Number(String(r.gross || "0").replace(",", ".")) || 0;

      // Висота рядка з обчисленням переносу
      let maxH = 0;
      doc.save();
      doc.font("Regular").fontSize(9);
      for (const c of columns) {
        const txt = String(row[c.key] ?? "");
        const h = doc.heightOfString(txt, { width: c.w - 12, align: c.align });
        maxH = Math.max(maxH, h);
      }
      doc.restore();

      const padY = 6;
      const rowH = Math.max(18, Math.ceil(maxH + padY * 2));
      ensurePage(rowH);

      if (i % 2 === 1) {
        doc.save();
        doc.rect(x0, y, totalW, rowH).fill("#fafbfc");
        doc.restore();
      }

      // Текст клітинок
      doc.font("Regular").fontSize(9).fillColor("#000");
      let cx = x0;
      for (const c of columns) {
        const txt = String(row[c.key] ?? "");
        doc.text(txt, cx + 6, y + padY, {
          width: c.w - 12,
          align: c.align,
          lineBreak: true,
        });
        cx += c.w;
      }

      doc
        .moveTo(x0, y + rowH)
        .lineTo(x0 + totalW, y + rowH)
        .lineWidth(0.3)
        .strokeColor("#e6eaf0")
        .stroke();

      y += rowH;
    });

    // 4.10 Podsumowanie
    const labelW = columns.slice(0, 5).reduce((s, c) => s + c.w, 0);
    ensurePage(28);

    // etykieta
    doc
      .font(USE_FAKE_BOLD ? "Regular" : "Bold")
      .fontSize(USE_FAKE_BOLD ? 11 : 10)
      .text("Razem:", x0, y + 6, {
        width: labelW - 12,
        align: "right",
      });

    // wartości
    function writeSum(val, colIdx) {
      const c = columns[colIdx];
      const cx = x0 + columns.slice(0, colIdx).reduce((s, cc) => s + cc.w, 0);
      doc.text(plMoney(val), cx + 6, y + 6, {
        width: c.w - 12,
        align: "right",
      });
    }
    writeSum(sumNet, 5);
    writeSum(sumVat, 6);
    writeSum(sumGross, 7);

    // koniec
    doc.end();
  } catch (e) {
    console.error("❌ PDF list error:", e);
    try {
      res.status(500).json({ error: "Błąd generowania PDF listy" });
    } catch {}
  }
}

module.exports = { createInvoiceListPDF };
