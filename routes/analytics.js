// routes/analytics.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const { query } = require("../server/db.js");

// DB helpers
async function fetchClientsDB() {
  return await query("SELECT * FROM clients");
}
async function fetchInvoicesDB(startIso, endIso) {
  return await query(
    "SELECT * FROM invoices WHERE issueDate>=? AND issueDate<?",
    [startIso, endIso]
  );
}
async function fetchProtocolsRangeDB(startIso, endIso) {
  const rows = await query(
    `SELECT p.clientId AS id, p.month, e.date, e.packages, e.delivery, e.shipping, e.comment,
            e.tools_json, e.signatures_json, e.returnDate, e.returnPackages, e.returnDelivery,
            e.returnShipping, e.returnTools_json
     FROM protocols p
     JOIN protocol_entries e ON e.protocol_id=p.id
     WHERE e.date>=? AND e.date<? 
     ORDER BY p.clientId, p.month, e.date, e.id`,
    [startIso, endIso]
  );
  const map = new Map(); // key: id|month
  for (const r of rows) {
    const key = `${r.id}|${r.month}`;
    if (!map.has(key)) map.set(key, { id: r.id, month: r.month, entries: [] });
    const entry = {
      date: r.date,
      packages: r.packages || 0,
      delivery: r.delivery || null,
      shipping: !!r.shipping,
      comment: r.comment || "",
      tools: (() => {
        try {
          return JSON.parse(r.tools_json || "[]");
        } catch {
          return [];
        }
      })(),
      signatures: (() => {
        try {
          return JSON.parse(r.signatures_json || "{}");
        } catch {
          return {};
        }
      })(),
      returnDate: r.returnDate || null,
      returnPackages: r.returnPackages || null,
      returnDelivery: r.returnDelivery || null,
      returnShipping: !!r.returnShipping,
      returnTools: (() => {
        try {
          return JSON.parse(r.returnTools_json || "[]");
        } catch {
          return [];
        }
      })(),
    };
    map.get(key).entries.push(entry);
  }
  return Array.from(map.values());
}

const DATA_DIR = path.join(__dirname, "..", "data");

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
  if (/^\d{4}-\d{2}$/.test(s)) s = `${s}-01`;
  // Парсимо 'YYYY-MM-DD' як ЛОКАЛЬНУ дату (а не UTC)
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const y = +m[1],
      mo = +m[2] - 1,
      d = +m[3];
    return new Date(y, mo, d);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
};
const toLocalISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const yymm = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const nextMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1);

const clampRange = (from, to) => {
  const df = from ? parseISO(from) : null;
  const dt = to ? parseISO(to) : null;

  // якщо to не передали — до сьогодні (локально)
  const end = dt ? dt : new Date();
  let start = df ? df : new Date(end.getFullYear(), end.getMonth() - 11, 1);

  // інтервал [start, endNext) — endNext це ПЕРШЕ число наступної доби (локально)
  const endNext = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate() + 1
  );

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
  s = s.replace(/[\s\u00A0\u202F]/g, "");
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  }
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};

// Витягнути перше число з будь-якого формату кількості
const qtyFromAny = (val) => {
  if (val == null) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const s = String(val).trim();
  const m = s.match(/[-+]?\d+(?:[.,]\d+)?/);
  if (!m) return 0;
  return Number(m[0].replace(",", ".")) || 0;
};
// Витягнути кількість "pakiety" з одного запису протоколу незалежно від структури
function packagesFromProtocolEntry(e) {
  if (!e) return 0;

  // 1) пряме поле
  const direct = qtyFromAny(e.packages ?? e.pakiety ?? e.packets ?? e.pkg);
  if (direct > 0) return direct;

  // 2) масиви об'єктів: lines/items/checklist/rows/entries
  const arrays = []
    .concat(Array.isArray(e.lines) ? e.lines : [])
    .concat(Array.isArray(e.items) ? e.items : [])
    .concat(Array.isArray(e.checklist) ? e.checklist : [])
    .concat(Array.isArray(e.rows) ? e.rows : [])
    .concat(Array.isArray(e.entries) ? e.entries : []);
  let sumFromArrays = 0;
  for (const it of arrays) {
    const label =
      it?.label ?? it?.name ?? it?.title ?? it?.field ?? it?.description ?? "";
    const key = normalizeKey(label);
    if (key.includes("pakiet")) {
      const q =
        qtyFromAny(
          it?.qty ?? it?.quantity ?? it?.count ?? it?.amount ?? it?.ilosc
        ) ||
        qtyFromAny(
          it?.value ??
            it?.val ??
            it?.number ??
            it?.num ??
            it?.answer ??
            it?.result
        ) ||
        qtyFromAny(String(it?.text ?? it?.content ?? it?.desc ?? ""));
      if (q > 0) sumFromArrays += q;
    }
  }
  if (sumFromArrays > 0) return sumFromArrays;

  // 3) signatures
  const signatures = Array.isArray(e.signatures) ? e.signatures : [];
  let sumFromSigs = 0;
  for (const s of signatures) {
    const q =
      qtyFromAny(s?.packages ?? s?.pakiety) ||
      qtyFromAny(String(s?.note ?? s?.text ?? s?.description ?? ""));
    if (q > 0) sumFromSigs += q;
  }
  if (sumFromSigs > 0) return sumFromSigs;

  // 4) текстові поля запису
  const textBlob = [
    e.note,
    e.notes,
    e.text,
    e.description,
    e.desc,
    e.comment,
    e.komentarz,
  ]
    .filter(Boolean)
    .map(String)
    .join(" | ");
  if (textBlob) {
    const re = /pakiet\w*[^0-9\-+]*([-+]?\d+(?:[.,]\d+)?)/gi;
    let m,
      s = 0;
    while ((m = re.exec(textBlob))) s += qtyFromAny(m[1]);
    if (s > 0) return s;
  }

  return 0;
}

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

