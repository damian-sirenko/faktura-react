/*
  server/mail/server.routes.mail.cjs
  Mail routes
*/

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

const express = require("express");
const path = require("path");
const { sendMailRaw } = require("./gmail.client.cjs");
const fs = require("fs");
const { logMail } = require("./mail.logger.cjs");
const { query } = require("../db.js");
const invoicesRepo = require("../repos/invoicesRepo.js");
const protocolsRepo = require("../repos/protocolsRepo.js");
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let STOP_BATCH = false;

const MAIL_MODE = "PROD";

module.exports = function mountMailRoutes(app) {
  const router = express.Router();

  // health check
  router.get("/_ping", (_req, res) => {
    res.json({ ok: true, service: "mail" });
  });

  router.post("/stop-batch", (_req, res) => {
    STOP_BATCH = true;
    res.json({ stopped: true });
  });
  router.post("/check-attachments", async (req, res) => {
    try {
      const { month, clients } = req.body || {};
      if (!month || !Array.isArray(clients)) {
        return res.status(400).json({ error: "Invalid payload" });
      }

      const GENERATED_DIR = path.join(process.cwd(), "generated");

      const fakturyDir = path.join(GENERATED_DIR, "faktury", month);

      const protokolyDir = path.join(GENERATED_DIR, "protocols", month);

      const fakturyFiles = fs.existsSync(fakturyDir)
        ? fs.readdirSync(fakturyDir)
        : [];

      const protokolyFiles = fs.existsSync(protokolyDir)
        ? fs.readdirSync(protokolyDir)
        : [];

      const result = [];

      for (const { clientId } of clients) {
        const id = String(clientId).trim().toUpperCase();
        const idEsc = escapeRegex(id);

        const invoiceFile =
          fakturyFiles.find((f) =>
            new RegExp(`^FAKTURA_.*_${idEsc}\\.pdf$`, "i").test(f)
          ) || null;

        const proto = await protocolsRepo.getProtocol(id, month);
        const hasProtocolEntries =
          Array.isArray(proto?.entries) && proto.entries.length > 0;

        let protocolFile = null;

        if (hasProtocolEntries) {
          protocolFile =
            protokolyFiles.find((f) =>
              new RegExp(`PROTOKOL_${id}_${month}\\.pdf$`, "i").test(f)
            ) || null;

          if (!protocolFile) {
            protocolFile =
              protokolyFiles.find((f) =>
                new RegExp(`_${id}_${month}.*\\.pdf$`, "i").test(f)
              ) || null;
          }
        }

        result.push({
          clientId: id,
          invoice: !!invoiceFile,
          invoiceFile,
          protocol: !!protocolFile,
          protocolFile,
        });
      }

      res.json(result);
    } catch (e) {
      console.error("check-attachments error:", e);
      res.status(500).json({ error: "Backend error" });
    }
  });

  // send single email
  router.post("/send", async (req, res) => {
    const { to, subject, html, clientId, month } = req.body || {};
    const targetEmail = to;

    try {
      if (
        !to ||
        !to.includes("@") ||
        !subject ||
        !html ||
        !clientId ||
        !month
      ) {
        return res
          .status(400)
          .json({ error: "to, subject, html are required" });
      }

      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Invalid month format" });
      }

      const GENERATED_DIR = path.join(process.cwd(), "generated");

      const fakturyDir = path.join(GENERATED_DIR, "faktury", month);

      const protokolyDir = path.join(GENERATED_DIR, "protocols", month);

      const id = String(clientId).trim().toUpperCase();
      const idEsc = escapeRegex(id);

      const fakturyFiles = fs.existsSync(fakturyDir)
        ? fs.readdirSync(fakturyDir)
        : [];

      const protokolyFiles = fs.existsSync(protokolyDir)
        ? fs.readdirSync(protokolyDir)
        : [];

      const invoiceFile =
        fakturyFiles.find((f) =>
          new RegExp(`^FAKTURA_.*_${idEsc}\\.pdf$`, "i").test(f)
        ) || null;

      let protocolFile =
        protokolyFiles.find((f) =>
          new RegExp(`PROTOKOL_${id}_${month}\\.pdf$`, "i").test(f)
        ) || null;

      if (!protocolFile) {
        protocolFile =
          protokolyFiles.find((f) =>
            new RegExp(`_${id}_${month}.*\\.pdf$`, "i").test(f)
          ) || null;
      }

      const attachments = [];

      if (invoiceFile) attachments.push(path.join(fakturyDir, invoiceFile));

      if (protocolFile) attachments.push(path.join(protokolyDir, protocolFile));

      if (!attachments.length) {
        return res.status(400).json({ error: "Brak załączników" });
      }

      const invoices = await invoicesRepo.getInvoicesForClientsAndMonth(
        [id],
        month
      );

      const invoice =
        invoices.sort(
          (a, b) => new Date(b.issueDate) - new Date(a.issueDate)
        )[0] || {};

      const invoiceNumberSafe = invoice?.number ? String(invoice.number) : "—";

      const dueDateSafe = invoice?.dueDate
        ? String(invoice.dueDate).slice(0, 10)
        : "—";

      const finalHtml = html
        .replace(/{invoiceNumber}/g, invoiceNumberSafe)
        .replace(/{dueDate}/g, dueDateSafe)
        .replace(/\n/g, "<br/>");

      await sendMailRaw({
        from: "Steryl Serwis <sterylserwis@gmail.com>",
        to: targetEmail,
        subject,
        html: finalHtml,
        attachments,
      });

      logMail({
        clientId: id,
        email: to,
        month,
        status: "SENT",
      });

      res.json({ success: true });
    } catch (e) {
      logMail({
        clientId: clientId ? String(clientId).toUpperCase() : null,
        email: to || null,
        month: month || null,
        status: "ERROR",
        error: e.message,
      });

      console.error("MAIL SEND ERROR:", e);
      res.status(500).json({ error: "send failed" });
    }
  });

  // send batch emails safely (queue)
  router.post("/send-batch", async (req, res) => {
    const { subject, html, month, clients } = req.body || {};

    if (!month || !Array.isArray(clients) || !clients.length) {
      return res.status(400).json({ error: "Invalid batch payload" });
    }
    const invoicesRepo = require("../repos/invoicesRepo.js");
    const protocolsRepo = require("../repos/protocolsRepo.js");

    let sent = 0;
    let failed = 0;
    const errors = [];
    for (const c of clients) {
      if (STOP_BATCH) {
        STOP_BATCH = false;
        break;
      }
      let id = null;
      let email = null;

      try {
        console.log("[MAIL][DEBUG] start client =", c);

        id = String(c.clientId || "")
          .trim()
          .toUpperCase();
        email = c.email;
        const idEsc = escapeRegex(id);

        if (!email || !email.includes("@")) {
          throw new Error("INVALID_EMAIL");
        }

        const GENERATED_DIR = path.join(process.cwd(), "generated");

        const fakturyDir = path.join(GENERATED_DIR, "faktury", month);

        const protokolyDir = path.join(GENERATED_DIR, "protocols", month);

        const fakturyFiles = fs.existsSync(fakturyDir)
          ? fs.readdirSync(fakturyDir)
          : [];
        const protokolyFiles = fs.existsSync(protokolyDir)
          ? fs.readdirSync(protokolyDir)
          : [];
        const invoiceFile =
          fakturyFiles.find((f) =>
            new RegExp(`^FAKTURA_.*_${idEsc}\\.pdf$`, "i").test(f)
          ) || null;

        const proto = await protocolsRepo.getProtocol(id, month);
        const hasProtocolEntries =
          Array.isArray(proto?.entries) && proto.entries.length > 0;

        let protocolFile = null;

        if (hasProtocolEntries) {
          protocolFile =
            protokolyFiles.find((f) =>
              new RegExp(`PROTOKOL_${id}_${month}\\.pdf$`, "i").test(f)
            ) || null;

          if (!protocolFile) {
            protocolFile =
              protokolyFiles.find((f) =>
                new RegExp(`_${id}_${month}.*\\.pdf$`, "i").test(f)
              ) || null;
          }
        }

        const invoicePath = invoiceFile
          ? path.join(fakturyDir, invoiceFile)
          : null;
        const protocolPath = protocolFile
          ? path.join(protokolyDir, protocolFile)
          : null;

        console.log("[MAIL][DEBUG] invoicePath =", invoicePath);
        console.log("[MAIL][DEBUG] protocolPath =", protocolPath);

        const attachments = [];
        if (invoicePath && fs.existsSync(invoicePath))
          attachments.push(invoicePath);
        if (protocolPath && fs.existsSync(protocolPath))
          attachments.push(protocolPath);

        console.log("[MAIL][DEBUG] attachments =", attachments);

        if (!attachments.length) {
          throw new Error("NO_ATTACHMENTS");
        }

        const invoices = await invoicesRepo.getInvoicesForClientsAndMonth(
          [id],
          month
        );

        const invoice =
          invoices?.sort(
            (a, b) => new Date(b.issueDate) - new Date(a.issueDate)
          )[0] || {};

        const invoiceNumberSafe = invoice?.number || "—";
        const dueDateSafe = invoice?.dueDate
          ? String(invoice.dueDate).slice(0, 10)
          : "—";

        const finalHtml = html
          .replace(/{invoiceNumber}/g, invoiceNumberSafe)
          .replace(/{dueDate}/g, dueDateSafe)
          .replace(/\n/g, "<br/>");

        await sendMailRaw({
          from: "Steryl Serwis <sterylserwis@gmail.com>",
          to: email,
          subject,
          html: finalHtml,
          attachments,
        });

        logMail({
          clientId: id,
          email,
          month,
          status: "SENT",
        });

        sent++;

        await delay(7000);
      } catch (e) {
        failed++;
        console.error("[MAIL][ERROR]", e.message);
        errors.push({
          clientId: id,
          email,
          error: e.message,
        });
      }
    }

    res.json({
      success: true,
      sent,
      failed,
      errors, // 🔴 тимчасово
    });
  });

  app.use("/mail", app.locals.authGuard, router);
};
