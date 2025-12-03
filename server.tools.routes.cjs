// server.tools.routes.cjs
const fs = require("fs");
const path = require("path");

const ROOT = __dirname; // корінь проекту
const DATA_DIR = path.join(ROOT, "data"); // .../faktura-react/data
const TOOLS_JSON = path.join(DATA_DIR, "tools.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readToolsJson() {
  ensureDataDir();
  if (!fs.existsSync(TOOLS_JSON)) {
    const initial = { cosmetic: [], medical: [] };
    fs.writeFileSync(TOOLS_JSON, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
  try {
    const raw = fs.readFileSync(TOOLS_JSON, "utf8");
    const parsed = JSON.parse(raw);
    return {
      cosmetic: Array.isArray(parsed?.cosmetic) ? parsed.cosmetic : [],
      medical: Array.isArray(parsed?.medical) ? parsed.medical : [],
    };
  } catch (e) {
    console.error("[tools] parse error:", e);
    return { cosmetic: [], medical: [] };
  }
}

function writeToolsJson(obj) {
  ensureDataDir();
  const clean = {
    cosmetic: Array.isArray(obj?.cosmetic) ? obj.cosmetic : [],
    medical: Array.isArray(obj?.medical) ? obj.medical : [],
  };
  fs.writeFileSync(TOOLS_JSON, JSON.stringify(clean, null, 2), "utf8");
}

module.exports = function mountToolsRoutes(app) {
  // GET /tools -> { cosmetic:[], medical:[] }
  app.get("/tools", (_req, res) => {
    try {
      const data = readToolsJson();
      console.log("[/tools] send ->", {
        c: data.cosmetic.length,
        m: data.medical.length,
      });

      console.log("[/tools] send ->", { c: data.cosmetic.length, m: data.medical.length });

      res.json(data);
    } catch (e) {
      console.error("GET /tools error:", e);
      res.status(500).json({ error: "Nie udało się odczytać tools.json" });
    }
  });

  // POST /tools -> перезапис bulk
  app.post("/tools", (req, res) => {
    try {
      const body = req.body || {};
      writeToolsJson({ cosmetic: body.cosmetic, medical: body.medical });
      res.json({ ok: true });
    } catch (e) {
      console.error("POST /tools error:", e);
      res.status(500).json({ error: "Nie udało się zapisać tools.json" });
    }
  });

  // Аліас на сумісність зі старим фронтом
  app.post("/tools/save", (req, res) => {
    try {
      const body = req.body || {};
      writeToolsJson({ cosmetic: body.cosmetic, medical: body.medical });
      res.json({ ok: true });
    } catch (e) {
      console.error("POST /tools/save error:", e);
      res.status(500).json({ error: "Nie udało się zapisać tools.json" });
    }
  });
};