// === STERYl plans (прайс і дозволені квоти) ===
const PRICE_LIST = [
  { name: "STERYL 20", price_gross: 110.0 },
  { name: "STERYL 30", price_gross: 140.0 },
  { name: "STERYL 50", price_gross: 210.0 },
  { name: "STERYL 100", price_gross: 300.0 },
  { name: "STERYL 150", price_gross: 360.0 },
  { name: "STERYL 200", price_gross: 430.0 },
  { name: "STERYL 300", price_gross: 550.0 },
  { name: "STERYL 500", price_gross: 780.0 },
];
const ALLOWED_QUOTAS = new Set(
  PRICE_LIST.map((p) => {
    const m = /steryl\s*(\d+)/i.exec(p.name);
    return m ? Number(m[1]) : null;
  }).filter(Boolean)
);

// Категоризація позиції інвойсу за назвою
const categorizeItemName = (nameRaw) => {
  const name = normalizeKey(nameRaw);

  if (name === "pakiety poza abonamentem") return "overquota";

  if (
    name.includes("wg abonamentu") ||
    name === "abonament" ||
    name.includes("abonament")
  )
    return "abon";

  if (
    name.includes("poza abonamentem") ||
    name.includes("poza-abonamentem") ||
    name.includes("poza  abonamentem") ||
    name.includes("poza limit") ||
    name.includes("poza limitem") ||
    name.includes("nadlimit") ||
    name.includes("ponad abonament") ||
    name.includes("ponad-abonament") ||
    name.includes("over quota") ||
    name.includes("overquota") ||
    (name.includes("pakiet") &&
      name.includes("poza") &&
      name.includes("abonament"))
  )
    return "overquota";

  if (
    name.includes("kurier") ||
    name.includes("dojazd kurier") ||
    name.includes("dowoz") ||
    name.includes("dojazd")
  )
    return "courier";

  if (
    name.includes("wysylka") ||
    name.includes("wysyłka") ||
    name.includes("przesylka") ||
    name.includes("przesyłka") ||
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
  return true;
}

// Архівація: виявити дату архівації клієнта
const archivedDateOf = (c) => {
  const direct =
    c.archivedAt ||
    c.archivedDate ||
    c.dateArchived ||
    c.movedToArchiveAt ||
    c.archive_date ||
    null;
  if (direct) return parseISO(direct);

  if (Array.isArray(c.statusHistory)) {
    const hit = c.statusHistory.find((h) => {
      const s = String(h?.status || h?.to || "").toLowerCase();
      return [
        "archived",
        "archive",
        "archiwum",
        "archiwizacja",
        "przeniesiono do archiwum",
      ].some((k) => s.includes(k));
    });
    if (hit?.date || hit?.at) return parseISO(hit.date || hit.at);
  }
  return null;
};

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
router.post("/query", async (req, res) => {
  try {
    // вимкнути кешування відповіді
    res.set("Cache-Control", "no-store");

    const { from, to } = req.body || {};
    const range = clampRange(from, to);
    const t = to ? parseISO(to) : null;
    const endExcl = t
      ? new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)
      : range.end;

    const clients = await fetchClientsDB();
    const protocols = await fetchProtocolsRangeDB(
      toLocalISO(range.start),
      toLocalISO(endExcl)
    );
    const invoices = await fetchInvoicesDB(
      toLocalISO(range.start),
      toLocalISO(endExcl)
    );

    // Мапи клієнтів для розпізнавання у фактурах
    const byNameExact = new Map();
    const byNameNorm = new Map();
    for (const c of clients) {
      const name = String(c.name || c.Klient || "").trim();
      if (name) {
        byNameExact.set(name, c);
        byNameNorm.set(normalizeKey(name), c);
      }
    }
    const resolveClientFromInvoice = (inv) => {
      const name = String(inv.client || "").trim();
      if (!name) return null;
      return (
        byNameExact.get(name) || byNameNorm.get(normalizeKey(name)) || null
      );
    };

    // KPI: нові/активні/архівні клієнти (по договорах)
    const newClients = clients.filter((c) => {
      const s = parseISO(c.agreementStart || c["Data podpisania umowy"]);
      return s && s >= range.start && s < range.end;
    }).length;

    // Активні за протоколами у періоді
    const activeClientsByProtocols = new Set();
    const allEntries = [];
    for (const p of protocols) {
      for (const e of p?.entries || []) {
        const d = parseISO(e.date);
        if (d && d >= range.start && d < endExcl) {
          allEntries.push({ ...e, _pid: p.id });
          const cid =
            e.clientId ||
            e.client ||
            e.clientName ||
            p.client ||
            p.name ||
            p.id;
          if (cid) activeClientsByProtocols.add(String(cid));
        }
      }
    }
    const activeClientsCount = activeClientsByProtocols.size;

    // Клієнти з абонементом (неархівні)
    const abonClientsCount = clients.filter((c) => {
      const hasAbon = String(
        c.subscription ?? c.Abonament ?? c.abonament ?? ""
      ).trim();
      const archivedFlag =
        c.archived === true ||
        String(c.status || "").toLowerCase() === "archived";
      const archivedByDate = !!archivedDateOf(c);
      return hasAbon && !archivedFlag && !archivedByDate;
    }).length;

    // Потенційна місткість (сума квот STERYL по неархівних абонементах)
    function firstSterylFromStringStrict(raw) {
      if (!raw) return 0;
      const m = String(raw).match(/steryl\s*(\d+)/i);
      if (!m) return 0;
      const q = Number(m[1]);
      return ALLOWED_QUOTAS.has(q) ? q : 0;
    }
    function totalQuotaForClientStrict(client) {
      const v =
        client?.subscription ??
        client?.Abonament ??
        client?.abonament ??
        client?.plan ??
        client?.abonamentName ??
        client?.planName ??
        "";
      if (Array.isArray(v)) return firstSterylFromStringStrict(v[0]);
      if (v && typeof v === "object") {
        const first = Object.values(v)[0];
        return firstSterylFromStringStrict(first);
      }
      return firstSterylFromStringStrict(v);
    }
    const potentialCapacity = clients.reduce((sum, c) => {
      const isAbon =
        String(c?.billingMode || "").toLowerCase() === "abonament" &&
        String(c?.subscription ?? c?.Abonament ?? c?.abonament ?? "")
          .toLowerCase()
          .includes("steryl");
      const archivedFlag =
        c?.archived === true ||
        String(c?.status || "").toLowerCase() === "archived" ||
        !!archivedDateOf(c);
      if (!isAbon || archivedFlag) return sum;
      return sum + Number(totalQuotaForClientStrict(c) || 0);
    }, 0);

    // Відвантаження з протоколів
    const shipments = allEntries.reduce((a, e) => a + (e.shipping ? 1 : 0), 0);
    const courierTrips = allEntries.reduce(
      (a, e) => a + courierTripsOf(e.delivery),
      0
    );

    // Місячні кошики в діапазоні
    const monthsInRange = new Set();
    for (const dt of monthsIter(range.start, endExcl)) {
      monthsInRange.add(yymm(dt));
    }

    const seriesMap = new Map(); // ym -> revenue buckets
    const actAll = new Map(); // ym -> Set(clientId) (за договорами)
    const actByType = { firma: new Map(), op: new Map() }; // ym -> Set
    const actByBilling = { abonament: new Map(), perpiece: new Map() }; // ym -> Set
    const actByInvoice = new Map(); // ym -> Set(clientKey)
    const actByProtocol = new Map(); // ym -> Set(clientKey)

    // PSL "na sztuki" рахуємо ВИКЛЮЧНО з інвойсів клієнтів з billingMode='perpiece'
    let perpieceGross = 0;
    let perpieceSteril = 0;
    let pslShippingAmount = 0;
    let pslShippingCount = 0;
    const perpieceActiveSet = new Set();
    const pslMonthly = new Map(); // ym -> { steril: 0, shipping: 0, gross: 0 }
    for (const ym of monthsInRange) {
      pslMonthly.set(ym, { steril: 0, shipping: 0, gross: 0 });
    }

    // Ініціалізація кошиків/сетів по місяцях
    for (const dt of monthsIter(range.start, endExcl)) {
      const ym = yymm(dt);
      seriesMap.set(ym, {
        ym,
        total: 0,
        abon: 0,
        overquota: 0,
        overquotaCount: 0,
        shipping: 0,
        courier: 0,
        other: 0,
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

    // Активні клієнти за договорами по місяцях
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
          const ty = normalizeType(c);
          actByType[ty].get(ym).add(id);
          const bm = normalizeBilling(c);
          if (bm === "abonament" || bm === "perpiece")
            actByBilling[bm].get(ym).add(id);
        }
      }
    }

    // Діагностика по overquota
    const debugOverquotaMatches = [];

    // Доходи за місяцями (фактури)
    for (const inv of invoices) {
      const d = parseISO(inv.issueDate || inv.issue_date || inv.date);
      if (!d || !(d >= range.start && d < endExcl)) continue;
      const ym = yymm(firstOfMonth(d));
      if (!seriesMap.has(ym)) continue;

      const bucket = seriesMap.get(ym);

      // сегменти клієнта
      const client = resolveClientFromInvoice(inv);
      const ty = client ? normalizeType(client) : null;
      const bm = client ? normalizeBilling(client) : null;

      // активність за інвойсом
      const clientKey =
        client?.id || normalizeKey(String(inv.client || "")) || null;
      if (clientKey) {
        actByInvoice.get(ym).add(clientKey);
      }

      const items = Array.isArray(inv.items) ? inv.items : [];
      if (items.length > 0) {
        for (const it of items) {
          const itemNameRaw =
            it.name ??
            it.title ??
            it.description ??
            it.Nazwa ??
            it.Item ??
            it.product ??
            it.productName ??
            "";

          const cat = categorizeItemName(itemNameRaw);

          const v =
            it.gross_total != null
              ? numFromPL(it.gross_total)
              : it.total_gross != null
              ? numFromPL(it.total_gross)
              : it.grossTotal != null
              ? numFromPL(it.grossTotal)
              : it.gross_price != null && it.quantity != null
              ? numFromPL(it.gross_price) * qtyFromAny(it.quantity)
              : it.price_gross != null && it.qty != null
              ? numFromPL(it.price_gross) * qtyFromAny(it.qty)
              : it.brutto != null
              ? numFromPL(it.brutto)
              : it.total != null
              ? numFromPL(it.total)
              : 0;

          const q =
            qtyFromAny(
              it.quantity ??
                it.qty ??
                it.count ??
                it.amount ??
                it.ilosc ??
                it.Ilosc
            ) || 0;

          // агрегування загальне
          bucket[cat] += v;
          bucket.total += v;

          // PSL з фактур: лише клієнти 'perpiece'
          if (bm === "perpiece") {
            const mb = pslMonthly.get(ym) || {
              steril: 0,
              shipping: 0,
              gross: 0,
            };

            if (cat === "shipping") {
              mb.shipping += v;
              pslShippingAmount += v;
              pslShippingCount += q > 0 ? q : 1;
              mb.gross += v;
            } else if (cat === "courier") {
              // кур'єр не входить у shipping, але входить у gross
              mb.gross += v;
            } else {
              // все інше як стерилізація
              mb.steril += v;
              mb.gross += v;
            }

            pslMonthly.set(ym, mb);
            if (clientKey) perpieceActiveSet.add(String(clientKey));
          }

          if (cat === "overquota") {
            bucket.overquotaCount = (bucket.overquotaCount || 0) + q;
            debugOverquotaMatches.push({
              ym,
              name: itemNameRaw,
              qtyParsed: q,
              rawQty:
                it.quantity ??
                it.qty ??
                it.count ??
                it.amount ??
                it.ilosc ??
                it.Ilosc ??
                null,
              grossParsed: v,
            });
          }

          if (ty) bucket.byType[ty] += v;
          if (bm === "abonament" || bm === "perpiece")
            bucket.byBilling[bm] += v;
          else bucket.byBilling.unknown += v;
        }
      } else {
        // fallback: коли немає items — беремо загальну суму інвойсу
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

    // Активність за протоколами (місяці)
    for (const p of protocols) {
      for (const e of p?.entries || []) {
        const d = parseISO(e.date);
        if (!d || !(d >= range.start && d < endExcl)) continue;
        const ym = yymm(firstOfMonth(d));
        const key = p.id ? String(p.id) : null;
        if (key && actByProtocol.has(ym)) {
          actByProtocol.get(ym).add(key);
        }
      }
    }

    // Серія пакунків помісячно з протоколів
    const pkgSeriesMap = new Map();
    for (const e of allEntries) {
      const d = parseISO(e.date);
      if (!d) continue;
      const ym = yymm(firstOfMonth(d));
      const pk = packagesFromProtocolEntry(e);
      if (!pkgSeriesMap.has(ym)) pkgSeriesMap.set(ym, 0);
      pkgSeriesMap.set(ym, pkgSeriesMap.get(ym) + (pk || 0));
    }
    const monthlyPackages = Array.from(pkgSeriesMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, count]) => ({ ym, packages: count }));
    const packagesTotal = monthlyPackages.reduce(
      (a, m) => a + (m.packages || 0),
      0
    );

    // Фіналізація PSL
    const perpieceActive = perpieceActiveSet.size;
    perpieceGross = Array.from(pslMonthly.values()).reduce(
      (s, m) => s + (m.gross || 0),
      0
    );
    perpieceSteril = Array.from(pslMonthly.values()).reduce(
      (s, m) => s + (m.steril || 0),
      0
    );
    const monthlyPSL = Array.from(pslMonthly.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, v]) => ({
        ym,
        steril: v.steril,
        shipping: v.shipping,
        gross: v.gross,
      }));

    const monthly = Array.from(seriesMap.values()).sort((a, b) =>
      a.ym.localeCompare(b.ym)
    );

    // Retention / Churn
    const retentionContract = retentionFromSets(monthly, actAll);
    const retentionByInvoices = retentionFromSets(monthly, actByInvoice);
    const retentionByProtocols = retentionFromSets(monthly, actByProtocol);

    // ARPU
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
      usageBased: monthly.map((m) => {
        const active = (actByInvoice.get(m.ym) || new Set()).size || 0;
        return { ym: m.ym, arpu: active ? m.total / active : 0 };
      }),
    };

    // Top clients by revenue
    const byClientMap = new Map();
    for (const inv of invoices) {
      const d = parseISO(
        inv.issueDate || inv.issue_date || inv.date || inv.createdAt
      );
      if (!d || !(d >= range.start && d < endExcl)) continue;

      const items = Array.isArray(inv.items) ? inv.items : [];
      let sum = 0;
      if (items.length > 0) {
        for (const it of items) {
          const v =
            it.gross_total != null
              ? numFromPL(it.gross_total)
              : it.gross_price != null && it.quantity != null
              ? numFromPL(it.gross_price) * qtyFromAny(it.quantity)
              : it.price_gross != null && it.qty != null
              ? numFromPL(it.price_gross) * qtyFromAny(it.qty)
              : it.brutto != null
              ? numFromPL(it.brutto)
              : it.total != null
              ? numFromPL(it.total)
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
        from: toLocalISO(range.start),
        to: toLocalISO(
          new Date(
            endExcl.getFullYear(),
            endExcl.getMonth(),
            endExcl.getDate() - 1
          )
        ),
      },
      kpis: {
        newClients,
        archivedClients: clients.filter((c) => {
          const a = archivedDateOf(c);
          return a && a >= range.start && a < endExcl;
        }).length,
        activeClients: activeClientsCount,
        abonClients: abonClientsCount,
        packages: packagesTotal,
        shipments,
        courierTrips,
        overquotaValue: monthly.reduce((acc, m) => acc + (m.overquota || 0), 0),
        perpieceActive,
        potentialCapacity,
        perpieceGross,
        perpieceSteril,
        pslShippingAmount,
        pslShippingCount,
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
        overquotaCount: monthly.reduce(
          (acc, m) => acc + (m.overquotaCount || 0),
          0
        ),
        _debugOverquotaMatches: debugOverquotaMatches,
      },

      monthly,
      monthlyPSL,
      monthlyPackages,
      byClient,
      retention: {
        series: retentionContract.series,
        last: retentionContract.last,
        avgRetentionRate: retentionContract.avgRetentionRate,
        byInvoices: retentionByInvoices,
        byProtocols: retentionByProtocols,
      },
      arpu: arpuSummary,
    });
  } catch (e) {
    console.error("analytics error:", e);
    res.status(500).json({ error: "Błąd analityki" });
  }
});

module.exports = router;
