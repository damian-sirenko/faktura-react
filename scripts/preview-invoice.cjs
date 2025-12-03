// scripts/preview-invoice.cjs
const path = require("path");
const fs = require("fs");
const { generateInvoicePDF } = require("../invoice.pdfkit.cjs");

(async () => {
  const jsonPath =
    process.argv[2] || path.join(process.cwd(), "sample-invoice.json");
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const out = path.join(process.cwd(), "generated", "preview", "Faktura.pdf");
  const final = await generateInvoicePDF(data, out);
  console.log("✅ Wygenerowano:", final);
})();
