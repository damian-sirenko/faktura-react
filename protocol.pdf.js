// protocol.pdf.js
const fs = require("fs");
const path = require("path");
const { PassThrough } = require("stream");
const archiver = require("archiver");
let PDFDocument;
try {
  PDFDocument = require("pdfkit");
} catch {
  PDFDocument = null;
}

/* --- Шляхи --- */
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const PROTOCOLS_FILE = path.join(DATA_DIR, "protocols.json");
const SIGNATURES_DIR = path.join(ROOT, "signatures");
/* ✅ ДОДАНО: директорія для збереження PDF */
const GENERATED_DIR = path.join(ROOT, "generated");

/* --- Місяці польською --- */
const MONTHS_PL = [
  "styczeń",
  "luty",
  "marzec",
  "kwiecień",
  "maj",
  "czerwiec",
  "lipiec",
  "sierpień",
  "wrzesień",
  "październik",
  "listopad",
  "grudzień",
];
function monthWord(ym) {
  const [y, m] = String(ym || "").split("-");
  const i = (Number(m) || 1) - 1;
  const w = MONTHS_PL[i] || m || "";
  return { year: y || "", word: w };
}

/* --- Шрифти --- */
const FONT_REG_CANDIDATES = [
  path.join(ROOT, "fonts", "DejaVuSans.ttf"),
  path.join(ROOT, "public", "fonts", "DejaVuSans.ttf"),
  path.join(process.cwd(), "fonts", "DejaVuSans.ttf"),
  path.join(process.cwd(), "public", "fonts", "DejaVuSans.ttf"),
];
const FONT_BOLD_CANDIDATES = [
  path.join(ROOT, "fonts", "DejaVuSans-Bold.ttf"),
  path.join(ROOT, "public", "fonts", "DejaVuSans-Bold.ttf"),
  path.join(process.cwd(), "fonts", "DejaVuSans-Bold.ttf"),
  path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf"),
];
function registerPdfFonts(doc) {
  const reg = FONT_REG_CANDIDATES.find((p) => fs.existsSync(p));
  const bold = FONT_BOLD_CANDIDATES.find((p) => fs.existsSync(p));
  if (reg) doc.registerFont("DejaVu", reg);
  if (bold) doc.registerFont("DejaVuBold", bold);
  try {
    doc.font("DejaVu");
  } catch {}
}
function setFont(doc, name) {
  try {
    doc.font(name);
  } catch {}
}

