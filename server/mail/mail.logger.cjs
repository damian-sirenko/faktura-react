const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "mail.log");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logMail(entry) {
  const line = JSON.stringify({
    ...entry,
    ts: new Date().toISOString(),
  });
  fs.appendFileSync(LOG_FILE, line + "\n");
}

module.exports = { logMail };
