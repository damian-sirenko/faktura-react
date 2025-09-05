// routes/analytics.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

// --- FILES (як у ваших інших роутів)
const DATA_DIR = path.join(__dirname, "..", "data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const PROTOCOLS_FILE = path.join(DATA_DIR, "protocols.json");
const INVOICES_FILE = path.join(DATA_DIR, "invoices.json");

// --- helpers ---
const readJSON = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
};

const parseISO = (s) => {
  if (!s) return null;
  // Підтримка 'YYYY-MM' як перший день місяця
  if (/^\d{4}-\d{2}$/.test(s)) s = `${s}-01`;
  const d = new Date(s);
  return isNaN(d) ? null : d;
};

const yymm = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const nextMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1);

const clampRange = (from, to) => {
  const df = from ? parseISO(from) : null;
  const dt = to ? parseISO(to) : null;
  const end = dt ? dt : new Date(); // якщо to не передали — до сьогодні
  let start = df ? df : new Date(end);
  if (!df) {
    start.setMonth(start.getMonth() - 11); // дефолт: останні 12 міс.
    start.setDate(1);
  }
  // інтервал [start, endNextDay) — інклюзивний по дню "to"
  const endNext = new Date(end);
  endNext.setDate(endNext.getDate() + 1);
  return { start, end: endNext };
};

// Видалення діакритиків + уніфікація регістру/пробілів
const stripDiacritics = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
const normalizeKey = (s) =>
  stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

// Парсинг чисел у PL-нотації: "1 234,56" -> 1234.56, також підтримка NBSP
const numFromPL = (val) => {
  if (val === null || val === undefined) return 0;
  let s = String(val).trim();
  if (!s) return 0;
  // прибираємо звичайні та нерозривні пробіли/вузькі NBSP
  s = s.replace(/[\s\u00A0\u202F]/g, "");
  // якщо є кома — вважаємо її десятковим роздільником, крапки як тисячні
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  }
  // інакше намагаємося як стандартний JS-чиселковий рядок
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};

// Нормалізація доставки + рахунок поїздок кур'єра
const courierTripsOf = (delivery) => {
  const d = normalizeKey(delivery);
  if (d === "odbior" || d === "dowoz") return 1;
  if (d === "odbior dowoz" || d === "odbior+dowoz") return 2;
  return 0;
};

// Тип клієнта
const normalizeType = (c) =>
  String(c?.type || c?.["Firma - OP"] || "op").toLowerCase() === "firma"
    ? "firma"
    : "op";

// Модель білінгу
const normalizeBilling = (c) => {
  const hasAbon = !!String(
    c?.subscription ?? c?.Abonament ?? c?.abonament ?? ""
  ).trim();
  return c?.billingMode || (hasAbon ? "abonament" : "perpiece");
};

// Категоризація позиції інвойсу за назвою (з підтримкою варіацій/діакритики)
const categorizeItemName = (nameRaw) => {
  const name = normalizeKey(nameRaw);
  // абонплата
  if (
    name.includes("wg abonamentu") ||
    name === "abonament" ||
    name.includes("abonament")
  )
    return "abon";
  // понад ліміт
  if (
    name.includes("poza abonamentem") ||
    name.includes("nadlimit") ||
    name.includes("ponad abonament")
  )
    return "overquota";
  // кур'єр (різні варіанти)
  if (
    name.includes("kurier") ||
    name.includes("dojazd kurier") ||
    name.includes("dowoz") ||
    name.includes("dojazd")
  )
    return "courier";
  // відправка
  if (
    name.includes("wysylka") ||
    name.includes("przesylka") ||
    name.includes("shipping")
  )
    return "shipping";
  return "other";
};

function* monthsIter(from, toExcl) {
  // ітеруємо перші числа місяців: [firstOfMonth(from) .. firstOfMonth(toExcl))
  let cur = firstOfMonth(from);
  const end = firstOfMonth(toExcl);
  while (cur < end) {
    yield new Date(cur);
    cur = nextMonth(cur);
  }
}

function isClientActiveInMonth(client, y, m) {
  const start = client?.agreementStart ? parseISO(client.agreementStart) : null;
  const end = client?.agreementEnd ? parseISO(client.agreementEnd) : null;
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 1); // ексклюзивно
  if (start && start >= monthEnd) return false;
  if (end && end < monthStart) return false;
  // інакше — вважаємо активним
  return true;
}

