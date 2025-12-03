// src/utils/docStore.js
// Утиліти для збереження/читання переліку протоколів у localStorage.
// Безпечна робота з localStorage (перевірка доступності, QuotaExceeded), нормалізація даних та хелпери.

const STORE_KEY = "doc:protocols:v1";
const MAX_PROTOCOLS = 300; // верхня межа списку (запобігання нестримному росту)

// ===== Внутрішні хелпери =====
const isYm = (s) => typeof s === "string" && /^\d{4}-\d{2}$/.test(s);

const toIso = (d) => {
  try {
    return new Date(d || Date.now()).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

const safeParse = (raw) => {
  try {
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

// Безпечні обгортки для localStorage (на випадок недоступності / SSR / privacy-режимів)
function hasLocalStorage() {
  try {
    if (typeof window === "undefined" || !("localStorage" in window))
      return false;
    const t = "__ls_test__" + Math.random();
    window.localStorage.setItem(t, t);
    window.localStorage.removeItem(t);
    return true;
  } catch {
    return false;
  }
}
const LS_AVAILABLE = hasLocalStorage();

function lsGet(key) {
  if (!LS_AVAILABLE) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key, val) {
  if (!LS_AVAILABLE) return;
  try {
    window.localStorage.setItem(key, val);
  } catch {
    // ігноруємо — оброблятимемо вище по стеку
  }
}
function lsRemove(key) {
  if (!LS_AVAILABLE) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ігноруємо
  }
}

const normalizeRec = (r) => {
  if (!r || typeof r !== "object") return null;
  const rec = { ...r };

  rec.id = String(rec.id || "").trim();
  if (!rec.id) return null;

  rec.clientId = String(rec.clientId || "").trim();
  rec.clientName = String(rec.clientName || "").trim();

  // Місяць: якщо відсутній — спробуємо витягнути з id формату "<clientId>:YYYY-MM"
  let month = String(rec.month || "").trim();
  if (!isYm(month)) {
    const m = /^.+:(\d{4}-\d{2})$/.exec(rec.id);
    if (m) month = m[1];
  }
  rec.month = isYm(month) ? month : "";

  rec.fileName = String(rec.fileName || "protokol.pdf").trim();
  rec.createdAt = toIso(rec.createdAt);
  rec.dataUrl = String(rec.dataUrl || "");

  return rec;
};

const readList = () => {
  const raw = lsGet(STORE_KEY);
  const arr = safeParse(raw).map(normalizeRec).filter(Boolean);

  // уникнення дублікатів id (останній виграє)
  const map = new Map();
  for (const r of arr) map.set(r.id, r);
  const uniq = Array.from(map.values());

  // сортуємо від нових до старих
  uniq.sort(
    (a, b) =>
      new Date(b.createdAt || 0).getTime() -
      new Date(a.createdAt || 0).getTime()
  );

  return uniq;
};

const tryWrite = (list) => {
  lsSet(STORE_KEY, JSON.stringify(list));
};

const writeList = (list) => {
  // обмежимо довжину (зайве з хвоста зникне)
  let out = Array.isArray(list) ? [...list] : [];
  if (out.length > MAX_PROTOCOLS) out = out.slice(0, MAX_PROTOCOLS);

  try {
    tryWrite(out);
    return;
  } catch (e) {
    // Якщо переповнення сховища — по одному видаляємо найстаріші та пробуємо ще.
    const isQuota =
      e?.name === "QuotaExceededError" ||
      e?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      e?.code === 22;
    if (!isQuota) return; // якщо інша помилка — тихо ігноруємо, нічого не записали

    while (out.length > 0) {
      out.pop();
      try {
        tryWrite(out);
        return;
      } catch {
        // продовжуємо чистити
      }
    }
    // якщо нічого не лишилось — видаляємо ключ
    lsRemove(STORE_KEY);
  }
};

// ===== Публічні API =====

/** Зберегти/оновити метадані протоколу (upsert по id). dataUrl — PDF як data:URL. */
export function saveProtocolDocMeta({
  id,
  clientId,
  clientName,
  month,
  fileName,
  createdAt,
  dataUrl,
}) {
  if (!id) return;

  const list = readList();
  const idx = list.findIndex((x) => x.id === id);

  // зберігаємо попередню дату, якщо нову не передано
  const prevCreated = idx >= 0 ? list[idx].createdAt : null;

  const rec = normalizeRec({
    id,
    clientId,
    clientName,
    month,
    fileName: fileName || "protokol.pdf",
    createdAt: createdAt || prevCreated || new Date().toISOString(),
    dataUrl: dataUrl || "",
  });

  if (!rec) return;

  if (idx >= 0) list[idx] = rec;
  else list.unshift(rec);

  writeList(list);

  // (опційно) ping для інших вкладок — щоб зловили подію 'storage'
  try {
    lsSet("doc:protocols:ping", String(Date.now()));
  } catch {
    // ігноруємо
  }
}

/** Прочитати всі збережені протоколи (останні — зверху). */
export function getProtocols() {
  return readList();
}

/** Прочитати один протокол за id. */
export function getProtocolById(id) {
  if (!id) return null;
  return readList().find((x) => x.id === id) || null;
}

/** Видалити протокол по id. */
export function deleteProtocol(id) {
  if (!id) return;
  const list = readList().filter((x) => x.id !== id);
  writeList(list);
}

/** Видалити кілька протоколів. */
export function deleteProtocols(ids = []) {
  if (!Array.isArray(ids) || !ids.length) return;
  const set = new Set(ids);
  const list = readList().filter((x) => !set.has(x.id));
  writeList(list);
}

/** Повністю очистити сховище протоколів. */
export function clearProtocols() {
  lsRemove(STORE_KEY);
}

/** Оціночний розмір JSON у символах (для діагностики). */
export function getStorageUsageApprox() {
  const raw = lsGet(STORE_KEY) || "";
  return raw.length;
}

/** Людський формат дати/часу (для списку). */
export function humanDateTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso || "";
  }
}
