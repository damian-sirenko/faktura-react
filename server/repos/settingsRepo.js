// server/repos/settingsRepo.js
const fs = require("fs");
const path = require("path");

// Project root: .../faktura-react
const ROOT = path.join(__dirname, "..", "..");
// Data dir: .../faktura-react/data
const DATA_DIR = path.join(ROOT, "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

const defaultSettings = {
  perPiecePriceGross: 6,
  defaultVat: 23,
  courierPriceGross: 12,
  shippingPriceGross: 20,
  currentIssueMonth: null,
  dueMode: "days",
  dueDays: 0,
  dueFixedDate: null,
  counters: {},
};

async function readSettings() {
  ensureDataDir();
  try {
    const raw = await fs.promises.readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return {
      ...defaultSettings,
      ...parsed,
      counters:
        parsed.counters && typeof parsed.counters === "object"
          ? parsed.counters
          : {},
    };
  } catch (e) {
    await fs.promises.writeFile(
      SETTINGS_FILE,
      JSON.stringify(defaultSettings, null, 2),
      "utf8"
    );
    return { ...defaultSettings };
  }
}

async function saveSettings(obj) {
  ensureDataDir();
  const safe = {
    ...defaultSettings,
    ...obj,
    counters:
      obj.counters && typeof obj.counters === "object" ? obj.counters : {},
  };
  await fs.promises.writeFile(
    SETTINGS_FILE,
    JSON.stringify(safe, null, 2),
    "utf8"
  );
  return safe;
}

async function get() {
  return readSettings();
}

async function update(patch) {
  const current = await readSettings();
  const next = { ...current };

  const fields = [
    "perPiecePriceGross",
    "defaultVat",
    "courierPriceGross",
    "shippingPriceGross",
    "currentIssueMonth",
    "dueMode",
    "dueDays",
    "dueFixedDate",
  ];

  for (const f of fields) {
    if (typeof patch[f] !== "undefined") {
      next[f] = patch[f];
    }
  }

  if (patch.counters && typeof patch.counters === "object") {
    const merged = { ...(current.counters || {}) };
    for (const [k, v] of Object.entries(patch.counters)) {
      if (v == null) continue;
      merged[k] = v;
    }
    next.counters = merged;
  }

  return saveSettings(next);
}

module.exports = {
  get,
  update,
};
