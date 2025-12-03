// invoice.pdfkit.cjs
// Drop-in генератор PDF без Puppeteer,
// зчитує вашу розмітку/templates та стилі з invoice.css і відтворює макет у PDFKit.

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

// --- Rendering defaults (повертаємо як було) ---
const FORCE_BLACK_STROKES = false; // рамки знову світло-сірі
const HEADER_SHADE = true; // шапка таблиці з сірим фоном, як було раніше
const SELLER_BOX_SHADE = false; // НОВЕ: вимкнути сірий фон у блоці "Sprzedawca" (щоб не давав «зерно»)

// ---------- Utils ----------
function findFirst(paths) {
  for (const p of paths) if (p && fs.existsSync(p)) return p;
  return null;
}
function ensureDir(p) {
  const d = path.dirname(p);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
function safeName(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_");
}
function to2(n) {
  const v = Number(String(n ?? 0).replace(",", "."));
  return Number.isFinite(v) ? v.toFixed(2) : "0.00";
}
function pl(n) {
  return to2(n).replace(".", ",");
}
function val(x, ...alts) {
  for (const k of [x, ...alts]) {
    if (k != null && String(k).trim() !== "") return String(k);
  }
  return "";
}

// прибрати зайві нулі з відсотків: "23.00%" -> "23%", "5.50%" -> "5.5%"
function cleanPercent(v) {
  if (v == null || v === "") return "";
  let s = String(v).trim().replace(",", ".").replace(/%$/, "");
  const num = Number(s);
  if (!Number.isFinite(num)) return String(v).replace(/\s+/g, "");
  let out = String(num);
  if (out.includes(".")) {
    out = out.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }
  return out + "%";
}

// --- amount-in-words fallback (PL) ---
function _formPL(n, forms) {
  if (n === 1) return forms[0];
  const u = n % 10,
    t = n % 100;
  if (u >= 2 && u <= 4 && !(t >= 12 && t <= 14)) return forms[1];
  return forms[2];
}
function _triplet(n) {
  const U = [
    "",
    "jeden",
    "dwa",
    "trzy",
    "cztery",
    "pięć",
    "sześć",
    "siedem",
    "osiem",
    "dziewięć",
  ];
  const T = [
    "",
    "",
    "dwadzieścia",
    "trzydzieści",
    "czterdzieści",
    "pięćdziesiąt",
    "sześćdziesiąt",
    "siedemdziesiąt",
    "osiemdziesiąt",
    "dziewięćdziesiąt",
  ];
  const TE = [
    "dziesięć",
    "jedenaście",
    "dwanaście",
    "trzynaście",
    "czternaście",
    "piętnaście",
    "szesnaście",
    "siedemnaście",
    "osiemnaście",
    "dziewiętnaście",
  ];
  const H = [
    "",
    "sto",
    "dwieście",
    "trzysta",
    "czterysta",
    "pięćset",
    "sześćset",
    "siedemset",
    "osiemset",
    "dziewięćset",
  ];
  const s = [];
  const h = Math.floor(n / 100),
    d = Math.floor((n % 100) / 10),
    u = n % 10;
  if (h) s.push(H[h]);
  if (d === 1) s.push(TE[u]);
  else {
    if (d) s.push(T[d]);
    if (u) s.push(U[u]);
  }
  return s.join(" ").trim();
}
function _intWords(n) {
  if (n === 0) return "zero";
  const G = [
    null,
    ["tysiąc", "tysiące", "tysięcy"],
    ["milion", "miliony", "milionów"],
    ["miliard", "miliardy", "miliardów"],
  ];
  const parts = [];
  let g = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) {
      if (g === 1 && chunk === 1) parts.unshift("tysiąc");
      else if (g === 0) parts.unshift(_triplet(chunk));
      else parts.unshift((_triplet(chunk) + " " + _formPL(chunk, G[g])).trim());
    }
    n = Math.floor(n / 1000);
    g++;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
function amountInWordsPL(amount) {
  const s = String(amount ?? "")
    .replace(/\./g, "")
    .replace(",", ".");
  const v = Number(s);
  if (!isFinite(v)) return "";
  const totalGr = Math.round(v * 100);
  const zl = Math.floor(totalGr / 100);
  const gr = totalGr % 100;
  const zlForms = ["złoty", "złote", "złotych"];
  return `${_intWords(zl)} ${_formPL(zl, zlForms)} ${String(gr).padStart(
    2,
    "0"
  )}/100`;
}

// ---------- CSS intake (read from your file & pick needed sizes) ----------
function cssGet(css, selector, prop, fallback) {
  // дуже простий парсер: шукає "selector { ... prop: value; ... }"
  const selRx = new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([\\s\\S]*?)\\}",
    "i"
  );
  const m = css.match(selRx);
  if (!m) return fallback;
  const body = m[1];
  const prx = new RegExp(
    prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:\\s*([^;]+);",
    "i"
  );
  const p = body.match(prx);
  return p ? p[1].trim() : fallback;
}
function cssPxNum(v, fallbackNum) {
  if (!v) return fallbackNum;
  const m = String(v).match(/([\d.]+)/);
  return m ? Number(m[1]) : fallbackNum;
}

