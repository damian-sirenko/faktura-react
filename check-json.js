// check-json.js
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const files = [
  "clients.json",
  "protocols.json",
  "settings.json",
  "invoices.json",
  "counters.json",
];

let ok = true;
for (const name of files) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) {
    console.log(`⚠️  ${name} — немає файлу (це не помилка)`);
    continue;
  }
  try {
    const raw = fs.readFileSync(p, "utf8");
    JSON.parse(raw);
    console.log(`✅ ${name} — валідний JSON`);
  } catch (e) {
    ok = false;
    console.log(`❌ ${name} — невалідний JSON: ${e.message}`);
  }
}
if (!ok) process.exit(1);
