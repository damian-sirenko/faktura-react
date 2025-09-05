// routes/uploadInvoices.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const xlsx = require("xlsx");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const iconv = require("iconv-lite");
const { generatePDF } = require("../faktura.pdf.js");
/* ✅ ДОДАНО: використовуємо єдиний коректний конструктор .epp */
const { generateEPPContent } = require("../epp.js");

// ——— ШЛЯХИ/ФАЙЛИ
const DATA_DIR = path.join(__dirname, "..", "data");
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
const GENERATED_DIR = path.join(__dirname, "..", "generated");
const COUNTER_FILE = path.join(DATA_DIR, "counters.json");
const INVOICES_FILE = path.join(DATA_DIR, "invoices.json");

// ensure dirs/files
for (const dir of [DATA_DIR, UPLOADS_DIR, GENERATED_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(INVOICES_FILE))
  fs.writeFileSync(INVOICES_FILE, "[]", "utf8");
if (!fs.existsSync(COUNTER_FILE)) fs.writeFileSync(COUNTER_FILE, "{}", "utf8");

// multer
const upload = multer({ dest: UPLOADS_DIR });

// ——— УТИЛІТИ
function formatPL(num) {
  return Number(num || 0)
    .toFixed(2)
    .replace(".", ",");
}

// Безпечний парсер чисел у PL-нотації: "1 234,56" / NBSP / тощо
function numFromPL(val) {
  if (val === null || val === undefined) return 0;
  let s = String(val).trim();
  if (!s) return 0;
  s = s.replace(/[\s\u00A0\u202F]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

// Нормалізація діакритиків/ключів для стабільних назв папок/ідентифікаторів
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

const INVOICE_PREFIX = "ST";
function readCounters() {
  try {
    return JSON.parse(fs.readFileSync(COUNTER_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeCounters(o) {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify(o, null, 2), "utf8");
}
function readInvoices() {
  try {
    const a = JSON.parse(fs.readFileSync(INVOICES_FILE, "utf8"));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
function writeInvoices(a) {
  fs.writeFileSync(INVOICES_FILE, JSON.stringify(a, null, 2), "utf8");
}
function ymKeyOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return { key: `${y}-${m}`, y, m };
}

// ——— amount in words (PL), узгоджено з generateFromClients.js
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

// ——— НОМЕРАЦІЯ ЗА ОБРАНОЮ ДАТОЮ І ГАРАНТІЯ УНІКАЛЬНОСТІ
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

// ——— API ДЛЯ ЛІЧИЛЬНИКА
router.get("/counters", (_req, res) => {
  try {
    res.json(readCounters());
  } catch {
    res.status(500).json({ error: "Nie udało się pobrać liczników" });
  }
});
router.post("/counters/init", (req, res) => {
  try {
    const { year, month, seed } = req.body || {};
    if (!year || !month)
      return res.status(400).json({ error: "Brak year lub month" });
    const y = Number(year);
    const m = String(Number(month)).padStart(2, "0");
    const s = Number(seed || 1);
    const key = `${y}-${m}`;

    const usedNumbers = readInvoices()
      .filter(
        (inv) =>
          typeof inv.number === "string" && inv.number.endsWith(`/${m}/${y}`)
      )
      .map((inv) => {
        const m2 = inv.number.match(/^ST-(\d{3})\/\d{2}\/\d{4}$/);
        return m2 ? Number(m2[1]) : null;
      })
      .filter((n) => n != null);
    const maxUsed = usedNumbers.length ? Math.max(...usedNumbers) : 0;
    if (s <= maxUsed) {
      return res.status(400).json({
        error: `Numer startowy (${String(s).padStart(
          3,
          "0"
        )}) jest zajęty lub nie może być ≤ ${String(maxUsed).padStart(
          3,
          "0"
        )}.`,
      });
    }
    const counters = readCounters();
    counters[key] = s;
    writeCounters(counters);
    res.json({ ok: true, counter: { key, value: s } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Nie udało się zainicjalizować licznika" });
  }
});

// ——— «СТАРИЙ» СИНХРОННИЙ МАРШРУТ-ДЛЯ СУМІСНОСТІ (без прогресу)
router.post("/", upload.single("excelFile"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nie przesłano pliku" });
  let issueDate = new Date();
  if (req.body?.issueDate) {
    const d = new Date(req.body.issueDate);
    if (!isNaN(d)) issueDate = d;
  }
  try {
    const { zipPath } = await generateJobSync(req.file.path, issueDate);
    // відповідаємо ZIP
    res.attachment("faktury.zip");
    res.setHeader("Content-Type", "application/zip");
    const stream = fs.createReadStream(zipPath);
    stream.pipe(res);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: "Błąd przetwarzania" });
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  }
});

// ——— НОВИЙ РЕЖИМ З ПРОГРЕСОМ — JOBs
const JOBS = Object.create(null); // jobId -> { total, done, status, folderName, zipPath, error, finished }
function newJobId() {
  return "job_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

// Старт асинхронної генерації
router.post("/start", upload.single("excelFile"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nie przesłano pliku" });
  let issueDate = new Date();
  if (req.body?.issueDate) {
    const d = new Date(req.body.issueDate);
    if (!isNaN(d)) issueDate = d;
  }

  const jobId = newJobId();
  JOBS[jobId] = {
    total: 0,
    done: 0,
    status: "Wczytywanie pliku…",
    folderName: "",
    zipPath: "",
    error: "",
    finished: false,
  };

  res.json({ jobId }); // миттєво повертаємо id

  // запуск обробки «у фоні»
  setImmediate(async () => {
    try {
      const { zipPath, folderName, total } = await generateJobSync(
        req.file.path,
        issueDate,
        (progress) => {
          JOBS[jobId].total = progress.total;
          JOBS[jobId].done = progress.done;
          JOBS[jobId].status = progress.message || "Przetwarzanie…";
        }
      );
      JOBS[jobId].zipPath = zipPath;
      JOBS[jobId].folderName = folderName;
      JOBS[jobId].finished = true;
      JOBS[
        jobId
      ].status = `Zakończono: ${JOBS[jobId].done}/${JOBS[jobId].total}`;
    } catch (e) {
      console.error("JOB ERROR", e);
      JOBS[jobId].error = e?.message || "Błąd przetwarzania";
      JOBS[jobId].finished = true;
    } finally {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      setTimeout(() => {
        delete JOBS[jobId];
      }, 10 * 60 * 1000);
    }
  });
});

// Прогрес
router.get("/progress/:jobId", (req, res) => {
  const job = JOBS[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Nie znaleziono zadania" });
  res.json({
    total: job.total,
    done: job.done,
    status: job.status,
    finished: job.finished,
    error: job.error,
  });
});

// Завантаження готового ZIP
router.get("/download/:jobId", (req, res) => {
  const job = JOBS[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Nie znaleziono zadania" });
  if (!job.finished)
    return res.status(409).json({ error: "Zadanie jeszcze trwa" });
  if (job.error) return res.status(400).json({ error: job.error });

  res.attachment("faktury.zip");
  res.setHeader("Content-Type", "application/zip");
  fs.createReadStream(job.zipPath).pipe(res);
});

// ——— ОСНОВНА ЛОГІКА (спільна для обох режимів)
async function generateJobSync(excelPath, issueDate, onProgress) {
  const wb = xlsx.readFile(excelPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils
    .sheet_to_json(ws)
    .filter((r) => r["Klient"] && String(r["Klient"]).trim() !== "");
  const total = rows.filter((r) => r["Faktura"]).length;

  const { y, m } = ymKeyOf(issueDate);
  const monthLabel = `${m}/${y}`;
  const polishMonth = getPolishMonthName(issueDate.getMonth());
  const dateFolderPart = new Date().toISOString().split("T")[0];
  const folderName = `Faktury_${polishMonth}_${dateFolderPart}`;
  const outputDir = path.join(GENERATED_DIR, folderName).normalize("NFC"); // уніфікація Юнікоду
  fs.mkdirSync(outputDir, { recursive: true });

  let done = 0;
  const files = [];
  const invoices = readInvoices();

  for (const client of rows) {
    if (!client["Faktura"]) continue;

    const items = [];
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 7);

    let buyerIdentifier = "";
    const firmaOp = String(client["Firma - OP"] || "")
      .trim()
      .toLowerCase();
    const isFirma = firmaOp === "firma";
    if (isFirma) {
      const nip = client["NIP"] || client["nip"];
      if (nip) buyerIdentifier = `NIP: ${nip}`;
    } else {
      const pesel = client["Pesel"];
      if (pesel) buyerIdentifier = `PESEL: ${pesel}`;
    }

    const subscriptionTotal = numFromPL(client["Kwota abonamentu"] || 0);
    if (subscriptionTotal > 0) {
      const net = subscriptionTotal / 1.23;
      items.push({
        name: `Sterylizacja narzędzi wg abonamentu ${client["Abonament"]} za mies. ${monthLabel}`,
        quantity: 1,
        net_price: formatPL(net),
        gross_price: formatPL(subscriptionTotal),
        net_total: formatPL(net),
        vat_rate: "23%",
        vat_amount: formatPL(subscriptionTotal - net),
        gross_total: formatPL(subscriptionTotal),
      });
    }

    const visitsCount = Number.parseInt(client["Dojazdy"] || 0, 10);
    const visitsCost = numFromPL(client["Koszt dojazdów"] || 0);
    if (visitsCount > 0 && visitsCost > 0) {
      const netPrice = visitsCost / visitsCount / 1.23;
      items.push({
        name: "Dojazd kuriera",
        quantity: visitsCount,
        net_price: formatPL(netPrice),
        gross_price: formatPL(netPrice * 1.23),
        net_total: formatPL(netPrice * visitsCount),
        vat_rate: "23%",
        vat_amount: formatPL(visitsCost - netPrice * visitsCount),
        gross_total: formatPL(visitsCost),
      });
    }

    const shippingCount = Number.parseInt(client["Wysyłki"] || 0, 10);
    const shippingCost = numFromPL(client["Koszt wysyłki"] || 0);
    if (shippingCount > 0 && shippingCost > 0) {
      const netPrice = shippingCost / shippingCount / 1.23;
      items.push({
        name: "Wysyłka",
        quantity: shippingCount,
        net_price: formatPL(netPrice),
        gross_price: formatPL(netPrice * 1.23),
        net_total: formatPL(netPrice * shippingCount),
        vat_rate: "23%",
        vat_amount: formatPL(shippingCost - netPrice * shippingCount),
        gross_total: formatPL(shippingCost),
      });
    }

    const extraPackages = Number.parseInt(client["Poza abonamentem"] || 0, 10);
    const extraCost = numFromPL(client["Poza ab. kwota"] || 0);
    if (extraPackages > 0 && extraCost > 0) {
      const netPrice = extraCost / extraPackages / 1.23;
      items.push({
        name: "Pakiety poza abonamentem",
        quantity: extraPackages,
        net_price: formatPL(netPrice),
        gross_price: formatPL(netPrice * 1.23),
        net_total: formatPL(netPrice * extraPackages),
        vat_rate: "23%",
        vat_amount: formatPL(extraCost - netPrice * extraPackages),
        gross_total: formatPL(extraCost),
      });
    }

    // якщо позицій немає — пропускаємо клієнта (не створюємо пусту фактуру)
    if (!items.length) {
      done++;
      if (onProgress)
        onProgress({
          total,
          done,
          message: `Pominięto pustą pozycję ${done}/${total}`,
        });
      continue;
    }

    const gross_sum = items.reduce((s, p) => s + numFromPL(p.gross_total), 0);
    const net_sum = items.reduce((s, p) => s + numFromPL(p.net_total), 0);
    const vat_sum = items.reduce((s, p) => s + numFromPL(p.vat_amount), 0);

    const number = getNextInvoiceNumberByDate(issueDate);

    const invoiceData = {
      number,
      place: "Kraków",
      issue_date: issueDate.toISOString().split("T")[0],
      sale_date: issueDate.toISOString().split("T")[0],
      due_date: dueDate.toISOString().split("T")[0],
      seller_name: "CORRECT SOLUTION SP. Z O.O.",
      seller_address: "Osiedle Dywizjonu 303 62F, 31-875 Kraków",
      seller_nip: "6751516747",
      buyer_name: client["Klient"],
      buyer_address: client["Adres"] || "",
      buyer_identifier: buyerIdentifier,
      items,
      net_sum: formatPL(net_sum),
      vat_sum: formatPL(vat_sum),
      gross_sum: formatPL(gross_sum),
      amount_due: formatPL(gross_sum),
      paid_amount: formatPL(numFromPL(client["Opłacona kwota"] || 0)),
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
      // розширені метадані у invoices.json (узгоджено з generateFromClients.js)
      const isFirmaMeta =
        String(client["Firma - OP"] || "")
          .trim()
          .toLowerCase() === "firma";
      const nipMeta = client["NIP"] || "";
      const peselMeta = client["Pesel"] || "";
      const record = {
        number: invoiceData.number,
        client: invoiceData.buyer_name,
        issueDate: invoiceData.issue_date,
        dueDate: invoiceData.due_date,
        net: invoiceData.net_sum,
        gross: invoiceData.gross_sum,
        filename: `Faktura_${fileSafeNumber}.pdf`,
        folder: folderName,
        items: invoiceData.items,
        buyer_address: invoiceData.buyer_address,
        buyer_nip: isFirmaMeta ? nipMeta : "",
        buyer_pesel: !isFirmaMeta ? peselMeta : "",
        status: "issued",
      };
      invoices.push(record);
    } catch (e) {
      // лог, але не валимо всю джобу
      console.error("PDF error for:", client["Klient"], e);
    }

    done++;
    if (onProgress)
      onProgress({ total, done, message: `Wygenerowano ${done}/${total}` });
  }

  writeInvoices(invoices);

  if (!files.length) {
    // нічого не згенеровано — повертаємо помилку
    throw new Error("Brak danych do faktur (puste pozycje)");
  }

  // ZIP
  const zipName = `faktury_${y}-${m}_${Date.now()}.zip`;
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

  return { zipPath, folderName, total };
}

// ====== EPP EXPORT (InsERT Nexo / Rachmistrz GT) ======

// спроба розбити адресу на вулицю / код / місто
function splitAddress(addr = "") {
  const s = String(addr).replace(/\s+/g, " ").trim();
  const m = s.match(/(\d{2}-\d{3})\s+([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż.\- ]+)/);
  let zip = "",
    city = "",
    street = s;
  if (m) {
    zip = m[1].trim();
    city = m[2].trim().replace(/,$/, "");
    street = s
      .replace(m[0], "")
      .replace(/[,;]?\s*$/, "")
      .trim();
  }
  street = street.replace(/^[, ]+|[, ]+$/g, "");
  return { street, zip, city };
}

// будуємо секцію [INFO]
function buildEppInfo() {
  const wersja = `"1.08"`;
  const rezerw = `0`;
  const codepage = `1250`;
  const program = `"faktura-react"`;
  const programOpis = `"faktura-react"`;
  const firma = `"CORRECT SOLUTION SP. Z O.O."`;
  const kraj = `"Polska"`;
  const kodKraju = `"PL"`;
  const nip = `"PL6751516747"`;
  const operator = `"Dmytro Sirenko"`;
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(
    2,
    "0"
  )}${String(now.getMinutes()).padStart(2, "0")}${String(
    now.getSeconds()
  ).padStart(2, "0")}`;

  return `[INFO]
${wersja},${rezerw},${codepage},${program},${programOpis},${firma},${rezerw},${operator},${ts},${kraj},${kodKraju},${nip},${rezerw}

`;
}

// будуємо [NAGLOWEK] для однієї фактури
function buildEppHeader(invNumber, buyer, issueDate, dueDate, totals) {
  const idDok = Date.now();
  const tytul = `"FS ${invNumber}"`;

  const { street, zip, city } = splitAddress(buyer.address || "");
  const kraj = `"Polska"`;
  const kodKraju = `"PL"`;

  const nip = buyer.type === "firma" && buyer.nip ? `"${buyer.nip}"` : `""`;
  const pesel =
    buyer.type !== "firma" && buyer.pesel ? `"${buyer.pesel}"` : `""`;

  const dIssue = issueDate.replaceAll("-", "");
  const dDue = dueDate.replaceAll("-", "");
  const waluta = `"PLN"`;

  return (
    `[NAGLOWEK]
"FS",1,0,${idDok},"${invNumber}",,${tytul},,,,,` +
    `"${buyer.name || ""}",` +
    `"${city || ""}",` +
    `"${zip || ""}",` +
    `"${street || ""}",` +
    `${nip},${pesel},` +
    `"${dIssue}","${dDue}",` +
    `0,0,0,` +
    `${waluta},1.0000,,,,,0,0,0,,0.0000,,0.0000,${kraj},${kodKraju},0

`
  );
}

// будуємо [ZAWARTOSC] — зведення по ставці VAT (23%)
function buildEppContent(totals) {
  const stawkaKod = `"23"`;
  const vatProc = `23.0000`;
  const netto = totals.net.toFixed(4).replace(".", ",");
  const vat = totals.vat.toFixed(4).replace(".", ",");
  const brutto = totals.gross.toFixed(4).replace(".", ",");

  return `[ZAWARTOSC]
${stawkaKod},${vatProc},${netto},${vat},${brutto},${netto},${vat},${brutto},0.0000,0.0000,0.0000,0.0000,0.0000,0.0000,0.0000,0.0000,0.0000,0.0000

`;
}

/* ✅ ОНОВЛЕНО: будуємо .epp з Excel через єдиний генератор generateEPPContent */
function buildEppFromExcelRows(rows, issueDate) {
  const factRows = rows.filter((r) => r["Klient"] && r["Faktura"]);

  const invoices = [];
  for (const r of factRows) {
    // підрахунок позицій
    const itemsTmp = [];
    const subscriptionTotal = numFromPL(r["Kwota abonamentu"] || 0);
    if (subscriptionTotal > 0) {
      const net = subscriptionTotal / 1.23;
      itemsTmp.push({
        net,
        vat: subscriptionTotal - net,
        gross: subscriptionTotal,
        name: `Abonament`,
      });
    }
    const visitsCount = parseInt(r["Dojazdy"] || 0, 10);
    const visitsCost = numFromPL(r["Koszt dojazdów"] || 0);
    if (visitsCount > 0 && visitsCost > 0) {
      const net = visitsCost / 1.23;
      itemsTmp.push({
        net,
        vat: visitsCost - net,
        gross: visitsCost,
        name: "Dojazd kuriera",
      });
    }
    const shipCount = parseInt(r["Wysyłki"] || 0, 10);
    const shipCost = numFromPL(r["Koszt wysyłki"] || 0);
    if (shipCount > 0 && shipCost > 0) {
      const net = shipCost / 1.23;
      itemsTmp.push({
        net,
        vat: shipCost - net,
        gross: shipCost,
        name: "Wysyłka",
      });
    }
    const extraCount = parseInt(r["Poza abonamentem"] || 0, 10);
    const extraCost = numFromPL(r["Poza ab. kwota"] || 0);
    if (extraCount > 0 && extraCost > 0) {
      const net = extraCost / 1.23;
      itemsTmp.push({
        net,
        vat: extraCost - net,
        gross: extraCost,
        name: "Pakiety poza abonamentem",
      });
    }

    // якщо порожньо — пропускаємо
    if (!itemsTmp.length) continue;

    const totals = itemsTmp.reduce(
      (acc, it) => {
        acc.net += it.net;
        acc.vat += it.vat;
        acc.gross += it.gross;
        return acc;
      },
      { net: 0, vat: 0, gross: 0 }
    );

    const number = getNextInvoiceNumberByDate(issueDate);
    const isFirma =
      String(r["Firma - OP"] || "")
        .trim()
        .toLowerCase() === "firma";
    const issueISO = issueDate.toISOString().slice(0, 10);
    const due = new Date(issueDate);
    due.setDate(due.getDate() + 7);
    const dueISO = due.toISOString().slice(0, 10);

    // один агрегований рядок — як і в попередній версії
    const aggItem = {
      name: `Sterylizacja i usługi za ${String(
        issueDate.getMonth() + 1
      ).padStart(2, "0")}/${issueDate.getFullYear()}`,
      quantity: 1,
      net_price: totals.net,
      gross_price: totals.gross,
      net_total: totals.net,
      vat_rate: "23%",
      vat_amount: totals.vat,
      gross_total: totals.gross,
    };

    invoices.push({
      number,
      client: r["Klient"] || "",
      buyer_name: r["Klient"] || "",
      buyer_address: r["Adres"] || "",
      buyer_nip: isFirma ? r["NIP"] || "" : "",
      buyer_pesel: !isFirma ? r["Pesel"] || "" : "",
      issueDate: issueISO,
      saleDate: issueISO,
      dueDate: dueISO,
      place: "Kraków",
      items: [aggItem],
      net: totals.net,
      gross: totals.gross,
      defaultVat: 23,
    });
  }

  // використовуємо виправлений генератор заголовків/дат/валюти
  return generateEPPContent(invoices);
}

// маршрут: синхронний експорт EPP з Excel
router.post("/export-epp", upload.single("excelFile"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nie przesłano pliku" });
  let issueDate = new Date();
  if (req.body?.issueDate) {
    const d = new Date(req.body.issueDate);
    if (!isNaN(d)) issueDate = d;
  }

  try {
    const wb = xlsx.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws);
    const eppText = buildEppFromExcelRows(rows, issueDate);

    const fname = `export_${issueDate.getFullYear()}-${String(
      issueDate.getMonth() + 1
    ).padStart(2, "0")}_${Date.now()}.epp`;

    // кодуємо у CP1250 (win1250) — InsERT цього вимагає
    const buf = iconv.encode(eppText, "win1250");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.send(buf);
  } catch (e) {
    console.error("EPP export error:", e);
    res.status(500).json({ error: "Błąd generowania pliku EPP" });
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  }
});

module.exports = router;
