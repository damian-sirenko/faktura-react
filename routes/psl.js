const express = require("express");
const router = express.Router();

router.use((_req, res, next) => {
  res.set("X-PSL-Storage", "db");
  next();
});

const crypto = require("crypto");
const pslRepo = require("../server/repos/pslRepo.js");

function newId(label) {
  return `${label}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function isRowEmpty(r) {
  if (!r || typeof r !== "object") return true;
  const name = String(r.clientName || r.client || "").trim();
  const qty = r.qty ?? r.packages ?? r.packs ?? r.count ?? r.ilosc ?? "";
  const ship =
    r.shipOrCourier ??
    r.ship ??
    r.courier ??
    r.shippingCost ??
    r.deliveryCost ??
    r.wysylka ??
    "";
  return (
    name === "" &&
    (qty === "" || Number(qty) === 0) &&
    (ship === "" || Number(ship) === 0)
  );
}

/* ========= WORKSPACE ========= */
router.get("/workspace", async (_req, res) => {
  try {
    const ws = await pslRepo.getWorkspace();
    if (Array.isArray(ws)) {
      return res.json({ rows: ws });
    }
    return res.json(ws);
  } catch (e) {
    console.error("PSL /workspace GET", e);
    res.status(500).json({ error: "Cannot read workspace" });
  }
});

router.put("/workspace", async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const cleaned = incoming
      .filter((r) => !isRowEmpty(r))
      .map(({ isNew, ...rest }) => rest);

    // ВАЖЛИВО: завжди перезаписуємо workspace, навіть якщо cleaned порожній,
    // щоб після фіналізації місяця в БД зберігався порожній масив, а не старі дані
    await pslRepo.upsertWorkspace(cleaned);

    res.json({ ok: true, count: cleaned.length });
  } catch (e) {
    console.error("PSL /workspace PUT", e);
    res.status(500).json({ error: "Cannot save workspace" });
  }
});


/* ========= SAVED INDEX ========= */
router.get("/saved-index", async (_req, res) => {
  try {
    const idx = await pslRepo.savedIndex();
    res.json(idx);
  } catch (e) {
    console.error("PSL /saved-index", e);
    res.status(500).json({ error: "Cannot read index" });
  }
});

/* ========= COMPAT DRAFTS BY YM ========= */
router.get("/draft/:ym", async (req, res) => {
  try {
    const ym = String(req.params.ym || "");
    const rows = await pslRepo.getDraft(ym);
    res.json({ ym, rows });
  } catch (e) {
    console.error("PSL /draft GET", e);
    res.status(500).json({ error: "Cannot read draft" });
  }
});

router.put("/draft/:ym", async (req, res) => {
  try {
    const ym = String(req.params.ym || "");
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    await pslRepo.upsertDraft(ym, rows);
    res.json({ ok: true, ym, count: rows.length });
  } catch (e) {
    console.error("PSL /draft PUT", e);
    res.status(500).json({ error: "Cannot save draft" });
  }
});

/* ========= FINALIZE ========= */
router.post("/finalize", async (req, res) => {
  try {
    const body = req.body || {};
    const ym = String(body.ym || "").slice(0, 7);
    const title = String(body.title || ym);
    const createdAt = body.createdAt || new Date().toISOString();
    const rows = Array.isArray(body.rows) ? body.rows : [];

    // серверні підсумки (не довіряєм клієнту)
    const qty = rows.reduce(
      (s, r) => s + (Number(r.qty ?? r.packages ?? 0) || 0),
      0
    );
    const pricePerPack = Number(body.pricePerPack || 6) || 6;
    const steril = qty * pricePerPack;
    const ship = rows.reduce(
      (s, r) =>
        s + (Number(r.shipOrCourier ?? r.ship ?? r.deliveryCost ?? 0) || 0),
      0
    );
    const total = steril + ship;

    const snapshot = {
      id: body.id || newId(ym),
      ym,
      title,
      rows,
      totals: {
        qty,
        steril: Number(steril.toFixed(2)),
        ship: Number(ship.toFixed(2)),
        total: Number(total.toFixed(2)),
      },
      pricePerPack,
      createdAt,
      deleted: 0,
    };

    const saved = await pslRepo.finalize(snapshot);
    const id = typeof saved === "string" ? saved : saved?.id || snapshot.id;

    // після фіналізації: чистимо драфт цього місяця і workspace
    try {
      await pslRepo.clearDraft(ym);
    } catch (e2) {
      console.error("PSL finalize: cannot clear draft", e2);
    }

    try {
      await pslRepo.upsertWorkspace([]);
    } catch (e2) {
      console.error("PSL finalize: cannot clear workspace", e2);
    }

    return res.json({ id });
  } catch (e) {
    console.error("PSL /finalize", e);
    res.status(500).json({ error: "Cannot finalize snapshot" });
  }
});

/* ========= SAVED SNAPSHOTS ========= */
router.get("/saved/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const snap = await pslRepo.getSaved(id);
    if (!snap) return res.status(404).json({ error: "Not found" });
    res.json(snap);
  } catch (e) {
    console.error("PSL /saved/:id GET", e);
    res.status(500).json({ error: "Cannot read saved" });
  }
});

router.delete("/saved/:id", async (req, res) => {
  try {
    const need = "psl:delete-saved";
    const h = String(req.headers["x-confirm-action"] || "");
    const q = String(req.query.confirm || "");
    if (h !== need && q !== need) {
      return res.status(409).json({
        error: "Confirm header required",
        need,
        how: `add header: x-confirm-action: ${need}  або ?confirm=${need}`,
      });
    }
    const id = String(req.params.id || "");
    await pslRepo.deleteSaved(id);
    res.json({ ok: true });
  } catch (e) {
    console.error("PSL /saved/:id DELETE", e);
    res.status(500).json({ error: "Cannot delete saved" });
  }
});

/* ========= SUMMARY ========= */
router.get("/summary", async (req, res) => {
  try {
    const from = String(req.query.from || "").slice(0, 10);
    const to = String(req.query.to || "").slice(0, 10);
    if (!from || !to)
      return res.status(400).json({ error: "from/to required" });

    const s = await pslRepo.summary(from, to);
    res.json({
      from,
      to,
      psl: {
        totalQty: s.totalQty,
        totalSteril: s.totalSteril,
        totalShip: s.totalShip,
        totalGross: s.totalGross,
      },
    });
  } catch (e) {
    console.error("PSL /summary", e);
    res.status(500).json({ error: "Cannot build summary" });
  }
});

module.exports = router;
