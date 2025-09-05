// faktura.pdf.js  (раніше generate-pdf.js)
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

/** Робить безпечну базову назву файлу з номера фактури */
function safeInvoiceBase(number) {
  return String(number || "")
    .normalize("NFKD") // прибирає діакритику
    .replace(/[^\w.-]+/g, "_"); // все, що не [a-zA-Z0-9_ . -], у "_"
}

/* ===================== */
/* ===== NEW: utils ==== */
/* ===================== */

/** NEW: безпечна екранування тексту в HTML (щоб дані не ламали розмітку) */
function escapeHtml(v) {
  const s = String(v ?? "");
  // Швидкий вихід для порожніх/простих рядків
  if (!/[&<>"']/g.test(s)) return s;
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** NEW: м’яке форматування чисел до 2 знаків; приймає і рядки, і числа */
function fmt2(v) {
  if (v == null || v === "") return "";
  // Дозволяємо як "12,34", так і "12.34"
  const num = Number(String(v).replace(",", "."));
  if (Number.isFinite(num)) return num.toFixed(2);
  return String(v);
}

/** NEW: формат із комою для польського вигляду (на виході рядок) */
function fmtPL(v) {
  const f = fmt2(v);
  return f ? f.replace(".", ",") : "";
}

/** NEW: безпечна підстановка в HTML (із escape) */
function sub(tpl, key, val) {
  return tpl.replaceAll(`{{${key}}}`, escapeHtml(val));
}

/** NEW: опції для запуску Chromium у різних середовищах (Docker, serverless) */
function getLaunchOptions() {
  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROME_PATH ||
    undefined;
  const base = {
    headless: "new", // Puppeteer v20+; нижче є fallback
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--font-render-hinting=medium",
      "--disable-dev-shm-usage",
    ],
  };
  if (executablePath) base.executablePath = executablePath;
  return base;
}

/** NEW: безпечний запис файлу */
function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function generatePDF(data, outputPath) {
  // ---- НОРМАЛІЗАЦІЯ ШЛЯХУ ФАЙЛУ (головне виправлення — збережено) ----
  const dir = path.dirname(outputPath);
  const numSafe = safeInvoiceBase(data.number);
  const expectedBase = `Faktura_${numSafe}.pdf`;
  const finalPath = path.join(dir, expectedBase);

  // Якщо передали "зламаний" шлях із '/', перезаписуємо на безпечний
  if (!outputPath.endsWith(expectedBase)) {
    outputPath = finalPath;
  }

  // Переконаймося, що директорія існує
  ensureDir(outputPath);

  const templatePath = path.join(__dirname, "templates", "invoice.html");
  const stylePath = path.join(__dirname, "templates", "invoice.css");

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Brak szablonu: ${templatePath}`);
  }
  if (!fs.existsSync(stylePath)) {
    throw new Error(`Brak arkusza stylów: ${stylePath}`);
  }

  const htmlTemplate = fs.readFileSync(templatePath, "utf8");
  const cssStyles = fs.readFileSync(stylePath, "utf8");

  // Таблиця позицій — із екрануванням і м’яким форматуванням
  const items = Array.isArray(data.items) ? data.items : [];
  const rowsHtml = items
    .map((item, index) => {
      const name = escapeHtml(item.name ?? "");
      const qty = escapeHtml(item.quantity ?? item.qty ?? "");
      const netUnit = fmtPL(item.net_price ?? "");
      const grossUnit = fmtPL(item.gross_price ?? "");
      const netSum = fmtPL(item.net_total ?? "");
      const vatRate = escapeHtml(item.vat_rate ?? "");
      const vatAmt = fmtPL(item.vat_amount ?? "");
      const grossSum = fmtPL(item.gross_total ?? "");
      return `
        <tr>
          <td class="text-left">${index + 1}</td>
          <td class="text-left">${name}</td>
          <td class="text-right">${qty}</td>
          <td class="text-right">${netUnit}</td>
          <td class="text-right">${grossUnit}</td>
          <td class="text-right">${netSum}</td>
          <td class="text-right">${vatRate}</td>
          <td class="text-right">${vatAmt}</td>
          <td class="text-right">${grossSum}</td>
        </tr>
      `;
    })
    .join("");

  // Безпечні підстановки в шаблон
  let filledHtml = htmlTemplate;
  filledHtml = sub(filledHtml, "number", data.number ?? "");
  filledHtml = sub(filledHtml, "place", data.place ?? "");
  filledHtml = sub(filledHtml, "buyer_identifier", data.buyer_identifier ?? "");
  filledHtml = sub(filledHtml, "issue_date", data.issue_date ?? "");
  filledHtml = sub(filledHtml, "sale_date", data.sale_date ?? "");
  filledHtml = sub(filledHtml, "seller_name", data.seller_name ?? "");
  filledHtml = sub(filledHtml, "seller_address", data.seller_address ?? "");
  filledHtml = sub(filledHtml, "seller_nip", data.seller_nip ?? "");
  filledHtml = sub(filledHtml, "buyer_name", data.buyer_name ?? "");
  filledHtml = sub(filledHtml, "buyer_address", data.buyer_address ?? "");
  filledHtml = sub(filledHtml, "buyer_nip", data.buyer_nip ?? "");
  filledHtml = filledHtml.replaceAll("{{rows}}", rowsHtml);
  // Суми: якщо вже передані у PL-форматі — не чіпаємо; якщо ні — зробимо PL
  const netSum = data.net_sum ?? data.net ?? "";
  const vatSum = data.vat_sum ?? data.vat ?? "";
  const grossSum = data.gross_sum ?? data.gross ?? "";
  filledHtml = sub(
    filledHtml,
    "net_sum",
    /,/.test(String(netSum)) ? netSum : fmtPL(netSum)
  );
  filledHtml = sub(
    filledHtml,
    "vat_sum",
    /,/.test(String(vatSum)) ? vatSum : fmtPL(vatSum)
  );
  filledHtml = sub(
    filledHtml,
    "gross_sum",
    /,/.test(String(grossSum)) ? grossSum : fmtPL(grossSum)
  );

  filledHtml = sub(filledHtml, "amount_due", data.amount_due ?? "");
  filledHtml = sub(filledHtml, "amount_in_words", data.amount_in_words ?? "");
  filledHtml = sub(filledHtml, "paid_amount", data.paid_amount ?? "");
  filledHtml = sub(filledHtml, "payment_method", data.payment_method ?? "");
  filledHtml = sub(filledHtml, "bank", data.bank ?? "");
  filledHtml = sub(filledHtml, "account", data.account ?? "");
  filledHtml = sub(filledHtml, "issuer", data.issuer ?? "");
  filledHtml = sub(filledHtml, "due_date", data.due_date ?? "");
  // стилі тільки одне входження (як було)
  filledHtml = filledHtml.replace("{{styles}}", cssStyles);

  /* ======== Печать PDF через Puppeteer ======== */
  let browser;
  let page;
  try {
    // NEW: універсальні опції запуску (з урахуванням env executablePath)
    try {
      browser = await puppeteer.launch(getLaunchOptions());
    } catch {
      // Fallback для старіших версій, де headless: "new" недоступний
      const legacy = getLaunchOptions();
      legacy.headless = true;
      browser = await puppeteer.launch(legacy);
    }

    page = await browser.newPage();

    // NEW: більший таймаут на повільних середовищах CI/Docker
    await page.setDefaultNavigationTimeout(60_000);
    await page.setDefaultTimeout(60_000);

    await page.setContent(filledHtml, { waitUntil: "networkidle0" });

    // NEW: зачекати, поки браузер завантажить шрифти (якщо є webfonts)
    try {
      await page.evaluate(async () => {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
      });
    } catch {}

    await page.emulateMediaType("screen");

    console.log("[PDF] save to:", outputPath);
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      // Можна задати поля, якщо в шаблоні не керується через @page
      // margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    // 🔁 ДОДАТКОВО: копія в корінь /generated для прямих лінків
    try {
      const rootGenDir =
        process.env.PDF_PUBLIC_DIR /* NEW: дозволяє перевизначити ціль */ ||
        path.join(__dirname, "generated");
      ensureDir(path.join(rootGenDir, "dummy"));
      const rootCopy = path.join(rootGenDir, path.basename(outputPath));
      if (rootCopy !== outputPath) {
        fs.copyFileSync(outputPath, rootCopy);
        console.log("[PDF] copied to:", rootCopy);
      }
    } catch (e) {
      console.warn("[PDF] copy to /generated failed:", e?.message || e);
    }

    // NEW: дев-опція — зберегти HTML поруч для налагодження
    if (process.env.SAVE_DEBUG_HTML === "1") {
      const debugHtml = outputPath.replace(/\.pdf$/i, ".html");
      fs.writeFileSync(debugHtml, filledHtml, "utf8");
      console.log("[PDF] debug HTML:", debugHtml);
    }
  } finally {
    // NEW: акуратно закриваємо сторінку перед браузером
    if (page) {
      try {
        await page.close();
      } catch {}
    }
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }

  return outputPath;
}

module.exports = { generatePDF };
