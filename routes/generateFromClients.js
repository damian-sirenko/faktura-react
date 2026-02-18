// routes/generateFromClients.js (MySQL)
const express = require("express");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
const router = express.Router();

const { generateInvoicePDF } = require("../invoice.pdfkit.cjs");
const clientsRepo = require("../server/repos/clientsRepo.js");
const protocolsRepo = require("../server/repos/protocolsRepo.js");
const invoicesRepo = require("../server/repos/invoicesRepo.js");
const settingsRepo = require("../server/repos/settingsRepo.js");

// --- ДИРЕКТОРІЇ ВИХІДНИХ PDF
const GENERATED_DIR = path.join(__dirname, "..", "generated");
if (!fs.existsSync(GENERATED_DIR))
  fs.mkdirSync(GENERATED_DIR, { recursive: true });

// --- УТИЛІТИ
function formatPL(num) {
  return Number(num || 0)
    .toFixed(2)
    .replace(".", ",");
}
function getPolishMonthName(idx0to11) {
  const m = [
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
  return m[idx0to11];
}
function ymKeyOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return { key: `${y}-${m}`, y, m };
}
function courierTripsOf(delivery) {
  const d = String(delivery || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (d === "odbior" || d === "dowoz") return 1;
  if (d === "odbior dowoz") return 2; // покриває 'odbior+dowoz' після нормалізації
  return 0;
}
function amountInWordsPL(amount) {
  const v = Math.round(Number(String(amount || "0").replace(",", ".")) * 100);
  const zl = Math.floor(v / 100);
  const gr = v % 100;
  const zlForms = ["złoty", "złote", "złotych"];
  const form = (n) => {
    if (n === 1) return zlForms[0];
    const u = n % 10,
      t = n % 100;
    if (u >= 2 && u <= 4 && !(t >= 12 && t <= 14)) return zlForms[1];
    return zlForms[2];
  };
  const words = (n) => String(n);
  return `${words(zl)} ${form(zl)} ${String(gr).padStart(2, "0")}/100`;
}
function toSlugId(c) {
  const id = c?.id || c?.ID;
  if (id && String(id).trim()) return String(id).trim();
  const name = c?.name || c?.Klient || "client";
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
// локальний ISO без зсуву по тайзоні
function iso10Local(d) {
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  return `${Y}-${M}-${D}`;
}

// --- ГОЛОВНИЙ РОУТ
// POST /gen/from-clients { clientIds?: string[], issueDate?: "YYYY-MM-DD", month?: "YYYY-MM" }
router.post("/from-clients", async (req, res) => {
  try {
    const {
      clientIds: idsRaw,
      issueDate: issueDateStr,
      dueDate: dueDateStrManual,
      month: monthStr,
    } = req.body || {};
    const clientIds = Array.isArray(idsRaw) ? idsRaw.map(String) : [];

    // дати і налаштування
    let issueDate = new Date();
    if (issueDateStr) {
      const d = new Date(issueDateStr);
      if (!Number.isNaN(d)) issueDate = d;
    }
    const { y, m } = ymKeyOf(issueDate);
    const month =
      typeof monthStr === "string" && /^\d{4}-\d{2}$/.test(monthStr)
        ? monthStr
        : `${y}-${m}`;

    const settings = await settingsRepo.get();
    console.log("[GEN][SETTINGS]", {
      shippingPriceGross: settings.shippingPriceGross,
      courierPriceGross: settings.courierPriceGross,
    });

    const perPiece = Number(settings.perPiecePriceGross || 6);
    const vat = Number(settings.defaultVat || 23);
    const globalCourier = Number(settings.courierPriceGross || 0);
    const globalShipping = Number(settings.shippingPriceGross || 0);

    // ВАЖЛИВО: завантажуємо клієнтів з БД
    const allClients = await clientsRepo.getAllActiveClients();

    const target = clientIds.length
      ? allClients.filter((c) => clientIds.includes(String(c.id)))
      : allClients;

    const monthLabel = `${month.slice(5)}/${month.slice(0, 4)}`; // MM/YYYY
    const folderName = `faktury_${month.slice(5)}_${month.slice(0, 4)}`;
    const outputDir = path.join(GENERATED_DIR, "faktury", folderName);
    fs.mkdirSync(outputDir, { recursive: true });

    const files = [];

    for (const baseClient of target) {
      // агрегати з протоколів — з MySQL
      const hasAbonInit = !!String(baseClient.subscription || "").trim();
      const billingModeInit =
        baseClient.billingMode || (hasAbonInit ? "abonament" : "perpiece");
      const abonGrossInit = Number(baseClient.subscriptionAmount || 0) || 0;

      const proto = await protocolsRepo.getProtocol(baseClient.id, month);
      const entries = Array.isArray(proto?.entries) ? proto.entries : [];

      let packages = 0,
        courier = 0,
        shipments = 0;
      for (const e of entries) {
        packages += Number(e.packages || 0) || 0;
        if (e.shipping) shipments += 1;
        courier += courierTripsOf(e.delivery || "");
      }

      // якщо немає взагалі даних — пропустимо клієнта
      if (
        packages === 0 &&
        courier === 0 &&
        shipments === 0 &&
        !(billingModeInit === "abonament" && abonGrossInit > 0)
      ) {
        continue;
      }

      const courierUnit =
        String(baseClient.courierPriceMode || "") === "custom"
          ? Number(baseClient.courierPriceGross || 0)
          : globalCourier;

      const shippingUnit =
        baseClient.shippingPriceMode === "custom"
          ? Number(baseClient.shippingPriceGross || 0)
          : Number(settings.shippingPriceGross || 0);

      const billingMode = billingModeInit;
      const items = [];

      if (billingMode === "abonament") {
        const abonGross = Number(baseClient.subscriptionAmount || 0) || 0;
        if (abonGross > 0) {
          const net = abonGross / (1 + vat / 100);
          items.push({
            name: `Sterylizacja narzędzi wg abonamentu ${
              baseClient.subscription || ""
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

        const limMatch = String(baseClient.subscription || "").match(
          /(\d{1,4})/
        );
        const limit = limMatch ? parseInt(limMatch[1], 10) : 0;
        const over = Math.max((Number(packages) || 0) - limit, 0);
        if (over > 0) {
          const unitGrossOver =
            Math.round(
              (abonGrossInit > 0 && limit > 0
                ? abonGrossInit / limit
                : perPiece) * 100
            ) / 100;
          const unitNetOver =
            Math.round((unitGrossOver / (1 + vat / 100)) * 100) / 100;
          const grossT = unitGrossOver * over;
          const netT = unitNetOver * over;
          const vatT = Math.round((grossT - netT) * 100) / 100;

          items.push({
            name: "Pakiety poza abonamentem",
            quantity: over,
            net_price: formatPL(unitNetOver),
            gross_price: formatPL(unitGrossOver),
            net_total: formatPL(netT),
            vat_rate: `${vat}%`,
            vat_amount: formatPL(vatT),
            gross_total: formatPL(grossT),
          });
        }
      } else {
        if (packages > 0 && perPiece > 0) {
          const netU = perPiece / (1 + vat / 100);
          const netT = netU * packages;
          const grossT = perPiece * packages;
          items.push({
            name: "Sterylizacja narzędzi — pakiety",
            quantity: packages,
            net_price: formatPL(netU),
            gross_price: formatPL(perPiece),
            net_total: formatPL(netT),
            vat_rate: `${vat}%`,
            vat_amount: formatPL(grossT - netT),
            gross_total: formatPL(grossT),
          });
        }
      }

      if (courier > 0 && courierUnit > 0) {
        const netU = courierUnit / (1 + vat / 100);
        const netT = netU * courier;
        const grossT = courierUnit * courier;
        items.push({
          name: "Dojazd kuriera",
          quantity: courier,
          net_price: formatPL(netU),
          gross_price: formatPL(courierUnit),
          net_total: formatPL(netT),
          vat_rate: `${vat}%`,
          vat_amount: formatPL(grossT - netT),
          gross_total: formatPL(grossT),
        });
      }

      if (shipments > 0 && shippingUnit > 0) {
        const netU = shippingUnit / (1 + vat / 100);
        const netT = netU * shipments;
        const grossT = shippingUnit * shipments;

        items.push({
          name: "Wysyłka",
          quantity: shipments,
          net_price: formatPL(netU),
          gross_price: formatPL(shippingUnit),
          net_total: formatPL(netT),
          vat_rate: `${vat}%`,
          vat_amount: formatPL(grossT - netT),
          gross_total: formatPL(grossT),
        });
      }

      if (!items.length) continue;

      const gross_sum = items.reduce(
        (s, p) => s + Number(String(p.gross_total).replace(",", ".")),
        0
      );
      const net_sum = items.reduce(
        (s, p) => s + Number(String(p.net_total).replace(",", ".")),
        0
      );
      const vat_sum = items.reduce(
        (s, p) => s + Number(String(p.vat_amount).replace(",", ".")),
        0
      );
      let dueDateStr;
      if (
        typeof dueDateStrManual === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(dueDateStrManual)
      ) {
        dueDateStr = dueDateStrManual;
      } else {
        const tmp = new Date(issueDate);
        tmp.setDate(tmp.getDate() + 7);
        dueDateStr = iso10Local(tmp);
      }

      const number = await (async () => {
        const INVOICE_PREFIX = "ST";
        const [year, monthNum] = month.split("-"); // YYYY-MM

        const rows = await invoicesRepo.queryAllInvoices();

        let maxSeq = 0;
        let width = 3;

        for (const r of rows || []) {
          const n = String(r?.number || "").trim();
          const m = /^ST-(\d+)\/(\d{2})\/(\d{4})$/.exec(n);
          if (!m) continue;
          if (m[2] !== monthNum || m[3] !== year) continue;

          const seq = parseInt(m[1], 10);
          if (!Number.isFinite(seq)) continue;

          if (seq > maxSeq) {
            maxSeq = seq;
            width = Math.max(3, m[1].length);
          }
        }

        const nextSeq = maxSeq + 1;
        const pad = String(nextSeq).padStart(width, "0");

        return `${INVOICE_PREFIX}-${pad}/${monthNum}/${year}`;
      })();

      const isFirma = String(baseClient.type || "op").toLowerCase() === "firma";
      const buyerIdentifier = isFirma
        ? baseClient.nip
          ? `NIP: ${baseClient.nip}`
          : ""
        : baseClient.pesel
        ? `PESEL: ${baseClient.pesel}`
        : "";

      const issueISO = iso10Local(issueDate);

      const invoiceData = {
        clientId: baseClient.id, // ← КРИТИЧНО
        month,
        number,
        place: "Kraków",
        issue_date: issueISO,
        sale_date: issueISO,
        due_date: dueDateStr,

        seller_name: "CORRECT SOLUTION SP. Z O.O.",
        seller_address: "Osiedle Dywizjonu 303 62F, 31-875 Kraków",
        seller_nip: "6751516747",

        buyer_name: baseClient.name || "",
        buyer_address: baseClient.address || "",
        buyer_identifier: buyerIdentifier,

        items,
        net_sum: formatPL(net_sum),
        vat_sum: formatPL(vat_sum),
        gross_sum: formatPL(gross_sum),

        amount_due: formatPL(gross_sum),
        paid_amount: formatPL(0),
        amount_in_words: "",
        payment_method: "Przelew",
        bank: "Bank Pekao S.A.",
        account: "97 1240 4533 1111 0010 8767 4627",
        issuer: "Pracownik",
      };

      const clientUid = String(baseClient.id).trim().toUpperCase();

      const fileSafeNumber = String(invoiceData.number)
        .replaceAll("/", "_")
        .toUpperCase();

      const filePath = path.join(
        outputDir,
        `FAKTURA_${fileSafeNumber}_${clientUid}.pdf`
      );
      
      const fileNameOnly = path.basename(filePath);
      

      try {
        await generateInvoicePDF(invoiceData, filePath);

        files.push(filePath);

        await invoicesRepo.insertInvoice({
          number: invoiceData.number,
          clientId: baseClient.id,
          clientName: invoiceData.buyer_name,
          issueDate: invoiceData.issue_date,
          dueDate: invoiceData.due_date,
          net: invoiceData.net_sum,
          gross: invoiceData.gross_sum,
          payment_method: "transfer",
          filename: fileNameOnly,
          folder: `faktury/${folderName}`,
          items_json: JSON.stringify(invoiceData.items),
          buyer_address: invoiceData.buyer_address,
          buyer_nip: isFirma ? baseClient.nip || "" : "",
          buyer_pesel: !isFirma ? baseClient.pesel || "" : "",
          status: "issued",
        });
      } catch (e) {
        console.error("PDF error for:", baseClient.name, e);
      }
    }

    if (!files.length) {
      return res
        .status(400)
        .json({ error: "Brak danych do faktur (puste pozycje)" });
    }

    // ZIP
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
    console.error("GEN from clients (MySQL) error:");
    console.error(e);
    console.error(e?.stack);
    res.status(500).json({
      error: "Błąd generowania z bazy (MySQL)",
      details: String(e?.message || e),
    });
  }
});

module.exports = router;
