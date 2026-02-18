const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { query } = require("../../../../server/db");

function mm(n) {
  return (n * 72) / 25.4;
}
function px(n) {
  return n * 0.75;
}
function findFirst(paths) {
  for (const p of paths) if (p && fs.existsSync(p)) return p;
  return null;
}

function isoDate(d) {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return String(d || "").slice(0, 10);
  }
}

function truncateToWidth(doc, text, maxW) {
  const t = String(text ?? "");
  if (!t) return "";
  if (doc.widthOfString(t) <= maxW) return t;

  const ell = "…";
  let lo = 0;
  let hi = t.length;

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const s = t.slice(0, mid) + ell;
    if (doc.widthOfString(s) <= maxW) lo = mid;
    else hi = mid - 1;
  }

  const out = t.slice(0, lo) + ell;
  return out;
}

module.exports = async function generateBatchPDF(reports) {
  if (!Array.isArray(reports) || !reports.length) {
    throw new Error("No reports provided");
  }

  const osoba = "Dmytro Sirenko";

  const outDir = path.join(process.cwd(), "generated", "disinfection");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const allDates = reports.map((r) => isoDate(r.report_date));
  const uniqueDates = [...new Set(allDates)].sort();

  const fileName = `ewidencja_dezynfekcji_${uniqueDates[0]}_${
    uniqueDates[uniqueDates.length - 1]
  }.pdf`;
  const outPath = path.join(outDir, fileName);

  const FONT_REG = findFirst([
    path.join(process.cwd(), "public/fonts/DejaVuSans.ttf"),
  ]);
  const FONT_BOLD = findFirst([
    path.join(process.cwd(), "public/fonts/DejaVuSans-Bold.ttf"),
    FONT_REG,
  ]);

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: mm(10), left: mm(10), right: mm(10), bottom: mm(10) },
  });

  const ws = fs.createWriteStream(outPath);
  doc.pipe(ws);

  if (FONT_REG) doc.registerFont("R", FONT_REG);
  if (FONT_BOLD) doc.registerFont("B", FONT_BOLD);

  const washerMap = { W1: "№1", W2: "№2", MANUAL: "Wanienka" };

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const m = doc.page.margins;
  const innerW = pageW - m.left - m.right;

  // ======== KONFIGURACJA SZEROKOŚCI KOLUMN (%) ========
  const colPercent = {
    nr: 6,
    washer: 8,
    disinfectant: 20,
    concentration: 6,
    time: 7,
    clients: 38,
    person: 15,
  };
  // =====================================================

  const colW = {
    nr: innerW * (colPercent.nr / 100),
    washer: innerW * (colPercent.washer / 100),
    disinfectant: innerW * (colPercent.disinfectant / 100),
    concentration: innerW * (colPercent.concentration / 100),
    time: innerW * (colPercent.time / 100),
    clients: innerW * (colPercent.clients / 100),
    person: innerW * (colPercent.person / 100),
  };

  const cols = [
    { key: "nr", title: "Nr", w: colW.nr },
    { key: "washer", title: "Myjka", w: colW.washer },
    { key: "disinfectant", title: "Środek", w: colW.disinfectant },
    { key: "concentration", title: "Stęż.", w: colW.concentration },
    { key: "time", title: "Czas", w: colW.time },
    { key: "clients", title: "Klienci", w: colW.clients },
    { key: "person", title: "Odpowiedzialny", w: colW.person },
  ];

  const x0 = m.left;
  let y = m.top;

  const periodFrom = uniqueDates[0];
  const periodTo = uniqueDates[uniqueDates.length - 1];

  doc
    .font("B")
    .fontSize(px(14))
    .text(
      `EWIDENCJA DEZYNFEKCJI INSTRUMENTÓW ZA OKRES ${periodFrom} – ${periodTo}`,
      x0,
      y,
      {
        width: innerW,
        align: "center",
      }
    );

  y = doc.y + mm(4);

  const headerH = mm(7);
  const baseRowH = mm(16);
  const cellPadX = mm(1.8);

  function ensureSpace(needH) {
    if (y + needH > pageH - m.bottom) {
      doc.addPage();
      y = m.top;
    }
  }

  function drawTableHeader(topY) {
    doc.save().rect(x0, topY, innerW, headerH).fill("#e5e5e5").restore();
    doc.rect(x0, topY, innerW, headerH).stroke();

    doc.font("B").fontSize(px(9));

    let cx = x0;
    for (const c of cols) {
      const t = truncateToWidth(doc, c.title, c.w - cellPadX * 2);
      doc.text(t, cx, topY + (headerH - doc.currentLineHeight()) / 2, {
        width: c.w,
        align: "center",
        lineBreak: false,
      });
      cx += c.w;
    }
  }

  function drawRowBorder(topY) {
    doc
      .moveTo(x0, topY)
      .lineTo(x0 + innerW, topY)
      .stroke();
  }

  async function loadClients(reportId) {
    const rows = await query(
      `
        SELECT COALESCE(c.id, drc.manual_identifier) AS id
        FROM disinfect_report_clients drc
        LEFT JOIN clients c ON c.id = drc.client_id
        WHERE drc.report_id=?
        ORDER BY id
      `,
      [reportId]
    );
    return rows.map((r) => String(r.id || "").trim()).filter(Boolean);
  }

  function drawClientChips(chips, x, yTop, w) {
    const chipH = mm(5.6);
    const r = 3;
    const gap = mm(1.5);

    doc.font("B").fontSize(px(9));

    let cy = yTop + mm(5);
    let row = [];
    let rowWidth = 0;
    let maxY = cy + chipH;

    function drawRow(rowChips, totalWidth) {
      let cx = x + (w - totalWidth) / 2;

      for (const chip of rowChips) {
        const chipW = chip.w;

        doc
          .save()
          .roundedRect(cx, cy, chipW, chipH, r)
          .fill("#eeeeee")
          .restore();
        doc.text(chip.text, cx, cy + mm(1.2), {
          width: chipW,
          align: "center",
          lineBreak: false,
        });

        cx += chipW + gap;
      }
    }

    for (const id of chips) {
      const text = String(id || "");
      const chipW = doc.widthOfString(text) + mm(6);

      if (rowWidth + chipW > w && row.length) {
        drawRow(row, rowWidth - gap);
        cy += chipH + gap;
        row = [];
        rowWidth = 0;
      }

      row.push({ text, w: chipW });
      rowWidth += chipW + gap;
      maxY = Math.max(maxY, cy + chipH);
    }

    if (row.length) {
      drawRow(row, rowWidth - gap);
    }

    return cy + chipH + mm(4);
  }

  function drawRowCells(topY, data) {
    doc.font("R").fontSize(px(9));

    let cx = x0;
    let maxContentBottom = topY + baseRowH;

    // ===== 1. ОБЧИСЛЮЄМО РЕАЛЬНУ ВИСОТУ =====
    for (const c of cols) {
      const val = data[c.key] ?? "";

      if (c.key === "clients") {
        const chips = Array.isArray(val) ? val : [];
        const chipsHeight = estimateClientChipsHeight(chips, c.w);
        maxContentBottom = Math.max(maxContentBottom, topY + chipsHeight);
      } else {
        const textHeight = doc.heightOfString(String(val), {
          width: c.w,
        });

        maxContentBottom = Math.max(
          maxContentBottom,
          topY + textHeight + mm(8)
        );
      }

      cx += c.w;
    }

    const rowBottom = maxContentBottom;

    // ===== 2. МАЛЮЄМО З ВЕРТИКАЛЬНИМ ЦЕНТРУВАННЯМ =====
    cx = x0;

    for (const c of cols) {
      const val = data[c.key] ?? "";

      if (c.key === "clients") {
        const chips = Array.isArray(val) ? val : [];
        const chipsHeight = estimateClientChipsHeight(chips, c.w);

        const offsetY = topY + (rowBottom - topY - chipsHeight) / 2;

        drawClientChips(chips, cx, offsetY, c.w);
      } else {
        const textHeight = doc.heightOfString(String(val), {
          width: c.w,
        });

        const textY = topY + (rowBottom - topY - textHeight) / 2;

        doc.text(String(val), cx, textY, {
          width: c.w,
          align: "center",
        });
      }

      cx += c.w;
    }

    return rowBottom;
  }
  function estimateClientChipsHeight(chips, w) {
    const chipH = mm(5.6);
    const gap = mm(1.5);

    if (!chips.length) return mm(8);

    doc.font("B").fontSize(px(9));

    let rowWidth = 0;
    let rows = 1;

    for (const id of chips) {
      const text = String(id || "");
      const chipW = doc.widthOfString(text) + mm(6);

      if (rowWidth + chipW > w && rowWidth > 0) {
        rows++;
        rowWidth = 0;
      }

      rowWidth += chipW + gap;
    }

return rows * chipH + (rows - 1) * gap + mm(10);
  }

  for (const date of uniqueDates) {
    ensureSpace(mm(14));

    doc.font("B").fontSize(px(11)).text(date, x0, y, { align: "left" });
    y = doc.y + mm(2);

    ensureSpace(headerH + baseRowH + mm(2));
    const tableTop = y;

    drawTableHeader(tableTop);
    y = tableTop + headerH;

    const dayReports = reports
      .filter((r) => isoDate(r.report_date) === date)
      .sort((a, b) => Number(a.cycle_number) - Number(b.cycle_number));

    for (const r of dayReports) {
      const clients = await loadClients(r.id);

      const rowData = {
        nr: String(r.cycle_number).padStart(4, "0"),
        washer: washerMap[r.washer] || r.washer || "",
        disinfectant: r.disinfectant_name || "",
        concentration: r.concentration || "",
        time: r.immersion_time_minutes ? `${r.immersion_time_minutes} min` : "",
        clients,
        person: osoba,
      };

      ensureSpace(baseRowH + mm(2));

      drawRowBorder(y);

      const bottomY = drawRowCells(y, rowData);

      doc.rect(x0, y, innerW, bottomY - y).stroke();

      y = bottomY;
    }

    doc
      .moveTo(x0, y)
      .lineTo(x0 + innerW, y)
      .stroke();

    y += mm(6);
  }

  doc.end();

  await new Promise((resolve, reject) => {
    ws.on("finish", resolve);
    ws.on("error", reject);
  });

  return {
    success: true,
    file: `/api/generated/disinfection/${fileName}`,
  };
};
