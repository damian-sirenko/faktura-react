/*
  server.middleware.cjs
  Global middleware & auth wiring:
  - API base path normalization (for /api hosting mount)
  - CORS (global + /auth preflight)
  - cookies + JSON body parser
  - tools routes + /__tools-debug
  - query bearer -> Authorization header helper
  - authGuard setup + protected prefixes + /auth routes
  - process-level error hooks
  - request logger
*/

const cookieParser = require("cookie-parser");
const express = require("express");
const fs = require("fs");
const path = require("path");

const mountToolsRoutes = require("./server.tools.routes.cjs");
const { authRequired } = require("./backend/middleware/auth");

module.exports = function mountGlobalMiddleware(app) {
  // normalize base path when app is mounted under /api (production)
  const API_BASE_PATH = process.env.API_BASE_PATH || "/api";
  app.use((req, _res, next) => {
    if (
      API_BASE_PATH &&
      API_BASE_PATH !== "/" &&
      typeof req.url === "string" &&
      (req.url === API_BASE_PATH || req.url.startsWith(API_BASE_PATH + "/"))
    ) {
      req.url =
        req.url.length === API_BASE_PATH.length
          ? "/"
          : req.url.slice(API_BASE_PATH.length);
    }
    next();
  });

  // [CORS-SIMPLE] global CORS to any routes/guards
  const DEV = process.env.NODE_ENV !== "production";
  const allow = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://panel.sterylserwis.pl",
    "https://sterylserwis.pl",
    "https://www.sterylserwis.pl",
  ]);

  const isPrivateHost = (h) =>
    /^localhost$|^127\.0\.0\.1$/.test(h) ||
    /^10\.\d+\.\d+\.\d+$/.test(h) ||
    /^192\.168\.\d+\.\d+$/.test(h) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h);

  const isAllowedOrigin = (o) => {
    if (!o) return false;
    if (allow.has(o)) return true;
    try {
      const { hostname } = new URL(o);
      return DEV && isPrivateHost(hostname);
    } catch {
      return false;
    }
  };

  app.use((req, res, next) => {
    const o = req.headers.origin;
    if (isAllowedOrigin(o)) {
      res.header("Access-Control-Allow-Origin", o);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Credentials", "true");
      res.header(
        "Access-Control-Allow-Headers",
        [
          "Content-Type",
          "Accept",
          "Authorization",
          "X-Requested-With",
          "X-CSRF-Token",
          "x-update-status-only",
          "x-allow-renumber",
          "x-confirm-action",
        ].join(", ")
      );
      res.header(
        "Access-Control-Allow-Methods",
        ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].join(", ")
      );
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // fallback: guarantee ACAO/credentials on all paths if origin in allow
  app.use((req, res, next) => {
    const o = req.headers.origin;
    if (o && allow.has(o)) {
      res.header("Access-Control-Allow-Origin", o);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    next();
  });

  // cookies: read AUTH_COOKIE_SECURE or COOKIE_SECURE
  const cookieSecureFlag = (
    process.env.AUTH_COOKIE_SECURE ??
    process.env.COOKIE_SECURE ??
    ""
  )
    .toString()
    .toLowerCase();

  const cookieSecure = cookieSecureFlag === "true";
  const cookieSameSite = cookieSecure ? "none" : "lax";
  app.locals.cookieSecure = cookieSecure;
  app.locals.cookieSameSite = cookieSameSite;

  app.use(cookieParser());
  app.use(express.json({ limit: process.env.JSON_LIMIT || "25mb" }));

  // Tools JSON routes (public, без auth)
  mountToolsRoutes(app);

  // __tools-debug: show where and what we serve
  app.get("/__tools-debug", (_req, res) => {
    const ROOT_LOCAL = __dirname;
    const TOOLS_PATH = path.join(ROOT_LOCAL, "data", "tools.json");
    let stat = null,
      exists = fs.existsSync(TOOLS_PATH);
    try {
      stat = exists ? fs.statSync(TOOLS_PATH) : null;
    } catch {}
    let sample = null;
    try {
      sample = exists ? JSON.parse(fs.readFileSync(TOOLS_PATH, "utf8")) : null;
    } catch {}
    res.json({
      file: TOOLS_PATH,
      exists,
      size: stat?.size || 0,
      mtime: stat?.mtime || null,
      sample: sample && {
        cosmeticCount: Array.isArray(sample.cosmetic)
          ? sample.cosmetic.length
          : 0,
        medicalCount: Array.isArray(sample.medical) ? sample.medical.length : 0,
      },
    });
  });

  // allow token in query: ?bearer=JWT
  app.use((req, _res, next) => {
    if (!req.headers.authorization && req.query && req.query.bearer) {
      req.headers.authorization = `Bearer ${req.query.bearer}`;
    }
    next();
  });

  process.on("unhandledRejection", (_e) => {});
  process.on("uncaughtException", (e) => {
    console.error("❌ UncaughtException:", e);
  });

  // /auth CORS preflight + routes
  const corsConfig = {
    allowedHeaders: [
      "Content-Type",
      "Accept",
      "Authorization",
      "X-Requested-With",
      "X-CSRF-Token",
      "x-update-status-only",
      "x-allow-renumber",
      "x-confirm-action",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  };

  app.use("/auth", (req, res, next) => {
    const o = req.headers.origin;
    if (o && allow.has(o)) {
      res.header("Access-Control-Allow-Origin", o);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Credentials", "true");
      res.header(
        "Access-Control-Allow-Headers",
        corsConfig.allowedHeaders.join(", ")
      );
      res.header("Access-Control-Allow-Methods", corsConfig.methods.join(", "));
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // DEV-mode: allow disabling auth locally
  const AUTH_DISABLE_DEV = process.env.AUTH_DISABLE_DEV === "1";
  const authGuard = AUTH_DISABLE_DEV
    ? (_req, _res, next) => next()
    : authRequired;
    app.locals.authGuard = authGuard;

  app.use("/auth", require("./routes/auth"));

  // Protected prefixes
  app.use("/clients", authGuard);
  app.use("/invoices", authGuard);
  app.use("/upload", authGuard);
  app.use("/gen", authGuard);
  app.use("/psl", authGuard);
  app.use("/settings", authGuard);
  app.use("/protocols", authGuard);
  app.use("/sign-queue", authGuard);
  app.use("/export-epp", authGuard);
  app.use("/download-multiple", authGuard);

  // request logger (kept as in original behavior)
  app.use((req, _res, next) => {
    console.log(`[API] ${req.method} ${req.url}`);
    next();
  });
};
