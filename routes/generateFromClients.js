// routes/generateFromClients.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const router = express.Router();
const { generatePDF } = require("../faktura.pdf.js");

// --- PATHS / FILES
const DATA_DIR = path.join(__dirname, "..", "data");
const GENERATED_DIR = path.join(__dirname, "..", "generated");
const COUNTERS_FILE = path.join(DATA_DIR, "counters.json");
const INVOICES_FILE = path.join(DATA_DIR, "invoices.json");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const PROTOCOLS_FILE = path.join(DATA_DIR, "protocols.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

// ensure
for (const dir of [DATA_DIR, GENERATED_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
for (const f of [
  COUNTERS_FILE,
  INVOICES_FILE,
  CLIENTS_FILE,
  PROTOCOLS_FILE,
  SETTINGS_FILE,
]) {
  if (!fs.existsSync(f))
    fs.writeFileSync(
      f,
      f === SETTINGS_FILE
        ? JSON.stringify(
            {
              perPiecePriceGross: 6,
              defaultVat: 23,
              currentIssueMonth: new Date().toISOString().slice(0, 7),
              courierPriceGross: 0,
              shippingPriceGross: 0,
            },
            null,
            2
          )
        : "[]",
      "utf8"
    );
}

// --- HELPERS
function readJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJSON(p, val) {
  fs.writeFileSync(p, JSON.stringify(val, null, 2), "utf8");
}
function formatPL(num) {
  return Number(num || 0)
    .toFixed(2)
    .replace(".", ",");
}

// Безпечний парсер чисел у PL-нотації: "1 234,56" / "1 234,56" / "1234,56"
function numFromPL(val) {
  if (val === null || val === undefined) return 0;
  let s = String(val).trim();
  if (!s) return 0;
  s = s.replace(/[\s\u00A0\u202F]/g, ""); // звичайні/нерозривні/вузькі пробіли
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

// Нормалізація діакритиків/ключів для стабільних slug/id
function stripDiacritics(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function normalizeKey(s) {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// --- amount in words (PL) ---
function _formPL(n, forms) {
  if (n === 1) return forms[0];
  const u = n % 10,
    t = n % 100;
  if (u >= 2 && u <= 4 && !(t >= 12 && t <= 14)) return forms[1];
  return forms[2];
}
function _tripletToWordsPL(n) {
  const UNITS = [
    "",
    "jeden",
    "dwa",
    "trzy",
    "cztery",
    "pięć",
    "sześć",
    "siedem",
    "osiem",
    "dziewięć",
  ];
  const TEENS = [
    "dziesięć",
    "jedenaście",
    "dwanaście",
    "trzynaście",
    "czternaście",
    "piętnaście",
    "szesnaście",
    "siedemnaście",
    "osiemnaście",
    "dziewiętnaście",
  ];
  const TENS = [
    "",
    "",
    "dwadzieścia",
    "trzydzieści",
    "czterdzieści",
    "pięćdziesiąt",
    "sześćdziesiąt",
    "siedemdziesiąt",
    "osiemdziesiąt",
    "dziewięćdziesiąt",
  ];
  const HUNDS = [
    "",
    "sto",
    "dwieście",
    "trzysta",
    "czterysta",
    "pięćset",
    "sześćset",
    "siedemset",
    "osiemset",
    "dziewięćset",
  ];
  const s = [];
  const h = Math.floor(n / 100);
  const d = Math.floor((n % 100) / 10);
  const u = n % 10;
  if (h) s.push(HUNDS[h]);
  if (d === 1) s.push(TEENS[u]);
  else {
    if (d) s.push(TENS[d]);
    if (u) s.push(UNITS[u]);
  }
  return s.join(" ").trim();
}
function _intToWordsPL(n) {
  if (n === 0) return "zero";
  const groups = [
    null,
    ["tysiąc", "tysiące", "tysięcy"],
    ["milion", "miliony", "milionów"],
    ["miliard", "miliardy", "miliardów"],
  ];
  const parts = [];
  let g = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) {
      if (g === 1 && chunk === 1) {
        parts.unshift("tysiąc");
      } else if (g === 0) {
        parts.unshift(_tripletToWordsPL(chunk));
      } else {
        const chunkWords = _tripletToWordsPL(chunk);
        parts.unshift((chunkWords + " " + _formPL(chunk, groups[g])).trim());
      }
    }
    n = Math.floor(n / 1000);
    g++;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
function amountInWordsPL(amount) {
  const v = numFromPL(amount);
  const totalGr = Math.round(v * 100);
  const zl = Math.floor(totalGr / 100);
  const gr = totalGr % 100;
  const zlForms = ["złoty", "złote", "złotych"];
  const zlWord = _intToWordsPL(zl);
  const zlUnit = _formPL(zl, zlForms);
  const grPart = String(gr).padStart(2, "0") + "/100";
  return `${zlWord} ${zlUnit} ${grPart}`;
}

function ymKeyOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return { key: `${y}-${m}`, y, m };
}
function getPolishMonthName(idx0to11) {
  const months = [
    "styczeń",
    "luty",
    "marzec",
    "kwiecień",
    "maj",
    "czerwiec",
    "lipiec",
    "sierpień",
    "wrzesień",
    "październik",
    "listopad",
    "grudzień",
  ];
  return months[idx0to11];
}
function toSlugId(client) {
  const id = client?.id || client?.ID;
  if (id && String(id).trim()) return String(id).trim();
  const name = client?.name || client?.Klient || "client";
  return normalizeKey(name).replace(/\s+/g, "-");
}
function readCounters() {
  try {
    return JSON.parse(fs.readFileSync(COUNTERS_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeCounters(o) {
  fs.writeFileSync(COUNTERS_FILE, JSON.stringify(o, null, 2), "utf8");
}
function readInvoices() {
  return readJSON(INVOICES_FILE, []);
}
function writeInvoices(a) {
  writeJSON(INVOICES_FILE, a);
}
function parseSubscriptionLimit(s) {
  // np. "Steryl 50", "STERYL-100", "Steryl50" -> 50 / 100 / 50
  const m = String(s || "").match(/(\d{1,4})/);
  return m ? parseInt(m[1], 10) : 0;
}

// unique number ST-XYZ/MM/YYYY by issueDate
const INVOICE_PREFIX = "ST";
function getNextInvoiceNumberByDate(issueDate) {
  const counters = readCounters();
  const { key, y, m } = ymKeyOf(issueDate);
  if (!(key in counters)) {
    counters[key] = 1;
    writeCounters(counters);
  }
  const used = new Set(
    readInvoices()
      .filter(
        (inv) =>
          typeof inv.number === "string" && inv.number.endsWith(`/${m}/${y}`)
      )
      .map((inv) => inv.number)
  );
  let next = Number(counters[key] || 1);
  while (true) {
    const three = String(next).padStart(3, "0");
    const candidate = `${INVOICE_PREFIX}-${three}/${m}/${y}`;
    if (!used.has(candidate)) {
      counters[key] = next + 1;
      writeCounters(counters);
      return candidate;
    }
    next++;
  }
}

// Нормалізація режимів доставки для підрахунку кур'єрських поїздок
function courierTripsOf(delivery) {
  const d = normalizeKey(delivery);
  if (d === "odbior" || d === "dowoz") return 1;
  if (d === "odbior dowoz" || d === "odbior+dowoz") return 2;
  return 0;
}

// --- MAIN ROUTE
// POST /gen/from-clients { ids?: string[], clientIds?: string[], issueDate?: "YYYY-MM-DD", month?: "YYYY-MM" }
router.post("/from-clients", async (req, res) => {
  try {
    const body = req.body || {};
    const clientIdsRaw = Array.isArray(body.clientIds)
      ? body.clientIds
      : Array.isArray(body.ids)
      ? body.ids
      : [];
    const clientIds = clientIdsRaw.map(String);

    let issueDate = new Date();
    if (body.issueDate) {
      const d = new Date(body.issueDate);
      if (!isNaN(d)) issueDate = d;
    }

    const settings = readJSON(SETTINGS_FILE, {
      perPiecePriceGross: 6,
      defaultVat: 23,
      currentIssueMonth: new Date().toISOString().slice(0, 7),
      courierPriceGross: 0,
      shippingPriceGross: 0,
    });
    const perPiece = Number(settings.perPiecePriceGross || 0);
    const vat = Number(settings.defaultVat || 23);
    const globalCourier = Number(settings.courierPriceGross || 0);
    const globalShipping = Number(settings.shippingPriceGross || 0);
    const month =
      typeof body.month === "string" && /^\d{4}-\d{2}$/.test(body.month)
        ? body.month
        : settings.currentIssueMonth || new Date().toISOString().slice(0, 7);

    const clients = readJSON(CLIENTS_FILE, []);
    const protocols = readJSON(PROTOCOLS_FILE, []);
    const invoices = readInvoices();

    const monthLabel = `${month.slice(5)}/${month.slice(0, 4)}`; // MM/YYYY
    const polishMonth = getPolishMonthName(Number(month.slice(5)) - 1);
    const dateFolderPart = new Date().toISOString().split("T")[0];
    // Залишаємо польські літери (узгоджено з шаблонами/даними)
    const folderName = `Faktury_${polishMonth}_${dateFolderPart}`;
    const outputDir = path.join(GENERATED_DIR, folderName.normalize("NFC"));
    fs.mkdirSync(outputDir, { recursive: true });

    // map for quick find
    const clientMapById = new Map();
    const clientMapByName = new Map();
    for (const c of clients) {
      clientMapById.set(toSlugId(c), c);
      const n = (c.name || c.Klient || "").trim();
      if (n) clientMapByName.set(n, c);
    }

    const files = [];

    // helper: sum packages / courier / shipping
    function collectMonth(proto) {
      const entries = Array.isArray(proto?.entries) ? proto.entries : [];
      let packages = 0,
        courier = 0,
        shipments = 0;
      for (const e of entries) {
        packages += Number(e?.packages || 0) || 0;
        if (e?.shipping) shipments += 1;
        courier += courierTripsOf(e?.delivery || "");
      }
      return { packages, courier, shipments };
    }

    const targetKeys = clientIds.length ? clientIds : clients.map(toSlugId);
    for (const key of targetKeys) {
      const baseClient =
        clientMapById.get(String(key)) ||
        clientMapByName.get(String(key)) ||
        null;
      if (!baseClient) continue;

      // indywidualne ceny (jeśli ustawione) albo globalne
      const courierUnit =
        String(baseClient?.courierPriceMode || "") === "custom"
          ? Number(baseClient?.courierPriceGross || 0)
          : globalCourier;

      const shippingUnit =
        String(baseClient?.shippingPriceMode || "") === "custom"
          ? Number(baseClient?.shippingPriceGross || 0)
          : globalShipping;

      // find protocol for month
      const clientId = toSlugId(baseClient);
      const proto = protocols.find(
        (p) => p.id === clientId && p.month === month
      ) || { entries: [] };
      const sums = collectMonth(proto);

      // buyer id (NIP/PESEL)
      const isFirma =
        String(
          baseClient.type || baseClient["Firma - OP"] || "op"
        ).toLowerCase() === "firma";
      const buyerIdentifier = isFirma
        ? baseClient.nip || baseClient.NIP
          ? `NIP: ${baseClient.nip || baseClient.NIP}`
          : ""
        : baseClient.pesel || baseClient.Pesel
        ? `PESEL: ${baseClient.pesel || baseClient.Pesel}`
        : "";

      // decide billing mode
      const hasAbon = !!String(
        baseClient.subscription ?? baseClient.Abonament ?? ""
      ).trim();
      const billingMode =
        baseClient.billingMode || (hasAbon ? "abonament" : "perpiece");

      const items = [];

      if (billingMode === "abonament") {
        const abonGross =
          Number(
            baseClient.subscriptionAmount || baseClient["Kwota abonamentu"] || 0
          ) || 0;

        // pozycja abonamentowa
        if (abonGross > 0) {
          const net = abonGross / (1 + vat / 100);
          items.push({
            name: `Sterylizacja narzędzi wg abonamentu ${
              baseClient.subscription || baseClient.Abonament || ""
            } za mies. ${monthLabel}`,
            quantity: 1,
            net_price: formatPL(net),
            gross_price: formatPL(abonGross),
            net_total: formatPL(net),
            vat_rate: `${vat}%`,
            vat_amount: formatPL(abonGross - net),
            gross_total: formatPL(abonGross),
          });
        }

        // tylko nadwyżka ponad limit abonamentu
        const limit = parseSubscriptionLimit(
          baseClient.subscription || baseClient.Abonament || ""
        );
        const over = Math.max((Number(sums.packages) || 0) - limit, 0);
        if (over > 0 && perPiece > 0) {
          const netU = perPiece / (1 + vat / 100);
          const netT = netU * over;
          const grossT = perPiece * over;
          items.push({
            name: "Pakiety poza abonamentem",
            quantity: over,
            net_price: formatPL(netU),
            gross_price: formatPL(perPiece),
            net_total: formatPL(netT),
            vat_rate: `${vat}%`,
            vat_amount: formatPL(grossT - netT),
            gross_total: formatPL(grossT),
          });
        }
      } else {
        // tryb "na sztuki" — całość з протоколу
        if (sums.packages > 0 && perPiece > 0) {
          const netU = perPiece / (1 + vat / 100);
          const netT = netU * sums.packages;
          const grossT = perPiece * sums.packages;
          items.push({
            name: "Sterylizacja narzędzi — pakiety",
            quantity: sums.packages,
            net_price: formatPL(netU),
            gross_price: formatPL(perPiece),
            net_total: formatPL(netT),
            vat_rate: `${vat}%`,
            vat_amount: formatPL(grossT - netT),
            gross_total: formatPL(grossT),
          });
        }
      }

      // kurier / wysyłka
      if (sums.courier > 0 && courierUnit > 0) {
        const netU = courierUnit / (1 + vat / 100);
        const netT = netU * sums.courier;
        const grossT = courierUnit * sums.courier;
        items.push({
          name: "Dojazd kuriera",
          quantity: sums.courier,
          net_price: formatPL(netU),
          gross_price: formatPL(courierUnit),
          net_total: formatPL(netT),
          vat_rate: `${vat}%`,
          vat_amount: formatPL(grossT - netT),
          gross_total: formatPL(grossT),
        });
      }
      if (sums.shipments > 0 && shippingUnit > 0) {
        const netU = shippingUnit / (1 + vat / 100);
        const netT = netU * sums.shipments;
        const grossT = shippingUnit * sums.shipments;
        items.push({
          name: "Wysyłka",
          quantity: sums.shipments,
          net_price: formatPL(netU),
          gross_price: formatPL(shippingUnit),
          net_total: formatPL(netT),
          vat_rate: `${vat}%`,
          vat_amount: formatPL(grossT - netT),
          gross_total: formatPL(grossT),
        });
      }

      // totals
      const gross_sum = items.reduce((s, p) => s + numFromPL(p.gross_total), 0);
      const net_sum = items.reduce((s, p) => s + numFromPL(p.net_total), 0);
      const vat_sum = items.reduce((s, p) => s + numFromPL(p.vat_amount), 0);

      if (!items.length) continue;

      // dates & number
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + 7);
      const number = getNextInvoiceNumberByDate(issueDate);

      const invoiceData = {
        number,
        place: "Kraków",
        issue_date: issueDate.toISOString().split("T")[0],
        sale_date: issueDate.toISOString().split("T")[0],
        due_date: dueDate.toISOString().split("T")[0],

        // SELLER (for invoice.html)
        seller_name: "CORRECT SOLUTION SP. Z O.O.",
        seller_address: "Osiedle Dywizjonu 303 62F, 31-875 Kraków",
        seller_nip: "6751516747",

        // BUYER
        buyer_name: baseClient.name || baseClient.Klient || "",
        buyer_address: baseClient.address || baseClient.Adres || "",
        buyer_identifier: buyerIdentifier,

        // ITEMS + TOTALS
        items,
        net_sum: formatPL(net_sum),
        vat_sum: formatPL(vat_sum),
        gross_sum: formatPL(gross_sum),

        // PAYMENT / ISSUER
        amount_due: formatPL(gross_sum),
        paid_amount: formatPL(0),
        amount_in_words: amountInWordsPL(gross_sum),
        payment_method: "Przelew",
        bank: "Bank Pekao S.A.",
        account: "97 1240 4533 1111 0010 8767 4627",
        issuer: "Pracownik",
      };

      const fileSafeNumber = invoiceData.number.replaceAll("/", "_");
      const filePath = path.join(outputDir, `Faktura_${fileSafeNumber}.pdf`);
      try {
        await generatePDF(invoiceData, filePath);
        files.push(filePath);
        invoices.push({
          number: invoiceData.number,
          client: invoiceData.buyer_name,
          issueDate: invoiceData.issue_date,
          dueDate: invoiceData.due_date,
          net: invoiceData.net_sum,
          gross: invoiceData.gross_sum,
          filename: `Faktura_${fileSafeNumber}.pdf`,
          folder: folderName, // зберігаємо метадані папки (прев’ю робити через /download-invoice/:filename)
          items: invoiceData.items,
          buyer_address: invoiceData.buyer_address,
          buyer_nip: isFirma ? baseClient.nip || baseClient.NIP || "" : "",
          buyer_pesel: !isFirma
            ? baseClient.pesel || baseClient.Pesel || ""
            : "",
          status: "issued",
        });
      } catch (e) {
        console.error(
          "PDF error for:",
          baseClient.name || baseClient.Klient,
          e
        );
      }
    }

    writeInvoices(invoices);

    if (!files.length)
      return res
        .status(400)
        .json({ error: "Brak danych do faktur (puste pozycje)" });

    // zip
    const zipName = `faktury_${Date.now()}.zip`;
    const zipPath = path.join(outputDir, zipName);
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      for (const f of files) archive.file(f, { name: path.basename(f) });
      archive.finalize();
    });

    res.attachment("faktury.zip");
    res.setHeader("Content-Type", "application/zip");
    fs.createReadStream(zipPath).pipe(res);
  } catch (e) {
    console.error("GEN from clients error:", e);
    res.status(500).json({ error: "Błąd generowania z bazy klientów" });
  }
});

module.exports = router;
