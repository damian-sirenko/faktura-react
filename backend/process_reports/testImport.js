require("dotenv").config();

const path = require("path");
const importReport = require("./sterilization/importers/importAutoclaveReport");

async function run() {
  const filePath = path.join(__dirname, "sample_report.TXT");

  try {
    const result = await importReport(filePath);
    console.log(result);
  } catch (err) {
    console.error(err);
  }
}

run();
