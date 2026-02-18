const fs = require("fs");
const path = require("path");
const pdf = require("html-pdf-node");
const { query } = require("../../../../server/db");

function formatDuration(seconds) {
  if (!seconds) return "-";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m} min ${s} s`;
}

module.exports = async function generateSterilizationFromTemplate(cycleId) {
  const cycleRows = await query(
    `
    SELECT *
    FROM sterilization_cycles
    WHERE id=?
  `,
    [cycleId]
  );

  if (!cycleRows.length) throw new Error("Cycle not found");

  const c = cycleRows[0];

  if (c.status !== "APPROVED") {
    throw new Error("Cycle must be APPROVED before generating report");
  }

  const clients = await query(
    `
    SELECT COALESCE(cl.id, scc.manual_identifier) AS id
    FROM sterilization_cycle_clients scc
    LEFT JOIN clients cl ON cl.id = scc.client_id
    WHERE scc.cycle_id = ?
    ORDER BY id
  `,
    [cycleId]
  );

  // ---------- HTML TEMPLATE ----------
  const templatePath = path.join(
    process.cwd(),
    "templates",
    "sterilization.html"
  );

  let html = fs.readFileSync(templatePath, "utf8");

  // ---------- CSS ----------
  const cssPath = path.join(process.cwd(), "templates", "sterilization.css");

  const css = fs.readFileSync(cssPath, "utf8");

  html = html.replace("</head>", `<style>${css}</style></head>`);

  // ---------- DATA ----------
  const dateStr = c.cycle_start_datetime
    ? new Date(c.cycle_start_datetime).toISOString().slice(0, 10)
    : "-";

  const clientsHtml = clients
    .map((cl) => `<div class="client-tile">${cl.id}</div>`)
    .join("");

  html = html
    .replaceAll("{{date}}", dateStr)
    .replaceAll("{{cycle_number}}", c.cycle_number || "-")
    .replaceAll("{{program}}", c.program || "-")
    .replaceAll(
      "{{duration}}",
      formatDuration(c.sterilization_duration_seconds)
    )
    .replaceAll("{{pressure_min}}", c.pressure_min ?? "-")
    .replaceAll("{{pressure_max}}", c.pressure_max ?? "-")
    .replaceAll("{{clients}}", clientsHtml);

  // ---------- OUTPUT ----------
  const outputDir = path.join(process.cwd(), "generated", "sterilization");

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const fileName = `cycle_${cycleId}.pdf`;
  const outputPath = path.join(outputDir, fileName);

  const file = { content: html };

  const options = {
    format: "A4",
    landscape: true,
    printBackground: true,
  };

  const pdfBuffer = await pdf.generatePdf(file, options);

  fs.writeFileSync(outputPath, pdfBuffer);

  await query(
    `
    UPDATE sterilization_cycles
    SET generated_report_path=?
    WHERE id=?
  `,
    [outputPath, cycleId]
  );

  return { success: true, path: outputPath };
};
