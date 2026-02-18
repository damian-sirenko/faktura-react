const fs = require("fs");
const path = require("path");
const { query } = require("./server/db.js");

async function loadClientById(id) {
  const [row] = await query(
    "SELECT id,name,address,nip,pesel FROM clients WHERE id=? LIMIT 1",
    [id]
  );
  return row || null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function toISO10(v) {
  if (!v) return "";
  if (v instanceof Date && !isNaN(v)) {
    const Y = v.getFullYear();
    const M = String(v.getMonth() + 1).padStart(2, "0");
    const D = String(v.getDate()).padStart(2, "0");
    return `${Y}-${M}-${D}`;
  }
  const s = String(v).slice(0, 10);
  return ISO_RE.test(s) ? s : "";
}

async function loadProtocolFull(clientId, month) {
  // Безпечний парсер JSON ( підтримка Buffer та вже-розпарсених об’єктів )
  function parseJSON(val, fallback) {
    try {
      if (val == null) return fallback;
      if (Buffer.isBuffer(val)) val = val.toString("utf8");
      if (typeof val === "object") return val ?? fallback; // mysql2 може повертати вже об’єкт
      const s = String(val || "").trim();
      if (!s) return fallback;
      return JSON.parse(s);
    } catch {
      return fallback;
    }
  }
  // Нормалізація масиву інструментів
  function normalizeToolsArray(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((t) => {
        if (typeof t === "string") return { name: t.trim(), count: 0 };
        if (t && typeof t === "object") {
          return {
            name: String(t.name || t.nazwa || "").trim(),
            count: Number(t.count || t.ilosc || 0) || 0,
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  const [p] = await query(
    "SELECT id, summarized FROM protocols WHERE clientId=? AND month=? LIMIT 1",
    [clientId, month]
  );

  if (!p) return { entries: [] };

  const rows = await query(
    `SELECT date,packages,delivery,shipping,comment,tools_json,signatures_json,
            returnDate,returnPackages,returnDelivery,returnShipping,returnTools_json
     FROM protocol_entries
     WHERE protocol_id=?
     ORDER BY date ASC, id ASC`,
    [p.id]
  );

  return {
    summarized: !!p.summarized,
    entries: rows.map((r) => {
      const tools = normalizeToolsArray(parseJSON(r.tools_json, []));
      const signatures = parseJSON(r.signatures_json, {});
      const returnTools = normalizeToolsArray(
        parseJSON(r.returnTools_json, [])
      );
      return {
        date: toISO10(r.date) || r.date,

        packages: Number(r.packages || 0) || 0,
        delivery: r.delivery || null,
        shipping: !!r.shipping,
        comment: r.comment || "",
        tools,
        signatures,
        returnDate: toISO10(r.returnDate) || r.returnDate || null,

        returnPackages:
          r.returnPackages != null ? Number(r.returnPackages) || 0 : null,
        returnDelivery: r.returnDelivery || null,
        returnShipping: !!r.returnShipping,
        returnTools,
      };
    }),
  };
}

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
const SIGNATURES_DIR = path.join(ROOT, "signatures");
const GENERATED_DIR = path.join(ROOT, "generated");

/* 🔎 Розумний вибір файлу печатки (png/jpg), шукаємо у кількох місцях */
function resolveSealFile() {
  const candidates = [
    // 1) локально у бекенді (assets/seal.*)
    path.join(ROOT, "assets", "seal.png"),
    path.join(ROOT, "assets", "seal.jpg"),
    // 2) поряд із бекендом, але через process.cwd()
    path.join(process.cwd(), "assets", "seal.png"),
    path.join(process.cwd(), "assets", "seal.jpg"),
    // 3) фронтенд: src/assets/seal.*
    path.join(process.cwd(), "src", "assets", "seal.png"),
    path.join(process.cwd(), "src", "assets", "seal.jpg"),
    // 4) один рівень вгору (якщо бекенд у підпапці)
    path.join(process.cwd(), "..", "src", "assets", "seal.png"),
    path.join(process.cwd(), "..", "src", "assets", "seal.jpg"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/* ✅ Використовуємо знайдений шлях, або null */
const SEAL_FILE = resolveSealFile();

/* 🔎 Вибір дефолтного підпису працівника (staff-sign.*) */
function resolveStaffSignFile() {
  const candidates = [
    path.join(ROOT, "assets", "staff-sign.png"),
    path.join(ROOT, "assets", "staff-sign.jpg"),
    path.join(process.cwd(), "assets", "staff-sign.png"),
    path.join(process.cwd(), "assets", "staff-sign.jpg"),
    path.join(process.cwd(), "src", "assets", "staff-sign.png"),
    path.join(process.cwd(), "src", "assets", "staff-sign.jpg"),
    path.join(process.cwd(), "..", "src", "assets", "staff-sign.png"),
    path.join(process.cwd(), "..", "src", "assets", "staff-sign.jpg"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const STAFF_SIGN_FILE = resolveStaffSignFile();

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
function capFirst(s) {
  const str = String(s || "");
  return str.charAt(0).toUpperCase() + str.slice(1);
}
const PROTOCOLS_FILE = path.join(DATA_DIR, "protocols.json");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");

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

function plDate(v) {
  const iso = toISO10(v);
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function parseISO(iso) {
  if (typeof iso !== "string" || !ISO_RE.test(iso)) return null;
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function fmtISO(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
function addDaysISO(iso, days) {
  const d = parseISO(iso);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return fmtISO(d);
}
function isWeekendISO(iso) {
  const d = parseISO(iso);
  if (!d) return false;
  const wd = d.getUTCDay(); // 0=Sun..6=Sat
  return wd === 0 || wd === 6;
}
function nextBusinessDay(iso) {
  let base = addDaysISO(iso, 1);
  if (!base) return null;
  let guard = 0;
  while (isWeekendISO(base) && guard++ < 31) {
    base = addDaysISO(base, 1);
    if (!base) break;
  }
  return base;
}

/* --- Малювання --- */
const COLOR_LINE = "#d1d5db";
const COLOR_HEADER_BG = "#f3f4f6";
const COLOR_THEAD_BG = "#f7f7f8";
const COLOR_TAG_BG = "#eef2f7";

/* 👉 Параметри підписів */
const SIGN_CELL_MIN_H = 48;
const SIGN_INSET = 6;

/* ✅ Розміри шрифтів (зменшено) */
const SIZE_TITLE = 12; // (було ~18)
const SIZE_HEADER_LEFT = 9; // (було 11)
const SIZE_HEADER_RIGHT = 10; // (було 12)
const SIZE_BODY = 9; // (було 10)
const SIZE_HEADER_TH = 9; // (було 10)
const SIZE_TAG = 8; // (було 9)
const SIZE_SUM_BOLD = 9; // (було 11)
const SIZE_SEAL = 9; // (було 10)

/* ✅ Санітизація та шлях для збереження PDF */
function safeSeg(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function protocolOutPath(clientId, month, onlySigned = false) {
  const { year } = monthWord(month);

  const todayISO = new Date().toISOString().slice(0, 10);
  const baseDirName = month;

  const finalDir = path.join(GENERATED_DIR, "protocols", baseDirName);

  if (!fs.existsSync(finalDir)) {
    fs.mkdirSync(finalDir, { recursive: true });
  }

  const safeClientId = String(clientId || "")
    .trim()
    .toUpperCase();

  const fileName = `PROTOKOL_${safeClientId}_${month}${
    onlySigned ? "_PODPISANE" : ""
  }.pdf`;

  return path.join(finalDir, fileName);
}

/* ✅ Коректне отримання абсолютного шляху підпису із публічного URL */
function absSignaturePath(pub) {
  try {
    const s = String(pub || "").trim();
    if (!s) return null;
    // очікуємо щось на /signatures/...
    if (!s.startsWith("/signatures/")) return null;

    // Прибираємо префікс і отримуємо відносні частини
    const rel = decodeURIComponent(s).replace(/^\/signatures\//, "");
    const parts = rel.split("/").filter(Boolean);

    // Склейка в межах SIGNATURES_DIR (безпечна)
    const abs = path.join(SIGNATURES_DIR, ...parts);
    const resolved = path.resolve(abs);

    // Додатковий захист: не виходимо за межі SIGNATURES_DIR
    const base = path.resolve(SIGNATURES_DIR);
    if (!resolved.startsWith(base)) return null;

    return resolved;
  } catch {
    return null;
  }
}

function measureText(
  doc,
  text,
  width,
  fontName = "DejaVu",
  fontSize = SIZE_BODY,
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
    size = SIZE_BODY,
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
function drawCenteredImage(
  doc,
  imgPath,
  x,
  y,
  w,
  h,
  inset = SIGN_INSET,
  withBorder = true
) {
  if (!imgPath || !fs.existsSync(imgPath)) {
    if (withBorder) drawCellBorder(doc, x, y, w, h);
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
  if (withBorder) drawCellBorder(doc, x, y, w, h);
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
    size: SIZE_TAG,
  });
  drawCenteredImage(doc, imgTopPath, x, y + labelH, w, signH);
  drawTextInCell(doc, labelBottom, x, y + labelH + signH, w, labelH, {
    align: "center",
    vAlign: "middle",
    font: "DejaVuBold",
    size: SIZE_TAG,
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
  doc.fontSize(SIZE_TITLE);
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
  const rightTitle = `${capFirst(word)} ${year}`;

  const leftText = leftLines.map((l) => l.val).join("\n");
  const hLeft = measureText(
    doc,
    leftText,
    leftW - pad * 2,
    "DejaVu",
    SIZE_HEADER_LEFT,
    4,
    "left"
  );
  const hRight = measureText(
    doc,
    rightTitle,
    rightW - pad * 2,
    "DejaVuBold",
    SIZE_HEADER_RIGHT,
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
    doc.fontSize(SIZE_HEADER_LEFT);
    doc.text(row.val, lx, ly, {
      width: leftW - pad * 2,
      align: "left",
      lineGap: 4,
    });
    ly = doc.y;
  }
  setFont(doc, "DejaVuBold");
  doc.fontSize(SIZE_HEADER_RIGHT);
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
        SIZE_HEADER_TH,
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
      size: SIZE_HEADER_TH,
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
function ensureUniqueDir(basePath) {
  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true });
    return basePath;
  }
  let i = 2;
  while (true) {
    const candidate = `${basePath} (${i})`;
    if (!fs.existsSync(candidate)) {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    }
    i++;
  }
}

/* --- Таблиця --- */
function drawTable(doc, proto, { onlySigned = false } = {}) {
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x0 = doc.page.margins.left;
  let y = doc.y;
  doc.strokeColor(COLOR_LINE);

  const W_LP = 36,
    W_DATE_T = 72,
    W_NAME = 114,
    W_QTY = 36,
    W_SIGN = 84,
    W_DATE_R = 72;

  const sumFirst10 =
    W_LP +
    W_DATE_T +
    W_NAME +
    W_QTY +
    W_SIGN +
    W_SIGN +
    W_DATE_R +
    W_QTY +
    W_SIGN +
    W_SIGN;
  const W_COMMENT = Math.max(80, pageW - sumFirst10);

  const widths = [
    W_LP,
    W_DATE_T,
    W_NAME,
    W_QTY,
    W_SIGN,
    W_SIGN,
    W_DATE_R,
    W_QTY,
    W_SIGN,
    W_SIGN,
    W_COMMENT,
  ];

  const headers = [
    "L.p.",
    "Data przekazania",
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

  const ymdKey = (s) => {
    const [Y, M, D] = String(s || "")
      .split("-")
      .map((n) => parseInt(n, 10) || 0);
    return Y * 10000 + M * 100 + D;
  };
  const rows = (Array.isArray(proto.entries) ? proto.entries : [])
    .filter((e) => e && e.date)
    .slice()
    .sort((a, b) => ymdKey(a.date) - ymdKey(b.date));

  let lp = 0;
  let sumPackagesIncluded = 0;

  for (const row of rows) {
    const hasPairTransfer =
      row?.signatures?.transfer?.client && row?.signatures?.transfer?.staff;
    const hasPairReturn =
      row?.signatures?.return?.client && row?.signatures?.return?.staff;
    if (onlySigned && !hasPairTransfer && !hasPairReturn) continue;
    lp += 1;
    sumPackagesIncluded += Number(row.packages || 0) || 0;

    const tTools = Array.isArray(row.tools)
      ? row.tools.filter((t) => t && t.name)
      : [];
    const rTools =
      Array.isArray(row.returnTools) && row.returnTools.length
        ? row.returnTools.filter((t) => t && t.name)
        : tTools;

    const nameLines = tTools.map((t) => String(t.name || ""));
    const qtyLeftArr = tTools.map((t) => String(Number(t.count || 0) || 0));
    const qtyRightArr = rTools.map((t) => String(Number(t.count || 0) || 0));

    const tags = [];
    if (row.shipping) tags.push("Wysyłka");
    if (row.delivery === "odbior") tags.push("Dojazd x1");
    else if (row.delivery === "dowoz") tags.push("Dojazd x1");
    else if (row.delivery === "odbior+dowoz") tags.push("Dojazd x2");
    const commentTop = tags.join(" • ");
    const commentText = String(row.comment || "");

    // дати
    const transferDateISO = toISO10(row.date) || null;
    const rDateISO =
      toISO10(row.returnDate) ||
      (transferDateISO && nextBusinessDay(transferDateISO)) ||
      "";

    // висоти
    setFont(doc, "DejaVu");
    doc.fontSize(SIZE_BODY);

    const nameW = widths[2] - 8; // інсет 4 з кожного боку
    const nameLineHeights = nameLines.map((txt) =>
      doc.heightOfString(txt || "—", {
        width: nameW,
        align: "left",
        lineGap: 2,
      })
    );
    const namesHeight = nameLineHeights.reduce((a, b) => a + b, 0) + 8; // + інсети зверху/знизу

    const hDateT =
      Math.ceil(
        measureText(
          doc,
          plDate(transferDateISO),
          widths[1] - 8,
          "DejaVu",
          SIZE_BODY,
          2,
          "center"
        )
      ) + 8;

    const hQtyLeft =
      Math.ceil(
        measureText(
          doc,
          qtyLeftArr.join("\n") || "—",
          widths[3] - 8,
          "DejaVu",
          SIZE_BODY,
          2,
          "right"
        )
      ) + 8;

    const hQtyRight =
      Math.ceil(
        measureText(
          doc,
          qtyRightArr.join("\n") || "—",
          widths[7] - 8,
          "DejaVu",
          SIZE_BODY,
          2,
          "right"
        )
      ) + 8;

    const hDateR =
      Math.ceil(
        measureText(
          doc,
          plDate(rDateISO),
          widths[6] - 8,
          "DejaVu",
          SIZE_BODY,
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
          widths[10] - 8,
          "DejaVu",
          SIZE_BODY,
          2,
          "left"
        )
      ) + 8;

    const rowH = Math.max(
      SIGN_CELL_MIN_H,
      hDateT,
      namesHeight,
      hQtyLeft,
      hDateR,
      hQtyRight,
      hCommentTag + hCommentBody
    );

    const sumH = 24;
    ensurePageSpace(doc, rowH + sumH + 6, paintHeader);

    let x = x0;

    drawTextInCell(doc, String(lp), x, y, widths[0], rowH, {
      align: "center",
      vAlign: "middle",
      size: SIZE_BODY,
    });
    x += widths[0];

    drawTextInCell(doc, plDate(transferDateISO), x, y, widths[1], rowH, {
      align: "center",
      vAlign: "middle",
      size: SIZE_BODY,
    });
    x += widths[1];
    // Назви (мультилайн з підблоками)
    drawCellBorder(doc, x, y, widths[2], rowH);
    let yNames = y + 4;
    for (let i = 0; i < nameLines.length; i++) {
      doc.text(nameLines[i] || "—", x + 4, yNames, {
        width: widths[2] - 8,
        align: "left",
        lineGap: 2,
      });
      yNames += nameLineHeights[i];
    }
    x += widths[2];

    // Кількість (вирівнювання по висотах підблоків назв, по центру кожного підблоку)
    drawCellBorder(doc, x, y, widths[3], rowH);
    let yQtyL = y + 4;
    const oneQtyLH = doc.heightOfString("0", {
      width: widths[3] - 8,
      align: "right",
      lineGap: 2,
    });
    for (let i = 0; i < nameLines.length; i++) {
      const q = qtyLeftArr[i] ?? "";
      const blkH = nameLineHeights[i];
      const qY = yQtyL + Math.max(0, (blkH - oneQtyLH) / 2);
      doc.text(q, x + 4, qY, { width: widths[3] - 8, align: "right" });
      yQtyL += blkH;
    }
    x += widths[3];

    drawCenteredImage(
      doc,
      absSignaturePath(row?.signatures?.transfer?.client),
      x,
      y,
      widths[4],
      rowH
    );
    x += widths[4];

    const transferStaffAbs = absSignaturePath(row?.signatures?.transfer?.staff);
    const transferStaffPath =
      transferStaffAbs && fs.existsSync(transferStaffAbs)
        ? transferStaffAbs
        : STAFF_SIGN_FILE;

    drawCenteredImage(doc, transferStaffPath, x, y, widths[5], rowH);
    x += widths[5];

    drawTextInCell(doc, plDate(rDateISO), x, y, widths[6], rowH, {
      align: "center",
      vAlign: "middle",
      size: SIZE_BODY,
    });
    x += widths[6];

    drawCellBorder(doc, x, y, widths[7], rowH);
    let yQtyR = y + 4;
    const oneQtyRH = doc.heightOfString("0", {
      width: widths[7] - 8,
      align: "right",
      lineGap: 2,
    });
    for (let i = 0; i < nameLines.length; i++) {
      const q = qtyRightArr[i] ?? "";
      const blkH = nameLineHeights[i];
      const qY = yQtyR + Math.max(0, (blkH - oneQtyRH) / 2);
      doc.text(q, x + 4, qY, { width: widths[7] - 8, align: "right" });
      yQtyR += blkH;
    }
    x += widths[7];

    drawCenteredImage(
      doc,
      absSignaturePath(row?.signatures?.return?.client),
      x,
      y,
      widths[8],
      rowH
    );
    x += widths[8];

    const returnStaffAbs = absSignaturePath(row?.signatures?.return?.staff);
    const returnStaffPath =
      returnStaffAbs && fs.existsSync(returnStaffAbs)
        ? returnStaffAbs
        : STAFF_SIGN_FILE;

    drawCenteredImage(doc, returnStaffPath, x, y, widths[9], rowH);
    x += widths[9];

    if (commentTop) {
      const tagH = 18;
      const bodyH = rowH - tagH;
      doc.save();
      doc
        .fillColor(COLOR_TAG_BG)
        .rect(x + 2, y + 2, widths[10] - 4, tagH - 4)
        .fill();
      doc.restore();
      drawTextInCell(doc, commentTop, x, y, widths[10], tagH, {
        align: "left",
        vAlign: "middle",
        font: "DejaVuBold",
        size: SIZE_TAG,
      });
      drawTextInCell(
        doc,
        commentText || "—",
        x,
        y + tagH,
        widths[10],
        Math.max(0, bodyH),
        { align: "left", vAlign: "top", size: SIZE_BODY }
      );
    } else {
      drawTextInCell(doc, commentText || "—", x, y, widths[10], rowH, {
        align: "left",
        vAlign: "top",
        size: SIZE_BODY,
      });
    }

    y += rowH;
    doc.y = y;

    const tPackages = Number(row.packages || 0) || 0;
    const rawRP = row.returnPackages;
    const pkgsR =
      rawRP == null || rawRP === "" || Number(rawRP) <= 0
        ? tPackages
        : Number(rawRP) || tPackages;

    doc.save();
    doc.fillColor(COLOR_HEADER_BG).rect(x0, y, pageW, sumH).fill();
    doc.restore();
    doc.strokeColor(COLOR_LINE);

    let sx = x0;

    drawCellBorder(doc, sx, y, widths[0], sumH);
    sx += widths[0];

    drawCellBorder(doc, sx, y, widths[1], sumH);
    sx += widths[1];

    drawTextInCell(doc, "Pakiety", sx, y, widths[2], sumH, {
      align: "left",
      vAlign: "middle",
      font: "DejaVuBold",
      size: SIZE_SUM_BOLD,
    });
    sx += widths[2];

    drawTextInCell(doc, String(tPackages), sx, y, widths[3], sumH, {
      align: "right",
      vAlign: "middle",
      font: "DejaVuBold",
      size: SIZE_SUM_BOLD,
    });
    sx += widths[3];

    drawCellBorder(doc, sx, y, widths[4], sumH);
    sx += widths[4];
    drawCellBorder(doc, sx, y, widths[5], sumH);
    sx += widths[5];

    drawCellBorder(doc, sx, y, widths[6], sumH);
    sx += widths[6];

    drawTextInCell(doc, String(pkgsR), sx, y, widths[7], sumH, {
      align: "right",
      vAlign: "middle",
      font: "DejaVuBold",
      size: SIZE_SUM_BOLD,
    });
    sx += widths[7];

    drawCellBorder(doc, sx, y, widths[8], sumH);
    sx += widths[8];
    drawCellBorder(doc, sx, y, widths[9], sumH);
    sx += widths[9];

    drawCellBorder(doc, sx, y, widths[10], sumH);

    y += sumH;
    doc.y = y;
  }

  const totalRows = lp;
  const totalPackages = sumPackagesIncluded;

  const rightBoxW = 220;
  const leftW = pageW - rightBoxW - 8;
  const rowH = 24;

  /* 🔥 НОВЕ: динамічна висота правої комірки під печатку */
  const insetSeal = 10;
  let rightBoxH = rowH * 2;
  let sealImg = null;
  let sealDrawW = 0,
    sealDrawH = 0;
  const CM = 28.3464567;
  const DESIRED_SEAL_W = 4.5 * CM; // ≈ 127.56 pt (4.5 cm)

  if (proto && proto.summarized && SEAL_FILE && fs.existsSync(SEAL_FILE)) {
    try {
      const img = doc.openImage(SEAL_FILE);
      sealImg = img;

      /* Спочатку — під ширину 4.5 см (але не більше за fitW) */
      const fitW0 = rightBoxW - insetSeal * 2; // доступна ширина комірки
      let targetW = Math.min(DESIRED_SEAL_W, fitW0);
      const dh0 = (img.height * targetW) / img.width;

      /* Підіймаємо висоту комірки, щоб печатка влізла по висоті з відступами */
      rightBoxH = Math.max(rightBoxH, dh0 + insetSeal * 2);

      /* Тепер реальний "fit" у комірку — обмежуємо по ширині+висоті */
      const fitW = rightBoxW - insetSeal * 2;
      const fitH = rightBoxH - insetSeal * 2;

      const k = Math.min(
        fitW / img.width,
        fitH / img.height,
        targetW / img.width
      );
      sealDrawW = img.width * k;
      sealDrawH = img.height * k;
    } catch (e) {
      // якщо картинка битась — пропускаємо
    }
  }

  /* Загальна висота блоку (з урахуванням правої комірки) */
  const blockH = Math.max(rowH * 2, rightBoxH) + 8;

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

  // LEFT — підсумки (2 рядки)
  doc.save();
  doc.fillColor(COLOR_HEADER_BG).rect(x0l, y0l, leftW, rowH).fill();
  doc
    .fillColor(COLOR_HEADER_BG)
    .rect(x0l, y0l + rowH, leftW, rowH)
    .fill();
  doc.restore();
  setFont(doc, "DejaVuBold");
  doc.fontSize(SIZE_SUM_BOLD);
  doc.fillColor("#000");
  doc.text(
    `Razem przekazań: ${totalRows}`,
    x0l + 8,
    y0l + (rowH - SIZE_SUM_BOLD) / 2,
    {
      width: leftW - 16,
      align: "left",
    }
  );
  doc.text(
    `Razem pakietów: ${totalPackages}`,
    x0l + 8,
    y0l + rowH + (rowH - SIZE_SUM_BOLD) / 2,
    { width: leftW - 16, align: "left" }
  );
  drawCellBorder(doc, x0l, y0l, leftW, rowH);
  drawCellBorder(doc, x0l, y0l + rowH, leftW, rowH);

  // RIGHT — комірка під печатку (динамічна висота)
  doc.save();
  doc.fillColor("#fff").rect(x0r, y0r, rightBoxW, rightBoxH).fill();
  doc.restore();
  drawCellBorder(doc, x0r, y0r, rightBoxW, rightBoxH);

  setFont(doc, "DejaVu");
  doc.fontSize(SIZE_SEAL);
  doc.text("Miejsce na pieczęć", x0r + 8, y0r + 6, {
    width: rightBoxW - 16,
    align: "center",
  });

  // ✅ Печатка
  if (sealImg) {
    try {
      const ix = x0r + (rightBoxW - sealDrawW) / 2;
      const iy = y0r + (rightBoxH - sealDrawH) / 2;
      doc.image(sealImg, ix, iy, { width: sealDrawW, height: sealDrawH });
    } catch (e) {
      // якщо не вдалось намалювати — нічого не робимо
    }
  }
}

/* --- Рендер одного PDF --- */
function renderProtocol(doc, client, proto, onlySigned = false) {
  registerPdfFonts(doc);
  doc.strokeColor(COLOR_LINE);
  doc.fillColor("#000");
  doc.fontSize(SIZE_BODY);
  setFont(doc, "DejaVu");
  drawHeaderSection(doc, client, proto);
  drawTable(doc, proto, { onlySigned });
}

/* --- createProtocolPDF: підтримка обох способів + ✅ збереження на диск --- */
async function createProtocolPDF(arg1, arg2) {
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

      doc.info.Producer = "pdfkit";
      doc.end();
      if (typeof doc.flushPages === "function") {
        doc.flushPages();
      }
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
      const cli = await loadClientById(clientId);
      const protoDb = await loadProtocolFull(clientId, month);
      const onlySigned = String(req.query.onlySigned || "") === "1";
      const client = cli,
        proto = { id: clientId, month, ...protoDb };
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="PROTOKOL_${clientId}_${month}${
          onlySigned ? "_PODPISANE" : ""
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
async function createProtocolZip(req, res) {
  if (!PDFDocument)
    return res.status(500).send("Brak modułu pdfkit. npm i pdfkit");

  const { month } = req.params;
  const onlySigned = String(req.query.onlySigned || "") === "1";

  const archive = archiver("zip", { zlib: { level: 9 } });
  res.attachment(`protokoły_${month}${onlySigned ? "_podpisane" : ""}.zip`);

  archive.on("error", (err) => {
    console.error("zip error:", err);
    try {
      res.status(500).end();
    } catch {}
  });

  archive.pipe(res);

  const clients = readClients();
  const all = readProtocols().filter((p) => p.month === month);

  const pdfToBuffer = (client, proto, onlySignedFlag) =>
    new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 28,
      });

      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      try {
        renderProtocol(doc, client, proto, onlySignedFlag);

        doc.info.Producer = "pdfkit";
        doc.end();
        if (typeof doc.flushPages === "function") {
          doc.flushPages();
        }
      } catch (e) {
        reject(e);
      }
    });

  for (const proto of all) {
    try {
      const client = findClientById(clients, proto.id);
      const fn = `PROTOKOL_${String(proto.id).trim().toUpperCase()}_${month}${
        onlySigned ? "_PODPISANE" : ""
      }.pdf`;

      const buf = await pdfToBuffer(client, proto, onlySigned);

      if (buf && buf.length > 8) {
        archive.append(buf, { name: fn });
      } else {
        console.warn("Skip empty PDF:", proto.id, month);
      }
    } catch (e) {
      console.warn("PDF build failed:", proto?.id, month, e?.message || e);
    }
  }

  await archive.finalize();
}

module.exports = { createProtocolPDF, createProtocolZip };
