const parseAutoclaveReport = require("./sterilization/parsers/parseAutoclaveReport");

const path = require("path");

const filePath = path.join(__dirname, "sample_report.TXT");

try {
  const result = parseAutoclaveReport(filePath);
  console.log("PARSED RESULT:");
  console.dir(result, { depth: null });
} catch (err) {
  console.error("Parser error:", err);
}