/* --- IO --- */
function readProtocols() {
  try {
    return JSON.parse(fs.readFileSync(PROTOCOLS_FILE, "utf8")) || [];
  } catch {
    return [];
  }
}
function readClients() {
  try {
    return JSON.parse(fs.readFileSync(CLIENTS_FILE, "utf8")) || [];
  } catch {
    return [];
  }
}
function findClientById(clients, id) {
  return (
    clients.find(
      (c) =>
        c.id === id ||
        c.ID === id ||
        String(c.name || c.Klient || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") === id
    ) || null
  );
}

/* --- Дати / формат --- */
function plDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return d && m && y ? `${d}.${m}.${y}` : String(iso);
}
function toDate(iso) {
  return new Date(`${iso}T00:00:00`);
}
function addDaysISO(iso, days) {
  const d = toDate(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function isWeekendISO(iso) {
  const d = toDate(iso);
  const wd = d.getDay();
  return wd === 0 || wd === 6;
}
function nextBusinessDay(iso) {
  let n = addDaysISO(iso, 1);
  while (isWeekendISO(n)) n = addDaysISO(n, 1);
  return n;
}

/* --- Малювання --- */
const COLOR_LINE = "#d1d5db";
const COLOR_HEADER_BG = "#f3f4f6";
const COLOR_THEAD_BG = "#f7f7f8";
const COLOR_TAG_BG = "#eef2f7";

/* 👉 Параметри підписів */
const SIGN_CELL_MIN_H = 48;
const SIGN_INSET = 6;

/* ✅ Санітизація та шлях для збереження PDF */
function safeSeg(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
function protocolOutPath(clientId, month, onlySigned = false) {
  const dir = path.join(GENERATED_DIR, "protocols", safeSeg(month));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fn = `protokol_${safeSeg(clientId)}_${safeSeg(month)}${
    onlySigned ? "_podpisane" : ""
  }.pdf`;
  return path.join(dir, fn);
}

function absSignaturePath(pub) {
  try {
    const rel = decodeURIComponent(String(pub || "")).replace(
      /^\/signatures\//,
      ""
    );
    const parts = rel.split("/").filter(Boolean);
    return path.join(SIGNATURES_DIR, ...parts);
  } catch {
    return null;
  }
}

function measureText(
  doc,
  text,
  width,
  fontName = "DejaVu",
  fontSize = 10,
  lineGap = 2,
  align = "left"
) {
  setFont(doc, fontName);
  doc.fontSize(fontSize);
  return doc.heightOfString(String(text ?? ""), { width, align, lineGap });
}
function drawCellBorder(doc, x, y, w, h) {
  doc.rect(x, y, w, h).stroke();
}
function drawTextInCell(
  doc,
  text,
  x,
  y,
  w,
  h,
  {
    align = "left",
    vAlign = "top",
    font = "DejaVu",
    size = 10,
    lineGap = 2,
    inset = 4,
  } = {}
) {
  const prevY = doc.y;
  setFont(doc, font);
  doc.fontSize(size);
  const maxW = Math.max(0, w - inset * 2);
  const maxH = Math.max(0, h - inset * 2);
  let ty = y + inset;
  if (vAlign === "middle") {
    const th = doc.heightOfString(String(text ?? ""), {
      width: maxW,
      align,
      lineGap,
    });
    const free = Math.max(0, maxH - th);
    ty = y + inset + free / 2;
  }
  doc.text(String(text ?? ""), x + inset, ty, {
    width: maxW,
    align,
    lineGap,
    height: maxH,
  });
  drawCellBorder(doc, x, y, w, h);
  doc.y = prevY;
}
function drawCenteredImage(doc, imgPath, x, y, w, h, inset = SIGN_INSET) {
  if (!imgPath || !fs.existsSync(imgPath)) {
    drawCellBorder(doc, x, y, w, h);
    return;
  }
  const fitW = Math.max(0, w - inset * 2);
  const fitH = Math.max(0, h - inset * 2);
  try {
    const img = doc.openImage(imgPath);
    const k = Math.min(fitW / img.width, fitH / img.height);
    const dw = img.width * k,
      dh = img.height * k;
    const ix = x + (w - dw) / 2,
      iy = y + (h - dh) / 2;
    doc.image(img, ix, iy, { width: dw, height: dh });
  } catch {}
  drawCellBorder(doc, x, y, w, h);
}

/* Залишено на місці (не використовується у поточному макеті) */
function drawSignColumn(
  doc,
  x,
  y,
  w,
  h,
  labelTop,
  imgTopPath,
  labelBottom,
  imgBottomPath
) {
  const labelH = 16;
  const signH = Math.max(22, (h - labelH * 2) / 2);
  drawTextInCell(doc, labelTop, x, y, w, labelH, {
    align: "center",
    vAlign: "middle",
    font: "DejaVuBold",
    size: 9,
  });
  drawCenteredImage(doc, imgTopPath, x, y + labelH, w, signH);
  drawTextInCell(doc, labelBottom, x, y + labelH + signH, w, labelH, {
    align: "center",
    vAlign: "middle",
    font: "DejaVuBold",
    size: 9,
  });
  drawCenteredImage(
    doc,
    imgBottomPath,
    x,
    y + labelH + signH + labelH,
    w,
    signH
  );
}

function drawHeaderSection(doc, client, proto) {
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x0 = doc.page.margins.left;
  let y = doc.y;

  setFont(doc, "DejaVuBold");
  doc.fillColor("#000");
  doc.fontSize(18);
  doc.text("Protokół przekazania narzędzi", x0, y, {
    width: pageW,
    align: "center",
  });
  y = doc.y + 6;

  const pad = 10;
  const leftW = Math.floor(pageW * 0.6);
  const rightW = pageW - leftW;

  const name = String(client?.name || client?.Klient || proto.id).trim();
  const addr =
    client?.address ||
    client?.Adres ||
    `${client?.street || ""} ${client?.city || ""}`.trim();
  const nip = client?.nip || client?.NIP || "";
  const idLine = `ID: ${proto.id}`;

  const leftLines = [
    { val: name, bold: true },
    ...(addr ? [{ val: addr }] : []),
    ...(nip ? [{ val: `NIP: ${nip}` }] : []),
    { val: idLine, bold: true },
  ];

  const { year, word } = monthWord(proto.month);
  const rightTitle = `${word} ${year}`;

  const leftText = leftLines.map((l) => l.val).join("\n");
  const hLeft = measureText(
    doc,
    leftText,
    leftW - pad * 2,
    "DejaVu",
    11,
    4,
    "left"
  );
  const hRight = measureText(
    doc,
    rightTitle,
    rightW - pad * 2,
    "DejaVuBold",
    12,
    2,
    "right"
  );
  const boxH = Math.max(hLeft, hRight) + pad * 2;

  doc.save();
  doc.fillColor(COLOR_HEADER_BG).rect(x0, y, pageW, boxH).fill();
  doc.restore();
  doc.strokeColor(COLOR_LINE);

  let lx = x0 + pad,
    ly = y + pad;
  for (const row of leftLines) {
    setFont(doc, row.bold ? "DejaVuBold" : "DejaVu");
    doc.fontSize(11);
    doc.text(row.val, lx, ly, {
      width: leftW - pad * 2,
      align: "left",
      lineGap: 4,
    });
    ly = doc.y;
  }
  setFont(doc, "DejaVuBold");
  doc.fontSize(12);
  doc.text(rightTitle, x0 + leftW, y + pad, {
    width: rightW - pad * 2,
    align: "right",
  });

  doc.rect(x0, y, pageW, boxH).stroke();
  doc.y = y + boxH + 10;
}

function drawTableHeader(doc, x0, y, widths, headers) {
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const headerHeights = headers.map(
    (h, i) =>
      measureText(
        doc,
        h,
        Math.max(0, widths[i] - 8),
        "DejaVuBold",
        10,
        2,
        "center"
      ) + 8
  );
  const th = Math.max(26, ...headerHeights);

  doc.save();
  doc.fillColor(COLOR_THEAD_BG).rect(x0, y, pageW, th).fill();
  doc.restore();
  doc.strokeColor(COLOR_LINE);

  let cx = x0;
  for (let i = 0; i < headers.length; i++) {
    drawTextInCell(doc, headers[i], cx, y, widths[i], th, {
      align: "center",
      vAlign: "middle",
      font: "DejaVuBold",
      size: 10,
      lineGap: 2,
      inset: 4,
    });
    cx += widths[i];
  }
  return th;
}
function ensurePageSpace(doc, needed, drawHeader) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
    if (typeof drawHeader === "function") drawHeader();
  }
}

/* --- Таблиця --- */
function drawTable(doc, proto, { onlySigned = false } = {}) {
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x0 = doc.page.margins.left;
  let y = doc.y;
  doc.strokeColor(COLOR_LINE);

  const W_LP = 36,
    W_NAME = 114,
    W_QTY = 56,
    W_SIGN = 84,
    W_DATE = 72;
  const sumFirst9 =
    W_LP + W_NAME + W_QTY + W_SIGN + W_SIGN + W_DATE + W_QTY + W_SIGN + W_SIGN;
  const W_COMMENT = Math.max(80, pageW - sumFirst9);

  const widths = [
    W_LP,
    W_NAME,
    W_QTY,
    W_SIGN,
    W_SIGN,
    W_DATE,
    W_QTY,
    W_SIGN,
    W_SIGN,
    W_COMMENT,
  ];
  const headers = [
    "L.p.",
    "Nazwa narzędzi",
    "Ilość",
    "Podpis Usługobiorcy",
    "Podpis Usługodawcy",
    "Data zwrotu",
    "Ilość",
    "Podpis Usługobiorcy",
    "Podpis Usługodawcy",
    "Komentarz",
  ];

  const paintHeader = () => {
    const th = drawTableHeader(doc, x0, doc.y, widths, headers);
    y = doc.y + th;
    doc.y = y;
  };
  const th0 = drawTableHeader(doc, x0, y, widths, headers);
  y += th0;
  doc.y = y;

  const rows = Array.isArray(proto.entries) ? proto.entries : [];
  let lp = 0;

  for (const row of rows) {
    const hasPairTransfer =
      row?.signatures?.transfer?.client && row?.signatures?.transfer?.staff;
    const hasPairReturn =
      row?.signatures?.return?.client && row?.signatures?.return?.staff;
    if (onlySigned && !hasPairTransfer && !hasPairReturn) continue;
    lp += 1;

    const tTools = Array.isArray(row.tools)
      ? row.tools.filter((t) => t && t.name)
      : [];
    const rTools =
      Array.isArray(row.returnTools) && row.returnTools.length
        ? row.returnTools.filter((t) => t && t.name)
        : tTools;

    const toolNames = tTools.map((t) => String(t.name)).join("\n") || "—";
    const qtyLeft =
      tTools.map((t) => String(Number(t.count || 0) || 0)).join("\n") || "—";
    const qtyRight =
      rTools.map((t) => String(Number(t.count || 0) || 0)).join("\n") || "—";

    const tags = [];
    if (row.shipping) tags.push("Wysyłka");
    if (row.delivery === "odbior") tags.push("Odbiór");
    else if (row.delivery === "dowoz") tags.push("Dowóz");
    else if (row.delivery === "odbior+dowoz") tags.push("Odbiór + Dowóz");
    const commentTop = tags.join(" • ");
    const commentText = String(row.comment || "");

    const rDate = row.returnDate || (row.date ? nextBusinessDay(row.date) : "");

    const hNames =
      Math.ceil(
        measureText(doc, toolNames, widths[1] - 8, "DejaVu", 10, 2, "left")
      ) + 8;
    const hQtyLeft =
      Math.ceil(
        measureText(doc, qtyLeft, widths[2] - 8, "DejaVu", 10, 2, "right")
      ) + 8;
    const hQtyRight =
      Math.ceil(
        measureText(doc, qtyRight, widths[6] - 8, "DejaVu", 10, 2, "right")
      ) + 8;
    const hDate =
      Math.ceil(
        measureText(
          doc,
          plDate(rDate),
          widths[5] - 8,
          "DejaVu",
          10,
          2,
          "center"
        )
      ) + 8;

    let hCommentTag = commentTop ? 18 : 0;
    const hCommentBody =
      Math.ceil(
        measureText(
          doc,
          commentText || "—",
          widths[9] - 8,
          "DejaVu",
          10,
          2,
          "left"
        )
      ) + 8;

    const rowH = Math.max(
      SIGN_CELL_MIN_H,
      hNames,
      hQtyLeft,
      hQtyRight,
      hDate,
      hCommentTag + hCommentBody
    );

    const sumH = 24;
    ensurePageSpace(doc, rowH + sumH + 6, paintHeader);

    let x = x0;
    drawTextInCell(doc, String(lp), x, y, widths[0], rowH, {
      align: "center",
      vAlign: "middle",
    });
    x += widths[0];
    drawTextInCell(doc, toolNames, x, y, widths[1], rowH, {
      align: "left",
      vAlign: "top",
    });
    x += widths[1];
    drawTextInCell(doc, qtyLeft, x, y, widths[2], rowH, {
      align: "right",
      vAlign: "top",
    });
    x += widths[2];
    drawCenteredImage(
      doc,
      absSignaturePath(row?.signatures?.transfer?.client),
      x,
      y,
      widths[3],
      rowH
    );
    x += widths[3];
    drawCenteredImage(
      doc,
      absSignaturePath(row?.signatures?.transfer?.staff),
      x,
      y,
      widths[4],
      rowH
    );
    x += widths[4];
    drawTextInCell(doc, plDate(rDate), x, y, widths[5], rowH, {
      align: "center",
      vAlign: "middle",
    });
    x += widths[5];
    drawTextInCell(doc, qtyRight, x, y, widths[6], rowH, {
      align: "right",
      vAlign: "top",
    });
    x += widths[6];
    drawCenteredImage(
      doc,
      absSignaturePath(row?.signatures?.return?.client),
      x,
      y,
      widths[7],
      rowH
    );
    x += widths[7];
    drawCenteredImage(
      doc,
      absSignaturePath(row?.signatures?.return?.staff),
      x,
      y,
      widths[8],
      rowH
    );
    x += widths[8];

    if (commentTop) {
      doc.save();
      doc
        .fillColor(COLOR_TAG_BG)
        .rect(x + 2, y + 2, widths[9] - 4, hCommentTag - 4)
        .fill();
      doc.restore();
      drawTextInCell(doc, commentTop, x, y, widths[9], hCommentTag, {
        align: "left",
        vAlign: "middle",
        font: "DejaVuBold",
        size: 9,
      });
      drawTextInCell(
        doc,
        commentText || "—",
        x,
        y + hCommentTag,
        widths[9],
        rowH - hCommentTag,
        { align: "left", vAlign: "top" }
      );
    } else {
      drawTextInCell(doc, commentText || "—", x, y, widths[9], rowH, {
        align: "left",
        vAlign: "top",
      });
    }

    y += rowH;
    doc.y = y;

    const pkgsL = Number(row.packages || 0) || 0;
    const pkgsR =
      Number(row.returnPackages != null ? row.returnPackages : row.packages) ||
      0;

    doc.save();
    doc.fillColor(COLOR_HEADER_BG).rect(x0, y, pageW, sumH).fill();
    doc.restore();
    doc.strokeColor(COLOR_LINE);

    let sx = x0;
    drawCellBorder(doc, sx, y, widths[0], sumH);
    sx += widths[0];
    drawTextInCell(doc, "Pakiety", sx, y, widths[1], sumH, {
      align: "left",
      vAlign: "middle",
      font: "DejaVuBold",
    });
    sx += widths[1];
    drawTextInCell(doc, String(pkgsL), sx, y, widths[2], sumH, {
      align: "right",
      vAlign: "middle",
      font: "DejaVuBold",
    });
    sx += widths[2];
    drawCellBorder(doc, sx, y, widths[3], sumH);
    sx += widths[3];
    drawCellBorder(doc, sx, y, widths[4], sumH);
    sx += widths[4];
    drawCellBorder(doc, sx, y, widths[5], sumH);
    sx += widths[5];
    drawTextInCell(doc, String(pkgsR), sx, y, widths[6], sumH, {
      align: "right",
      vAlign: "middle",
      font: "DejaVuBold",
    });
    sx += widths[6];
    drawCellBorder(doc, sx, y, widths[7], sumH);
    sx += widths[7];
    drawCellBorder(doc, sx, y, widths[8], sumH);
    sx += widths[8];
    drawCellBorder(doc, sx, y, widths[9], sumH);

    y += sumH;
    doc.y = y;
  }

  const entries = Array.isArray(proto.entries) ? proto.entries : [];
  const totalPackages = entries.reduce(
    (s, e) => s + (Number(e.packages || 0) || 0),
    0
  );
  const totalRows = entries.length;

  const rightBoxW = 220;
  const leftW = pageW - rightBoxW - 8;
  const rowH = 24;
  const blockH = rowH * 2 + 8;

  ensurePageSpace(doc, blockH + 10);
  doc
    .moveTo(doc.page.margins.left, doc.y + 4)
    .lineTo(doc.page.margins.left + pageW, doc.y + 4)
    .stroke();
  doc.y += 8;

  const x0l = x0,
    y0l = doc.y,
    x0r = x0 + leftW + 8,
    y0r = doc.y;

  doc.save();
  doc.fillColor(COLOR_HEADER_BG).rect(x0l, y0l, leftW, rowH).fill();
  doc
    .fillColor(COLOR_HEADER_BG)
    .rect(x0l, y0l + rowH, leftW, rowH)
    .fill();
  doc.restore();
  setFont(doc, "DejaVuBold");
  doc.fontSize(11);
  doc.fillColor("#000");
  doc.text(`Razem wpisów: ${totalRows}`, x0l + 8, y0l + (rowH - 11) / 2, {
    width: leftW - 16,
    align: "left",
  });
  doc.text(
    `Razem pakietów: ${totalPackages}`,
    x0l + 8,
    y0l + rowH + (rowH - 11) / 2,
    { width: leftW - 16, align: "left" }
  );
  drawCellBorder(doc, x0l, y0l, leftW, rowH);
  drawCellBorder(doc, x0l, y0l + rowH, leftW, rowH);

  doc.save();
  doc
    .fillColor("#fff")
    .rect(x0r, y0r, rightBoxW, rowH * 2)
    .fill();
  doc.restore();
  drawCellBorder(doc, x0r, y0r, rightBoxW, rowH * 2);
  setFont(doc, "DejaVu");
  doc.fontSize(10);
  doc.text("Miejsce na pieczęć i podpis", x0r + 8, y0r + 6, {
    width: rightBoxW - 16,
    align: "center",
  });
}

/* --- Рендер одного PDF --- */
function renderProtocol(doc, client, proto, onlySigned = false) {
  registerPdfFonts(doc);
  doc.strokeColor(COLOR_LINE);
  doc.fillColor("#000");
  doc.fontSize(10);
  setFont(doc, "DejaVu");
  drawHeaderSection(doc, client, proto);
  drawTable(doc, proto, { onlySigned });
}

/* --- createProtocolPDF: підтримка обох способів + ✅ збереження на диск --- */
function createProtocolPDF(arg1, arg2) {
  if (!PDFDocument)
    return (arg1?.res || arg2)
      ?.status(500)
      .send("Brak modułu pdfkit. npm i pdfkit");

  // Новий стиль: createProtocolPDF({ res, client, proto, onlySigned, filename })
  if (arg1 && typeof arg1 === "object" && arg1.res && !arg2) {
    const { res, client, proto, onlySigned = false, filename } = arg1;
    try {
      res.setHeader("Content-Type", "application/pdf");
      if (filename)
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 28,
      });
      doc.on("error", (e) => {
        try {
          res.write(" ");
        } catch {}
        console.error("PDF stream error:", e?.message || e);
      });

      // ✅ паралельно зберігаємо на диск, якщо відомі id+month
      if (proto?.id && proto?.month) {
        const outPath = protocolOutPath(proto.id, proto.month, !!onlySigned);
        const ws = fs.createWriteStream(outPath);
        doc.pipe(ws);
      }

      doc.pipe(res);
      renderProtocol(
        doc,
        client || null,
        proto || { id: "", month: "", entries: [] },
        !!onlySigned
      );
      doc.end();
    } catch (e) {
      console.error("protocol pdf error:", e);
      try {
        res.status(500).send("Failed to generate protocol PDF");
      } catch {}
    }
    return;
  }

  // Старий стиль: createProtocolPDF(req, res)
  if (arg1 && arg2) {
    const req = arg1,
      res = arg2;
    try {
      const { clientId, month } = req.params;
      const onlySigned = String(req.query.onlySigned || "") === "1";
      const all = readProtocols();
      const proto = all.find((p) => p.id === clientId && p.month === month) || {
        id: clientId,
        month,
        entries: [],
      };
      const clients = readClients();
      const client = findClientById(clients, clientId);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="protokol_${clientId}_${month}${
          onlySigned ? "_podpisane" : ""
        }.pdf"`
      );

      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 28,
      });
      doc.on("error", (e) => {
        try {
          res.write(" ");
        } catch {}
        console.error("PDF stream error:", e?.message || e);
      });

      // ✅ паралельно зберігаємо файл
      const outPath = protocolOutPath(clientId, month, onlySigned);
      const ws = fs.createWriteStream(outPath);
      doc.pipe(ws);

      doc.pipe(res);
      renderProtocol(doc, client, proto, onlySigned);
      doc.end();
    } catch (e) {
      console.error("protocol pdf error:", e);
      try {
        res.status(500).send("Failed to generate protocol PDF");
      } catch {}
    }
    return;
  }

  throw new Error("createProtocolPDF called with invalid arguments");
}

