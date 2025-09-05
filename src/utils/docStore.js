// src/utils/docStore.js
// Прості утиліти збереження/читання переліку протоколів у localStorage.
// Додано: безпечний запис з обробкою QuotaExceeded, м'яка валідація, корисні хелпери.

const STORE_KEY = "doc:protocols:v1";
const MAX_PROTOCOLS = 300; // скільки останніх протоколів тримати (запобігає росту до безкінечності)

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
  const raw = localStorage.getItem(STORE_KEY);
  const arr = safeParse(raw).map(normalizeRec).filter(Boolean);

  // уникаємо дублікатів id (останній виграє)
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
  localStorage.setItem(STORE_KEY, JSON.stringify(list));
};

const writeList = (list) => {
  // обмежимо довжину (зайве з хвоста зникне)
  let out = Array.isArray(list) ? [...list] : [];
  if (out.length > MAX_PROTOCOLS) out = out.slice(0, MAX_PROTOCOLS);

  try {
    tryWrite(out);
    return;
  } catch (e) {
    // Якщо переповнення сховища — по одному видаляємо найстаріші записи і пробуємо ще.
    const isQuota =
      e?.name === "QuotaExceededError" ||
      e?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      e?.code === 22;
    if (!isQuota) throw e;

    // видаляємо з кінця (найстаріші) поки не влізе або поки не залишиться мінімум
    while (out.length > 0) {
      out.pop();
      try {
        tryWrite(out);
        return;
      } catch (err) {
        // продовжуємо чистити
      }
    }
    // якщо сюди дійшли — вже нічого не лишилось, просто очистимо ключ
    localStorage.removeItem(STORE_KEY);
  }
};

// ===== Публічні API (збережені старі назви/сигнатури) =====

/** Зберегти/оновити метадані протоколу (upsert по id). dataUrl містить сам PDF у base64. */
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

  // читаємо без сортування через readList(), але нам ок і так (він нормалізує)
  const list = readList();
  const idx = list.findIndex((x) => x.id === id);

  // Зберігаємо старий createdAt якщо не передали новий
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

  // (опційно) „пінг” для інших вкладок — щоб зловили подію 'storage'
  try {
    localStorage.setItem("doc:protocols:ping", String(Date.now()));
  } catch {
    // ігноруємо
  }
}

/** Прочитати всі збережені протоколи (останні — зверху). */
export function getProtocols() {
  return readList();
}

/** Видалити протокол по id. */
export function deleteProtocol(id) {
  if (!id) return;
  const list = readList().filter((x) => x.id !== id);
  writeList(list);
}

/** Людський формат дати/часу (для списку). */
export function humanDateTime(iso) {
  try {
    const d = new Date(iso);
    // лишаю undefined для локалі користувача; якщо хочеш PL — заміни на 'pl-PL'
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

// ===== Додаткові корисні утиліти (можеш не використовувати, але вони безпечні) =====

/** Прочитати один протокол за id. */
export function getProtocolById(id) {
  if (!id) return null;
  return readList().find((x) => x.id === id) || null;
}

/** Видалити кілька протоколів разом. */
export function deleteProtocols(ids = []) {
  if (!Array.isArray(ids) || !ids.length) return;
  const set = new Set(ids);
  const list = readList().filter((x) => !set.has(x.id));
  writeList(list);
}

/** Повністю очистити сховище протоколів. */
export function clearProtocols() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {}
}

/** Оціночний розмір JSON з протоколами у байтах (для діагностики). */
export function getStorageUsageApprox() {
  try {
    const raw = localStorage.getItem(STORE_KEY) || "";
    // приблизно: 2 байти на символ у UTF-16 — але повернемо довжину рядка (символів)
    return raw.length;
  } catch {
    return 0;
  }
}
