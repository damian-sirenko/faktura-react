/*
  server.routes.core.cjs
  Core app routes & app-wide endpoints:
  - /services and backend health endpoints
  - analytics router
  - settings + clients routes (including kartoteka PDF)
  - gen + psl routers
  - sign-queue file router mount
  - static serving for /signatures and /generated
  - diagnostics endpoints (/__peek, /__health, manifests, etc.)
  - frontend static + SPA fallback
  - final express error handler
*/

const fs = require("fs");
const path = require("path");
const express = require("express");

const { query: sql } = require("./server/db.js");

const analyticsRouter = require("./routes/analytics");
const reportsRouter = require("./routes/reports");
const processReportsRouter = require("./routes/processReportsRoutes");
const genRouter = require("./routes/generateFromClients");
const pslRouter = require("./routes/psl");
const signQueueFileRouter = require("./routes/signQueue");

const settingsRepo = require("./server/repos/settingsRepo.js");
const clientsRepo = require("./server/repos/clientsRepo.js");

const { createClientsKartotekaPDF } = require("./clients.kartoteka.pdf.js");

const { GENERATED_DIR, SIGNATURES_DIR } = require("./server.shared.cjs");

const { authRequired } = require("./backend/middleware/auth");

const emailPreviewRouter = require("./routes/emailPreview.cjs");
const sterilizationCycleClientsRoutes = require("./routes/sterilizationCycleClientsRoutes");
const sterilizationDocumentsRoutes = require("./routes/sterilizationDocumentsRoutes");
const sterilizationImportRoutes = require("./routes/sterilizationImportRoutes");
const disinfectionDocumentsRoutes = require("./routes/disinfectionDocumentsRoutes");
const disinfectionReportsRoutes = require("./routes/disinfectionReportsRoutes");
const disinfectionProcessLogsRoutes = require("./routes/disinfectionProcessLogsRoutes");
const disinfectionProcessLogClientsRoutes = require("./routes/disinfectionProcessLogClientsRoutes");