/* --- ZIP за місяць (залишено як було) + ✅ паралельне збереження кожного PDF --- */
function createProtocolZip(req, res) {
  if (!PDFDocument)
    return res.status(500).send("Brak modułu pdfkit. npm i pdfkit");
  try {
    const { month } = req.params;
    const onlySigned = String(req.query.onlySigned || "") === "1";
    const clients = readClients();
    const all = readProtocols().filter((p) => p.month === month);

    const archive = archiver("zip", { zlib: { level: 9 } });
    res.attachment(`protokoły_${month}${onlySigned ? "_podpisane" : ""}.zip`);
    archive.on("error", (err) => {
      console.error("zip error:", err);
      try {
        res.status(500).end();
      } catch {}
    });
    archive.pipe(res);

    for (const proto of all) {
      const client = findClientById(clients, proto.id);
      const stream = new PassThrough();
      const fn = `protokol_${proto.id}_${month}${
        onlySigned ? "_podpisane" : ""
      }.pdf`;
      archive.append(stream, { name: fn });

      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 28,
      });

      // ✅ паралельне локальне збереження кожного PDF
      const savePath = protocolOutPath(proto.id, month, onlySigned);
      const ws = fs.createWriteStream(savePath);
      doc.pipe(ws);

      doc.pipe(stream);
      renderProtocol(doc, client, proto, onlySigned);
      doc.end();
    }
    archive.finalize();
  } catch (e) {
    console.error("protocols export zip error:", e);
    res.status(500).send("Failed to export protocols zip");
  }
}

module.exports = { createProtocolPDF, createProtocolZip };
