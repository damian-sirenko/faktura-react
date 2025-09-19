// epp.js
// Eksport .epp dla InsERT GT/Nexo: format zgodny z plikiem referencyjnym (Fakturownia),
// poprawione sekcje [INFO] (24 pola), [NAGLOWEK] (62) i [ZAWARTOSC] (18),
// CRLF, możliwość zwrotu jako Buffer w windows-1250 (jeśli iconv-lite dostępny).

let iconv = null;
try {
  // jeśli masz iconv-lite w deps – użyjemy do CP1250
  iconv = require("iconv-lite");
} catch (_) {}

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

/** Normalizacja nazwy: prostujemy cudzysłowy, pauzy, wywalamy kontrolne znaki */
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
  // pojedyncze spacje
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Dzielenie nazwy kontrahenta na 1..3 linie po maks X znaków z podziałem po słowach */
function splitNameTo3(name, maxLen = 50) {
  const s = normalizeName(name);
  if (!s) return ["", "", ""];
  if (s.length <= maxLen) {
    // zgodnie z plikiem referencyjnym Fakturownia: powielamy tę samą nazwę w 11/12/13
    return [s, s, s];
  }
  const out = [];
  let rest = s;
  for (let i = 0; i < 3 && rest.length > 0; i++) {
    if (rest.length <= maxLen) {
      out.push(rest);
      rest = "";
      break;
    }
    // szukamy granicy słowa
    let cut = rest.lastIndexOf(" ", maxLen);
    if (cut < 0 || cut < maxLen * 0.6) cut = maxLen; // w razie bardzo długiego tokenu – tniemy brutalnie
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  while (out.length < 3) out.push(out[out.length - 1] || "");
  return out.slice(0, 3);
}

/** Rozbij adres "Ulica 1/2, 31-875 Kraków" -> {street, postal, city} */
function splitAddress(addr) {
  const out = { street: "", postal: "", city: "" };
  const s = String(addr || "").trim();
  if (!s) return out;

  // Jeśli mamy przecinek – zwykle po nim jest "kod miasto"
  const parts = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const joinTail = (arr) => arr.join(", ").trim();

  if (parts.length >= 2) {
    out.street = parts[0];
    const tail = joinTail(parts.slice(1));
    // Poszukaj "dd-ddd Miasto"
    const m = tail.match(/(\d{2}-\d{3})\s+(.+)$/);
    if (m) {
      out.postal = m[1];
      out.city = m[2].trim();
    } else {
      // może na końcu jest kod, na początku miasto
      const m2 = tail.match(/^(.+)\s+(\d{2}-\d{3})$/);
      if (m2) {
        out.city = m2[1].trim();
        out.postal = m2[2];
      } else {
        // brak kodu – wszystko to miasto
        out.city = tail;
      }
    }
    return out;
  }

  // Bez przecinka: spróbuj wyłuskać kod+miasto z końca
  const m3 = s.match(/(.+?)\s*,?\s*(\d{2}-\d{3})\s+(.+)$/);
  if (m3) {
    out.street = m3[1].trim();
    out.postal = m3[2];
    out.city = m3[3].trim();
    return out;
  }

  // Ostatecznie – wpisz wszystko jako ulicę
  out.street = s;
  return out;
}

/** Pobierz min i max datę YYYYMMDD z tablicy faktur */
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

/* ===== Stabilny source-id do [NAGLOWEK][3] ===== */

// CRC32 tabela + funkcja
const CRC32_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(str) {
  let crc = 0 ^ -1;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ str.charCodeAt(i)) & 0xff];
  }
  return (crc ^ -1) >>> 0; // bez znaku
}

/**
 * Buduje stabilny numeryczny identyfikator źródłowy dokumentu
 * – najpierw używa inv.source_id/id, jeżeli to liczba
 * – w przeciwnym razie deterministyczny CRC32 po kluczowych polach + offset,
 *   aby nie kolidować z historycznymi ID z Fakturowni.
 */
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
  const OFFSET = 2000000000; // 10-cyfrowy start
  return String(OFFSET + (h % 800000000)); // 2,000,000,000..2,799,999,999
}

/* ===== GŁÓWNA FUNKCJA ===== */

