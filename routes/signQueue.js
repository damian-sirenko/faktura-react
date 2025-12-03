// routes/signQueue.js
const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const DATA_DIR = path.join(__dirname, "..", "data");
const QUEUE_FILE = path.join(DATA_DIR, "sign_queue.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, "[]", "utf8");

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function readQueue() {
  try {
    const raw = fs.readFileSync(QUEUE_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function writeQueue(arr) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(arr, null, 2), "utf8");
}

/**
 * POST /sign-queue/enqueue
 * body: {
 *   type: 'courier'|'point',
 *   clientId, clientName, month('YYYY-MM'), index(Number),
 *   entry?: { date?, returnDate?, tools?, packages?, delivery?, shipping?, comment?, signatures? },
 *   plannedDate?: 'YYYY-MM-DD'
 * }
 */
router.post("/sign-queue/enqueue", (req, res) => {
  try {
    const b = req.body || {};
    const type = String(b.type || "").toLowerCase();
    if (type !== "courier" && type !== "point") {
      return res
        .status(400)
        .json({ error: "type must be 'courier' or 'point'" });
    }

    const clientId = String(b.clientId || "").trim();
    const clientName = String(b.clientName || "").trim();
    const month = String(b.month || "").trim();
    const index = Number.isFinite(Number(b.index)) ? Number(b.index) : -1;
    if (!clientId || !MONTH_RE.test(month) || index < 0) {
      return res.status(400).json({
        error: "clientId, month(YYYY-MM) and valid index are required",
      });
    }

    const entry = b.entry && typeof b.entry === "object" ? b.entry : {};
    const plannedDate =
      b.plannedDate && DAY_RE.test(b.plannedDate) ? b.plannedDate : null;
    const createdAt = new Date().toISOString();

    const item = {
      id: `${type}:${clientId}:${month}:${index}:${Date.now()}`, // виправлено шаблонні рядки
      type,
      clientId,
      clientName,
      month,
      index,
      entry,
      plannedDate, // зберігаємо планову дату прямо в item
      status: "queued",
      createdAt,
      updatedAt: createdAt,
    };

    const list = readQueue();
    list.push(item);
    writeQueue(list);

    return res.json({ ok: true, item });
  } catch (e) {
    console.error("enqueue error:", e);
    return res.status(500).json({ error: "enqueue failed" });
  }
});

/**
 * GET /sign-queue?type=courier|point&month=YYYY-MM
 * Повертаємо завжди { items: [...] } у форматі, який очікує фронт.
 */
router.get("/sign-queue", (req, res) => {
  try {
    const type = String(req.query.type || "").toLowerCase();
    const month = String(req.query.month || "").trim();

    let items = readQueue();
    if (type) items = items.filter((x) => x.type === type);
    if (MONTH_RE.test(month)) items = items.filter((x) => x.month === month);

    const normalized = items.map((it) => ({
      clientId: it.clientId,
      clientName: it.clientName,
      month: it.month,
      index: it.index,
      date: it.entry?.date || null,
      returnDate: it.entry?.returnDate || null,
      tools: Array.isArray(it.entry?.tools) ? it.entry.tools : [],
      packages: Number(it.entry?.packages || 0),
      delivery: it.entry?.delivery || null,
      shipping: !!it.entry?.shipping,
      comment: it.entry?.comment || "",
      signatures: it.entry?.signatures || {},
      queue: {
        pointPending: it.type === "point",
        courierPending: it.type === "courier",
        courierPlannedDate: it.plannedDate || it.entry?.plannedDate || null, // додаємо вивід plannedDate
      },
      _rawId: it.id,
    }));

    return res.json({ items: normalized });
  } catch (e) {
    console.error("read queue error:", e);
    return res.status(500).json({ error: "read failed" });
  }
});

/**
 * POST /sign-queue/update
 * body: { rawId? , type?, clientId?, month?, index?, plannedDate? }
 * Оновити plannedDate або entry частково.
 */
router.post("/sign-queue/update", (req, res) => {
  try {
    const b = req.body || {};
    const plannedDate =
      b.plannedDate && DAY_RE.test(b.plannedDate) ? b.plannedDate : null;

    let list = readQueue();

    const findByKey = (x) =>
      (b.rawId && x.id === b.rawId) ||
      (!!b.type &&
        !!b.clientId &&
        !!b.month &&
        Number.isFinite(Number(b.index)) &&
        x.type === String(b.type) &&
        x.clientId === String(b.clientId) &&
        x.month === String(b.month) &&
        x.index === Number(b.index));

    const idx = list.findIndex(findByKey);
    if (idx === -1) return res.status(404).json({ error: "not found" });

    if (plannedDate !== null) list[idx].plannedDate = plannedDate;
    list[idx].updatedAt = new Date().toISOString();

    writeQueue(list);
    return res.json({ ok: true, item: list[idx] });
  } catch (e) {
    console.error("update queue error:", e);
    return res.status(500).json({ error: "update failed" });
  }
});

/**
 * POST /sign-queue/dequeue
 * body: { rawId? , type?, clientId?, month?, index? }
 * Видаляє запис із локальної черги.
 */
router.post("/sign-queue/dequeue", (req, res) => {
  try {
    const b = req.body || {};
    let list = readQueue();
    const before = list.length;

    list = list.filter((x) => {
      if (b.rawId) return x.id !== b.rawId;
      if (
        b.type &&
        b.clientId &&
        b.month &&
        Number.isFinite(Number(b.index)) &&
        x.type === String(b.type) &&
        x.clientId === String(b.clientId) &&
        x.month === String(b.month) &&
        x.index === Number(b.index)
      ) {
        return false;
      }
      return true;
    });

    if (list.length === before)
      return res.status(404).json({ error: "not found" });

    writeQueue(list);
    return res.json({ ok: true, left: list.length });
  } catch (e) {
    console.error("dequeue error:", e);
    return res.status(500).json({ error: "dequeue failed" });
  }
});

/**
 * GET /sign-queue/file — швидка перевірка, що файл існує і що в ньому
 */
router.get("/sign-queue/file", (_req, res) => {
  try {
    const list = readQueue();
    res.json({ path: QUEUE_FILE, count: list.length, items: list });
  } catch {
    res.status(500).json({ error: "cannot read queue file" });
  }
});

/**
 * POST /sign-queue/clear — повне очищення (корисно для відладки)
 */
router.post("/sign-queue/clear", (_req, res) => {
  try {
    writeQueue([]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "clear failed" });
  }
});

module.exports = router;
