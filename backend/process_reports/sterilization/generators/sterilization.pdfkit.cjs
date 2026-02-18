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

function formatDuration(seconds) {
  if (!seconds) return "-";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m} min ${s} s`;
}

function findFirst(paths) {
  for (const p of paths) if (p && fs.existsSync(p)) return p;
  return null;
}

module.exports = async function generateSterilizationPDF(cycleId) {
  const [c] = await query(`SELECT * FROM sterilization_cycles WHERE id=?`, [
    cycleId,
  ]);
  if (!c) throw new Error("Cycle not found");
  if (c.status !== "APPROVED") throw new Error("Cycle not APPROVED");

  const clients = await query(
    `
    SELECT COALESCE(cl.id, scc.manual_identifier) AS id
    FROM sterilization_cycle_clients scc
    LEFT JOIN clients cl ON cl.id = scc.client_id
    WHERE scc.cycle_id=?
    ORDER BY id
    `,
    [cycleId]
  );

  const outDir = path.join(process.cwd(), "generated", "sterilization");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const datePart = c.cycle_start_datetime
    ? new Date(c.cycle_start_datetime).toISOString().slice(0, 10)
    : "no-date";

  const outPath = path.join(outDir, `cykl_${c.cycle_number}_${datePart}.pdf`);

  const FONT_REG = findFirst([
    path.join(process.cwd(), "public/fonts/DejaVuSans.ttf"),
  ]);
  const FONT_BOLD = findFirst([
    path.join(process.cwd(), "public/fonts/DejaVuSans-Bold.ttf"),
    FONT_REG,
  ]);

  const doc = new PDFDocument({
    size: [mm(210), mm(148.5)],
    margins: { top: mm(10), left: mm(10), right: mm(10), bottom: mm(10) },
  });

  const ws = fs.createWriteStream(outPath);
  doc.pipe(ws);

  doc.registerFont("R", FONT_REG);
  doc.registerFont("B", FONT_BOLD);

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const m = doc.page.margins;
  const innerW = pageW - m.left - m.right;
  const innerH = pageH - m.top - m.bottom;

  const leftW = innerW * 0.35;
  const rightW = innerW - leftW - mm(3);

  const xL = m.left;
  const xR = xL + leftW + mm(3);
  const y = m.top;

  doc
    .font("B")
    .fontSize(px(20))
    .text(`Raport sterylizacji nr ${c.cycle_number || "-"}`, m.left, y, {
      width: innerW,
      align: "center",
    });

  const topY = doc.y + mm(5);

  doc.rect(xL, topY, leftW, innerH - mm(10)).stroke();
  doc.rect(xR, topY, rightW, innerH - mm(10)).stroke();

  const rowH = mm(7);

  doc.rect(xL, topY, leftW, rowH).stroke();
  doc.rect(xL, topY + rowH, leftW, rowH).stroke();

  const dateStr = c.cycle_start_datetime
    ? new Date(c.cycle_start_datetime).toISOString().slice(0, 10)
    : "-";

  function drawLeftParam(label, value, yPos) {
    const labelSize = px(12);
    const valueSize = px(13);

    doc.font("R").fontSize(labelSize);
    const labelWidth = doc.widthOfString(label + " ");

    doc.font("B").fontSize(valueSize);
    const valueWidth = doc.widthOfString(value);

    const totalWidth = labelWidth + valueWidth;

    const startX = xL + mm(2);

    const lineHeight = Math.max(
      doc.font("R").fontSize(labelSize).currentLineHeight(),
      doc.font("B").fontSize(valueSize).currentLineHeight()
    );

    const textY = yPos + (rowH - lineHeight) / 2;

    doc
      .font("R")
      .fontSize(labelSize)
      .text(label + " ", startX, textY, {
        continued: true,
      });

    doc.font("B").fontSize(valueSize).text(value, {
      continued: false,
    });
  }

  drawLeftParam("Data:", dateStr, topY);
  drawLeftParam("Nr cyklu:", c.cycle_number || "-", topY + rowH);

  const reportY = topY + rowH * 2;
  const reportH = mm(85);

  doc.rect(xL, reportY, leftW, reportH).stroke();
  doc
    .font("R")
    .fontSize(px(12))
    .text("W tym miejscu podkleić raport", xL, reportY + reportH / 2 - mm(3), {
      width: leftW,
      align: "center",
    });

  const signH = innerH - mm(10) - (reportY + reportH - topY);
  const signY = reportY + reportH;

  doc.rect(xL, signY, leftW, signH).stroke();

  const nameSize = px(18);
  const labelSize = px(10);

  doc.font("R").fontSize(labelSize);
  const labelHeight = doc.currentLineHeight();

  doc.font("R").fontSize(nameSize);
  const nameHeight = doc.currentLineHeight();

  const labelY = signY + signH - labelHeight - mm(2);
  const nameY = labelY - nameHeight - mm(4);

  doc.font("R").fontSize(nameSize).text("Dmytro Sirenko", xL, nameY, {
    width: leftW,
    align: "center",
    oblique: true,
  });

  doc
    .font("R")
    .fontSize(labelSize)
    .text("Podpis osoby odpowiedzialnej", xL, labelY, {
      width: leftW,
      align: "center",
    });

  const headerH = mm(6);
  const paramsRowH = mm(7);
  const paramsH = headerH + paramsRowH;

  doc.rect(xR, topY, rightW, paramsH).stroke();

  doc.save().rect(xR, topY, rightW, headerH).fill("#e5e5e5").restore();
  doc.rect(xR, topY, rightW, headerH).stroke();

  const headerFontSize = px(12);

  doc.font("R").fontSize(headerFontSize);

  const textHeight = doc.currentLineHeight();
  const textY = topY + (headerH - textHeight) / 2;

  doc.text("Parametry krytyczne procesu", xR, textY, {
    width: rightW,
    align: "center",
  });
  const cellW = rightW / 3;
  const py = topY + headerH + mm(2);

  function drawParam(label, value, x) {
    const labelSize = px(12);
    const valueSize = px(13);

    doc.font("R").fontSize(labelSize);
    const labelWidth = doc.widthOfString(label + ": ");

    doc.font("B").fontSize(valueSize);
    const valueWidth = doc.widthOfString(value);

    const totalWidth = labelWidth + valueWidth;
    const startX = x + (cellW - totalWidth) / 2;

    const lineHeight = Math.max(
      doc.font("R").fontSize(labelSize).currentLineHeight(),
      doc.font("B").fontSize(valueSize).currentLineHeight()
    );

    const textY = topY + headerH + (paramsRowH - lineHeight) / 2;

    doc
      .font("R")
      .fontSize(labelSize)
      .text(label + ": ", startX, textY, {
        continued: true,
      });

    doc.font("B").fontSize(valueSize).text(value, {
      continued: false,
    });
  }

  drawParam("Temperatura", c.program || "-", xR);

  drawParam(
    "Czas",
    formatDuration(c.sterilization_duration_seconds),
    xR + cellW
  );

  drawParam(
    "Ciśnienie",
    `${c.pressure_min ?? "-"} - ${c.pressure_max ?? "-"}`,
    xR + cellW * 2
  );

  const clientsY = topY + paramsH;
  const clientsH = mm(26);
  doc.rect(xR, clientsY, rightW, clientsH).stroke();

  /* ===== INDICATOR BLOCK SAFE ===== */

  const indicatorsY = clientsY + clientsH;
  const indicatorsH = mm(79.5);

  const sectionH = indicatorsH / 3;

  doc.font("R").fontSize(px(12));
  const indicatorLabelW =
    (Math.max(
      doc.widthOfString("góra"),
      doc.widthOfString("środek"),
      doc.widthOfString("dół")
    ) +
      mm(2)) *
    0.6;
  function drawIndicatorSection(title, y) {
    const verticalFont = px(12);

    // визначаємо мінімальну ширину вертикального тексту
    doc.font("R").fontSize(verticalFont);
    const labelW = indicatorLabelW;

    // вертикальна колонка
    doc.rect(xR, y, labelW, sectionH).stroke();

    doc.save();
    doc.rotate(-90, { origin: [xR + labelW / 2, y + sectionH / 2] });

    doc.text(
      title,
      xR + labelW / 2 - sectionH / 2,
      y + sectionH / 2 - verticalFont / 2,
      { width: sectionH, align: "center" }
    );

    doc.restore();

    const contentX = xR + labelW;
    const contentW = rightW - labelW;

    const lowerH = mm(7);
    const upperH = sectionH - lowerH;
    // верхній рядок
    doc.rect(contentX, y, contentW, upperH).stroke();

    // нижній рядок
    const lowerY = y + upperH;
    doc.rect(contentX, lowerY, contentW, lowerH).stroke();

    // компактний текст чекбоксів
    const cbFont = px(12);
    const cbSize = mm(3);

    doc.font("R").fontSize(cbFont);
    const textHeight = doc.currentLineHeight();
    const textY = lowerY + (lowerH - textHeight) / 2;

    doc.font("R").fontSize(cbFont);

    const baseX = contentX + mm(3);

    doc.text("Wskaźnik wybarwiony", baseX, textY);

    const baseText = "Wskaźnik wybarwiony";
    const baseTextWidth = doc.widthOfString(baseText);

    const rightStart = baseX + baseTextWidth + doc.widthOfString("    ");

    // checkbox 1
    const cbY = lowerY + (lowerH - cbSize) / 2;
    doc.rect(rightStart, cbY, cbSize, cbSize).stroke();
    doc.text("prawidłowo", rightStart + cbSize + mm(1), textY);

    // визначаємо ширину першого тексту
    const firstTextWidth = doc.widthOfString("prawidłowo");

    // checkbox 2 (мінімальний відступ після першого тексту)
    const cb2X = rightStart + cbSize + mm(1) + firstTextWidth + mm(4);

    doc.rect(cb2X, cbY, cbSize, cbSize).stroke();
    doc.text("nieprawidłowo", cb2X + cbSize + mm(1), textY);
  }

  drawIndicatorSection("góra", indicatorsY);
  drawIndicatorSection("środek", indicatorsY + sectionH);
  drawIndicatorSection("dół", indicatorsY + sectionH * 2);

  doc
    .font("R")
    .fontSize(px(12))
    .text(
      "Podmioty dla których zostały wysterylizowane narzędzia w danym cyklu",
      xR + mm(2),
      clientsY + mm(1.4),
      { width: rightW - mm(4) }
    );

  let cx = xR + mm(2);
  let cy = clientsY + mm(6);

  doc.font("B").fontSize(px(11));

  for (const cl of clients) {
    const t = String(cl.id || "");
    const w = doc.widthOfString(t) + mm(6);
    if (cx + w > xR + rightW) {
      cx = xR + mm(2);
      cy += mm(9);
    }
    doc.save().roundedRect(cx, cy, w, mm(6), 3).fill("#eeeeee").restore();
    doc.text(t, cx, cy + mm(1.2), { width: w, align: "center" });
    cx += w + mm(2);
  }

  doc.end();

  await new Promise((r, e) => {
    ws.on("finish", r);
    ws.on("error", e);
  });

  await query(
    `UPDATE sterilization_cycles SET generated_report_path=? WHERE id=?`,
    [outPath, cycleId]
  );

  return { success: true, path: outPath };
};
