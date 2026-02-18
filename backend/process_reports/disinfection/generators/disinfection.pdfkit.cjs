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

module.exports = async function generateDisinfectionPDF(reportId) {
  const [r] = await query(`SELECT * FROM disinfect_reports WHERE id=?`, [
    reportId,
  ]);

  if (!r) throw new Error("Report not found");
  if (r.status !== "APPROVED") throw new Error("Report not APPROVED");

  const clients = await query(
    `
    SELECT
      COALESCE(c.id, drc.manual_identifier) AS id,
      drc.washer
    FROM disinfect_report_clients drc
    LEFT JOIN clients c ON c.id = drc.client_id
    WHERE drc.report_id=?
    ORDER BY drc.washer, id
    `,
    [reportId]
  );

  const outDir = path.join(process.cwd(), "generated", "disinfection");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // timezone-safe дата
 const dateObj = new Date(r.report_date);
const datePart = dateObj.toISOString().slice(0, 10);

  const outPath = path.join(outDir, `raport_dezynfekcji_${datePart}.pdf`);

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

  doc.registerFont("R", FONT_REG);
  doc.registerFont("B", FONT_BOLD);

  const pageW = doc.page.width;
  const m = doc.page.margins;
  const innerW = pageW - m.left - m.right;

  // ===== Header =====
  doc
    .font("B")
    .fontSize(px(18))
    .text(`Raport dezynfekcji - ${datePart}`, m.left, m.top, {
      width: innerW,
      align: "center",
    });

  doc.moveDown(2);

  // ===== Parametry =====
  doc.font("R").fontSize(px(12));

  doc.text(`Środek dezynfekcyjny: ${r.disinfectant_name}`);
  doc.text(`Stężenie: ${r.concentration}`);
  doc.text(`Czas zanurzenia: ${r.immersion_time_minutes} min`);

  doc.moveDown(2);

  // ===== Klienci =====
  function drawWasher(title, washerKey) {
    doc.font("B").fontSize(px(13)).text(title);
    doc.moveDown(0.5);

    doc.font("R").fontSize(px(11));

    const list = clients.filter((c) => c.washer === washerKey);

    if (!list.length) {
      doc.text("-");
    } else {
      for (const cl of list) {
        doc.text(cl.id);
      }
    }

    doc.moveDown(1.5);
  }

  drawWasher("Myjka ultradźwiękowa nr 1", "W1");
  drawWasher("Myjka ultradźwiękowa nr 2", "W2");
  drawWasher("Kąpiel manualna", "MANUAL");

  doc.end();

  await new Promise((resolve, reject) => {
    ws.on("finish", resolve);
    ws.on("error", reject);
  });

  await query(
    `UPDATE disinfect_reports SET generated_report_path=? WHERE id=?`,
    [outPath, reportId]
  );

  return { success: true, path: outPath };
};