// ---------- Fonts ----------
const FONT_REGULAR = findFirst([
  path.join(process.cwd(), "public", "fonts", "DejaVuSans.ttf"),
  path.join(__dirname, "..", "public", "fonts", "DejaVuSans.ttf"),
  path.join(__dirname, "public", "fonts", "DejaVuSans.ttf"),
]);
const FONT_BOLD = findFirst([
  path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf"),
  path.join(__dirname, "..", "public", "fonts", "DejaVuSans-Bold.ttf"),
  path.join(__dirname, "public", "fonts", "DejaVuSans-Bold.ttf"),
  FONT_REGULAR,
]);

// ---------- Main ----------
async function generateInvoicePDF(input, outputPath) {
  if (!FONT_REGULAR) throw new Error("Brak DejaVuSans.ttf (public/fonts)");
  // де лежать ваші шаблони/стилі
  const TPL_DIR = path.join(__dirname, "templates");
  const HTML_PATH = path.join(TPL_DIR, "invoice.html");
  const CSS_PATH = path.join(TPL_DIR, "invoice.css");
  if (!fs.existsSync(HTML_PATH)) throw new Error(`Brak szablonu: ${HTML_PATH}`);
  if (!fs.existsSync(CSS_PATH)) throw new Error(`Brak stylów: ${CSS_PATH}`);
  const cssText = fs.readFileSync(CSS_PATH, "utf8");

  // зчитуємо потрібні розміри зі стилів (ваші значення)
  const baseFontSize = cssPxNum(
    cssGet(cssText, "body", "font-size", "10px"),
    10
  );
  const invTitleSize = cssPxNum(
    cssGet(cssText, ".inv-title", "font-size", "14px"),
    14
  );
  const invNumberSize = cssPxNum(
    cssGet(cssText, ".inv-number", "font-size", "24px"),
    24
  );
  const bigTotalSize = cssPxNum(
    cssGet(cssText, ".big-total", "font-size", "20px"),
    20
  );

  // Дані з підтримкою camelCase/snake_case/PL-ключів
  const data = {
    number: val(input.number),
    place: val(
      input.place,
      input.place_of_issue,
      input.issue_place,
      input.issuePlace,
      input.miejsce_wystawienia,
      input.place_name,
      input.placeName,
      input.location,
      input.city,
      input.place_of_issue_name,
      input.miejsce
    ),

    issue_date: val(
      input.issue_date,
      input.issueDate,
      input.date_of_issue,
      input.data_wystawienia
    ),

    sale_date: val(input.sale_date, input.date_of_sale, input.data_sprzedazy),
    due_date: val(
      input.due_date,
      input.termin_platnosci,
      input.payment_due,
      input.termin
    ),

    seller_name: val(input.seller_name, input.sellerName),
    seller_address: val(input.seller_address, input.sellerAddress),
    seller_nip: val(input.seller_nip, input.sellerNip),

    buyer_name: val(input.buyer_name, input.buyerName),
    buyer_address: val(input.buyer_address, input.buyerAddress),
    buyer_identifier: val(input.buyer_identifier, input.buyerId),
    buyer_nip: val(input.buyer_nip, input.buyerNip),

    net_sum: val(input.net_sum, input.net),
    vat_sum: val(input.vat_sum, input.vat),
    gross_sum: val(input.gross_sum, input.gross),

    amount_due: val(input.amount_due, input.kwota_do_zaplaty, input.do_zaplaty),
    amount_in_words: val(
      input.amount_in_words,
      input.amountInWords,
      input.kwota_slownie,
      input.slownie
    ),
    paid_amount: val(input.paid_amount, input.paidAmount, input.zaplacono),
    payment_method: val(input.payment_method, input.paymentMethod, "Przelew"),
    bank: val(
      input.bank,
      input.bank_name,
      input.seller_bank,
      "Bank Pekao S.A."
    ),
    account: val(
      input.account,
      input.account_number,
      input.iban,
      input.konto,
      input.seller_account,
      "97 1240 4533 1111 0010 8767 4627"
    ),
    issuer: val(
      input.issuer,
      input.wystawil,
      input["wystawił"],
      input.issued_by,
      "Pracownik"
    ),

    items: Array.isArray(input.items) ? input.items : [],
  };
  // дефолт для місця виставлення, якщо його немає в даних
  if (!data.place) data.place = "Kraków";

  // нормалізація сум та Słownie — завжди словами + PLN
  if (!data.amount_due) data.amount_due = data.gross_sum || "";

  const looksNumeric = /^[\s\d.,]+(?:\s*pln)?$/i.test(
    String(data.amount_in_words || "")
  );
  const wordsBase = data.amount_due || data.gross_sum || "";
  const wordsPL = amountInWordsPL(wordsBase);

  // якщо Słownie порожнє або виглядає як число — перерахувати словами і додати PLN
  if (!data.amount_in_words || looksNumeric) {
    data.amount_in_words = `${wordsPL}`;
  } else if (!/pln/i.test(data.amount_in_words)) {
    // якщо користувач передав слова без PLN — додамо PLN
    data.amount_in_words = `${String(data.amount_in_words).trim()} PLN`;
  }

  // вихідний шлях
  const numSafe = safeName(data.number || "Faktura");
  const finalPath = path.join(
    path.dirname(outputPath),
    `Faktura_${numSafe}.pdf`
  );
  ensureDir(finalPath);

  // PDF
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 20, left: 20, right: 20, bottom: 28 }, // як у CSS body margin
  });
  const ws = fs.createWriteStream(finalPath);
  doc.pipe(ws);

  doc.fillColor("#000");

  // fonts
  doc.registerFont("Regular", FONT_REGULAR);
  doc.registerFont("Bold", FONT_BOLD || FONT_REGULAR);

  // ----- Header (праворуч, як у вашій HTML) -----
  doc
    .font("Regular")
    .fontSize(invTitleSize)
    .fillColor("#333")
    .text("FAKTURA VAT numer", { align: "right" });
  doc.moveDown(0.1);
  doc
    .font("Regular")
    .fontSize(invNumberSize)
    .text((data.number || "").toUpperCase(), { align: "right" });
  doc.moveDown(0.4);

  const pageRight = doc.page.width - doc.page.margins.right;
  const metaFontSize = 9;
  const gap = 8; // відступ між підписом і значенням

  function rightMetaLine(label, value) {
    const valStr = String(value || "");
    const startY = doc.y;

    // 1) значення — рівно притиснене до правого краю
    doc.font("Regular").fontSize(metaFontSize);
    const valW = doc.widthOfString(valStr);
    const valX = pageRight - valW;
    doc.text(valStr, valX, startY, { continued: false });

    // 2) підпис — праворуч, закінчується за gap до значення
    const labelMaxW = valX - gap - doc.page.margins.left;
    doc.font("Regular").fontSize(metaFontSize);
    doc.text(label, doc.page.margins.left, startY, {
      width: Math.max(labelMaxW, 0),
      align: "right",
    });

    // 3) коректний перехід на наступний рядок (без налазань)
    const hVal = doc.heightOfString(valStr, { width: 10000 });
    const hLab = doc.heightOfString(label, { width: Math.max(labelMaxW, 0) });
    const lineH = Math.max(hVal, hLab);
    doc.y = startY + lineH + 2; // невеликий вертикальний відступ
  }

  // ряди meta (усі притиснуті до правого краю)
  rightMetaLine("Miejsce wystawienia:", data.place || "");
  rightMetaLine("Data wystawienia:", data.issue_date || "");
  rightMetaLine("Data sprzedaży:", data.sale_date || "");

  doc.moveDown(0.6);

  // ----- Sprzedawca / Nabywca (дві колонки 50/50) -----
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colW = (pageW - 20) / 2; // gap 20
  const xL = doc.page.margins.left;
  const xR = xL + colW + 20;
  const yTop = doc.y;

  doc.font("Regular").fontSize(10).fillColor("#333");
  // labels
  doc.text("Sprzedawca:", xL + 8, yTop, { width: colW - 16, align: "left" });
  doc.text("Nabywca:", xR + 8, yTop, { width: colW - 16, align: "left" });

  // boxes
  const boxY = yTop + 16;
  const boxH = 80;
  // seller box gray
  doc.save().fillColor("#e0e0e0").rect(xL, boxY, colW, boxH).fill().restore();
  doc.rect(xL, boxY, colW, boxH).stroke("#e0e0e0");
  // buyer box white
  doc.rect(xR, boxY, colW, boxH).stroke("#e0e0e0");

  // seller text
  doc
    .font("Bold")
    .fontSize(10)
    .text(data.seller_name || "", xL + 8, boxY + 6, {
      width: colW - 16,
      lineGap: 4,
    });
  doc
    .font("Regular")
    .fontSize(10)
    .text(data.seller_address || "", { width: colW - 16, lineGap: 4 });
  doc.text(data.seller_nip ? `NIP: ${data.seller_nip}` : "", {
    width: colW - 16,
    lineGap: 4,
  });

  // buyer text
  doc
    .font("Bold")
    .fontSize(10)
    .text(data.buyer_name || "", xR + 8, boxY + 6, {
      width: colW - 16,
      lineGap: 4,
    });
  doc
    .font("Regular")
    .fontSize(10)
    .text(data.buyer_address || "", { width: colW - 16, lineGap: 4 });
  const buyerIdLine =
    data.buyer_identifier || (data.buyer_nip ? `NIP: ${data.buyer_nip}` : "");
  doc.text(buyerIdLine, { width: colW - 16, lineGap: 4 });

  doc.y = boxY + boxH + 16;

  // ----- Таблиця позицій як у HTML (бордюри, падінги) -----
  const tX = xL;
  const tY = doc.y;
  const cols = [
    { key: "lp", title: "LP", w: Math.round(pageW * 0.05), align: "left" },
    {
      key: "name",
      title: "Nazwa towaru / usługi",
      w: Math.round(pageW * 0.26),
      align: "left",
    },
    { key: "qty", title: "Ilość", w: Math.round(pageW * 0.07), align: "right" },
    {
      key: "netUnit",
      title: "Cena netto",
      w: Math.round(pageW * 0.09),
      align: "right",
    },
    {
      key: "grossUnit",
      title: "Cena brutto",
      w: Math.round(pageW * 0.11),
      align: "right",
    },
    {
      key: "netSum",
      title: "Wartość netto",
      w: Math.round(pageW * 0.11),
      align: "right",
    },
    {
      key: "vatRate",
      title: "VAT %",
      w: Math.round(pageW * 0.08),
      align: "right",
    },
    {
      key: "vatAmt",
      title: "Wartość VAT",
      w: Math.round(pageW * 0.11),
      align: "right",
    },
    {
      key: "grossSum",
      title: "Wartość brutto",
      w: Math.round(pageW * 0.11),
      align: "right",
    },
  ];

  // ПІДГАНЯЄМО ширину таблиці під pageW, додаючи весь дельта до колонки "name"
  let tabW = cols.reduce((s, c) => s + c.w, 0);
  const delta = Math.round(pageW - tabW); // може бути +/- через округлення
  if (delta !== 0) {
    const nameCol = cols.find((c) => c.key === "name");
    if (nameCol) nameCol.w += delta; // «розтягуємо» колонку «Nazwa…»
    tabW = cols.reduce((s, c) => s + c.w, 0); // оновлюємо суму після правки
  }

  const rowPadY = 4;
  const cellPadX = 6;
  const border = "#e0e0e0";

  // header (REPLACED)
  let cx = tX;
  doc.font("Bold").fontSize(9).fillColor("#333");

  // обчислюємо висоту шапки з переносами
  let thH = 0;
  cols.forEach((c) => {
    const h = doc.heightOfString(c.title, {
      width: c.w - cellPadX * 2,
      align: c.align,
    });
    thH = Math.max(thH, h + rowPadY * 2);
  });

  // фон шапки
  doc.save().fillColor("#f3f3f3").rect(tX, tY, tabW, thH).fill().restore();

  cx = tX;
  doc.font("Bold").fontSize(9).fillColor("#333");
  cols.forEach((c) => {
    const h = doc.heightOfString(c.title, {
      width: c.w - cellPadX * 2,
      align: "center",
    });
    const ty = tY + (thH - h) / 2; // ← вертикальне центрування у thH
    doc.rect(cx, tY, c.w, thH).stroke(border);
    doc.text(c.title, cx + cellPadX, ty, {
      width: c.w - cellPadX * 2,
      align: "center",
    });
    cx += c.w;
  });

  // rows (REPLACED — динамічна висота рядка з переносами)
  let y = tY + thH;
  doc.font("Regular").fontSize(9);

  const items = data.items;
  items.forEach((it, i) => {
    const row = {
      lp: String(i + 1),
      name: String(it.name ?? it.title ?? ""),
      qty: String(it.quantity ?? it.qty ?? ""),
      netUnit: pl(it.net_price ?? it.netPrice ?? ""),
      grossUnit: pl(it.gross_price ?? it.grossPrice ?? ""),
      netSum: pl(it.net_total ?? it.netTotal ?? ""),
      vatRate: cleanPercent(it.vat_rate ?? it.vatRate ?? ""),
      vatAmt: pl(it.vat_amount ?? it.vatAmount ?? ""),
      grossSum: pl(it.gross_total ?? it.grossTotal ?? ""),
    };

    // динамічна висота рядка (беремо макс з усіх клітинок)
    let rowH = 0;
    cols.forEach((c) => {
      const h = doc.heightOfString(row[c.key] || "", {
        width: c.w - cellPadX * 2,
        align: c.align,
      });
      rowH = Math.max(rowH, h + rowPadY * 2);
    });

    // перенос на нову сторінку + перемальовка шапки
    if (y + rowH + 120 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.y;

      let thH2 = 0;
      doc.font("Regular").fontSize(9);
      cols.forEach((c) => {
        const h = doc.heightOfString(c.title, {
          width: c.w - cellPadX * 2,
          align: c.align,
        });
        thH2 = Math.max(thH2, h + rowPadY * 2);
      });
      doc.save().fillColor("#f3f3f3").rect(tX, y, tabW, thH2).fill().restore();

      cx = tX;
      cols.forEach((c) => {
        doc.rect(cx, y, c.w, thH2).stroke(border);
        doc.text(c.title, cx + cellPadX, y + rowPadY, {
          width: c.w - cellPadX * 2,
          align: c.align,
        });
        cx += c.w;
      });

      y += thH2;
      doc.font("Regular").fontSize(baseFontSize);
    }

    // рамки + текст клітинок
    cx = tX;
    cols.forEach((c) => {
      doc.rect(cx, y, c.w, rowH).stroke(border);
      doc.text(row[c.key] || "", cx + cellPadX, y + rowPadY, {
        width: c.w - cellPadX * 2,
        align: c.align,
      });
      cx += c.w;
    });

    y += rowH;
  });

  // нижня межа під останнім рядком таблиці (з фіксацією координати)
  //   const bottomY = y; // зберігаємо координату перед зміною doc.y
  //   doc.save();
  //   doc
  //     .moveTo(tX, bottomY)
  //     .lineTo(tX + tabW, bottomY)
  //     .stroke(border);
  //   doc.restore();

  // summary 2 рядки як у HTML (одна клітинка „W tym”, потім „Razem”)
  const sumRowH = 18;
  const emptyW = cols.slice(0, 4).reduce((s, c) => s + c.w, 0);
  const wNet = cols[5].w,
    wVatRate = cols[6].w,
    wVat = cols[7].w,
    wGross = cols[8].w;

  doc
    .moveTo(tX, y)
    .lineTo(tX + emptyW, y)
    .stroke(border);

  // жодних рамок у лівій порожній зоні
  // праві клітинки
  doc.rect(tX + emptyW, y, cols[4].w, sumRowH).stroke(border);
  doc.font("Bold").text("W tym", tX + emptyW + cellPadX, y + rowPadY, {
    width: cols[4].w - cellPadX * 2,
    align: "right",
  });

  doc.rect(tX + emptyW + cols[4].w, y, wNet, sumRowH).stroke(border);
  doc
    .font("Regular")
    .text(pl(data.net_sum), tX + emptyW + cols[4].w + cellPadX, y + rowPadY, {
      width: wNet - cellPadX * 2,
      align: "right",
    });

  doc.rect(tX + emptyW + cols[4].w + wNet, y, wVatRate, sumRowH).stroke(border);
  doc.text("23", tX + emptyW + cols[4].w + wNet + cellPadX, y + rowPadY, {
    width: wVatRate - cellPadX * 2,
    align: "right",
  });

  doc
    .rect(tX + emptyW + cols[4].w + wNet + wVatRate, y, wVat, sumRowH)
    .stroke(border);
  doc.text(
    pl(data.vat_sum),
    tX + emptyW + cols[4].w + wNet + wVatRate + cellPadX,
    y + rowPadY,
    { width: wVat - cellPadX * 2, align: "right" }
  );

  doc
    .rect(tX + emptyW + cols[4].w + wNet + wVatRate + wVat, y, wGross, sumRowH)
    .stroke(border);
  doc.text(
    pl(data.gross_sum),
    tX + emptyW + cols[4].w + wNet + wVatRate + wVat + cellPadX,
    y + rowPadY,
    { width: wGross - cellPadX * 2, align: "right" }
  );

  y += sumRowH;

  // рядок "Razem:"
  doc.rect(tX + emptyW, y, cols[4].w, sumRowH).stroke(border);
  doc.font("Bold").text("Razem:", tX + emptyW + cellPadX, y + rowPadY, {
    width: cols[4].w - cellPadX * 2,
    align: "right",
  });

  // значення — ЖИРНІ
  doc.rect(tX + emptyW + cols[4].w, y, wNet, sumRowH).stroke(border);
  doc
    .font("Bold")
    .text(pl(data.net_sum), tX + emptyW + cols[4].w + cellPadX, y + rowPadY, {
      width: wNet - cellPadX * 2,
      align: "right",
    });

  doc.rect(tX + emptyW + cols[4].w + wNet, y, wVatRate, sumRowH).stroke(border); // порожньо

  doc
    .rect(tX + emptyW + cols[4].w + wNet + wVatRate, y, wVat, sumRowH)
    .stroke(border);
  doc.text(
    pl(data.vat_sum),
    tX + emptyW + cols[4].w + wNet + wVatRate + cellPadX,
    y + rowPadY,
    { width: wVat - cellPadX * 2, align: "right" }
  );

  doc
    .rect(tX + emptyW + cols[4].w + wNet + wVatRate + wVat, y, wGross, sumRowH)
    .stroke(border);
  doc.text(
    pl(data.gross_sum),
    tX + emptyW + cols[4].w + wNet + wVatRate + wVat + cellPadX,
    y + rowPadY,
    { width: wGross - cellPadX * 2, align: "right" }
  );

  doc.font("Regular");
  y += sumRowH + 20; // відступ між таблицею та Totals
  doc.moveTo(doc.x, y); // оновлюємо позицію для наступного блоку
  doc.moveDown(1);

  // ----- Totals (праворуч, flush-right значення + лейбл як у meta) -----
  const totalsGap = 8;
  const pageRight2 = doc.page.width - doc.page.margins.right;
  function rightTotalsLine(label, value) {
    const startY = doc.y;
    const valStr = String(value || "");
    // значення — рівно у правому краї
    doc.font("Regular").fontSize(9);
    const valW = doc.widthOfString(valStr);
    const valX = pageRight2 - valW;
    doc.text(valStr, valX, startY);

    // підпис — вирівняний праворуч, закінчується за totalsGap до значення
    const labelMaxW = valX - totalsGap - doc.page.margins.left;
    doc.font("Bold").fontSize(9);
    doc.text(label, doc.page.margins.left, startY, {
      width: Math.max(labelMaxW, 0),
      align: "right",
    });

    const hVal = doc.heightOfString(valStr, { width: 10000 });
    const hLab = doc.heightOfString(label, { width: Math.max(labelMaxW, 0) });
    const lineH = Math.max(hVal, hLab);
    doc.y = startY + lineH + 2;
  }

  rightTotalsLine("Wartość netto:", `${pl(data.net_sum)} PLN`);
  rightTotalsLine("Wartość VAT:", `${pl(data.vat_sum)} PLN`);
  rightTotalsLine("Wartość brutto:", `${pl(data.gross_sum)} PLN`);

  doc.moveDown(0.4);

  // ----- Payment info (Słownie, Do zapłaty, Termin, Płatność, Bank, Konto) -----
  const xMeta = xL;
  let yMeta = doc.y;
  const LABEL_GAP = 8; // відступ між підписом і значенням
  const LINE_SPACING = 2; // вертикальний інтервал між рядками

  function rightLabelVal(label, value, bigValue) {
    const LABEL_GAP = 8; // лишається як у тебе зверху
    const LINE_SPACING = 2; // лишається як у тебе зверху
    const labelFontSize = 9;
    const valueFontSize = bigValue ? bigTotalSize : 9;

    const labelStartX = xMeta;
    const valueStr = String(value || "");

    // 1) ПОРАХУВАТИ РОЗМІРИ (окремо для підпису і значення)
    doc.font("Bold").fontSize(labelFontSize);
    const labelW = doc.widthOfString(label);
    const labelH = doc.heightOfString(label, { width: 1e6 });

    // УВАГА: значення завжди Regular (навіть коли bigValue === true)
    doc.font("Regular").fontSize(valueFontSize);
    const valueH = doc.heightOfString(valueStr, { width: 1e6 });

    // 2) КООРДИНАТИ X/W ДЛЯ ЗНАЧЕННЯ
    const valueX = labelStartX + labelW + LABEL_GAP;
    const valueW = doc.page.width - doc.page.margins.right - valueX;

    // 3) НАМАЛЮВАТИ ЗНАЧЕННЯ (в один рядок)
    const valueY = yMeta;
    doc.text(valueStr, valueX, valueY, {
      width: valueW,
      lineBreak: false, // без переносу
    });

    // 4) НАМАЛЮВАТИ ПІДПИС — НИЖНІМ КРАЄМ ДО РЯДКА ЗНАЧЕННЯ
    const labelY = valueY + (valueH - labelH);
    doc.font("Bold").fontSize(labelFontSize).text(label, labelStartX, labelY, {
      lineBreak: false, // без переносу
    });

    // 5) ПЕРЕХІД НА НАСТУПНИЙ РЯДОК
    const rowH = Math.max(labelH, valueH);
    yMeta = valueY + rowH + LINE_SPACING;
    doc.y = yMeta;
  }

  rightLabelVal(
    "Do zapłaty:",
    `${pl(data.amount_due || data.gross_sum)} PLN`,
    true
  );

  rightLabelVal("Słownie:", data.amount_in_words);
  rightLabelVal("Termin płatności:", data.due_date);
  rightLabelVal("Płatność:", data.payment_method);
  rightLabelVal("Bank:", data.bank);
  rightLabelVal("Konto:", data.account);

  // ----- Issuer / signature box (як у .section-issuer) -----
  const signW = 200;
  const signX = xL + 120;
  const signY = yMeta + 24;
  const signH = 60;

  doc
    .font("Bold")
    .fontSize(9)
    .text("Imię i nazwisko wystawcy", signX, signY + 8, {
      width: signW,
      align: "center",
    });
  doc.font("Regular").text(data.issuer || " ", signX, signY + signH - 22, {
    width: signW,
    align: "center",
  });

  // фініш
  doc.end();
  await new Promise((res, rej) => {
    ws.on("finish", res);
    ws.on("error", rej);
  });
  return finalPath;
}

module.exports = { generateInvoicePDF };
