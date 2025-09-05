// epp.js
// Експорт .epp для InsERT GT/Nexo: фікс дат і валюти за зразком бухгалтерії.

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
  const s = String(v ?? "").replace(/"/g, '""');
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

function generateEPPContent(invoices) {
  const seller = {
    name: "CORRECT SOLUTION SP. Z O.O.",
    nip: "6751516747",
    address: "Osiedle Dywizjonu 303 62F, 31-875 Kraków",
  };

  const CRLF = "\r\n";
  let out = "";

  // [INFO]
  out += "[INFO]" + CRLF;
  out +=
    [
      csvq("1.08"),
      0,
      0,
      csvq("faktura-react"),
      csvq("faktura-react"),
      csvq(seller.name),
      csvq(seller.nip),
      "",
      "",
      csvq("PLN"),
    ].join(",") +
    CRLF +
    CRLF;

  for (const inv of invoices) {
    const buyerName = inv.client || inv.buyer_name || "";
    const number = inv.number || "";
    const issue = inv.issueDate || inv.issue_date || "";
    const sale = inv.saleDate || inv.sale_date || issue;
    const due = inv.dueDate || inv.due_date || "";
    const place = inv.place || "Kraków";

    const items = Array.isArray(inv.items) ? inv.items : [];

    let netSum = 0,
      vatSum = 0,
      grossSum = 0;

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

    if (!items.length) {
      netSum = Number(String(inv.net || 0).replace(",", "."));
      grossSum = Number(String(inv.gross || 0).replace(",", "."));
      vatSum = Math.max(0, grossSum - netSum);
    }

    // [NAGLOWEK] — 62 поля
    out += "[NAGLOWEK]" + CRLF;
    const H = new Array(62).fill("");

    H[0] = csvq("FS");
    H[1] = 1;
    H[2] = 0;
    H[3] = ""; // numer wewnętrzny (opcjonalно)
    H[4] = csvq(number); // numer dokumentu
    H[5] = "";
    H[6] = csvq(`FS ${number}`);
    // kontrahent (minimalно)
    H[11] = csvq(buyerName);
    H[12] = csvq(buyerName);
    H[13] = csvq(buyerName);

    // ✅ Місце і дати (як у зразку): [20]=miejsce, [21]=wystawienia, [22]=sprzedaży, [23]=wystawienia
    H[20] = csvq(place);
    H[21] = eppDate14(issue);
    H[22] = eppDate14(sale);
    H[23] = eppDate14(issue);

    H[24] = 2; // wg zrzutu z przykładu
    H[25] = 1;

    // ✅ Суми
    H[27] = to4(netSum);
    H[28] = to4(vatSum);
    H[29] = to4(grossSum);
    H[30] = to4(0);
    H[32] = to4(0);

    H[33] = csvq(inv.payment_method || "Przelew");
    H[34] = eppDate14(due || issue); // termin płatności
    H[35] = to4(0);
    H[36] = to4(grossSum); // kwota do zapłaty

    H[37] = 0;
    H[38] = 0;
    H[39] = 1;

    // ✅ Валюта → [46] за зразком
    H[46] = "PLN";
    H[47] = to4(1);

    H[52] = 0;
    H[53] = 0;
    H[54] = 0;
    H[56] = to4(0);
    H[58] = to4(0);
    H[61] = 0;

    out +=
      H.map((v) => (typeof v === "number" ? String(v) : String(v))).join(",") +
      CRLF;

    // [ZAWARTOSC] — 18 полів (перші 8 — суми позиції)
    out += "[ZAWARTOSC]" + CRLF;

    const lines =
      items.length > 0
        ? items
        : [
            {
              quantity: 1,
              vat_rate:
                inv.vat_rate || (inv.defaultVat != null ? inv.defaultVat : 23),
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
      Z[0] = csvq(String(vatP));
      Z[1] = to4(vatP);
      Z[2] = to4(netUnit);
      Z[3] = to4(qty ? vatTotal / qty : 0);
      Z[4] = to4(grossUnit);
      Z[5] = to4(netTotal);
      Z[6] = to4(vatTotal);
      Z[7] = to4(grossTotal);
      out += Z.join(",") + CRLF;
    }

    out += CRLF;
  }

  return out;
}

module.exports = { generateEPPContent, to2, to4 };
