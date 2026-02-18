/*
  server.shared.cjs
  Shared paths, file helpers, date helpers, signature helpers, and small reusable middleware.
  Used by invoices/protocols/core route modules to keep logic identical but centralized.
*/

const fs = require("fs");
const path = require("path");

// fetch polyfill for Node < 18 (used by protocols ZIP route)
const fetchFn =
  global.fetch ||
  ((...a) => import("node-fetch").then(({ default: f }) => f(...a)));

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const GENERATED_DIR = path.join(ROOT, "generated");
const SIGNATURES_DIR = path.join(ROOT, "signatures");

function safeSeg(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function findGeneratedFileDeep(filename) {
  const safe = path.basename(String(filename || ""));
  const stack = [GENERATED_DIR];
  while (stack.length) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name === safe) return full;
    }
  }
  return null;
}

function toISO10(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function parseJSON(val, fallback) {
  try {
    if (val == null) return fallback;
    if (Buffer.isBuffer(val)) {
      val = val.toString("utf8");
    }
    if (typeof val === "object") {
      return val ?? fallback;
    }
    if (typeof val !== "string") {
      val = String(val ?? "");
    }
    if (!val.trim()) return fallback;
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function nowForSQL() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  const Y = d.getFullYear();
  const M = pad(d.getMonth() + 1);
  const D = pad(d.getDate());
  const h = pad(d.getHours());
  const m = pad(d.getMinutes());
  const s = pad(d.getSeconds());

  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function ymFromISO(iso) {
  return typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? iso.slice(0, 7)
    : null;
}

function stripDiacritics(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function slugFromName(name) {
  return stripDiacritics(String(name || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function deriveInitialQueue(logistics) {
  const v = String(logistics || "")
    .toLowerCase()
    .trim();
  return {
    pointPending: v === "punkt",
    courierPending: v === "kurier",
  };
}

function normalizeToolsArray(raw) {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      if (typeof t === "string") {
        return { name: t.trim(), count: 0 };
      }
      if (t && typeof t === "object") {
        return {
          name: String(t.name || t.nazwa || "").trim(),
          count: Number(t.count || t.ilosc || 0) || 0,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function requireConfirmHeader(actionId) {
  return (req, res, next) => {
    const h = String(req.headers["x-confirm-action"] || "");
    const q = String(req.query.confirm || "");
    if (h === actionId || q === actionId) return next();
    return res.status(409).json({
      error: "Confirm header required",
      need: actionId,
      how: `add header: x-confirm-action: ${actionId}`,
    });
  };
}

function resolveStaffSignFile() {
  const candidates = [
    path.join(ROOT, "assets", "staff-sign.png"),
    path.join(ROOT, "assets", "staff-sign.jpg"),
    path.join(process.cwd(), "src", "assets", "staff-sign.png"),
    path.join(process.cwd(), "src", "assets", "staff-sign.jpg"),
    path.join(process.cwd(), "assets", "staff-sign.png"),
    path.join(process.cwd(), "assets", "staff-sign.jpg"),
    path.join(process.cwd(), "..", "src", "assets", "staff-sign.png"),
    path.join(process.cwd(), "..", "src", "assets", "staff-sign.jpg"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function ensureStaticStaffSigPublic() {
  const src = resolveStaffSignFile();
  const staticDir = path.join(SIGNATURES_DIR, "_static");
  if (!fs.existsSync(staticDir)) fs.mkdirSync(staticDir, { recursive: true });

  const target = path.join(staticDir, "staff-sign.png");
  if (!src) {
    try {
      const blank =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
      fs.writeFileSync(target, Buffer.from(blank, "base64"));
    } catch {}
    return "/signatures/_static/staff-sign.png";
  }

  try {
    fs.copyFileSync(src, target);
  } catch {}
  return "/signatures/_static/staff-sign.png";
}

let DEFAULT_STAFF_SIG_PUBLIC = ensureStaticStaffSigPublic();

function getDefaultStaffSignaturePublic() {
  return DEFAULT_STAFF_SIG_PUBLIC;
}

function refreshDefaultStaffSignaturePublic() {
  DEFAULT_STAFF_SIG_PUBLIC = ensureStaticStaffSigPublic();
  return DEFAULT_STAFF_SIG_PUBLIC;
}

module.exports = {
  fetchFn,

  ROOT,
  DATA_DIR,
  GENERATED_DIR,
  SIGNATURES_DIR,

  safeSeg,
  findGeneratedFileDeep,
  toISO10,
  parseJSON,
  nowForSQL,
  todayLocalISO,
  ymFromISO,

  stripDiacritics,
  slugFromName,
  deriveInitialQueue,
  normalizeToolsArray,

  requireConfirmHeader,

  resolveStaffSignFile,
  ensureStaticStaffSigPublic,
  getDefaultStaffSignaturePublic,
  refreshDefaultStaffSignaturePublic,
};
