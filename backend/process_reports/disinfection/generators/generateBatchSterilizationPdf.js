const fs = require("fs");
const path = require("path");

const { GENERATED_DIR } = require("../../../../server.shared.cjs");
const { query } = require("../../../../server/db.js");
async function getApprovedCycles(cycleIds) {
  return query(
    `
      SELECT *
      FROM sterilization_cycles
      WHERE id IN (${cycleIds.map(() => "?").join(",")})
      AND status='APPROVED'
      `,
    cycleIds
  );
}

const { PDFDocument } = require("pdf-lib");

async function loadCycle(cycleId) {
  const cycleRows = await query(
    `SELECT sc.*, a.name AS autoclave_name
       FROM sterilization_cycles sc
       JOIN autoclaves a ON a.id = sc.autoclave_id
       WHERE sc.id = ?`,
    [cycleId]
  );

  if (!cycleRows.length) throw new Error("Cycle not found");

  const clients = await query(
    `
      SELECT
        COALESCE(c.id, scc.manual_identifier) AS id,
        COALESCE(c.name, scc.manual_client_name) AS name
      FROM sterilization_cycle_clients scc
      LEFT JOIN clients c ON c.id = scc.client_id
      WHERE scc.cycle_id = ?
      `,
    [cycleId]
  );

  return {
    ...cycleRows[0],
    clients,
  };
}

async function generateBatchSterilizationPdf(cycleIds) {
  const approvedCycles = await getApprovedCycles(cycleIds);
  const approvedIds = approvedCycles.map((c) => c.id);
  const cycleNumbers = approvedCycles.map((c) => c.cycle_number);

  if (!approvedIds.length) {
    throw new Error("Brak zatwierdzonych cykli do wydruku");
  }

  const generateSingle = require("../generators/sterilization.pdfkit.cjs");

  const dir = path.join(GENERATED_DIR, "sterilization_batches");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `Cykle_${cycleNumbers.join("_")}.pdf`);

  const mergedPdf = await PDFDocument.create();

  let pageBuffer = [];

  for (const id of approvedIds) {
    await query(
      `UPDATE sterilization_cycles
         SET generated_report_path=NULL
         WHERE id=?`,
      [id]
    );

    await generateSingle(id);

    const cycle = await loadCycle(id);

    const pdfBytes = fs.readFileSync(cycle.generated_report_path);
    const pdf = await PDFDocument.load(pdfBytes);

    const [copiedPage] = await mergedPdf.copyPages(pdf, [0]);
    const embeddedPage = await mergedPdf.embedPage(copiedPage);

    pageBuffer.push(embeddedPage);

    if (pageBuffer.length === 2) {
      const newPage = mergedPdf.addPage([595.28, 841.89]);

      const { width, height } = newPage.getSize();

      newPage.drawPage(pageBuffer[0], {
        x: 0,
        y: height / 2,
      });

      newPage.drawPage(pageBuffer[1], {
        x: 0,
        y: 0,
      });

      pageBuffer = [];
    }
  }

  if (pageBuffer.length === 1) {
    const newPage = mergedPdf.addPage([595.28, 841.89]);

    const { width, height } = newPage.getSize();

    newPage.drawPage(pageBuffer[0], {
      x: 0,
      y: height / 2,
    });
  }

  const finalPdf = await mergedPdf.save();
  fs.writeFileSync(filePath, finalPdf);

  return {
    generated: true,
    file: `/api/generated/sterilization_batches/${path.basename(filePath)}`,
  };
}

module.exports = generateBatchSterilizationPdf;
