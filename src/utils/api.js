// src/utils/api.js
const API_URL = import.meta.env.VITE_API_URL || "";

// база з .env для прода + дефолт /api, якщо змінна не підхопилася
const rawBase = API_URL.replace(/\/+$/, "");

const envBase = rawBase || "/api";

// визначаємо дев під Vite
const isDevVite =
  typeof window !== "undefined" &&
  window.location &&
  (window.location.port === "5173" || window.location.port === "4173");

// у деві ходимо через Vite proxy => API_BASE = "" (відносні шляхи)
const API_BASE = isDevVite ? "" : envBase;

// токен у пам'яті + localStorage
let AUTH_TOKEN = "";
try {
  AUTH_TOKEN = localStorage.getItem("auth:token") || "";
} catch {}

export function setAuthToken(tok) {
  AUTH_TOKEN = tok || "";
  try {
    if (AUTH_TOKEN) localStorage.setItem("auth:token", AUTH_TOKEN);
    else localStorage.removeItem("auth:token");
  } catch {}
}

export function getAuthToken() {
  return AUTH_TOKEN || "";
}

// нормалізація URL: у деві зрізаємо http://localhost:3000 і подібне → відносний шлях
function normalizeDevUrl(p) {
  if (!isDevVite) return p;

  try {
    const s = String(p || "");
    // якщо передали повний URL на локальний бекенд — прибираємо схему/хост
    if (
      s.startsWith("http://localhost:3000") ||
      s.startsWith("http://127.0.0.1:3000")
    ) {
      const u = new URL(s);
      return u.pathname + (u.search || "") + (u.hash || "");
    }
    // якщо передали повний URL на бойовий домен бекенду — теж зрізаємо
    if (envBase && s.startsWith(envBase)) {
      const u = new URL(s);
      return u.pathname + (u.search || "") + (u.hash || "");
    }
    return s;
  } catch {
    return p;
  }
}

export const api = (p) => {
  const path = String(p || "");
  if (isDevVite) {
    // у деві: завжди відносно (через проксі)
    return normalizeDevUrl(path.startsWith("/") ? path : `/${path}`);
  }
  // у проді: повний базовий URL з env (або /api за замовчанням)
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
};

/**
 * універсальний запит до бекенду:
 * - credentials: "include" для cookie-сесій
 * - Authorization: Bearer <token> якщо є
 * - opts.json -> body JSON
 * - автозбереження токена після /auth/login
 * - централізований хендл 401
 */
export async function apiFetch(path, opts = {}) {
  // будуємо абсолют/відносно залежно від середовища
  let url;
  if (typeof path === "string" && /^https?:\/\//i.test(path)) {
    // повний URL: у деві нормалізуємо до відносного
    url = isDevVite ? normalizeDevUrl(path) : path;
  } else {
    url = api(path);
  }

  const headers = new Headers(opts.headers || {});

  // підтримка body через opts.json
  let body = opts.body;
  if (body == null && opts.json !== undefined) {
    if (!headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.json);
  }

  // для не-FormData за замовчанням JSON (не заважає GET)
  if (!headers.has("Content-Type") && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const t = getAuthToken();
  if (t) headers.set("Authorization", `Bearer ${t}`);

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body,
    credentials: "include",
    cache: "no-store",
  });

  const isLoginCall =
    typeof path === "string" && path.startsWith("/auth/login");

  // автозбереження токена після логіну
  if (res.ok && isLoginCall) {
    try {
      const cloned = res.clone();
      const data = await cloned.json();
      if (data && data.token) setAuthToken(data.token);
    } catch {}
  }

  // централізований 401
  if (res.status === 401) {
    let message = "Nieautoryzowany dostęp";
    try {
      const cloned = res.clone();
      const data = await cloned.json();
      if (data && (data.error || data.message)) {
        message = String(data.error || data.message);
      }
    } catch {
      try {
        const text = await res.clone().text();
        if (text) message = text;
      } catch {}
    }

    if (isLoginCall) {
      if (!message || /unauthorized/i.test(message)) {
        message = "Nieprawidłowy e-mail lub hasło";
      }
      throw new Error(message);
    }

    try {
      setAuthToken("");
      await fetch(api("/auth/logout"), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
    } catch {}

    if (typeof window !== "undefined" && location.pathname !== "/login") {
      const back = encodeURIComponent(location.pathname + location.search);
      location.replace(`/login?back=${back}`);
    }

    throw new Error(message || "401 Unauthorized");
  }

  return res;
}

export async function apiJson(path, opts = {}) {
  const res = await apiFetch(path, opts);
  const contentType = res.headers.get("content-type") || "";

  // якщо це не JSON – лог + помилка, без спроби парсити
  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    console.error(
      "[apiJson] Non-JSON response:",
      res.status,
      contentType,
      (text || "").slice(0, 300)
    );
    throw new Error(
      `Очікував JSON, але отримав ${contentType || "невідомий тип"}. Статус: ${
        res.status
      }`
    );
  }

  try {
    return await res.json();
  } catch (e) {
    console.error("[apiJson] JSON parse error:", e);
    throw new Error("Не вдалося розпарсити JSON відповіді з сервера");
  }
}

// для зручності у вікні
if (typeof window !== "undefined") {
  window.apiFetch = apiFetch;
  window.setAuthToken = setAuthToken;
}
