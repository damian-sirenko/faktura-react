// src/api/base.js

function isDev() {
  // Treat as dev only on local hosts
  if (typeof window !== "undefined") {
    const h = window.location.hostname || "";
    if (
      h &&
      h !== "localhost" &&
      h !== "127.0.0.1" &&
      !h.startsWith("192.168.") &&
      !h.startsWith("10.") &&
      !h.endsWith(".local")
    ) {
      // On real domain (e.g. panel.sterylserwis.pl) force production mode
      return false;
    }
  }

  return (
    typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV
  );
}

export function getApiBase() {
  if (isDev()) {
    // local backend
    return import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "" : "/api");

  }

  // production (browser)
  if (typeof window !== "undefined") {
    const { protocol, host } = window.location;

    // Steryl Serwis panel
    if (
      host === "panel.sterylserwis.pl" ||
      host === "sterylserwis.pl" ||
      host.endsWith(".sterylserwis.pl")
    ) {
      return "https://panel.sterylserwis.pl";
    }

    // fallback — same host
    return `${protocol}//${host}`;
  }

  return "";
}

export function apiUrl(p = "") {
  const base = getApiBase();
  if (!p) return base;

  // already full URL
  if (/^https?:\/\//i.test(p)) return p;

  const path = p.startsWith("/") ? p : `/${p}`;

  // DEV: call backend root directly, without /api
  if (isDev()) {
    return `${base}${path}`;
  }

  // PROD: backend is under /api
  const finalPath =
    path.startsWith("/api/") || path.startsWith("/auth/")
      ? path
      : `/api${path}`;

  return `${base}${finalPath}`;
}

export async function apiFetch(p, options = {}) {
  const url = apiUrl(p);
  return fetch(url, options);
}

export default getApiBase;
