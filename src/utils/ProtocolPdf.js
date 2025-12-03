// src/utils/ProtocolPdf.js
import jsPDF from "jspdf";

/* ========= Helpers ========= */
const MONTHS_PL = [
  "Styczeń",
  "Luty",
  "Marzec",
  "Kwiecień",
  "Maj",
  "Czerwiec",
  "Lipiec",
  "Sierpień",
  "Wrzesień",
  "Październik",
  "Listopad",
  "Grudzień",
];

const monthLabel = (ym) => {
  const parts = String(ym || "").split("-");
  const y = parts[0] || "";
  const m = parts[1] || "01";
  const idx = (Number(m) || 1) - 1;
  return { y, mWord: MONTHS_PL[idx] || m || "" };
};

const toClientId = (c) =>
  (c && (c.id || c.ID)) ||
  String((c && (c.name || c.Klient)) || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const plDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("-");
  return `${d}.${m}.${y}`;
};

const serviceLabel = (row) => {
  if (!row) return "—";
  if (row.shipping) return "Wysyłka";
  if (row.delivery === "odbior") return "Dojazd x1";
  if (row.delivery === "dowoz") return "Dojazd x1";
  if (row.delivery === "odbior+dowoz") return "Dojazd x2";
  return "—";
};


/* ========= Unicode font loader (кеш/параметри) ========= */

let FONT_URL_REG = "/fonts/DejaVuSans.ttf";
let FONT_URL_BOLD = "/fonts/DejaVuSans-Bold.ttf";


let FONT_BASE64_REG = null;
let FONT_BASE64_BOLD = null;
let FONT_READY = false;
let FONT_SOURCE_KEY = ""; // унікальний ключ джерела шрифтів (щоб не плутати кеш при інших URL)

function arrayBufferToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Завантажує TTF і кешує як base64; якщо URL змінено — перезавантажує. */
export async function ensureProtocolPdfFonts(urlReg, urlBold) {
  const regUrl = urlReg || FONT_URL_REG;
  const boldUrl = urlBold || FONT_URL_BOLD;
  const key = `${regUrl}||${boldUrl}`;

  if (
    FONT_READY &&
    FONT_SOURCE_KEY === key &&
    FONT_BASE64_REG &&
    FONT_BASE64_BOLD
  ) {
    return true;
  }

  try {
    const [regRes, boldRes] = await Promise.all([
      fetch(regUrl),
      fetch(boldUrl),
    ]);
    if (!regRes.ok || !boldRes.ok) throw new Error("font fetch failed");
    const [regBuf, boldBuf] = await Promise.all([
      regRes.arrayBuffer(),
      boldRes.arrayBuffer(),
    ]);
    FONT_BASE64_REG = arrayBufferToBase64(regBuf);
    FONT_BASE64_BOLD = arrayBufferToBase64(boldBuf);
    FONT_READY = true;
    FONT_SOURCE_KEY = key;
    FONT_URL_REG = regUrl;
    FONT_URL_BOLD = boldUrl;
    return true;
  } catch (e) {
    console.warn("PDF font load failed:", e);
    FONT_READY = false;
    return false;
  }
}

/** Сумісний аліас; приймає (регулярний, жирний) URL — як у твоєму коді з DejaVu. */
export async function registerProtocolPdfFontFromUrl(regUrl, boldUrl) {
  return ensureProtocolPdfFonts(regUrl, boldUrl);
}

/** Прив’язуємо шрифт до конкретного документа jsPDF (якщо завантажено). */
function useUnicodeFont(doc) {
  if (!FONT_READY) return false;
  try {
    doc.addFileToVFS("AppFont-Regular.ttf", FONT_BASE64_REG);
    doc.addFont("AppFont-Regular.ttf", "AppFont", "normal");
    doc.addFileToVFS("AppFont-Bold.ttf", FONT_BASE64_BOLD);
    doc.addFont("AppFont-Bold.ttf", "AppFont", "bold");
    doc.setFont("AppFont", "normal");
    return true;
  } catch (e) {
    console.warn("PDF font attach failed:", e);
    return false;
  }
}

