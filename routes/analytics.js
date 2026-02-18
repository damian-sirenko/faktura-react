// routes/analytics.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const { query } = require("../server/db.js");
const pslRepo = require("../server/repos/pslRepo");

const LOG_FILE = "/tmp/analytics.log";

function log(...args) {
  try {
    const line =
      new Date().toISOString() +
      " " +
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ") +
      "\n";
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch {}
}

// DB helpers
async function fetchClientsDB() {
  return await query("SELECT * FROM clients");
}
async function fetchInvoicesDB(startIso, endIso) {
  return await query(
    `
    SELECT *
    FROM invoices
    WHERE issue_date_real >= ?
    AND issue_date_real < ?
    `,
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
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l");
const normalizeKey = (s) =>
  stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const clientCodeOf = (c) => {
  const v =
    c.clientId ??
    c.client_id ??
    c.clientID ??
    c.code ??
    c.kod ??
    c.Kod ??
    c["Kod klienta"] ??
    c["Client ID"] ??
    c.id ??
    c.ID ??
    null;
  return v ? String(v).trim() : "";
};

const resolveClientById = (clients, clientId) => {
  const wanted = String(clientId || "").trim();
  if (!wanted) return null;

  return (
    clients.find((c) => String(c.id ?? "").trim() === wanted) ||
    clients.find((c) => String(c.ID ?? "").trim() === wanted) ||
    clients.find((c) => clientCodeOf(c) === wanted) ||
    null
  );
};

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
  const hasAbon = String(c?.subscription ?? c?.Abonament ?? c?.abonament ?? "")
    .toLowerCase()
    .includes("steryl");

  if (hasAbon) return "abonament";
  return "perpiece";
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

const categorizeItemName = (nameRaw) => {
  const name = normalizeKey(nameRaw);

  if (name.startsWith("sterylizacja narzedzi wg abonamentu steryl")) {
    return "abonBase";
  }

  if (name.includes("wysylka")) {
    return "shipping";
  }

  if (name.includes("dojazd")) {
    return "courier";
  }

  if (name.includes("poza abonamentem")) {
    return "overquota";
  }

  return "other";
};
const itemNameOf = (it) =>
  String(
    it?.name ??
      it?.title ??
      it?.description ??
      it?.Nazwa ??
      it?.Item ??
      it?.product ??
      it?.productName ??
      ""
  ).trim();

const isInvoiceAbonamentByItems = (items) => {
  for (const it of items) {
    const n = normalizeKey(itemNameOf(it));
    if (n.startsWith("sterylizacja narzedzi wg abonamentu steryl")) return true;
  }
  return false;
};

const billingModeForInvoice = (client, items) => {
  if (
    Array.isArray(items) &&
    items.length > 0 &&
    isInvoiceAbonamentByItems(items)
  ) {
    return "abonament";
  }
  return normalizeBilling(client);
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

router.post("/query", async (req, res) => {
  try {
    log("[ANALYTICS] /query START");

    // вимкнути кешування відповіді
    res.set("Cache-Control", "no-store");

    const { from, to } = req.body || {};
    const start = from
      ? firstOfMonth(parseISO(from))
      : firstOfMonth(new Date());
    const endExcl = to
      ? new Date(parseISO(to).getFullYear(), parseISO(to).getMonth() + 1, 1)
      : nextMonth(firstOfMonth(new Date()));

    const range = { start, end: endExcl };

    const clients = await fetchClientsDB();
    const protocols = await fetchProtocolsRangeDB(
      toLocalISO(start),
      toLocalISO(endExcl)
    );

    const invoices = await fetchInvoicesDB(
      toLocalISO(start),
      toLocalISO(endExcl)
    );

    log("[DB]", {
      clients: clients.length,
      protocols: protocols.length,
      invoices: invoices.length,
    });

    console.log("[ANALYTICS][INVOICES] fetched:", invoices.length);
    console.log(
      "[ANALYTICS][INVOICES] with items_json:",
      invoices.filter((i) => String(i.items_json || "").trim().length > 2)
        .length
    );

    // === PAYMENTS (abonament invoices only) ===
    const abonInvoiceRe = /^K\d{3}-[A-Z]{2,3}$/;

    const paymentsMap = new Map();
    // ym -> {
    //   issued: number,
    //   paidCount: number,
    //   unpaidCount: number,
    //   paidSum: number,
    //   unpaidSum: number
    // }

    function ensurePaymentBucket(ym) {
      if (!paymentsMap.has(ym)) {
        paymentsMap.set(ym, {
          issued: 0,
          paidCount: 0,
          unpaidCount: 0,
          paidSum: 0,
          unpaidSum: 0,
        });
      }
      return paymentsMap.get(ym);
    }

    const issuedClientsByMonth = new Map(); // ym -> Set(clientCode)
    const paidClientsByMonth = new Map();
    const unpaidClientsByMonth = new Map();

    // === PAYMENTS CALCULATION (SEPARATE LOOP) ===
    for (const inv of invoices) {
      const clientCode = String(
        inv.clientId || inv.client_id || inv.clientID || ""
      ).toUpperCase();

      // тільки клієнти з абонементом (K###-XX)
      if (!abonInvoiceRe.test(String(clientCode))) continue;

      if (!abonInvoiceRe.test(clientCode)) continue;

      const rawDate = inv.issue_date_real || inv.issueDate || null;

      let d = parseISO(rawDate);

      if (!d && typeof rawDate === "string" && /^\d{4}-\d{2}$/.test(rawDate)) {
        const [Y, M] = rawDate.split("-").map(Number);
        d = new Date(Y, M - 1, 1);
      }

      if (!d || !(d >= start && d < endExcl)) continue;

      const ym = yymm(firstOfMonth(d));
      const bucket = ensurePaymentBucket(ym);
      bucket.issued++;
      if (!issuedClientsByMonth.has(ym)) {
        issuedClientsByMonth.set(ym, new Set());
        paidClientsByMonth.set(ym, new Set());
        unpaidClientsByMonth.set(ym, new Set());
      }

      issuedClientsByMonth.get(ym).add(clientCode);

      // 2️⃣ сума фактури
      let invoiceSum =
        numFromPL(inv.gross) ||
        numFromPL(inv.total_gross) ||
        numFromPL(inv.total) ||
        numFromPL(inv.brutto) ||
        0;

      if (!invoiceSum) {
        try {
          const items = JSON.parse(inv.items_json || "[]");

          if (Array.isArray(items)) {
            for (const it of items) {
              invoiceSum +=
                it.gross_total != null
                  ? numFromPL(it.gross_total)
                  : it.gross_price != null && it.quantity != null
                  ? numFromPL(it.gross_price) * qtyFromAny(it.quantity)
                  : 0;
            }
          }
        } catch {}
      }

      // 3️⃣ статус
      const status = String(
        inv.status || inv.paymentStatus || inv.payment_status || ""
      ).toLowerCase();

      const isPaid =
        status.includes("paid") ||
        status.includes("opłac") ||
        status.includes("oplac") ||
        status.includes("zapłac") ||
        status.includes("zaplac");

      if (isPaid) {
        bucket.paidCount++;
        bucket.paidSum += invoiceSum;
      } else {
        bucket.unpaidCount++;
        bucket.unpaidSum += invoiceSum;
      }
    }

    const pslIndex = await pslRepo.savedIndex();

    console.log("[ANALYTICS][PSL]", {
      rows: Array.isArray(pslIndex) ? pslIndex.length : null,
      sample: Array.isArray(pslIndex) ? pslIndex[0] : null,
    });

    const pslByMonth = new Map();
    // структура: ym -> { total, ship }
    for (const row of pslIndex) {
      const ym = row.ym;
      const total = Number(row.totals?.total || 0);
      const ship = Number(row.totals?.ship || 0);

      if (!pslByMonth.has(ym)) {
        pslByMonth.set(ym, { total: 0, ship: 0 });
      }

      const acc = pslByMonth.get(ym);
      acc.total += total;
      acc.ship += ship;
    }

    // KPI: нові/активні/архівні клієнти (по договорах)
    const newClients = clients.filter((c) => {
      const s = parseISO(c.agreementStart || c["Data podpisania umowy"]);
      return s && s >= start && s < range.end;
    }).length;

    // Активні за протоколами у періоді
    const activeClientsByProtocols = new Set();
    const allEntries = [];
    for (const p of protocols) {
      for (const e of p?.entries || []) {
        const d = parseISO(e.date);
        if (d && d >= start && d < endExcl) {
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
    for (const dt of monthsIter(start, endExcl)) {
      monthsInRange.add(yymm(dt));
    }

    const seriesMap = new Map(); // ym -> revenue buckets
    const actAll = new Map(); // ym -> Set(clientId) (за договорами)
    const actByType = { firma: new Map(), op: new Map() }; // ym -> Set
    const actByBilling = { abonament: new Map(), perpiece: new Map() }; // ym -> Set
    const actByInvoice = new Map(); // ym -> Set(clientKey)
    const actByProtocol = new Map(); // ym -> Set(clientKey)

    for (const dt of monthsIter(start, endExcl)) {
      const ym = yymm(dt);

      seriesMap.set(ym, {
        ym,
        abonBase: 0,
        abonCourier: 0,
        abonOverquota: 0,
        abonShipping: 0,
        perpieceShipping: 0,
        pieceTotal: 0,
      });

      actAll.set(ym, new Set());
      actByType.firma.set(ym, new Set());
      actByType.op.set(ym, new Set());
      actByBilling.abonament.set(ym, new Set());
      actByBilling.perpiece.set(ym, new Set());
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

    // Dochód miesięczny – dane do tabeli (spójne z kategoryzacją pozycji)
    for (const inv of invoices) {
      const clientId = inv.clientId || inv.client_id || inv.clientID || null;
      const client = resolveClientById(clients, clientId);
      const safeClient = client || {};

      const rawIssue = inv.issueDate || null;

      const d = parseISO(rawIssue);

      if (!d) {
        console.log("[ANALYTICS][BAD INVOICE DATE]", {
          id: inv.id,
          rawIssue,
          issueDate: inv.issueDate,
          issue_date: inv.issue_date,
          date: inv.date,
          createdAt: inv.createdAt,
        });
        continue;
      }

      if (!(d >= range.start && d < endExcl)) continue;

      const ym = yymm(firstOfMonth(d));
      if (!seriesMap.has(ym)) continue;

      const bucket = seriesMap.get(ym);

      // TEMP DEBUG
      console.log("[ANALYTICS][INV CLIENT RAW]", {
        invoiceId: inv.id,
        clientId: inv.clientId,
        client_id: inv.client_id,
        clientID: inv.clientID,
        client: inv.client,
      });

      let items = [];

      try {
        console.log("[ANALYTICS][INV RAW]", {
          id: inv.id,
          clientName: inv.clientName,
          issueDate: inv.issueDate,
          items_json_len: (inv.items_json || "").length,
          items_json_preview: String(inv.items_json || "").slice(0, 200),
          shippingGross: inv.shippingGross,
          shipping_price_gross: inv.shipping_price_gross,
          shipping: inv.shipping,
        });

        items = JSON.parse(inv.items_json || "[]");
        if (!Array.isArray(items)) items = [];
      } catch {
        items = [];
      }

      if (items.length === 0) {
        continue;
      }

      const invoiceBilling = billingModeForInvoice(client, items);

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
        console.log("[ANALYTICS][ITEM NAME]", it.name);
        const cat = categorizeItemName(itemNameRaw);
        if (normalizeKey(itemNameRaw).includes("wysylka")) {
          console.log("[ANALYTICS][SHIP MATCH CHECK]", {
            invoiceId: inv.id,
            issueDate: inv.issueDate || inv.issue_date || inv.date,
            itemNameRaw,
            normalized: normalizeKey(itemNameRaw),
            cat,
          });
        }

        const qty =
          it.quantity != null
            ? qtyFromAny(it.quantity)
            : it.qty != null
            ? qtyFromAny(it.qty)
            : 1;

        const v =
          it.gross_total != null
            ? numFromPL(it.gross_total)
            : it.total_gross != null
            ? numFromPL(it.total_gross)
            : it.grossTotal != null
            ? numFromPL(it.grossTotal)
            : it.gross_price != null
            ? numFromPL(it.gross_price) * (qty || 1)
            : it.price_gross != null
            ? numFromPL(it.price_gross) * qty
            : it.net_total != null
            ? numFromPL(it.net_total) * 1.23
            : it.net_price != null
            ? numFromPL(it.net_price) * 1.23
            : 0;
        if (cat === "shipping") {
          console.log("[ANALYTICS][SHIP ITEM RAW]", {
            invoiceId: inv.id,
            itemNameRaw,
            quantity: it.quantity,
            gross_price: it.gross_price,
            gross_total: it.gross_total,
            net_total: it.net_total,
            parsed_gross_total: numFromPL(it.gross_total),
          });
          console.log("[ANALYTICS][SHIP V]", {
            invoiceId: inv.id,
            v,
            qty,
            raw: it,
          });
        }

        const billing = invoiceBilling;
        if (billing === "abonament") {
          if (cat === "shipping") {
            bucket.abonShipping = (bucket.abonShipping || 0) + v;
          } else if (cat === "abonBase") {
            bucket.abonBase += v;
          } else if (cat === "courier") {
            bucket.abonCourier += v;
          } else if (cat === "overquota") {
            bucket.abonOverquota += v;
          }
        }
      }
    }

    console.log(
      "SHIPPING CHECK",
      Array.from(seriesMap.values()).map((m) => ({
        ym: m.ym,
        abonShipping: m.abonShipping,
        perpieceShipping: m.perpieceShipping,
        pieceTotal: m.pieceTotal,
      }))
    );

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
    const monthly = Array.from(seriesMap.values())
      .map((m) => {
        const abonBase = Number(m.abonBase || 0);
        const shipping = Number(m.abonShipping || 0);
        const courier = Number(m.abonCourier || 0);
        const overquota = Number(m.abonOverquota || 0);

        const abonTotal = abonBase + shipping + courier + overquota;
        const psl = pslByMonth.get(m.ym) || { total: 0, ship: 0 };

        return {
          ym: m.ym,
          abonBase,

          abon: {
            abon: abonBase,
            shipping,
            courier,
            overquota,
            total: abonTotal,
          },

          perpiece: {
            total: psl.total,
            shipping: psl.ship,
            service: psl.total - psl.ship,
          },

          total: abonTotal + psl.total,
        };
      })
      .sort((a, b) => a.ym.localeCompare(b.ym));

    log(
      "[MONTHLY]",
      monthly.map((m) => ({
        ym: m.ym,
        total: m.total,
        abon: m.abon.total,
        perpiece: m.perpiece.total,
      }))
    );

    console.log(
      "[ANALYTICS][MONTHLY OUT]",
      monthly.map((x) => ({
        ym: x.ym,
        total: x.total,
        abonTotal: x.abon?.total,
        perpieceTotal: x.perpiece?.total,
      }))
    );

    // Top clients by revenue
    const byClientMap = new Map();
    for (const inv of invoices) {
      const d = parseISO(
        inv.issueDate || inv.issue_date || inv.date || inv.createdAt
      );
      if (!d || !(d >= range.start && d < endExcl)) continue;

      let items = [];
      try {
        items = JSON.parse(inv.items_json || "[]");
        if (!Array.isArray(items)) items = [];
      } catch {
        items = [];
      }

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
      const clientId = inv.clientId || inv.client_id || inv.clientID;
      if (!clientId) continue;

      byClientMap.set(clientId, (byClientMap.get(clientId) || 0) + sum);
    }
    console.log(
      "[ANALYTICS][MONTHLY SHIPPING SUM]",
      Array.from(seriesMap.values()).map((m) => ({
        ym: m.ym,
        abonShipping: m.abonShipping,
        perpieceShipping: m.perpieceShipping,
        pieceTotal: m.pieceTotal,
        abonBase: m.abonBase,
        abonCourier: m.abonCourier,
        abonOverquota: m.abonOverquota,
      }))
    );

    const byClient = Array.from(byClientMap.entries())
      .map(([client, total]) => ({ client, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    console.log("=== ANALYTICS DEBUG ===");
    console.log("monthly length:", monthly.length);
    console.log(
      "monthly non-zero:",
      monthly.filter(
        (m) =>
          m.abonBase !== 0 ||
          m.abon.shipping !== 0 ||
          m.abon.courier !== 0 ||
          m.abon.overquota !== 0
      )
    );

    console.log("=======================");

    const paymentsMonthly = Array.from(paymentsMap.entries())
      .map(([ym, v]) => ({ ym, ...v }))
      .sort((a, b) => a.ym.localeCompare(b.ym));

    for (const ym of monthsInRange) {
      if (!paymentsMap.has(ym)) {
        paymentsMonthly.push({
          ym,
          issued: 0,
          paidCount: 0,
          unpaidCount: 0,
          paidSum: 0,
          unpaidSum: 0,
        });
      }
    }

    paymentsMonthly.sort((a, b) => a.ym.localeCompare(b.ym));

    log("[RESPONSE]", {
      monthly: monthly.length,
      paymentsMonthly: paymentsMonthly.length,
      monthlyPackages: monthlyPackages.length,
    });

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

      monthly,

      paymentsMonthly,

      monthlyPackages,

      byClient,
    });
  } catch (e) {
    console.error("analytics error:", e);
    res.status(500).json({ error: "Błąd analityki" });
  }
});

module.exports = router;
