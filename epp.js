// epp.js
// Eksport .epp dla InsERT GT/Nexo (zgodny z Fakturownia 1.08):
// - [INFO] dokładnie 24 pól, z [15] = 1 oraz zakresem dat miesiąca
// - [NAGLOWEK] 62 pól, uzupełnione 40..45 i waluta jako "PLN"
// - [ZAWARTOSC] 18 pól/pozycję (TERAZ: 1 wiersz na stawkę VAT – agregacja jak w Fakturowni)
// - Sekcje końcowe: KONTRAHENCI, DATYZAKONCZENIA, PRZYCZYNYKOREKT, DOKUMENTYZNACZNIKIJPKVAT
// - CRLF + encoding CP1250

let iconv = null;
try {
  iconv = require("iconv-lite");
} catch {}

const CRLF = "\r\n";

/* ===== Helpers ===== */
function to2(n) {
  const v = Number(
    String(n ?? "")
      .toString()
      .replace(",", ".")
  );
  if (!Number.isFinite(v)) return "0.00";
  return v.toFixed(2);
}
function to4(n) {
  const v = Number(
    String(n ?? "")
      .toString()
      .replace(",", ".")
  );
  if (!Number.isFinite(v)) return "0.0000";
  return v.toFixed(4);
}
function csvq(v = "") {
  const s = String(v ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/"/g, '""');
  return `"${s}"`;
}
function eppDate14(s) {
  if (!s) return "";
  const str = String(s).trim();
  if (/^\d{14}$/.test(str)) return str; // YYYYMMDDhhmmss
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str.replace(/-/g, "") + "000000";
  if (/^\d{8}$/.test(str)) return str + "000000";
  const d = new Date(str);
  if (!isNaN(d)) {
    const pad = (x, n = 2) => String(x).padStart(n, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    return `${yyyy}${mm}${dd}000000`;
  }
  return "";
}
function parseVatPercent(v) {
  if (v == null) return 23;
  const s = String(v).replace("%", "").replace(",", ".").trim();
  const num = Number(s);
  return Number.isFinite(num) ? num : 23;
}

/** Normalizacja nazwy: prostujemy cudzysłowy, pauzy, NBSP, wywalamy kontrolne */
function normalizeName(name = "") {
  const map = {
    "„": '"',
    "”": '"',
    "«": '"',
    "»": '"',
    "‚": "'",
    "’": "'",
    "–": "-",
    "—": "-",
    "\u00A0": " ", // NBSP
  };
  let s = String(name || "")
    .trim()
    .replace(/[\u0000-\u001F]/g, "");
  s = s.replace(/[„”«»‚’–—\u00A0]/g, (ch) => map[ch] || ch);
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function splitNameTo3(name, _maxLen = 50) {
  const s = normalizeName(name);
  if (!s) return ["", "", ""];
  return [s, s, s];
}

/** Próba pobrania nazwy nabywcy z różnych pól faktury */
function getBuyerNameFromInvoice(inv) {
  const candidates = [
    inv && inv.client,
    inv && inv.client_name,
    inv && inv.clientName,
    inv && inv.buyer_name,
    inv && inv.buyerName,
    inv && inv.buyer && inv.buyer.name,
    inv && inv.buyer && inv.buyer.fullName,
    inv && inv.Klient,
  ];
  for (const raw of candidates) {
    const n = normalizeName(raw || "");
    if (n) return n;
  }
  return "";
}

/** Rozbij adres "Ulica 1/2, 31-875 Kraków" -> {street, postal, city} */
function splitAddress(addr) {
  const out = { street: "", postal: "", city: "" };
  const s = String(addr || "").trim();
  if (!s) return out;

  const parts = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const joinTail = (arr) => arr.join(", ").trim();

  if (parts.length >= 2) {
    out.street = parts[0];
    const tail = joinTail(parts.slice(1));
    const m = tail.match(/(\d{2}-\d{3})\s+(.+)$/);
    if (m) {
      out.postal = m[1];
      out.city = m[2].trim();
    } else {
      const m2 = tail.match(/^(.+)\s+(\d{2}-\d{3})$/);
      if (m2) {
        out.city = m2[1].trim();
        out.postal = m2[2];
      } else {
        out.city = tail;
      }
    }
    return out;
  }

  const m3 = s.match(/(.+?)\s*,?\s*(\d{2}-\d{3})\s+(.+)$/);
  if (m3) {
    out.street = m3[1].trim();
    out.postal = m3[2];
    out.city = m3[3].trim();
    return out;
  }

  out.street = s;
  return out;
}

/** YYYYMMDD zakres z tablicy faktur */
function rangeDateYYYYMMDD(invoices, getter) {
  const ys = [];
  for (const inv of invoices) {
    const d = getter(inv);
    const ymd = eppDate14(d).slice(0, 8);
    if (ymd) ys.push(ymd);
  }
  if (!ys.length) {
    const today = eppDate14(new Date()).slice(0, 8);
    return { start: today, end: today };
  }
  ys.sort();
  return { start: ys[0], end: ys[ys.length - 1] };
}

/** Pierwszy i ostatni dzień miesięcy obejmujących zakres */
function monthStartEnd(ymdStart, ymdEnd) {
  const y1 = Number(ymdStart.slice(0, 4));
  const m1 = Number(ymdStart.slice(4, 6));
  const y2 = Number(ymdEnd.slice(0, 4));
  const m2 = Number(ymdEnd.slice(4, 6));

  const d1 = new Date(Date.UTC(y1, m1 - 1, 1));
  const d2 = new Date(Date.UTC(y2, m2, 0)); // ostatni dzień m2

  const pad = (x, n = 2) => String(x).padStart(n, "0");
  const S = `${d1.getUTCFullYear()}${pad(d1.getUTCMonth() + 1)}${pad(
    d1.getUTCDate()
  )}`;
  const E = `${d2.getUTCFullYear()}${pad(d2.getUTCMonth() + 1)}${pad(
    d2.getUTCDate()
  )}`;
  return { startMonth: S, endMonth: E };
}

/* ===== Stabilny source-id dla [NAGLOWEK][3] ===== */
const CRC32_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(str) {
  let crc = 0 ^ -1;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ str.charCodeAt(i)) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}
function buildEppSourceId(inv) {
  const explicit = inv.source_id || inv.sourceId || inv.id || inv._id;
  if (explicit && /^\d+$/.test(String(explicit))) return String(explicit);
  const base = [
    inv.number || "",
    inv.issueDate || inv.issue_date || "",
    inv.gross || "",
    inv.client || "",
  ].join("|");
  const h = crc32(base);
  const OFFSET = 2000000000;
  return String(OFFSET + (h % 800000000));
}

/* ===== GŁÓWNA FUNKCJA ===== */
function generateEPPContent(invoices = [], options = {}) {
  const seller = Object.assign(
    {
      name: "CORRECT SOLUTION SP. Z O.O.",
      shortName: "CORRECT SOLUTION SP. Z O.O.",
      nip: "6751516747",
      address: "Osiedle Dywizjonu 303 62F, 31-875 Kraków",
      countryName: "Polska",
      countryCode: "PL",
      contactName: "Exporter",
    },
    options.seller || {}
  );

  const addr = splitAddress(seller.address);
  const exporterName = options.exporterName || "faktura-react";

  // zakres wg dat wystawienia (pierwszy i ostatni dzień miesiąca)
  const range = rangeDateYYYYMMDD(
    invoices,
    (inv) => inv.issueDate || inv.issue_date
  );
  const monthRange = monthStartEnd(range.start, range.end);

  // [INFO] – 24 pola, zgodnie z Fakturownia: [15] = 1
  const codepage = 1250;
  const info = [
    csvq("1.08"), // [0]
    0, // [1]
    codepage, // [2]
    csvq(exporterName), // [3]
    csvq(exporterName), // [4]
    csvq(seller.shortName || seller.name), // [5]
    csvq(seller.name), // [6]
    csvq(addr.city || ""), // [7]
    csvq(addr.postal || ""), // [8]
    csvq(addr.street || ""), // [9]
    csvq(String(seller.nip || "")), // [10]
    "", // [11] magazyn id (opcjonalnie)
    "", // [12] magazyn nazwa (opcjonalnie)
    "", // [13]
    "", // [14]
    1, // [15] (zgodnie z plikiem referencyjnym)
    `${monthRange.startMonth}000000`, // [16] data od
    `${monthRange.endMonth}000000`, // [17] data do
    csvq(seller.contactName || seller.name), // [18]
    eppDate14(new Date()), // [19] data eksportu
    csvq(seller.countryName || "Polska"), // [20]
    csvq(seller.countryCode || "PL"), // [21]
    csvq(`${seller.countryCode || "PL"}${seller.nip || ""}`), // [22] EU VAT
    0, // [23]
  ];

  let out = "";
  out += "[INFO]" + CRLF;
  out += info.join(",") + CRLF + CRLF;

  // Zbiór kontrahentów do sekcji końcowej
  const contractors = new Map();

  // ===== Każda faktura
  for (const inv of invoices) {
    const buyerNameRaw = getBuyerNameFromInvoice(inv);
    const [buyerName1, buyerName2, buyerName3] = splitNameTo3(buyerNameRaw);

    if (!buyerName1 && options.requireBuyerName) {
      const num = inv && inv.number ? String(inv.number) : "(brak numeru)";
      throw new Error(
        `[EPP] Brak nazwy kontrahenta dla faktury ${num} – uzupełnij dane nabywcy przed eksportem`
      );
    }

    const number = inv.number || "";
    const issue = inv.issueDate || inv.issue_date || "";
    const sale = inv.saleDate || inv.sale_date || issue;
    const due = inv.dueDate || inv.due_date || issue;

    const place = inv.place || addr.city || "Kraków";

    // adres nabywcy
    let bStreet = inv.buyer_street || "";
    let bPostal = inv.buyer_postal || "";
    let bCity = inv.buyer_city || "";
    if (!bStreet && !bPostal && !bCity) {
      const parsed = splitAddress(inv.buyer_address || inv.address || "");
      bStreet = parsed.street;
      bPostal = parsed.postal;
      bCity = parsed.city;
    }
    const bNip = (inv.buyer_nip || "").toString().trim();

    // do sekcji KONTRAHENCI (unikalny klucz)
    const cKey = [
      buyerName1,
      buyerName2,
      buyerName3,
      bCity,
      bPostal,
      bStreet,
      bNip,
    ].join("|");
    if (!contractors.has(cKey)) {
      contractors.set(cKey, {
        name1: buyerName1,
        name2: buyerName2,
        name3: buyerName3,
        city: bCity,
        postal: bPostal,
        street: bStreet,
        nip: bNip,
      });
    }

    // ===== Agregacja pozycji po stawce VAT (jak w Fakturowni)
    const items = Array.isArray(inv.items) ? inv.items : [];

    // Najpierw policz sumy globalne (nagłówek)
    let netSum = 0,
      vatSum = 0,
      grossSum = 0;

    // Mapa: stawkaVAT -> { net, vat, gross }
    const byVat = new Map();

    if (items.length) {
      for (const it of items) {
        const qty = Number(it.quantity ?? it.qty ?? 1);
        const vatP = parseVatPercent(it.vat_rate);

        const netUnit = Number(
          String(it.net_price ?? it.price_net ?? 0).replace(",", ".")
        );
        const grossUnit =
          String(it.gross_price ?? it.price_gross ?? "") !== ""
            ? Number(String(it.gross_price ?? it.price_gross).replace(",", "."))
            : netUnit * (1 + vatP / 100);

        const netTotal =
          String(it.net_total ?? it._net_sum ?? "") !== ""
            ? Number(String(it.net_total ?? it._net_sum).replace(",", "."))
            : netUnit * qty;

        const grossTotal =
          String(it.gross_total ?? it._gross_sum ?? "") !== ""
            ? Number(String(it.gross_total ?? it._gross_sum).replace(",", "."))
            : grossUnit * qty;

        const vatTotal =
          String(it.vat_amount ?? it._vat_sum ?? "") !== ""
            ? Number(String(it.vat_amount ?? it._vat_sum).replace(",", "."))
            : grossTotal - netTotal;

        netSum += netTotal;
        vatSum += vatTotal;
        grossSum += grossTotal;

        const k = String(vatP);
        const acc = byVat.get(k) || { net: 0, vat: 0, gross: 0, vatP };
        acc.net += netTotal;
        acc.vat += vatTotal;
        acc.gross += grossTotal;
        byVat.set(k, acc);
      }
    } else {
      // Brak pozycji – tworzymy jedną agregację na domyślnej stawce
      const vatP =
        inv.vat_rate ?? (inv.defaultVat != null ? inv.defaultVat : 23);
      netSum = Number(String(inv.net || 0).replace(",", "."));
      grossSum = Number(String(inv.gross || 0).replace(",", "."));
      vatSum = Math.max(0, grossSum - netSum);
      byVat.set(String(parseVatPercent(vatP)), {
        net: netSum,
        vat: vatSum,
        gross: grossSum,
        vatP: parseVatPercent(vatP),
      });
    }

    // ===== [NAGLOWEK] – 62 pól
    const H = new Array(62).fill("");

    const sourceId = buildEppSourceId(inv);

    H[0] = csvq("FS");
    H[1] = 1;
    H[2] = 0;
    H[3] = sourceId; // bez cudzysłowów
    H[4] = csvq(number);
    H[5] = "";
    H[6] = csvq(`FS ${number}`);

    // 11..17 kontrahent
    H[11] = csvq(buyerName1);
    H[12] = csvq(buyerName2);
    H[13] = csvq(buyerName3);
    H[14] = csvq(bCity);
    H[15] = csvq(bPostal);
    H[16] = csvq(bStreet);
    H[17] = csvq(bNip);

    // 20..23 miejsce i daty
    H[20] = csvq(place);
    H[21] = eppDate14(issue);
    H[22] = eppDate14(sale);
    H[23] = eppDate14(issue);

    H[24] = 2;
    H[25] = 1;

    // sumy
    H[27] = to4(netSum);
    H[28] = to4(vatSum);
    H[29] = to4(grossSum);
    H[30] = to4(0);
    H[31] = "";
    H[32] = to4(0);

    H[33] = csvq(inv.payment_method || "Przelew");
    H[34] = eppDate14(due);
    H[35] = to4(0); // zapłacono
    H[36] = to4(grossSum); // do zapłaty

    H[37] = 0;
    H[38] = 0;
    H[39] = 1;

    // 40..45 uzupełnienia jak w Fakturowni
    H[40] = 0;
    H[41] = csvq("Pracownik");
    H[42] = "";
    H[43] = "";
    H[44] = to4(0);
    H[45] = to4(0);

    // waluta i kurs
    H[46] = csvq("PLN");
    H[47] = to4(1);

    H[52] = 0;
    H[53] = 0;
    H[54] = 0;
    H[55] = "";
    H[56] = to4(0);
    H[57] = "";
    H[58] = to4(0);

    H[59] = csvq("Polska");
    H[60] = csvq("PL");
    H[61] = 0;

    out += "[NAGLOWEK]" + CRLF;
    out +=
      H.map((v) => (typeof v === "number" ? String(v) : String(v))).join(",") +
      CRLF;

    // ===== [ZAWARTOSC] – 18 pól/wiersz; 1 wiersz na stawkę VAT (agregacja)
    out += CRLF + "[ZAWARTOSC]" + CRLF;

    // Stabilna kolejność po stawce (np. 0, 5, 8, 23 itd.)
    const vatKeys = Array.from(byVat.keys()).sort(
      (a, b) => Number(a) - Number(b)
    );

    for (const k of vatKeys) {
      const g = byVat.get(k);
      const vatP = g.vatP;

      // Jak w Fakturowni: pola "jednostkowe" zawierają sumy (qty=1)
      const net = g.net;
      const vat = g.vat;
      const gross = g.gross;

      const Z = new Array(18).fill("0.0000");
      Z[0] = csvq(String(vatP)); // "23"
      Z[1] = to4(vatP); // 23.0000
      Z[2] = to4(net); // cena netto / szt. (tu: suma)
      Z[3] = to4(vat); // VAT / szt. (tu: suma)
      Z[4] = to4(gross); // cena brutto / szt. (tu: suma)
      Z[5] = to4(net); // wartość netto
      Z[6] = to4(vat); // VAT
      Z[7] = to4(gross); // wartość brutto

      out += Z.join(",") + CRLF;
    }

    out += CRLF; // pusta linia między dokumentami
  }

  // ===== Sekcja KONTRAHENCI
  out += "[NAGLOWEK]" + CRLF + csvq("KONTRAHENCI") + CRLF + CRLF;
  out += "[ZAWARTOSC]" + CRLF;

  for (const c of contractors.values()) {
    const row = new Array(32).fill("");
    row[0] = 0;
    row[1] = csvq(c.name1);
    row[2] = csvq(c.name2);
    row[3] = csvq(c.name3);
    row[4] = csvq(c.city);
    row[5] = csvq(c.postal);
    row[6] = csvq(c.street);
    row[7] = csvq(c.nip || "");
    // ogon zgodny z przykładem (kraj/kod/0/"PL")
    row[28] = csvq("Polska");
    row[29] = csvq("PL");
    row[30] = 0;
    row[31] = csvq("PL");
    out +=
      row
        .map((v) => (typeof v === "number" ? String(v) : String(v)))
        .join(",") + CRLF;
  }
  out += CRLF;

  // ===== Sekcja DATYZAKONCZENIA
  out += "[NAGLOWEK]" + CRLF + csvq("DATYZAKONCZENIA") + CRLF + CRLF;
  out += "[ZAWARTOSC]" + CRLF;
  for (const inv of invoices) {
    const number = inv.number || "";
    const sale =
      inv.saleDate ||
      inv.sale_date ||
      inv.issueDate ||
      inv.issue_date ||
      new Date();
    out += `${csvq(`FS ${number}`)},${eppDate14(sale)}${CRLF}`;
  }
  out += CRLF;

  // ===== Sekcja PRZYCZYNYKOREKT (pusta, jak w przykładzie)
  out += "[NAGLOWEK]" + CRLF + csvq("PRZYCZYNYKOREKT") + CRLF + CRLF;
  out += "[ZAWARTOSC]" + CRLF + CRLF;

  // ===== Sekcja DOKUMENTYZNACZNIKIJPKVAT (wszystko 0)
  out += "[NAGLOWEK]" + CRLF + csvq("DOKUMENTYZNACZNIKIJPKVAT") + CRLF + CRLF;
  out += "[ZAWARTOSC]" + CRLF;
  for (const inv of invoices) {
    const number = inv.number || "";
    const zeros = Array(28).fill("0").join(",");
    out += `${csvq(`FS ${number}`)},${zeros}${CRLF}`;
  }

  return out;
}

/** Buffer w CP1250 (jeśli iconv-lite dostępny), inaczej UTF-8 */
function generateEPPBuffer(invoices = [], options = {}) {
  const content = generateEPPContent(invoices, options);
  const encoding = (options && options.encoding) || "cp1250";
  if (iconv && encoding.toLowerCase().includes("1250")) {
    return iconv.encode(content, "windows-1250");
  }
  return Buffer.from(content, "utf8");
}

module.exports = {
  generateEPPContent,
  generateEPPBuffer,
  to2,
  to4,
};