function setFont(doc, style = "normal") {
  const list = doc.getFontList() || {};
  const hasUnicode = !!list.AppFont;
  if (hasUnicode) {
    doc.setFont("AppFont", style === "bold" ? "bold" : "normal");
  } else {
    doc.setFont("helvetica", style === "bold" ? "bold" : "normal");
  }
}

/* ========= Основна функція генерації (синхронна) ========= */
export function buildProtocolPdf({ month, client, protocol, options = {} }) {
  const landscape = options.landscape !== false; // за замовчанням — landscape
  const doc = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "pt",
    format: "a4",
    compress: true,
  });

  // Якщо шрифт уже завантажено — підключимо. Якщо ні — fallback на Helvetica (буде ОК).
  useUnicodeFont(doc);

  const margin = 36; // 0.5"
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - margin * 2;

  let x = margin;
  let y = margin;

  // Заголовок (менший) + відступ
  setFont(doc, "normal");
  doc.setFontSize(12);
  doc.text("Protokół przekazania narzędzi", pageW / 2, y, { align: "center" });
  y += 10;

  // Дані клієнта + період — один сірий блок на всю ширину
  const ml = monthLabel(month);
  const year = ml.y;
  const mWord = ml.mWord;

  const clientName = String((client && (client.name || client.Klient)) || "—");
  const clientAddr =
    (client &&
      (client.address ||
        client.Adres ||
        [
          [client.street, client.city].filter(Boolean).join(" "),
          [client.postal, client.post || client.miejscowosc]
            .filter(Boolean)
            .join(", "),
        ]
          .filter(Boolean)
          .join(" "))) ||
    "—";

  const nip =
    client &&
    (client.nip ||
      client.NIP ||
      client.vat ||
      client.VAT ||
      client.taxId ||
      client.TaxId);
  const pesel = client && (client.pesel || client.PESEL);
  const taxLabel = nip ? "NIP" : pesel ? "PESEL" : "NIP/PESEL";
  const taxValue = nip || pesel || "—";
  const clientId = toClientId(client);

  const bandPadX = 10;
  const bandPadY = 8;
  const lineGap = 12;

  const leftLines = 4;
  const rightLines = 2;
  const bandH =
    Math.max(leftLines * lineGap, rightLines * lineGap) + bandPadY * 2 + 6;

  doc.setDrawColor(224, 224, 224);
  doc.setFillColor(243, 244, 246);
  doc.rect(x, y, usableW, bandH, "FD");

  // LEFT
  let ly = y + bandPadY + 12;
  setFont(doc, "bold");
  doc.setFontSize(10);
  doc.text(clientName, x + bandPadX, ly);
  setFont(doc, "normal");
  doc.setFontSize(9);
  ly += lineGap;
  doc.text(clientAddr, x + bandPadX, ly);
  ly += lineGap;
  doc.text(`${taxLabel}: ${taxValue}`, x + bandPadX, ly);
  ly += lineGap;
  doc.text(`ID: ${clientId}`, x + bandPadX, ly);

  // RIGHT
  const rx = x + usableW - bandPadX;
  let ry = y + bandPadY + 12;
  setFont(doc, "normal");
  doc.setFontSize(9);
  doc.text("Okres", rx, ry, { align: "right" });
  ry += lineGap;
  setFont(doc, "bold");
  doc.setFontSize(10);
  doc.text(`${mWord} ${year}`, rx, ry, { align: "right" });

  y += bandH + 10;

  // === Таблиця ===
  const baseCols = [
    { title: "L.p.", w: 24, align: "center" },
    { title: "Data\nprzekazania", w: 62, align: "center" },
    { title: "Nazwa\nnarzędzi", w: 172, align: "left" },
    { title: "Ilość", w: 54, align: "center" },
    { title: "Podpis\nUsługobiorcy", w: 70, align: "center" },
    { title: "Podpis\nUsługodawcy", w: 70, align: "center" },
    { title: "Data\nzwrotu", w: 62, align: "center" },
    { title: "Ilość", w: 54, align: "center" },
    { title: "Podpis\nUsługobiorcy", w: 70, align: "center" },
    { title: "Podpis\nUsługodawcy", w: 70, align: "center" },
    { title: "Komentarz", w: 62, align: "left" },
  ];
  // Підганяємо останню колонку рівно до доступної ширини (один раз).
  const cols = baseCols.map((c) => ({ ...c }));
  {
    const sumW = cols.reduce((a, c) => a + c.w, 0);
    if (sumW !== usableW) cols[cols.length - 1].w += usableW - sumW;
  }

  // Заголовок таблиці (з переносами)
  const thH = 30;
  const headLineH = 10;
  setFont(doc, "normal");
  doc.setFontSize(9);

  let cx = x;
  for (const c of cols) {
    doc.setDrawColor(230, 232, 235);
    doc.setFillColor(248, 250, 252);
    doc.rect(cx, y, c.w, thH, "F");
    const lines = String(c.title).split("\n");
    const startY = y + (thH - headLineH * lines.length) / 2 + 8;
    lines.forEach((ln, i) => {
      const ty = startY + i * headLineH;
      const tx = c.align === "center" ? cx + c.w / 2 : cx + 6;
      doc.text(ln, tx, ty, { align: c.align === "center" ? "center" : "left" });
    });
    cx += c.w;
  }
  y += thH;

  // Рядки
  const rows = Array.isArray(protocol && protocol.entries)
    ? protocol.entries
    : [];
  doc.setFontSize(9);
  const contentLineH = 14; // трохи більший міжрядковий інтервал
  const rowHmin = 22;
  const footerReserve = 90; // місце під підсумок/штамп
  let totalPackages = 0;

  const drawHeaderOnNewPage = () => {
    // коротка шапка на наступних сторінках
    setFont(doc, "normal");
    doc.setFontSize(10);
    doc.text(clientName, x, y);
    doc.text(`${mWord} ${year}`, pageW - margin, y, { align: "right" });
    y += 14;

    // заголовок таблиці знову
    setFont(doc, "normal");
    doc.setFontSize(9);
    let cxx = x;
    for (const c of cols) {
      doc.setDrawColor(230, 232, 235);
      doc.setFillColor(248, 250, 252);
      doc.rect(cxx, y, c.w, thH, "F");
      const lines = String(c.title).split("\n");
      const startY = y + (thH - headLineH * lines.length) / 2 + 8;
      lines.forEach((ln, ii) => {
        const ty = startY + ii * headLineH;
        const tx = c.align === "center" ? cxx + c.w / 2 : cxx + 6;
        doc.text(ln, tx, ty, {
          align: c.align === "center" ? "center" : "left",
        });
      });
      cxx += c.w;
    }
    y += thH;
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const tTools = (r.tools || []).filter((t) => t && t.name);
    const rTools = (
      (r.returnTools && r.returnTools.length ? r.returnTools : r.tools) || []
    ).filter((t) => t && t.name);

    const namesLines = tTools.length
      ? tTools.map((t) => String(t.name || ""))
      : ["—"];
    namesLines.push("Pakiety");

    const qty1Lines = tTools.length
      ? tTools.map((t) => String(t.count != null ? t.count : ""))
      : ["—"];
    qty1Lines.push(String(Number(r.packages || 0) || 0));

    const qty2Lines = rTools.length
      ? rTools.map((t) => String(t.count != null ? t.count : ""))
      : ["—"];
    const returnPkgs =
      r && r.returnPackages != null
        ? r.returnPackages
        : r && r.packages != null
        ? r.packages
        : 0;
    qty2Lines.push(String(+returnPkgs || 0));

    const maxLines = Math.max(
      namesLines.length,
      qty1Lines.length,
      qty2Lines.length
    );
    const rowH = Math.max(rowHmin, maxLines * contentLineH + 6);

    // Перенос на нову сторінку — без розриву рядка
    if (y + rowH > pageH - margin - footerReserve) {
      doc.addPage({ orientation: landscape ? "landscape" : "portrait" });
      // reset координат (ширини колонок вже підігнані й сталі)
      y = margin;
      x = margin;
      drawHeaderOnNewPage();
    }

    // Сітка рядка
    cx = x;
    for (const c of cols) {
      doc.setDrawColor(230, 232, 235);
      doc.rect(cx, y, c.w, rowH);
      cx += c.w;
    }

    // Запис у клітинки
    let colX = x;
    const writeCell = (lines, w, align, boldLast = false) => {
      const arr = Array.isArray(lines)
        ? lines
        : [String(lines != null ? lines : "—")];
      for (let li = 0; li < arr.length; li++) {
        const s = String(arr[li]);
        const isLast = boldLast && li === arr.length - 1;
        setFont(doc, isLast ? "bold" : "normal");
        const ty = y + 12 + li * contentLineH;
        const tx = align === "center" ? colX + w / 2 : colX + 6;
        doc.text(s, tx, ty, { align: align === "center" ? "center" : "left" });
      }
      colX += w;
    };

    const centerSig = (w, sig) => {
      if (!sig) {
        setFont(doc, "normal");
        doc.setFontSize(8);
        doc.text("—", colX + w / 2, y + rowH / 2, { align: "center" });
        doc.setFontSize(9);
      } else {
        try {
          const h = 24;
          const iw = w - 12;
          const yImg = y + (rowH - h) / 2;
          doc.addImage(
            sig,
            "PNG",
            colX + (w - iw) / 2,
            yImg,
            iw,
            h,
            "",
            "FAST"
          );
        } catch {
          doc.text("—", colX + w / 2, y + rowH / 2, { align: "center" });
        }
      }
      colX += w;
    };

    // L.p.
    writeCell(String(i + 1), cols[0].w, "center");
    // Data przekazania
    writeCell(plDate(r.date), cols[1].w, "center");
    // Nazwa narzędzi — знизу сірий “Pakiety”
    {
      const w = cols[2].w;
      const blockY = y + 6 + (namesLines.length - 1) * contentLineH - 6;
      doc.setFillColor(229, 231, 235);
      doc.rect(colX, blockY, w, contentLineH + 6, "F");
      writeCell(namesLines, w, "left", false);
    }
    // Ilość (przek.) — останнє жирним
    writeCell(qty1Lines, cols[3].w, "center", true);
    // Підписи (przek.)
    centerSig(
      cols[4].w,
      r && r.signatures && r.signatures.transfer
        ? r.signatures.transfer.client
        : null
    );
    centerSig(
      cols[5].w,
      r && r.signatures && r.signatures.transfer
        ? r.signatures.transfer.staff
        : null
    );
    // Data zwrotu (поки порожня)
    writeCell("", cols[6].w, "center");
    // Ilość (zwrot) — останнє жирним
    writeCell(qty2Lines, cols[7].w, "center", true);
    // Підписи (zwrot)
    centerSig(
      cols[8].w,
      r && r.signatures && r.signatures.return
        ? r.signatures.return.client
        : null
    );
    centerSig(
      cols[9].w,
      r && r.signatures && r.signatures.return
        ? r.signatures.return.staff
        : null
    );
    // Komentarz — лише назва послуги
    writeCell(
      (() => {
        const s = serviceLabel(r);
        return s === "—" ? "" : s;
      })(),
      cols[10].w,
      "left",
      false
    );

    y += rowH;
    totalPackages += Number((r && r.packages) || 0) || 0;
  }

  // Відступ під таблицею + підсумки
  y += 16;
  setFont(doc, "bold");
  doc.text(`Razem przekazań: ${rows.length}`, x, y);
  doc.text(`Razem pakietów: ${totalPackages}`, x + 220, y);

  // Підпис/штамп внизу сторінки
  setFont(doc, "normal");
  doc.setFontSize(8);
  doc.text("Miejsce na pieczątkę i podpis usługodawcy", x, pageH - 20);

  // Файл
  const fileName = `Protokół_${mWord || ""}_${year || ""}_${
    clientName || "klient"
  }.pdf`;
  const dataUrl = doc.output("datauristring");
  return { doc, fileName, dataUrl };
}
