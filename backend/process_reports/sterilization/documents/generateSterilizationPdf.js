const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { GENERATED_DIR } = require("../../../../server.shared.cjs");

const { query } = require("../../../../server/db.js");
const drawProtocol = require("./drawProtocol");

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "-";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m} min ${s} s`;
}

async function generateSterilizationPdf(cycleId) {
  // ===== LOAD CYCLE =====
  const cycle = await query(
    `
    SELECT *
    FROM sterilization_cycles
    WHERE id = ?
    `,
    [cycleId]
  );

  if (!cycle.length) {
    throw new Error("Cycle not found");
  }

  const c = cycle[0];

  // ===== BUSINESS VALIDATION =====
  if (c.status !== "APPROVED") {
    throw new Error("Cycle must be APPROVED before generating report");
  }

  if (c.generated_report_path) {
    throw new Error("Report already generated");
  }

  if (c.cycle_type !== "NORMAL") {
    throw new Error("Standard report allowed only for NORMAL cycles");
  }

  // ===== LOAD CLIENTS =====
  const clients = await query(
    `
  SELECT 
  COALESCE(c.id, scc.manual_identifier) AS id,
  COALESCE(c.name, scc.manual_client_name) AS name
FROM sterilization_cycle_clients scc
LEFT JOIN clients c ON c.id = scc.client_id
WHERE scc.cycle_id = ?
ORDER BY name
    `,
    [cycleId]
  );

  // ===== PREPARE STORAGE =====
  const dir = path.join(GENERATED_DIR, "sterilization");

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, `raport_sterylizacji_cycle_${cycleId}.pdf`);

  // ===== CREATE PDF =====
  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
  });

  const fontPath = path.join(process.cwd(), "public/fonts/DejaVuSans.ttf");

  doc.font(fontPath);

  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // ===== HEADER =====
  const dateStr = c.cycle_start_datetime
    ? new Date(c.cycle_start_datetime).toISOString().slice(0, 10)
    : "-";

  try {
    await drawProtocol(doc, c, 40);
  } catch (e) {
    console.error("PDF layout error:", e);
    throw e;
  }
  doc.end();

  await new Promise((resolve) => stream.on("finish", resolve));
  // ===== SAVE PATH IN DB =====
  await query(
    `
    UPDATE sterilization_cycles
    SET generated_report_path = ?
    WHERE id = ?
    `,
    [filePath, cycleId]
  );

  return {
    generated: true,
    file: filePath,
  };
}

module.exports = generateSterilizationPdf;
