// backend/middleware/auth.js
const jwt = require("jsonwebtoken");

const COOKIE = process.env.AUTH_COOKIE_NAME || "sid";

function signSession(payload) {
  return jwt.sign(payload, process.env.AUTH_JWT_SECRET, {
    expiresIn: process.env.AUTH_JWT_EXPIRES || "7d",
  });
}

function authRequired(req, res, next) {
  const token =
    req.cookies?.[COOKIE] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const data = jwt.verify(token, process.env.AUTH_JWT_SECRET);
    req.user = data;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function parseExpToMs(exp) {
  // підтримка "Xd", "Xh", "Xm", "Xs"
  const s = String(exp || "").trim();
  const m = /^(\d+)\s*([dhms])$/i.exec(s);
  if (!m) return 1000 * 60 * 60 * 24 * 180; // fallback 180 днів
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  switch (unit) {
    case "d":
      return n * 24 * 60 * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    case "m":
      return n * 60 * 1000;
    case "s":
      return n * 1000;
    default:
      return 1000 * 60 * 60 * 24 * 180;
  }
}

function setAuthCookie(res, token) {
  // Довіряємо флагу AUTH_COOKIE_SECURE, а не NODE_ENV (щоб у деві не ламати куку)
  const secureFromEnv =
    String(process.env.AUTH_COOKIE_SECURE || "").toLowerCase() === "true";
  const sameSite = process.env.AUTH_COOKIE_SAME_SITE || "Lax"; // "Lax" за замовчанням

  const maxAge = parseExpToMs(process.env.AUTH_JWT_EXPIRES || "180d");
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: secureFromEnv, // локалка: false; прод під HTTPS: true
    sameSite,
    maxAge,
    path: "/",
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

module.exports = { authRequired, signSession, setAuthCookie, clearAuthCookie };
