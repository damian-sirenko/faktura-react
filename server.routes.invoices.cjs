/*
  server.routes.invoices.cjs
  Invoices feature module:
  - PDF generation helpers for invoices
  - smart /generated/:filename and /generated/:folder/:filename (DB-backed regen + disk fallback)
  - invoices CRUD (GET/PUT/DELETE)
  - save/load invoices
  - download single / multiple (ZIP)
  - export EPP
  - export invoice list PDF
  - DB diagnostics for invoices
*/

const fs = require("fs");
const path = require("path");

const invoicesRepo = require("./server/repos/invoicesRepo.js");

const { generateEPPBuffer, to2 } = require("./epp.js");
const { generateInvoicePDF } = require("./invoice.pdfkit.cjs");
const { createInvoiceListPDF } = require("./invoices.list.pdf.js");

const {
  GENERATED_DIR,
  safeSeg,
  findGeneratedFileDeep,
  requireConfirmHeader,
} = require("./server.shared.cjs");

module.exports = function mountInvoicesRoutes(app) {
  if (!app.locals || typeof app.locals.authGuard !== "function") {
    throw new Error(
      "authGuard missing: mount server.middleware.cjs before server.routes.invoices.cjs"
    );
  }
  const authGuard = app.locals.authGuard;

  /* Дані продавця (для шаблону) */
  const SELLER = {
    name: "CORRECT SOLUTION SP. Z O.O.",
    nip: "6751516747",
    address: "Osiedle Dywizjonu 303 62F, 31-875 Kraków",
  };

  function paymentMethodLabel(pm) {
    switch (pm) {
      case "cash":
        return "Gotówka";
      case "card":
        return "Karta płatnicza";
      case "transfer":
      default:
        return "Przelew";
    }
  }

  function invoiceToPdfData(inv) {
    const buyer_identifier = inv.buyer_nip
      ? `NIP: ${inv.buyer_nip}`
      : inv.buyer_pesel
      ? `PESEL: ${inv.buyer_pesel}`
      : "";

    const net = inv.net || "";
    const gross = inv.gross || "";
    const vat =
      net && gross
        ? to2(
            Number(String(gross).replace(",", ".")) -
              Number(String(net).replace(",", "."))
          )
        : "";

    return {
      clientId: String(inv.clientId || inv.client || inv.number),

      number: inv.number || "",
      place: "",
      issue_date: inv.issueDate || inv.issue_date || "",
      sale_date: inv.issueDate || inv.issue_date || "",
      due_date: inv.dueDate || inv.due_date || "",

      seller_name: SELLER.name,
      seller_address: SELLER.address,
      seller_nip: SELLER.nip,

      buyer_name: inv.client || inv.buyer_name || "",
      buyer_address: inv.buyer_address || inv.address || "",
      buyer_identifier,

      items: Array.isArray(inv.items) ? inv.items : [],

      net_sum: net || "",
      vat_sum: vat || "",
      gross_sum: gross || "",

      amount_due: gross || "",
      amount_in_words: "",
      paid_amount: "",
      payment_method: paymentMethodLabel(inv.payment_method),
      bank: "",
      account: "",
      issuer: "Dmytro Sirenko",
    };
  }

  function mapDbInvoiceRow(row) {
    let rawItems = [];
    try {
      rawItems = JSON.parse(row.items_json || "[]");
    } catch {}

    const items = Array.isArray(rawItems)
      ? rawItems.map((it) => ({
          name: it?.name || "",
          quantity: Number(it?.quantity ?? it?.qty ?? 1) || 1,

          net_price: Number(String(it?.net_price ?? "").replace(",", ".")) || 0,

          gross_price:
            Number(String(it?.gross_price ?? "").replace(",", ".")) || 0,

          net_total: Number(String(it?.net_total ?? "").replace(",", ".")) || 0,

          gross_total:
            Number(String(it?.gross_total ?? "").replace(",", ".")) || 0,

          vat_rate: it?.vat_rate ?? "23%",
          vat_amount:
            Number(String(it?.vat_amount ?? "").replace(",", ".")) || 0,
        }))
      : [];
    return {
      clientId: String(row.clientId || row.clientName || row.number),
      number: row.number,
      client: row.clientName,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      net: row.net,
      gross: row.gross,
      filename: row.filename,
      folder: row.folder,
      items,
      buyer_address: row.buyer_address,
      buyer_nip: row.buyer_nip,
      buyer_pesel: row.buyer_pesel,
      status: row.status,
      payment_method: row.payment_method,
    };
  }

  async function ensurePdfForInvoice(inv, { force = true } = {}) {
    if (!inv || !inv.number) return null;

    const folderSafe =
      typeof inv.folder === "string" && inv.folder.trim() !== ""
        ? safeSeg(inv.folder)
        : "";

    const outDir = folderSafe
      ? path.join(GENERATED_DIR, folderSafe)
      : GENERATED_DIR;

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const filename = (
      inv.filename || `FAKTURA_${String(inv.number).replaceAll("/", "_")}.pdf`
    ).toUpperCase();

    const base = path.basename(filename);

    if (!force) {
      const existing = findGeneratedFileDeep(base);
      if (existing && fs.existsSync(existing)) return existing;
    }

    const desiredPath = path.join(outDir, base);

    const data = invoiceToPdfData(inv);
    let producedPath;
    try {
      producedPath = await generateInvoicePDF(data, desiredPath);
    } catch (e) {
      console.error("❌ PDF generate error:", e);
      return null;
    }

    const finalPath =
      producedPath && fs.existsSync(producedPath) ? producedPath : null;

    if (finalPath) {
      const other = findGeneratedFileDeep(base);
      if (
        other &&
        fs.existsSync(other) &&
        path.resolve(other) !== path.resolve(finalPath)
      ) {
        try {
          fs.unlinkSync(other);
        } catch {}
      }
      return path.resolve(finalPath);
    }

    const fallback = findGeneratedFileDeep(base);
    return fallback && fs.existsSync(fallback) ? path.resolve(fallback) : null;
  }

  /* -----------------------------
   * /generated/:filename (smart serve/regenerate)
   * Must be mounted BEFORE static /generated in core routes.
   * ----------------------------- */
  app.get("/generated/:filename", authGuard, async (req, res) => {
    const fn = path.basename(req.params.filename);

    try {
      const dbRows = await invoicesRepo.queryInvoiceByFilename(fn);

      if (dbRows && dbRows.length) {
        const inv = mapDbInvoiceRow(dbRows[0]);

        const p = await ensurePdfForInvoice(inv, { force: true });
        if (!p || !fs.existsSync(p)) {
          console.error("PDF NOT GENERATED (folder):", fn);
          return res.status(404).send("PDF not found");
        }

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${fn}"`);
        return res.sendFile(path.resolve(p));
      }

      const p = findGeneratedFileDeep(fn);
      if (p && fs.existsSync(p)) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${fn}"`);
        return res.sendFile(path.resolve(p));
      }

      return res.status(404).send("Nie znaleziono pliku.");
    } catch (e) {
      console.error("❌ /generated error:", e);
      return res.status(500).send("Internal Server Error");
    }
  });

  app.get("/generated/:folder/:filename", authGuard, async (req, res) => {
    const fn = path.basename(req.params.filename);
    try {
      const dbRows = await invoicesRepo.queryInvoiceByFilename(fn);
      if (dbRows && dbRows.length) {
        const inv = mapDbInvoiceRow(dbRows[0]);
        const p = await ensurePdfForInvoice(inv, { force: true });
        if (!p || !fs.existsSync(p)) {
          return res.status(404).send("PDF not found");
        }

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${fn}"`);
        return res.sendFile(path.resolve(p));
      }

      const p = findGeneratedFileDeep(fn);
      if (p && fs.existsSync(p)) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${fn}"`);
        return res.sendFile(path.resolve(p));
      }

      return res.status(404).send("Nie znaleziono pliku.");
    } catch (e) {
      console.error("❌ /generated (folder) error:", e);
      return res.status(500).send("Internal server error");
    }
  });

  // диагностика инвойсов
  app.get("/__db/check-invoices", async (_req, res) => {
    try {
      const all = await invoicesRepo.queryAllInvoices();
      res.json({
        count: all.length,
        head: all.slice(0, 5),
      });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });

  /* -----------------------------
   * API: invoices
   * ----------------------------- */

  app.get("/invoices/next-number-preview", async (req, res) => {
    try {
      const ym = String(req.query.month || "").trim();
      if (!/^\d{4}-\d{2}$/.test(ym)) {
        return res.status(400).json({ error: "month must be YYYY-MM" });
      }

      const year = ym.slice(0, 4);
      const month = ym.slice(5, 7);

      const rows = await invoicesRepo.queryAllInvoices();

      let maxSeq = 0;
      let width = 3;

      for (const r of rows || []) {
        const n = String(r?.number || "").trim();
        const m = /^ST-(\d+)\/(\d{2})\/(\d{4})$/.exec(n);
        if (!m) continue;
        if (m[2] !== month || m[3] !== year) continue;

        const seq = parseInt(m[1], 10);
        if (!Number.isFinite(seq)) continue;

        if (seq > maxSeq) {
          maxSeq = seq;
          width = Math.max(3, String(m[1]).length);
        }
      }

      const pad = (x) => String(x).padStart(width, "0");
      const lastNumber = maxSeq ? `ST-${pad(maxSeq)}/${month}/${year}` : null;
      const nextNumber = `ST-${pad((maxSeq || 0) + 1)}/${month}/${year}`;

      return res.json({ month: ym, lastNumber, nextNumber });
    } catch (e) {
      console.error("GET /invoices/next-number-preview error:", e);
      return res.status(500).json({ error: "Failed to build preview" });
    }
  });

  app.get("/invoices", async (_req, res) => {
    try {
      const rows = await invoicesRepo.queryAllInvoices();

      const data = rows.map((r) => {
        let items = [];
        try {
          if (r.items_json) {
            items = JSON.parse(r.items_json);
          }
        } catch {}

        return {
          number: r.number,
          client: r.clientName, // ← КЛЮЧОВА ПРАВКА
          issueDate: r.issueDate,
          dueDate: r.dueDate,
          net: r.net,
          gross: r.gross,
          filename: r.filename,
          folder: r.folder,
          items,
          buyer_address: r.buyer_address,
          buyer_nip: r.buyer_nip,
          buyer_pesel: r.buyer_pesel,
          status: r.status,
          payment_method: r.payment_method,
        };
      });

      res.json(data);
    } catch (e) {
      console.error("invoices GET DB error:", e);
      res.status(500).json({ error: "Failed to load invoices from DB" });
    }
  });

  // створення 1 фактури (без масиву)
  app.post("/invoices", authGuard, async (req, res) => {
    try {
      const inv = req.body || {};

      const number = String(inv.number || "").trim();
      if (!number) return res.status(400).json({ error: "number is required" });

      const clientName = String(inv.client || inv.clientName || "").trim();
      if (!clientName)
        return res.status(400).json({ error: "client is required" });

      const issueDate = inv.issueDate || inv.issue_date || null;
      const dueDate = inv.dueDate || inv.due_date || null;

      const items = Array.isArray(inv.items) ? inv.items : [];
      if (!items.length)
        return res.status(400).json({ error: "items are required" });

      const filename = (
        inv.filename || `FAKTURA_${number.replaceAll("/", "_")}.PDF`
      ).toUpperCase();

      const payload = {
        number,
        clientId: inv.clientId || inv.client_id || inv.clientID || null,
        clientName,
        issueDate,
        dueDate,
        net: inv.net,
        gross: inv.gross,
        filename,
        folder: inv.folder || "",
        buyer_address: inv.buyer_address || inv.address || "",
        buyer_nip: inv.buyer_nip || "",
        buyer_pesel: inv.buyer_pesel || "",
        status: inv.status || "issued",
        payment_method: inv.payment_method || inv.paymentMethod || "transfer",
        items_json: JSON.stringify(items),
      };

      await invoicesRepo.insertInvoice(payload);

      try {
        const p = await ensurePdfForInvoice(
          {
            clientId: String(
              payload.clientId || payload.clientName || payload.number
            ),
            number: payload.number,
            client: payload.clientName,
            issueDate: payload.issueDate,
            dueDate: payload.dueDate,
            net: payload.net,
            gross: payload.gross,
            filename: payload.filename,
            folder: payload.folder,
            buyer_address: payload.buyer_address,
            buyer_nip: payload.buyer_nip,
            buyer_pesel: payload.buyer_pesel,
            status: payload.status,
            payment_method: payload.payment_method,
            items: items.map((it) => ({
              name: it?.name || "",
              quantity: Number(it?.quantity ?? it?.qty ?? 1) || 1,
              net_price:
                Number(String(it?.net_price ?? "").replace(",", ".")) || 0,
              gross_price:
                Number(
                  String(it?.gross_price ?? it?.price_gross ?? "").replace(
                    ",",
                    "."
                  )
                ) || 0,
              net_total:
                Number(String(it?.net_total ?? "").replace(",", ".")) || 0,
              gross_total:
                Number(String(it?.gross_total ?? "").replace(",", ".")) || 0,
              vat_rate: it?.vat_rate ?? "23%",
              vat_amount:
                Number(String(it?.vat_amount ?? "").replace(",", ".")) || 0,
            })),
          },
          { force: true }
        );

        if (!p) {
          return res.status(200).json({
            success: true,
            pdf: { generated: false, filename },
          });
        }

        return res.json({
          success: true,
          pdf: { generated: true, filename },
        });
      } catch {
        return res.json({
          success: true,
          pdf: { generated: false, filename },
        });
      }
    } catch (e) {
      console.error("POST /invoices error:", e);
      return res.status(500).json({ error: "Failed to create invoice" });
    }
  });

  app.put("/invoices/:number", async (req, res) => {
    try {
      const oldNo = String(req.params.number || "");
      const body = req.body || {};
      if (Object.prototype.hasOwnProperty.call(body, "paymentMethod")) {
        body.payment_method = body.paymentMethod;
      }

      const isStatusOnly =
        Object.prototype.hasOwnProperty.call(body, "status") &&
        Object.keys(body).length === 1;

      if (isStatusOnly) {
        const ok = await invoicesRepo.updateStatusByNumber(oldNo, body.status);
        if (!ok) return res.status(404).json({ error: "Invoice not found" });
        return res.json({ success: true, status: body.status });
      }

      const existing = await invoicesRepo.getInvoiceByNumber(oldNo);
      if (!existing)
        return res.status(404).json({ error: "Invoice not found" });

      if (!body.clientId) body.clientId = existing.clientId;
      if (!body.client && !body.clientName) body.client = existing.clientName;
      if (!body.filename) body.filename = existing.filename;
      if (body.folder == null || body.folder === "")
        body.folder = existing.folder || "";

      const allowRenumber =
        String(req.headers["x-allow-renumber"] || "") === "1";
      const wantsRenumber =
        allowRenumber &&
        !!body._renumber &&
        body.number &&
        String(body.number) !== oldNo;

      const makeInvLike = (baseNo) => ({
        number: body.number || baseNo,
        client: body.client || body.clientName || "",
        issueDate: body.issueDate || null,
        dueDate: body.dueDate || null,
        net: body.net,
        gross: body.gross,
        status: body.status || "issued",
        payment_method: body.payment_method ?? body.paymentMethod ?? undefined,
        filename: (
          body.filename ||
          `FAKTURA_${String(body.number || baseNo).replaceAll("/", "_")}.pdf`
        ).toUpperCase(),
        folder: body.folder || "",
        items: Array.isArray(body.items) ? body.items : [],
        buyer_address: body.buyer_address || body.address || "",
        buyer_nip: body.buyer_nip || "",
        buyer_pesel: body.buyer_pesel || "",
      });

      if (wantsRenumber) {
        const newNo = String(body.number || "").trim();
        const taken = newNo
          ? await invoicesRepo.getInvoiceByNumber(newNo)
          : null;
        if (taken && String(taken.number) !== String(oldNo)) {
          return res
            .status(409)
            .json({ error: "Invoice number already exists" });
        }

        const ok = await invoicesRepo.renumberInvoice(oldNo, body);
        if (!ok) return res.status(404).json({ error: "Invoice not found" });

        const oldFile = String(body.oldFilename || "");
        if (oldFile) {
          const p = findGeneratedFileDeep(path.basename(oldFile));
          if (p && fs.existsSync(p)) {
            try {
              fs.unlinkSync(p);
            } catch {}
          }
        }

        try {
          const rows = await invoicesRepo.queryAllInvoices();
          const hit = (rows || []).find(
            (r) => String(r.number) === String(body.number)
          );
          if (hit) {
            const inv = mapDbInvoiceRow(hit);
            await ensurePdfForInvoice(inv, { force: true });
          } else {
            await ensurePdfForInvoice(makeInvLike(body.number), {
              force: true,
            });
          }
        } catch {}
        return res.json({ success: true, renumbered: true });
      }

      if (body.number && String(body.number) !== oldNo) {
        return res.status(400).json({ error: "Renumber not allowed" });
      }

      const payload = { ...body };

      if (Array.isArray(body.items)) {
        payload.items_json = JSON.stringify(body.items);
      }

      const ok = await invoicesRepo.updateByNumber(oldNo, payload);

      if (!ok) return res.status(404).json({ error: "Invoice not found" });

      try {
        const rows = await invoicesRepo.queryAllInvoices();
        const hit = (rows || []).find(
          (r) => String(r.number) === String(oldNo)
        );
        if (hit) {
          const inv = mapDbInvoiceRow(hit);
          await ensurePdfForInvoice(inv, { force: true });
        } else {
          await ensurePdfForInvoice(makeInvLike(oldNo), { force: true });
        }
      } catch {}

      return res.json({ success: true, renumbered: false });
    } catch (e) {
      console.error("PUT /invoices/:number error:", e);
      return res.status(500).json({ error: "Failed to update invoice" });
    }
  });

  app.delete(
    "/invoices/by-filename/:filename",
    requireConfirmHeader("delete-invoice"),
    async (req, res) => {
      try {
        const fname = path.basename(req.params.filename);
        const ok = await invoicesRepo.deleteByFilename(fname);
        const p = findGeneratedFileDeep(fname);
        if (p && fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch {}
        }
        if (!ok) return res.status(404).json({ error: "Invoice not found" });
        return res.json({ success: true, filename: fname });
      } catch (e) {
        console.error("DELETE /invoices/by-filename error:", e);
        return res.status(500).json({ error: "Failed to delete invoice" });
      }
    }
  );

  app.delete(
    "/invoices/by-number/:number",
    requireConfirmHeader("delete-invoice"),
    async (req, res) => {
      try {
        const num = String(req.params.number || "");
        const ok = await invoicesRepo.deleteByNumber(num);
        const safe = `FAKTURA_${num.replaceAll("/", "_")}.pdf`;
        const p = findGeneratedFileDeep(safe);
        if (p && fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch {}
        }
        if (!ok) return res.status(404).json({ error: "Invoice not found" });
        return res.json({ success: true, number: num });
      } catch (e) {
        console.error("DELETE /invoices/by-number error:", e);
        return res.status(500).json({ error: "Failed to delete invoice" });
      }
    }
  );

  app.get("/saved-invoices", (_req, res) => {
    const invoices = [];
    function readFolder(folderPath, parent = "") {
      if (!fs.existsSync(folderPath)) return;
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(folderPath, entry.name);
        const relativePath = path.join(parent, entry.name);
        if (entry.isDirectory()) readFolder(fullPath, relativePath);
        else if (entry.name.toLowerCase().endsWith(".pdf"))
          invoices.push(relativePath);
      }
    }
    readFolder(GENERATED_DIR);
    res.json(invoices);
  });

  app.post("/save-invoices", async (req, res) => {
    const invoices = req.body;
    if (!Array.isArray(invoices)) {
      return res.status(400).json({ error: "Invalid invoices payload" });
    }

    try {
      for (const inv of invoices) {
        const invN = {
          ...inv,
          clientId: inv.clientId || inv.client_id || "ARCHIVE-OLD",
          clientName: inv.clientName || inv.client || "",
        };

        if (invN.paymentMethod && !invN.payment_method) {
          invN.payment_method = invN.paymentMethod;
        }

        try {
          if (invN.payment_method != null) {
            await invoicesRepo.insertInvoice(invN);
          } else {
            const { payment_method, ...rest } = invN;
            await invoicesRepo.insertInvoice(rest);
          }
        } catch (e) {
          console.warn(
            "⚠️ insertInvoice failed for",
            inv?.number,
            e?.message || e
          );
        }
      }

      setImmediate(async () => {
        for (const inv of invoices) {
          try {
            const fname = (
              inv.filename ||
              `FAKTURA_${String(inv.number || "").replaceAll("/", "_")}.pdf`
            ).toUpperCase();

            const exists = findGeneratedFileDeep(path.basename(fname));
            if (!exists) {
              const rows = await invoicesRepo.queryInvoiceByFilename(
                path.basename(fname)
              );
              if (rows && rows.length) {
                const fullInv = mapDbInvoiceRow(rows[0]);
                await ensurePdfForInvoice(fullInv, { force: true });
              }
            }
          } catch (e) {
            console.warn(
              "⚠️ PDF gen after save failed for",
              inv?.number,
              e?.message || e
            );
          }
        }
      });

      res.json({ success: true });
    } catch (err) {
      console.error("❌ Error saving invoices to DB:", err);
      res.status(500).json({ error: "Failed to save invoices" });
    }
  });

  app.get("/download-invoice/:filename", authGuard, async (req, res) => {
    const fn = path.basename(req.params.filename);

    try {
      const dbRows = await invoicesRepo.queryInvoiceByFilename(fn);

      if (dbRows && dbRows.length) {
        const inv = mapDbInvoiceRow(dbRows[0]);

        const p = await ensurePdfForInvoice(inv, { force: true });
        if (!p || !fs.existsSync(p)) {
          console.error("PDF NOT GENERATED:", fn);
          return res.status(404).send("PDF not found");
        }

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${fn}"`);
        return res.sendFile(path.resolve(p));
      }

      const found = findGeneratedFileDeep(fn);
      if (found && fs.existsSync(found)) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${fn}"`);
        return res.sendFile(path.resolve(found));
      }

      return res.status(404).send("Nie znaleziono faktury.");
    } catch (e) {
      console.error("❌ /download-invoice error:", e);
      return res.status(500).send("Internal Server Error");
    }
  });

  /* -----------------------------
   * EXPORT .EPP (InsERT)
   * ----------------------------- */
  app.post("/export-epp", async (req, res) => {
    try {
      const { files } = req.body || {};
      const allRows = await invoicesRepo.queryAllInvoices();
      const all = allRows.map(mapDbInvoiceRow);

      const selected =
        Array.isArray(files) && files.length
          ? all.filter(
              (i) => files.includes(i.filename) || files.includes(i.number)
            )
          : all;

      const buf = generateEPPBuffer(selected, { requireBuyerName: true });

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", 'attachment; filename="export.epp"');
      res.setHeader("Content-Transfer-Encoding", "binary");
      res.setHeader("Content-Length", buf.length);
      return res.end(buf);
    } catch (e) {
      console.error("EPP export DB error:", e);
      return res.status(500).json({ error: "Błąd eksportu EPP" });
    }
  });

  app.post("/export-invoice-list-pdf", authGuard, async (req, res) => {
    try {
      await createInvoiceListPDF(req, res);
    } catch (e) {
      console.error("❌ /export-invoice-list-pdf error:", e);
      if (!res.headersSent) {
        res.status(500).json({ error: "PDF generation error" });
      }
    }
  });

  app.post("/download-multiple", async (req, res) => {
    try {
      const { files } = req.body || {};
      if (!Array.isArray(files) || !files.length) {
        return res.status(400).json({ error: "Niepoprawna lista plików" });
      }

      const pathsToZip = [];
      for (const filename of files) {
        const safe = path.basename(String(filename || ""));

        const dbRows = await invoicesRepo.queryInvoiceByFilename(safe);
        if (dbRows && dbRows.length) {
          const row = dbRows[0];
          const inv = mapDbInvoiceRow(row);

          const freshPath = await ensurePdfForInvoice(inv, {
            force: true,
          });

          if (freshPath && fs.existsSync(freshPath)) {
            pathsToZip.push(freshPath);
            continue;
          }
        }

        const found = findGeneratedFileDeep(safe);
        if (found && fs.existsSync(found)) {
          pathsToZip.push(path.resolve(found));
        } else {
          console.warn("[ZIP] File not found:", safe);
        }
      }

      if (!pathsToZip.length) {
        return res.status(404).json({ error: "Brak plików do spakowania" });
      }

      const archiver = require("archiver");
      const archive = archiver("zip", { zlib: { level: 9 } });
      res.attachment("wybrane_faktury.zip");
      archive.on("error", (err) => {
        console.error("❌ Archiver error:", err);
        if (!res.headersSent) res.status(500).end();
      });
      res.setHeader("Content-Type", "application/zip");

      archive.pipe(res);

      for (const p of pathsToZip) {
        if (!fs.existsSync(p)) continue;
        archive.file(path.resolve(p), { name: path.basename(p) });
      }
      await archive.finalize();
    } catch (e) {
      console.error("❌ ZIP build error:", e);
      if (!res.headersSent)
        res.status(500).json({ error: "ZIP generation error" });
    }
  });
};