module.exports = function mountCoreRoutes(app) {
  const AUTH_DISABLE_DEV = process.env.AUTH_DISABLE_DEV === "1";
  const authGuard = AUTH_DISABLE_DEV
    ? (_req, _res, next) => next()
    : authRequired;
  app.locals.authGuard = authGuard;

  // ===== Services =====
  app.get("/services", async (_req, res) => {
    try {
      const servicesPath = path.join(process.cwd(), "data", "services.json");

      if (!fs.existsSync(servicesPath)) {
        throw new Error("services.json not found: " + servicesPath);
      }

      const raw = fs.readFileSync(servicesPath, "utf8");
      const data = JSON.parse(raw);

      res.json(
        Array.isArray(data)
          ? data.map((s) => ({
              name: String(s.name || ""),
              price_gross: Number(s.price_gross || 0),
              vat_rate: Number(s.vat_rate || 23),
            }))
          : []
      );
    } catch (e) {
      console.error("GET /services", e);
      res.status(500).json({ error: String(e.message) });
    }
  });

  app.get("/__services", (_req, res) => {
    res.json({ ok: true, name: "backend", version: 1 });
  });

  app.use("/analytics", authGuard, analyticsRouter);
  app.use("/reports", authGuard, reportsRouter);
  app.use(
    "/process-reports",
    (req, res, next) => {
      if (req.path === "/import-from-agent") return next();
      return app.locals.authGuard(req, res, next);
    },
    processReportsRouter
  );
  app.use("/api/sterilization", authGuard, sterilizationImportRoutes);
  app.use("/", authGuard, sterilizationCycleClientsRoutes);

  app.use("/disinfection", authGuard, disinfectionReportsRoutes);
  console.log("MOUNTED disinfectionReportsRoutes");
  app.use(
    "/disinfection/process-log",
    authGuard,
    disinfectionProcessLogsRoutes
  );
  app.use(
    "/disinfection/process-log",
    authGuard,
    disinfectionProcessLogClientsRoutes
  );

  // misc no-content endpoints
  app.get("/favicon.ico", (_req, res) => res.status(204).end());
  app.get("/site.webmanifest", (_req, res) => res.status(204).end());
  app.get("/manifest.webmanifest", (_req, res) => res.status(204).end());
  app.get("/.well-known/appspecific/com.chrome.devtools.json", (_req, res) =>
    res.status(204).end()
  );

  app.get("/__health", (_req, res) =>
    res.json({ ok: true, time: new Date().toISOString() })
  );

  app.post("/__agent-test", express.json({ limit: "5mb" }), (req, res) => {
    res.json({
      ok: true,
      receivedKeys: Object.keys(req.body || {}),
      fileName: req.body?.fileName || null,
      size: req.body?.fileContent ? req.body.fileContent.length : 0,
    });
  });

  app.post("/__test-export", authGuard, (req, res) => {
    console.log("🔥 HIT __test-export, body =", req.body);
    res.json({ ok: true });
  });

  // ===== Static =====
  app.use("/signatures", express.static(SIGNATURES_DIR));
  const STERILIZATION_REPORTS_DIR = path.join(
    process.cwd(),
    "storage",
    "sterilization_reports"
  );
  console.log("STERILIZATION_REPORTS_DIR =", STERILIZATION_REPORTS_DIR);

  app.use(
    "/generated",
    express.static(
      path.resolve(process.cwd(), "storage", "sterilization_reports")
    )
  );
console.log(
  "STATIC GENERATED DIR =",
  path.resolve(process.cwd(), "storage", "sterilization_reports")
);

app.use("/api/generated", express.static(STERILIZATION_REPORTS_DIR));

  // ===== Feature routers =====
  app.use("/gen", authGuard, genRouter);
  app.use("/mail", authGuard, emailPreviewRouter);

  app.use("/psl", pslRouter);
  app.use("/sterilization-documents", sterilizationDocumentsRoutes);
  app.use("/", sterilizationDocumentsRoutes);

  app.use("/disinfection-documents", disinfectionDocumentsRoutes);
  app.use("/", disinfectionDocumentsRoutes);

  // ===== Settings =====
  app.get("/settings", async (_req, res) => {
    try {
      const s = await settingsRepo.get();
      res.json(s);
    } catch (e) {
      console.error("settings GET error:", e);
      res.status(500).json({ error: "Failed to load settings from DB" });
    }
  });

  app.post("/settings", async (req, res) => {
    try {
      const body = req.body || {};
      const next = await settingsRepo.update({
        perPiecePriceGross: body.perPiecePriceGross,
        defaultVat: body.defaultVat,
        courierPriceGross: body.courierPriceGross,
        shippingPriceGross: body.shippingPriceGross,
        currentIssueMonth: body.currentIssueMonth,
        dueMode: body.dueMode === "fixed" ? "fixed" : "days",
        dueDays: Number(body.dueDays) || 0,
        dueFixedDate:
          typeof body.dueFixedDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(body.dueFixedDate)
            ? body.dueFixedDate
            : null,
      });
      res.json({ success: true, settings: next });
    } catch (e) {
      console.error("settings POST error:", e);
      res.status(500).json({ error: "Failed to save settings to DB" });
    }
  });

  // ===== Clients =====
  app.post("/save-clients", async (req, res) => {
    const clients = req.body;
    if (!Array.isArray(clients)) {
      return res.status(400).json({ error: "Invalid data format" });
    }
    try {
      const result = await clientsRepo.replaceAllClients(clients);
      res.json({ success: true, inserted: result.inserted });
    } catch (err) {
      console.error("❌ Error saving clients into MySQL:", err);
      res.status(500).json({ error: "Failed to save clients into DB" });
    }
  });

  app.get("/clients", async (_req, res) => {
    try {
      const rows = await clientsRepo.getAllClients();
      res.json(rows);
    } catch (err) {
      console.error("❌ Error reading clients from MySQL:", err);
      res.status(500).json({ error: "Failed to load clients from DB" });
    }
  });

  app.get("/clients/kartoteka.pdf", (req, res) => {
    Promise.resolve(createClientsKartotekaPDF(req, res)).catch((e) => {
      console.error("❌ /clients/kartoteka.pdf error:", e);
      if (!res.headersSent) res.status(500).send("PDF generation error");
    });
  });

  app.post("/clients/kartoteka-selected.pdf", authGuard, (req, res) => {
    Promise.resolve(createClientsKartotekaPDF(req, res)).catch((e) => {
      console.error("❌ /clients/kartoteka-selected.pdf error:", e);
      if (!res.headersSent) res.status(500).send("PDF generation error");
    });
  });

  // ===== Diagnostics =====
  app.get("/__peek", async (_req, res) => {
    try {
      const inv = await sql(`SELECT COUNT(*) AS c FROM invoices`);
      const d = await sql(`SELECT COUNT(*) AS c FROM psl_drafts`);
      const s = await sql(`SELECT COUNT(*) AS c FROM psl_saved`);
      res.json({
        invoices: inv[0]?.c || 0,
        pslDrafts: d[0]?.c || 0,
        pslSaved: s[0]?.c || 0,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String(e.message) });
    }
  });

  // sign-queue file router (existing behavior)
  app.use("/", authGuard, signQueueFileRouter);

  // ===== Frontend static + SPA fallback =====
  (() => {
    const FRONT_DIR_CANDIDATES = [
      path.join(__dirname, "dist"),
      path.join(__dirname, "frontend", "dist"),
      path.join(process.cwd(), "dist"),
      path.join(process.cwd(), "frontend", "dist"),
      path.join(__dirname, "..", "panel"),
    ];
    const FRONT_DIR = FRONT_DIR_CANDIDATES.find((p) => fs.existsSync(p));

    const API_PREFIXES = [
      "/api",
      "/auth",
      "/mail",
      "/psl",
      "/analytics",
      "/reports",
      "/upload",
      "/gen",
      "/generated",
      "/signatures",
      "/sterilization",
      "/services",
      "/settings",
      "/clients",
      "/invoices",
      "/saved-invoices",
      "/save-invoices",
      "/download-invoice",
      "/download-multiple",
      "/protocols",
      "/sign-queue",
      "/export-epp",
      "/export-invoice-list-pdf",
      "/tools",
      "/disinfection",
      "/__",
    ];

    if (FRONT_DIR) {
      app.use(express.static(FRONT_DIR, { fallthrough: true }));

      app.use((req, res, next) => {
        if (req.method !== "GET") return next();
        if (API_PREFIXES.some((p) => req.path.startsWith(p))) return next();

        if (req.path.startsWith("/panel")) {
          return res.sendFile(path.join(FRONT_DIR, "index.html"));
        }

        res.sendFile(path.join(FRONT_DIR, "index.html"));
      });

      console.log("🧩 Serving frontend from:", FRONT_DIR);
    } else {
      console.log();
      app.use((req, _res, next) => {
        if (req.method !== "GET") return next();
        if (API_PREFIXES.some((p) => req.path.startsWith(p))) return next();
        next();
      });
    }
  })();

  // ===== Final error handler =====
  app.use((err, _req, res, _next) => {
    console.error("❌ Unhandled express error:", err);
    if (!res.headersSent)
      res.status(500).json({ error: "Internal server error" });
  });
};