/**
 * generateEPPContent(invoices, options)
 * @param {Array} invoices - lista faktur:
 *   {
 *     number, issueDate, saleDate, dueDate, place,
 *     client|buyer_name, buyer_address | (buyer_street, buyer_postal, buyer_city), buyer_nip,
 *     items: [{ name?, quantity, net_price, gross_price?, net_total?, gross_total?, vat_amount?, vat_rate }],
 *     net, gross, vat_rate, defaultVat, payment_method
 *   }
 * @param {Object} options:
 *   {
 *     seller: {
 *       name, // pełna nazwa
 *       shortName?, // opcjonalny krótki wariant (INFO[5]); jeśli brak, użyje name
 *       nip,
 *       address, // "Ulica 1, 31-000 Miasto"
 *       countryName?: "Polska",
 *       countryCode?: "PL",
 *       contactName?: "Imię Nazwisko", // INFO[18]
 *     },
 *     exporterName?: "faktura-react", // INFO[3][4]
 *     encoding?: "cp1250"|"utf8" // jeżeli planujesz użyć generateEPPBuffer
 *   }
 */
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

  // okres eksportu wg dat wystawienia
  const range = rangeDateYYYYMMDD(
    invoices,
    (inv) => inv.issueDate || inv.issue_date
  );

  // ===== [INFO] – 24 pól, jak w pliku referencyjnym
  const codepage = 1250; // InsERT oczekuje CP1250
  const info = [
    csvq("1.08"), // [0] wersja
    0, // [1]
    codepage, // [2] strona kodowa
    csvq(exporterName), // [3]
    csvq(exporterName), // [4]
    csvq(seller.shortName || seller.name), // [5]
    csvq(seller.name), // [6]
    csvq(addr.city || ""), // [7]
    csvq(addr.postal || ""), // [8]
    csvq(addr.street || ""), // [9]
    csvq(String(seller.nip || "")), // [10]
    "", // [11] magazyn ID (opcjonalny)
    "", // [12] magazyn nazwa (opcjonalny)
    "", // [13]
    "", // [14]
    Number(invoices.length || 0), // [15] liczba dokumentów
    `${range.start}000000`, // [16] data od
    `${range.end}000000`, // [17] data do
    csvq(seller.contactName || seller.name), // [18] operator/eksporter
    eppDate14(new Date()), // [19] data eksportu
    csvq(seller.countryName || "Polska"), // [20]
    csvq(seller.countryCode || "PL"), // [21]
    csvq(`${seller.countryCode || "PL"}${seller.nip || ""}`), // [22] EU VAT
    0, // [23]
  ];

  let out = "";
  out += "[INFO]" + CRLF;
  out += info.join(",") + CRLF + CRLF;

  // ===== każda faktura
  for (const inv of invoices) {
    const buyerNameRaw =
      (inv.client && String(inv.client)) || inv.buyer_name || "";
    const [buyerName1, buyerName2, buyerName3] = splitNameTo3(buyerNameRaw);

    const number = inv.number || "";
    const issue = inv.issueDate || inv.issue_date || "";
    const sale = inv.saleDate || inv.sale_date || issue;
    const due = inv.dueDate || inv.due_date || issue;
    const place =
      inv.place ||
      addr.city || // domyślnie miasto sprzedawcy
      "Kraków";

    // dane nabywcy do pól 11..17 w [NAGLOWEK]
    const fromFields = {
      street: inv.buyer_street || "",
      postal: inv.buyer_postal || "",
      city: inv.buyer_city || "",
    };
    // jeśli nie mamy rozbicia, spróbuj sparsować buyer_address
    let bStreet = fromFields.street;
    let bPostal = fromFields.postal;
    let bCity = fromFields.city;

    if (!bStreet && !bPostal && !bCity) {
      const parsed = splitAddress(inv.buyer_address || inv.address || "");
      bStreet = parsed.street;
      bPostal = parsed.postal;
      bCity = parsed.city;
    }

    const bNip = (inv.buyer_nip || "").toString().trim();

    const items = Array.isArray(inv.items) ? inv.items : [];

    let netSum = 0,
      vatSum = 0,
      grossSum = 0;

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
      }
    } else {
      // fallback: sumy z nagłówka, jeśli pozycji brak
      netSum = Number(String(inv.net || 0).replace(",", "."));
      grossSum = Number(String(inv.gross || 0).replace(",", "."));
      vatSum = Math.max(0, grossSum - netSum);
    }

    // ===== [NAGLOWEK] – 62 pola
    const H = new Array(62).fill("");

    const sourceId = buildEppSourceId(inv); // stabilny ID do pola [3]

    H[0] = csvq("FS"); // typ
    H[1] = 1;
    H[2] = 0;
    H[3] = sourceId; // numer wewnętrzny/źródłowy – BEZ cudzysłowów (jak w Fakturownia)
    H[4] = csvq(number); // numer zewnętrzny
    H[5] = "";
    H[6] = csvq(`FS ${number}`);

    // Kontrahent — wg wzorca: 11..17
    H[11] = csvq(buyerName1); // nazwa wiersz 1
    H[12] = csvq(buyerName2); // wiersz 2 (kontynuacja)
    H[13] = csvq(buyerName3); // wiersz 3 (kontynuacja)
    H[14] = csvq(bCity); // miasto
    H[15] = csvq(bPostal); // kod
    H[16] = csvq(bStreet); // ulica
    H[17] = csvq(bNip); // NIP

    // Miejsce i daty: [20] miejsce, [21] wystawienia, [22] sprzedaży, [23] wystawienia
    H[20] = csvq(place);
    H[21] = eppDate14(issue);
    H[22] = eppDate14(sale);
    H[23] = eppDate14(issue);

    H[24] = 2;
    H[25] = 1;

    // Sums
    H[27] = to4(netSum);
    H[28] = to4(vatSum);
    H[29] = to4(grossSum);
    H[30] = to4(0);
    H[31] = ""; // w referencji puste
    H[32] = to4(0);

    H[33] = csvq(inv.payment_method || "Przelew");
    H[34] = eppDate14(due);
    H[35] = to4(0); // zapłacono
    H[36] = to4(grossSum); // do zapłaty

    H[37] = 0;
    H[38] = 0;
    H[39] = 1;

    H[46] = "PLN";
    H[47] = to4(1);

    H[52] = 0;
    H[53] = 0;
    H[54] = 0;
    H[55] = ""; // w referencji puste
    H[56] = to4(0);
    H[57] = ""; // puste
    H[58] = to4(0);
    H[59] = csvq("Polska"); // kraj nabywcy (jak w pliku z Fakturowni)
    H[60] = csvq("PL"); // kod kraju nabywcy
    H[61] = 0;

    out += "[NAGLOWEK]" + CRLF;
    out +=
      H.map((v) => (typeof v === "number" ? String(v) : String(v))).join(",") +
      CRLF;

    // ===== [ZAWARTOSC] – 18 pól na pozycję
    out += "[ZAWARTOSC]" + CRLF;

    const lines =
      items.length > 0
        ? items
        : [
            {
              quantity: 1,
              vat_rate:
                inv.vat_rate ?? (inv.defaultVat != null ? inv.defaultVat : 23),
              net_price: netSum,
              gross_price: grossSum,
              net_total: netSum,
              gross_total: grossSum,
              vat_amount: vatSum,
            },
          ];

    for (const it of lines) {
      const qty = Number(it.quantity ?? it.qty ?? 1);
      const vatP = parseVatPercent(it.vat_rate);
      const netUnit = Number(String(it.net_price ?? 0).replace(",", "."));
      const grossUnit =
        String(it.gross_price ?? "") !== ""
          ? Number(String(it.gross_price).replace(",", "."))
          : netUnit * (1 + vatP / 100);
      const netTotal =
        String(it.net_total ?? "") !== ""
          ? Number(String(it.net_total).replace(",", "."))
          : netUnit * qty;
      const grossTotal =
        String(it.gross_total ?? "") !== ""
          ? Number(String(it.gross_total).replace(",", "."))
          : grossUnit * qty;
      const vatTotal =
        String(it.vat_amount ?? "") !== ""
          ? Number(String(it.vat_amount).replace(",", "."))
          : grossTotal - netTotal;

      const Z = new Array(18).fill("0.0000");
      Z[0] = csvq(String(vatP)); // "23"
      Z[1] = to4(vatP); // 23.0000
      Z[2] = to4(netUnit); // cena netto / szt.
      Z[3] = to4(qty ? vatTotal / qty : 0); // VAT / szt.
      Z[4] = to4(grossUnit); // cena brutto / szt.
      Z[5] = to4(netTotal); // wartość netto
      Z[6] = to4(vatTotal); // VAT
      Z[7] = to4(grossTotal); // wartość brutto
      // Z[8]..Z[17] – "0.0000"
      out += Z.join(",") + CRLF;
    }

    out += CRLF; // pusta linia między dokumentami (jak w referencji)
  }

  return out;
}

/**
 * Opcjonalnie: zwróć Buffer w zadanym kodowaniu (domyślnie CP1250),
 * w przeciwnym razie UTF-8.
 */
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