// Підрахунок retention на основі мапи "ym -> Set(keys)"
const retentionFromSets = (monthly, setMap) => {
  const series = [];
  for (let i = 1; i < monthly.length; i++) {
    const prev = monthly[i - 1].ym;
    const curr = monthly[i].ym;
    const prevSet = setMap.get(prev) || new Set();
    const currSet = setMap.get(curr) || new Set();
    const retained = [...prevSet].filter((id) => currSet.has(id)).length;
    const churned = Math.max(prevSet.size - retained, 0);
    const added = Math.max(currSet.size - retained, 0);
    const rate = prevSet.size ? retained / prevSet.size : 0;
    series.push({
      ym: curr,
      activePrev: prevSet.size,
      activeCurr: currSet.size,
      retained,
      churned,
      added,
      retentionRate: rate,
    });
  }
  const last = series.length > 0 ? series[series.length - 1] : null;
  const avgRetentionRate =
    series.length > 0
      ? series.reduce((a, r) => a + r.retentionRate, 0) / series.length
      : 0;
  return { series, last, avgRetentionRate };
};

// --- MAIN: POST /analytics/query {from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD'}
router.post("/query", (req, res) => {
  try {
    const { from, to } = req.body || {};
    const range = clampRange(from, to);
    const clients = readJSON(CLIENTS_FILE, []);
    const protocols = readJSON(PROTOCOLS_FILE, []);
    const invoices = readJSON(INVOICES_FILE, []);

    // ===== Підготовка мап клієнтів =====
    const byNameExact = new Map(); // exact name -> client
    const byNameNorm = new Map(); // normalized name -> client
    const byId = new Map(); // id -> client
    const allIds = new Set();

    for (const c of clients) {
      const name = String(c.name || c.Klient || "").trim();
      const id = c.id || c.ID || normalizeKey(name).replace(/\s+/g, "-");
      if (name) byNameExact.set(name, c);
      if (name) byNameNorm.set(normalizeKey(name), c);
      if (id) {
        byId.set(id, c);
        allIds.add(id);
      }
    }

    const resolveClientFromInvoice = (inv) => {
      const name = String(inv.client || "").trim();
      if (!name) return null;
      return (
        byNameExact.get(name) || byNameNorm.get(normalizeKey(name)) || null
      );
    };

    // ========= Clients basic KPIs =========
    const newClients = clients.filter((c) => {
      const s = parseISO(c.agreementStart || c["Data podpisania umowy"]);
      return s && s >= range.start && s < range.end;
    }).length;

    const activeClients = clients.filter((c) => {
      const s = c.agreementStart ? parseISO(c.agreementStart) : null;
      const e = c.agreementEnd ? parseISO(c.agreementEnd) : null;
      const overlap = (!s || s < range.end) && (!e || e >= range.start);
      return overlap;
    }).length;

    // ========= Protocols (ops) =========
    const entries = [];
    for (const p of protocols) {
      for (const e of p?.entries || []) {
        const d = parseISO(e.date);
        if (d && d >= range.start && d < range.end)
          entries.push({ ...e, _pid: p.id });
      }
    }
    const packages = entries.reduce((a, e) => a + (Number(e.packages) || 0), 0);
    const shipments = entries.reduce((a, e) => a + (e.shipping ? 1 : 0), 0);
    const courierTrips = entries.reduce(
      (a, e) => a + courierTripsOf(e.delivery),
      0
    );

    // ========= Prepare month buckets =========
    const seriesMap = new Map(); // ym -> revenue buckets
    const actAll = new Map(); // ym -> Set(clientId) (за договорами)
    const actByType = { firma: new Map(), op: new Map() }; // ym -> Set
    const actByBilling = { abonament: new Map(), perpiece: new Map() }; // ym -> Set
    const actByInvoice = new Map(); // ym -> Set(clientKey) фактичні інвойси
    const actByProtocol = new Map(); // ym -> Set(clientKey) фактичні протоколи

    for (const dt of monthsIter(range.start, range.end)) {
      const ym = yymm(dt);
      seriesMap.set(ym, {
        ym,
        total: 0,
        abon: 0,
        overquota: 0,
        shipping: 0,
        courier: 0,
        other: 0,
        // revenue by client segments:
        byType: { firma: 0, op: 0 },
        byBilling: { abonament: 0, perpiece: 0, unknown: 0 },
      });
      actAll.set(ym, new Set());
      actByType.firma.set(ym, new Set());
      actByType.op.set(ym, new Set());
      actByBilling.abonament.set(ym, new Set());
      actByBilling.perpiece.set(ym, new Set());
      actByInvoice.set(ym, new Set());
      actByProtocol.set(ym, new Set());
    }

    // активні клієнти по місяцях (за договорами)
    for (const ym of seriesMap.keys()) {
      const [Y, M] = ym.split("-").map((n) => parseInt(n, 10));
      for (const c of clients) {
        const id =
          c.id ||
          c.ID ||
          normalizeKey(String(c.name || c.Klient || "")).replace(/\s+/g, "-");
        if (!id) continue;
        if (isClientActiveInMonth(c, Y, M)) {
          actAll.get(ym).add(id);
          const ty = normalizeType(c); // firma|op
          actByType[ty].get(ym).add(id);
          const bm = normalizeBilling(c); // abonament|perpiece
          if (bm === "abonament" || bm === "perpiece")
            actByBilling[bm].get(ym).add(id);
        }
      }
    }

    // revenue per month + per segment (по фактурам)
    for (const inv of invoices) {
      const d = parseISO(inv.issueDate);
      if (!d || !(d >= range.start && d < range.end)) continue;
      const ym = yymm(firstOfMonth(d));
      if (!seriesMap.has(ym)) continue;

      const bucket = seriesMap.get(ym);

      // визначаємо сегменти клієнта
      const client = resolveClientFromInvoice(inv);
      const ty = client ? normalizeType(client) : null;
      const bm = client ? normalizeBilling(client) : null;

      // маркуємо "активність за інвойсом" у цьому місяці
      const clientKey =
        client?.id || normalizeKey(String(inv.client || "")) || null;
      if (clientKey) {
        actByInvoice.get(ym).add(clientKey);
      }

      const items = Array.isArray(inv.items) ? inv.items : [];
      if (items.length > 0) {
        for (const it of items) {
          const cat = categorizeItemName(it.name);
          const v =
            it.gross_total != null
              ? numFromPL(it.gross_total)
              : it.gross_price != null && it.quantity != null
              ? numFromPL(it.gross_price) * Number(it.quantity)
              : it.price_gross != null && it.qty != null
              ? Number(it.price_gross) * Number(it.qty)
              : 0;

          bucket[cat] += v;
          bucket.total += v;

          // revenue by client segment
          if (ty) bucket.byType[ty] += v;
          if (bm === "abonament" || bm === "perpiece")
            bucket.byBilling[bm] += v;
          else bucket.byBilling.unknown += v;
        }
      } else {
        // Fallback: коли немає items — беремо загальну суму інвойсу
        const gross = numFromPL(inv.gross);
        const net = numFromPL(inv.net);
        const v = gross || net || 0;
        bucket.other += v;
        bucket.total += v;
        if (ty) bucket.byType[ty] += v;
        if (bm === "abonament" || bm === "perpiece") bucket.byBilling[bm] += v;
        else bucket.byBilling.unknown += v;
      }
    }

    // маркуємо "активність за протоколами" у місяцях
    for (const p of protocols) {
      for (const e of p?.entries || []) {
        const d = parseISO(e.date);
        if (!d || !(d >= range.start && d < range.end)) continue;
        const ym = yymm(firstOfMonth(d));
        const key = p.id ? String(p.id) : null;
        if (key && actByProtocol.has(ym)) {
          actByProtocol.get(ym).add(key);
        }
      }
    }

    const monthly = Array.from(seriesMap.values()).sort((a, b) =>
      a.ym.localeCompare(b.ym)
    );

    // monthly packages series
    const pkgSeriesMap = new Map();
    for (const p of protocols) {
      for (const e of p?.entries || []) {
        const d = parseISO(e.date);
        if (!d || !(d >= range.start && d < range.end)) continue;
        const ym = yymm(firstOfMonth(d));
        pkgSeriesMap.set(
          ym,
          (pkgSeriesMap.get(ym) || 0) + (Number(e.packages) || 0)
        );
      }
    }
    const monthlyPackages = monthly.map((m) => ({
      ym: m.ym,
      packages: pkgSeriesMap.get(m.ym) || 0,
    }));

    // ===== Retention / Churn =====
    // 1) як було — на основі активних за договорами (actAll)
    const retentionContract = retentionFromSets(monthly, actAll);

    // 2) додатково — на основі фактичних інвойсів (actByInvoice)
    const retentionByInvoices = retentionFromSets(monthly, actByInvoice);

    // 3) додатково — на основі фактичних протоколів (actByProtocol)
    const retentionByProtocols = retentionFromSets(monthly, actByProtocol);

    // ===== ARPU (monthly) по сегментах (за договорами, як було) =====
    const arpuOverall = monthly.map((m) => {
      const active = (actAll.get(m.ym) || new Set()).size || 0;
      return { ym: m.ym, arpu: active ? m.total / active : 0 };
    });
    const arpuByType = {
      firma: monthly.map((m) => {
        const active = (actByType.firma.get(m.ym) || new Set()).size || 0;
        const rev = m.byType.firma || 0;
        return { ym: m.ym, arpu: active ? rev / active : 0 };
      }),
      op: monthly.map((m) => {
        const active = (actByType.op.get(m.ym) || new Set()).size || 0;
        const rev = m.byType.op || 0;
        return { ym: m.ym, arpu: active ? rev / active : 0 };
      }),
    };
    const arpuByBilling = {
      abonament: monthly.map((m) => {
        const active =
          (actByBilling.abonament.get(m.ym) || new Set()).size || 0;
        const rev = m.byBilling.abonament || 0;
        return { ym: m.ym, arpu: active ? rev / active : 0 };
      }),
      perpiece: monthly.map((m) => {
        const active = (actByBilling.perpiece.get(m.ym) || new Set()).size || 0;
        const rev = m.byBilling.perpiece || 0;
        return { ym: m.ym, arpu: active ? rev / active : 0 };
      }),
    };

    const lastMonth = monthly.length ? monthly[monthly.length - 1].ym : null;
    const pickLastArpu = (arr) => (arr.length ? arr[arr.length - 1].arpu : 0);
    const mean = (arr) =>
      arr.length ? arr.reduce((a, x) => a + x, 0) / arr.length : 0;

    const arpuSummary = {
      latestMonth: {
        ym: lastMonth,
        overall: pickLastArpu(arpuOverall),
        byType: {
          firma: pickLastArpu(arpuByType.firma),
          op: pickLastArpu(arpuByType.op),
        },
        byBilling: {
          abonament: pickLastArpu(arpuByBilling.abonament),
          perpiece: pickLastArpu(arpuByBilling.perpiece),
        },
      },
      averageMonthly: {
        overall: mean(arpuOverall.map((x) => x.arpu)),
        byType: {
          firma: mean(arpuByType.firma.map((x) => x.arpu)),
          op: mean(arpuByType.op.map((x) => x.arpu)),
        },
        byBilling: {
          abonament: mean(arpuByBilling.abonament.map((x) => x.arpu)),
          perpiece: mean(arpuByBilling.perpiece.map((x) => x.arpu)),
        },
      },
      series: {
        overall: arpuOverall,
        byType: arpuByType,
        byBilling: arpuByBilling,
      },
      // Додатково: ARPU на основі фактичної активності за інвойсами
      usageBased: monthly.map((m) => {
        const active = (actByInvoice.get(m.ym) || new Set()).size || 0;
        return { ym: m.ym, arpu: active ? m.total / active : 0 };
      }),
    };

    // Top clients by revenue (із fallback на inv.gross/net)
    const byClientMap = new Map();
    for (const inv of invoices) {
      const d = parseISO(inv.issueDate);
      if (!d || !(d >= range.start && d < range.end)) continue;
      const items = Array.isArray(inv.items) ? inv.items : [];
      let sum = 0;
      if (items.length > 0) {
        for (const it of items) {
          const v =
            it.gross_total != null
              ? numFromPL(it.gross_total)
              : it.gross_price != null && it.quantity != null
              ? numFromPL(it.gross_price) * Number(it.quantity)
              : it.price_gross != null && it.qty != null
              ? Number(it.price_gross) * Number(it.qty)
              : 0;
          sum += v;
        }
      } else {
        const gross = numFromPL(inv.gross);
        const net = numFromPL(inv.net);
        sum = gross || net || 0;
      }
      const cl = String(inv.client || "").trim() || "—";
      byClientMap.set(cl, (byClientMap.get(cl) || 0) + sum);
    }
    const byClient = Array.from(byClientMap.entries())
      .map(([client, total]) => ({ client, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    res.json({
      range: {
        from: range.start.toISOString().slice(0, 10),
        to: new Date(range.end.getTime() - 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10),
      },
      kpis: {
        newClients,
        activeClients,
        packages,
        shipments,
        courierTrips,
        revenue: monthly.reduce(
          (acc, m) => {
            acc.total += m.total;
            acc.abon += m.abon;
            acc.overquota += m.overquota;
            acc.shipping += m.shipping;
            acc.courier += m.courier;
            acc.other += m.other;
            return acc;
          },
          { total: 0, abon: 0, overquota: 0, shipping: 0, courier: 0, other: 0 }
        ),
      },
      monthly, // revenue time series (по категоріях + по сегментах)
      monthlyPackages, // пакети на місяць
      byClient, // топ клієнтів
      // Зберігаємо старий формат retention + додаємо альтернативи
      retention: {
        series: retentionContract.series,
        last: retentionContract.last,
        avgRetentionRate: retentionContract.avgRetentionRate,

        byInvoices: retentionByInvoices, // { series, last, avgRetentionRate }
        byProtocols: retentionByProtocols, // { series, last, avgRetentionRate }
      },
      arpu: arpuSummary, // ARPU (як було) + usageBased
    });
  } catch (e) {
    console.error("analytics error:", e);
    res.status(500).json({ error: "Błąd analityki" });
  }
});

module.exports = router;
