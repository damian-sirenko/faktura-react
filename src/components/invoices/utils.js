// src/lib/invoices/utils.js

/* ===== API base (prod/dev) ===== */
export const API = import.meta.env.VITE_API_URL || "";
export const api = (p) => (API ? `${API}${p}` : p);

/* ===== ВСПОМОГАТЕЛЬНО: ключ кешу для інвойсу ===== */
export const cacheKeyOf = (inv) =>
  encodeURIComponent(
    String(
      inv?.updatedAt ||
        inv?._v ||
        inv?.lastModified ||
        inv?.lastSavedAt ||
        inv?.issueDate ||
        ""
    )
  );

/* ====== date helpers ====== */
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const plusDaysISO = (baseISO, days) => {
  const d = baseISO ? new Date(baseISO) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/* ====== № фактури: парсер і сортування ====== */
export function parseInvNo(no) {
  const m = /^ST-(\d{3})\/(\d{2})\/(\d{4})$/.exec(String(no || ""));
  if (!m) return { y: 0, m: 0, seq: 0 };
  return {
    seq: parseInt(m[1], 10),
    m: parseInt(m[2], 10),
    y: parseInt(m[3], 10),
  };
}
export function sortByNumberDesc(a, b) {
  const A = parseInvNo(a.number),
    B = parseInvNo(b.number);
  return B.y - A.y || B.m - A.m || B.seq - A.seq;
}

/* ====== money helpers ====== */
export const to2 = (x) => Number(x || 0).toFixed(2);

/* ====== перерахунок позиції ====== */
export const computeItem = (it) => {
  const qty = Number(it.qty || 0);
  const grossUnit = Number(it.price_gross || 0);
  const vat = Number(it.vat_rate || 23);
  const netUnit = grossUnit / (1 + vat / 100);
  const gross = grossUnit * qty;
  const netSum = netUnit * qty;
  const vatSum = gross - netSum;
  return {
    ...it,
    qty,
    price_gross: Number.isFinite(grossUnit) ? grossUnit : 0,
    vat_rate: Number.isFinite(vat) ? vat : 23,
    _net_unit: netUnit,
    _net_sum: netSum,
    _vat_sum: vatSum,
    _gross_sum: gross,
  };
};

/* ====== helpers: parse buyer_identifier ====== */
export function parseBuyerIdentifier(str) {
  const s = String(str || "");
  const nipMatch = s.match(/NIP:\s*([0-9A-Za-z-]+)/i);
  const peselMatch = s.match(/PESEL:\s*([0-9A-Za-z-]+)/i);
  return {
    nip: nipMatch ? nipMatch[1] : "",
    pesel: peselMatch ? peselMatch[1] : "",
  };
}

/* ====== уніфікація шляхів до файлів ====== */
export const fileSrcFor = (inv) => {
  const v = cacheKeyOf(inv) || Date.now();
  if (inv.folder && inv.filename) {
    return api(
      `/generated/${encodeURIComponent(inv.folder)}/${encodeURIComponent(
        inv.filename
      )}?v=${v}`
    );
  }
  return api(`/generated/${encodeURIComponent(inv.filename || "")}?v=${v}`);
};
export const downloadHrefFor = (inv) => {
  const v = cacheKeyOf(inv) || Date.now();
  return api(
    `/download-invoice/${encodeURIComponent(inv.filename || "")}?v=${v}`
  );
};
export const previewSrcFor = (inv) => {
  const v = cacheKeyOf(inv) || Date.now();
  if (inv.folder && inv.filename) {
    return api(
      `/generated/${encodeURIComponent(inv.folder)}/${encodeURIComponent(
        inv.filename
      )}?v=${v}`
    );
  }
  return api(
    `/download-invoice/${encodeURIComponent(inv.filename || "")}?v=${v}`
  );
};

/* ✅ НОВЕ: “поза абонементом” від Steryl NN */
export function adjustExtrasPricingBySubscription(items) {
  if (!Array.isArray(items) || !items.length) return items;
  const subIdx = items.findIndex((it) =>
    /steryl\s*(\d+)/i.test(String(it?.name || ""))
  );
  if (subIdx === -1) return items;

  const subName = String(items[subIdx].name || "");
  const match = /steryl\s*(\d+)/i.exec(subName);
  const included = match ? parseInt(match[1], 10) : 0;
  const subPrice = Number(items[subIdx].price_gross || 0);
  if (!included || !Number.isFinite(subPrice) || subPrice <= 0) return items;

  const perPackageGross = subPrice / included;
  const EXTRA_RE =
    /(poza\s*abon(am(en(t|tem)?)?|amentem|ament)|pakiet(y)?\s*poza\s*abon)|поза\s*абонемен/iu;

  return items.map((it) => {
    const name = String(it?.name || "");
    if (EXTRA_RE.test(name)) return { ...it, price_gross: perPackageGross };
    return it;
  });
}

/* ========= адреса ========= */
export function splitAddress(addr) {
  const out = { street: "", postal: "", city: "" };
  const s = String(addr || "").trim();
  if (!s) return out;

  const parts = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const joinTail = (arr) => arr.join(", ").trim();

  if (parts.length >= 2) {
    out.street = parts[0];
    const tail = joinTail(parts.slice(1));
    const m = tail.match(/(\d{2}-\d{3})\s+(.+)$/);
    if (m) {
      out.postal = m[1];
      out.city = m[2].trim();
    } else {
      const m2 = tail.match(/^(.+)\s+(\d{2}-\d{3})$/);
      if (m2) {
        out.city = m2[1].trim();
        out.postal = m2[2];
      } else {
        out.city = tail;
      }
    }
    return out;
  }
  const m3 = s.match(/(.+?)\s*,?\s*(\d{2}-\d{3})\s+(.+)$/);
  if (m3) {
    out.street = m3[1].trim();
    out.postal = m3[2];
    out.city = m3[3].trim();
    return out;
  }
  out.street = s;
  return out;
}
export function joinAddress(street, postal, city) {
  const s = String(street || "").trim();
  const p = String(postal || "").trim();
  const c = String(city || "").trim();
  if (p && c && s) return `${s}, ${p} ${c}`;
  if (s && (p || c)) return `${s}, ${[p, c].filter(Boolean).join(" ")}`;
  return s || [p, c].filter(Boolean).join(" ");
}

/* ====== НОВЕ: ефективний статус з автопротермінуванням ====== */
export const effectiveStatusOf = (inv) => {
  const stored = String(inv.status || "issued");
  if (stored === "paid") return "paid";
  const due = String(inv.dueDate || "").slice(0, 10);
  const today = todayISO();
  if (due && due < today) return "overdue";
  return stored;
};
