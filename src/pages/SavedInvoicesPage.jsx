// src/pages/SavedInvoicesPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/* ===== API base (prod/dev) ===== */
const API = import.meta.env.VITE_API_URL || "";
const api = (p) => (API ? `${API}${p}` : p);

/* ===== ВСПОМОГАТЕЛЬНО: ключ кешу для інвойсу ===== */
const cacheKeyOf = (inv) =>
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

/* ====== Confirm modal ====== */
function ConfirmModal({ open, title, message, onCancel, onConfirm }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-5 w-full max-w-md">
        <div className="text-lg font-semibold mb-2">{title}</div>
        <div className="text-sm text-gray-700 mb-4">{message}</div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Anuluj
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm}>
            Potwierdź
          </button>
        </div>
      </div>
    </div>
  );
}

/* ====== Узгоджений IconButton (квадратний фон як на списку клієнтів) ====== */
const IconButton = ({
  title,
  onClick,
  variant = "secondary", // secondary | primary | danger
  children,
}) => {
  const base =
    "inline-flex items-center justify-center w-8 h-8 rounded-lg p-1.5 transition focus:outline-none focus:ring";
  const variants = {
    secondary:
      "bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-300",
    primary: "bg-blue-100 text-blue-700 hover:bg-blue-200 focus:ring-blue-300",
    danger: "bg-red-100 text-red-700 hover:bg-red-200 focus:ring-red-300",
  };
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`${base} ${variants[variant]}`}
    >
      {children}
    </button>
  );
};

/* ====== Mono icons ====== */
const IconPencil = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);
const IconDownload = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);
const IconTrash = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);
/* ✅ моно-іконка перегляду */
const IconEye = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

function PreviewModal({ open, src, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-5xl h-[80vh] flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <div className="font-semibold">Podgląd PDF</div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Zamknij
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {/* ключ гарантує повний перерендер iframe при зміні src */}
          <iframe
            key={src}
            title="PDF preview"
            src={src}
            className="w-full h-full"
          />
        </div>
      </div>
    </div>
  );
}

/* ====== date helpers ====== */
const todayISO = () => new Date().toISOString().slice(0, 10);
const plusDaysISO = (baseISO, days) => {
  const d = baseISO ? new Date(baseISO) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

/* ====== № фактури: парсер і сортування (новіші зверху) ====== */
function parseInvNo(no) {
  const m = /^ST-(\d{3})\/(\d{2})\/(\d{4})$/.exec(String(no || ""));
  if (!m) return { y: 0, m: 0, seq: 0 };
  return {
    seq: parseInt(m[1], 10),
    m: parseInt(m[2], 10),
    y: parseInt(m[3], 10),
  };
}
function sortByNumberDesc(a, b) {
  const A = parseInvNo(a.number),
    B = parseInvNo(b.number);
  return B.y - A.y || B.m - A.m || B.seq - A.seq;
}

/* ====== money helpers ====== */
const to2 = (x) => Number(x || 0).toFixed(2);

/* ====== перерахунок позиції з qty + price_gross + vat_rate ====== */
const computeItem = (it) => {
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
function parseBuyerIdentifier(str) {
  const s = String(str || "");
  const nipMatch = s.match(/NIP:\s*([0-9A-Za-z-]+)/i);
  const peselMatch = s.match(/PESEL:\s*([0-9A-Za-z-]+)/i);
  return {
    nip: nipMatch ? nipMatch[1] : "",
    pesel: peselMatch ? peselMatch[1] : "",
  };
}

/* ====== уніфікація шляхів до файлів (з cache-buster) ====== */
const fileSrcFor = (inv) => {
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
const downloadHrefFor = (inv) => {
  const v = cacheKeyOf(inv) || Date.now();
  return api(
    `/download-invoice/${encodeURIComponent(inv.filename || "")}?v=${v}`
  );
};
/* ====== прев’ю-джерело: якщо PDF нема — використовуємо download endpoint + cache-buster */
const previewSrcFor = (inv) => {
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

const USE_BUILTIN_PREVIEW_MODAL = true;

/* ✅ НОВЕ: обчислення ціни «поза абонементом» від абонемента Steryl NN */
function adjustExtrasPricingBySubscription(items) {
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
    if (EXTRA_RE.test(name)) {
      return { ...it, price_gross: perPackageGross };
    }
    return it;
  });
}

/* ========= 🧩 НОВЕ: розбір/збирання адреси (вулиця/kod/miasto) ========= */
function splitAddress(addr) {
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
function joinAddress(street, postal, city) {
  const s = String(street || "").trim();
  const p = String(postal || "").trim();
  const c = String(city || "").trim();
  if (p && c && s) return `${s}, ${p} ${c}`;
  if (s && (p || c)) return `${s}, ${[p, c].filter(Boolean).join(" ")}`;
  return s || [p, c].filter(Boolean).join(" ");
}

export default function SavedInvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [preview, setPreview] = useState({ open: false, src: "" });
  const [servicesDict, setServicesDict] = useState([]);

  // filters
  const [searchClient, setSearchClient] = useState("");
  const [searchNumber, setSearchNumber] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // pagination
  const [perPage, setPerPage] = useState(50);
  const [page, setPage] = useState(1);

  // selection
  const [selected, setSelected] = useState([]);

  // form add/edit
  const [formOpen, setFormOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [form, setForm] = useState({
    number: "",
    client: "",
    buyer_nip: "",
    buyer_pesel: "",
    buyer_address: "", // зібраний рядок для сумісності/ПДФ
    buyer_street: "", // НОВЕ
    buyer_postal: "", // НОВЕ
    buyer_city: "", // НОВЕ
    issueDate: todayISO(),
    dueDate: plusDaysISO(todayISO(), 7),
    status: "issued",
    items: [{ name: "", qty: 1, price_gross: 0, vat_rate: 23 }],
  });

  // delete confirm
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  // ref для автоскролу до форми
  const formRef = useRef(null);

  /* Load data */
  useEffect(() => {
    fetch(api("/invoices"))
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        arr.sort(sortByNumberDesc);
        setInvoices(arr);
        const names = new Set();
        arr.forEach((inv) =>
          (inv.items || []).forEach(
            (it) => it?.name && names.add(String(it.name))
          )
        );
        setServicesDict(Array.from(names));
      });

    fetch(api("/clients"))
      .then((r) => r.json())
      .then((data) => setClients(Array.isArray(data) ? data : []));
  }, []);

  /* Закриття прев’ю по Escape */
  useEffect(() => {
    if (!preview.open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setPreview({ open: false, src: "" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview.open]);

  /* Helpers */
  const suggestNextNumber = (issueDate) => {
    const d = issueDate ? new Date(issueDate) : new Date();
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const nums = invoices
      .filter((inv) => (inv.number || "").endsWith(`/${m}/${y}`))
      .map((inv) => {
        const m2 = String(inv.number || "").match(/^ST-(\d{3})\/\d{2}\/\d{4}$/);
        return m2 ? parseInt(m2[1], 10) : null;
      })
      .filter((n) => n != null);
    const next = (nums.length ? Math.max(...nums) + 1 : 1)
      .toString()
      .padStart(3, "0");
    return `ST-${next}/${m}/${y}`;
  };

  /* Client autoload / NIP-PESEL exclusivity */
  const handleClientChange = (val) => {
    setForm((f) => ({
      ...f,
      client: val,
      buyer_address: "",
      buyer_street: "",
      buyer_postal: "",
      buyer_city: "",
      buyer_nip: "",
      buyer_pesel: "",
    }));
    const found =
      clients.find(
        (c) => (c.name || c.Klient || "").trim() === String(val).trim()
      ) || null;
    if (found) {
      const isFirma =
        String(found.type || found["Firma - OP"] || "op").toLowerCase() ===
        "firma";
      const nip = found.nip || found.NIP || "";
      const pesel = found.pesel || found.Pesel || "";
      const address = found.address || found.Adres || "";

      const { street, postal, city } = splitAddress(address);

      setForm((f) => ({
        ...f,
        buyer_address: address || joinAddress(street, postal, city),
        buyer_street: street,
        buyer_postal: postal,
        buyer_city: city,
        buyer_nip: isFirma ? nip : "",
        buyer_pesel: !isFirma ? pesel : "",
      }));
    }
  };
  const onChangeNip = (v) =>
    setForm((f) => ({
      ...f,
      buyer_nip: v,
      buyer_pesel: v ? "" : f.buyer_pesel,
    }));
  const onChangePesel = (v) =>
    setForm((f) => ({ ...f, buyer_pesel: v, buyer_nip: v ? "" : f.buyer_nip }));

  /* Date filter */
  const filteredByDate = useMemo(() => {
    if (dateFilter === "all") return invoices;
    const today = new Date();
    const start = new Date(today);
    let from, to;
    if (dateFilter === "today") {
      from = new Date(today.toISOString().slice(0, 10));
      to = new Date(from);
      to.setDate(to.getDate() + 1);
    } else if (dateFilter === "week") {
      const dow = today.getDay() || 7;
      start.setDate(today.getDate() - (dow - 1));
      from = new Date(start.toISOString().slice(0, 10));
      to = new Date(from);
      to.setDate(from.getDate() + 7);
    } else if (dateFilter === "month") {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      to = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    } else if (dateFilter === "custom") {
      from = customFrom ? new Date(customFrom) : null;
      to = customTo ? new Date(customTo) : null;
    }
    return invoices.filter((inv) => {
      const d = inv.issueDate ? new Date(inv.issueDate) : null;
      if (!d || Number.isNaN(d.getTime())) return false;
      if (from && d < from) return false;
      if (to && d >= to) return false;
      return true;
    });
  }, [invoices, dateFilter, customFrom, customTo]);

  const filtered = useMemo(() => {
    const name = searchClient.trim().toLowerCase();
    const no = searchNumber.trim().toLowerCase();
    return filteredByDate.filter((inv) => {
      const okName = name
        ? (inv.client || "").toLowerCase().includes(name)
        : true;
      const okNo = no ? (inv.number || "").toLowerCase().includes(no) : true;
      const okStatus =
        statusFilter === "all"
          ? true
          : (inv.status || "issued") === statusFilter;
      return okName && okNo && okStatus;
    });
  }, [filteredByDate, searchClient, searchNumber, statusFilter]);

  /* Pagination */
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageSafe = Math.min(page, totalPages);
  const pageSlice = filtered.slice(
    (pageSafe - 1) * perPage,
    pageSafe * perPage
  );

  /* Selection */
  const toggleSelectAllOnPage = () => {
    const pageFiles = pageSlice.map((i) => i.filename);
    const allSelected = pageFiles.every((f) => selected.includes(f));
    if (allSelected) {
      setSelected(selected.filter((f) => !pageFiles.includes(f)));
    } else {
      setSelected(Array.from(new Set([...selected, ...pageFiles])));
    }
  };

  /* Bulk actions */
  const bulkDelete = () => {
    if (!selected.length) {
      alert("Nie wybrano żadnych faktur.");
      return;
    }
    setToDelete({ list: "bulk", filenames: [...selected] });
    setConfirmOpen(true);
  };

  const bulkDownloadZip = async () => {
    if (!selected.length) return alert("Nie wybrano żadnych faktur.");
    const r = await fetch(api("/download-multiple"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: selected }),
    });
    if (!r.ok) return alert("Błąd podczas pobierania.");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wybrane_faktury.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const bulkExportEPP = async () => {
    if (!selected.length) return alert("Nie wybrano żadnych faktur.");
    const r = await fetch(api("/export-epp"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: selected }),
    });
    if (!r.ok) return alert("Błąd eksportu .epp");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.epp";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  /* Row actions */

  // ✅ відкрити прев’ю без кешу (додаємо випадковий параметр)
  const openPreviewNoCache = (inv) => {
    const base = previewSrcFor(inv);
    const url = `${base}${base.includes("?") ? "&" : "?"}r=${Date.now()}`;
    setPreview({ open: true, src: url });
  };

  // ✅ завантажити PDF, гарантовано минаючи кеш браузера/SW/CDN
  const downloadInvoiceNoCache = async (inv) => {
    try {
      const base = downloadHrefFor(inv);
      const url = `${base}${base.includes("?") ? "&" : "?"}r=${Date.now()}`;
      const resp = await fetch(url, {
        method: "GET",
        // ключовий момент: змушуємо мережевий запит, не беремо з кешу
        cache: "no-store",
        headers: {
          // деякі проксі/сервіси більш слухняні із цими хедерами
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = inv.filename || "faktura.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      // запасний варіант: якщо щось пішло не так, відкриємо у новій вкладці
      const fallback = `${downloadHrefFor(inv)}&r=${Date.now()}`;
      window.open(fallback, "_blank", "noopener,noreferrer");
    }
  };

  const startEdit = (inv, idxInAll) => {
    setEditingIndex(idxInAll);

    // 1) дані з самої фактури (включно з buyer_identifier)
    const idParsed = parseBuyerIdentifier(inv.buyer_identifier || "");
    let buyerAddress =
      inv.buyer_address ||
      inv.address ||
      (inv.buyer && inv.buyer.address) ||
      "";
    let buyerNip = inv.buyer_nip || idParsed.nip || "";
    let buyerPesel = inv.buyer_pesel || idParsed.pesel || "";

    // адреса: пріоритет — окремі поля; інакше — парсимо рядок
    let buyerStreet = inv.buyer_street || "";
    let buyerPostal = inv.buyer_postal || "";
    let buyerCity = inv.buyer_city || "";
    if (!buyerStreet && !buyerPostal && !buyerCity) {
      const parsed = splitAddress(buyerAddress);
      buyerStreet = parsed.street;
      buyerPostal = parsed.postal;
      buyerCity = parsed.city;
    }

    // 2) доповнюємо з бази клієнтів по exact name
    const foundClient =
      clients.find(
        (c) =>
          (c.name || c.Klient || "").trim() === String(inv.client || "").trim()
      ) || null;
    if (foundClient) {
      const isFirma =
        String(
          foundClient.type || foundClient["Firma - OP"] || "op"
        ).toLowerCase() === "firma";
      const nipC = foundClient.nip || foundClient.NIP || "";
      const peselC = foundClient.pesel || foundClient.Pesel || "";
      const addrC = foundClient.address || foundClient.Adres || "";
      if (!buyerAddress) buyerAddress = addrC || "";

      if (!buyerStreet && !buyerPostal && !buyerCity) {
        const p = splitAddress(addrC);
        buyerStreet = p.street;
        buyerPostal = p.postal;
        buyerCity = p.city;
      }
      if (!buyerNip && !buyerPesel) {
        buyerNip = isFirma ? nipC : "";
        buyerPesel = !isFirma ? peselC : "";
      } else {
        if (!buyerNip && isFirma) buyerNip = nipC;
        if (!buyerPesel && !isFirma) buyerPesel = peselC;
      }
    }

    const clone = {
      number: inv.number || "",
      client: inv.client || "",
      buyer_nip: buyerNip,
      buyer_pesel: buyerPesel,
      buyer_address:
        buyerAddress || joinAddress(buyerStreet, buyerPostal, buyerCity),
      buyer_street: buyerStreet,
      buyer_postal: buyerPostal,
      buyer_city: buyerCity,
      issueDate: inv.issueDate || todayISO(),
      dueDate: inv.dueDate || plusDaysISO(inv.issueDate || todayISO(), 7),
      status: inv.status || "issued",
      items: (inv.items || []).map((it) => ({
        name: it.name || "",
        qty: Number(it.quantity || it.qty || 1),
        price_gross: Number(
          it.price_gross ??
            (it.gross_price ? String(it.gross_price).replace(",", ".") : 0)
        ),
        vat_rate: Number(
          typeof it.vat_rate === "string"
            ? it.vat_rate.replace("%", "")
            : it.vat_rate ?? 23
        ),
      })),
    };
    if (!clone.items.length)
      clone.items = [{ name: "", qty: 1, price_gross: 0, vat_rate: 23 }];
    setForm(clone);
    setFormOpen(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const askDelete = (inv) => {
    setToDelete({ one: inv });
    setConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    let next = [...invoices];
    if (toDelete.list === "bulk" && Array.isArray(toDelete.filenames)) {
      next = next.filter((i) => !toDelete.filenames.includes(i.filename));
      setSelected([]);
    } else if (toDelete.one) {
      next = next.filter((i) => i !== toDelete.one);
    }
    next.sort(sortByNumberDesc);
    setInvoices(next);
    setConfirmOpen(false);
    setToDelete(null);
    await fetch(api("/save-invoices"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
  };

  /* Colored status select */
  const updateStatus = async (inv, newStatus) => {
    const next = invoices.map((i) =>
      i === inv ? { ...i, status: newStatus } : i
    );
    next.sort(sortByNumberDesc);
    setInvoices(next);
    await fetch(api("/save-invoices"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
  };

  /* Items handlers */
  const addItemRow = () =>
    setForm((f) => ({
      ...f,
      items: [...f.items, { name: "", qty: 1, price_gross: 0, vat_rate: 23 }],
    }));
  const removeItemRow = (idx) =>
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  const updateItemField = (idx, key, val) =>
    setForm((f) => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [key]: val };
      return { ...f, items };
    });

  /* Form submit (by button only) */
  const onFormKeyDown = (e) => {
    if (e.key === "Enter") e.preventDefault();
  };

  const saveForm = async () => {
    const requiredTop = ["number", "client", "issueDate", "dueDate"];
    for (const k of requiredTop) {
      if (!String(form[k] || "").trim()) {
        alert(`Pole "${k}" jest wymagane.`);
        return;
      }
    }
    if (!form.items.length) return alert("Dodaj przynajmniej jedną pozycję.");
    for (const it of form.items) {
      if (!String(it.name || "").trim())
        return alert("Pozycja: nazwa jest wymagana.");
      if (!(Number(it.qty) > 0)) return alert("Pozycja: ilość musi być > 0.");
      if (!(Number(it.price_gross) >= 0))
        return alert("Pozycja: cena brutto ≥ 0.");
    }

    /* ✅ ПЕРЕД розрахунком — виставляємо ціну «поза абонементом» від Steryl NN */
    const itemsAdjusted = adjustExtrasPricingBySubscription(form.items);

    const computed = itemsAdjusted.map(computeItem);
    const totals = computed.reduce(
      (a, it) => ({
        net: a.net + it._net_sum,
        vat: a.vat + it._vat_sum,
        gross: a.gross + it._gross_sum,
      }),
      { net: 0, vat: 0, gross: 0 }
    );

    // Зібраний адресний рядок для сумісності/PDF
    const buyer_address_joined = joinAddress(
      form.buyer_street,
      form.buyer_postal,
      form.buyer_city
    );

    const nowIso = new Date().toISOString();

    const payload = {
      ...form,
      buyer_address: buyer_address_joined || form.buyer_address || "",
      buyer_street: form.buyer_street || "",
      buyer_postal: form.buyer_postal || "",
      buyer_city: form.buyer_city || "",
      updatedAt: nowIso, // ✅ мітка для cache-busting
      items: computed.map((it) => ({
        name: it.name,
        quantity: it.qty,
        gross_price: to2(it.price_gross),
        net_price: to2(it._net_unit),
        net_total: to2(it._net_sum),
        vat_rate: `${to2(it.vat_rate)}%`,
        vat_amount: to2(it._vat_sum),
        gross_total: to2(it._gross_sum),
      })),
      net: to2(totals.net).replace(".", ","),
      gross: to2(totals.gross).replace(".", ","),
    };

    // ✅ УНІКАЛЬНІСТЬ НОМЕРА
    const proposedNumber =
      (payload.number && String(payload.number).trim()) ||
      suggestNextNumber(payload.issueDate);
    const conflict = invoices.some((inv, idx) => {
      const same =
        String(inv.number || "").trim() === String(proposedNumber).trim();
      if (editingIndex != null) {
        return same && idx !== editingIndex;
      }
      return same;
    });
    if (conflict) {
      alert(
        `Faktura o numerze "${proposedNumber}" już istnieje. Zmień numer na unikalny.`
      );
      return;
    }

    let next = [...invoices];
    if (editingIndex != null) {
      next[editingIndex] = { ...next[editingIndex], ...payload };
    } else {
      const n = proposedNumber;
      payload.number = n;
      const fileSafe = String(n).replaceAll("/", "_");
      payload.filename = `Faktura_${fileSafe}.pdf`;
      payload.folder = payload.folder || "";
      next = [payload, ...next];
    }

    next.sort(sortByNumberDesc);
    setInvoices(next);
    setFormOpen(false);
    setEditingIndex(null);
    setForm({
      number: "",
      client: "",
      buyer_nip: "",
      buyer_pesel: "",
      buyer_address: "",
      buyer_street: "",
      buyer_postal: "",
      buyer_city: "",
      issueDate: todayISO(),
      dueDate: plusDaysISO(todayISO(), 7),
      status: "issued",
      items: [{ name: "", qty: 1, price_gross: 0, vat_rate: 23 }],
    });

    await fetch(api("/save-invoices"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });

    alert(`✅ Zapisano fakturę: ${payload.number}`);
  };

  const clientNames = useMemo(
    () =>
      Array.from(
        new Set(clients.map((c) => c.name || c.Klient || "").filter(Boolean))
      ),
    [clients]
  );

  /* === Handlery верхніх кнопок === */
  const openNewForm = () => {
    const baseDate = todayISO();
    const suggestedNo = suggestNextNumber(baseDate);
    setEditingIndex(null);
    setForm({
      number: suggestedNo,
      client: "",
      buyer_nip: "",
      buyer_pesel: "",
      buyer_address: "",
      buyer_street: "",
      buyer_postal: "",
      buyer_city: "",
      issueDate: baseDate,
      dueDate: plusDaysISO(baseDate, 7),
      status: "issued",
      items: [{ name: "", qty: 1, price_gross: 0, vat_rate: 23 }],
    });
    setFormOpen(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  /* ✅ НОВЕ: редагування вибраної чекбоксом */
  const editSelected = () => {
    if (selected.length !== 1) {
      alert("Zaznacz dokładnie jedną fakturę do edycji.");
      return;
    }
    const filename = selected[0];
    let idx = invoices.findIndex((inv) => inv.filename === filename);
    if (idx === -1) {
      alert("Nie znaleziono zaznaczonej faktury.");
      return;
    }
    const inv = invoices[idx];
    startEdit(inv, idx);
  };

  /* ====== RENDER ====== */
  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">📁 Zapisane faktury</h1>

      {/* Кнопки керування формою */}
      <div className="card-lg flex items-center gap-2">
        <button className="btn-primary" onClick={openNewForm}>
          Dodaj fakturę
        </button>

        {/* ✅ Кнопка редагування по вибраній чекбоксом */}
        <button
          className="btn-secondary"
          onClick={editSelected}
          disabled={selected.length !== 1}
          title={
            selected.length === 1
              ? "Edytuj zaznaczoną fakturę"
              : "Zaznacz dokładnie jedną fakturę na liście"
          }
        >
          Edytuj zaznaczoną
        </button>

        {formOpen && (
          <button
            className="btn-secondary"
            onClick={() => {
              setFormOpen(false);
              setEditingIndex(null);
            }}
          >
            Zamknij formularz
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card-lg space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm mb-1">Klient</label>
            <input
              className="input"
              placeholder="Szukaj po kliencie"
              value={searchClient}
              onChange={(e) => {
                setSearchClient(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Numer</label>
            <input
              className="input"
              placeholder="Szukaj po numerze"
              value={searchNumber}
              onChange={(e) => {
                setSearchNumber(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Data</label>
            <select
              className="input"
              value={dateFilter}
              onChange={(e) => {
                setDateFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Wszystkie</option>
              <option value="today">Dzisiaj</option>
              <option value="week">Ten tydzień</option>
              <option value="month">Ten miesiąc</option>
              <option value="custom">Zakres</option>
            </select>
          </div>
          {dateFilter === "custom" && (
            <>
              <div>
                <label className="block text-sm mb-1">Od</label>
                <input
                  type="date"
                  className="input"
                  value={customFrom}
                  onChange={(e) => {
                    setCustomFrom(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Do</label>
                <input
                  type="date"
                  className="input"
                  value={customTo}
                  onChange={(e) => {
                    setCustomTo(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </>
          )}

          {/* ✅ Новий фільтр за статусом */}
          <div>
            <label className="block text-sm mb-1">Status</label>
            <select
              className="input"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              title="Filtruj po statusie"
            >
              <option value="all">Wszystkie</option>
              <option value="issued">wystawiona</option>
              <option value="paid">opłacona</option>
              <option value="overdue">przeterminowana</option>
            </select>
          </div>

          <div className="flex-1" />

          <div className="flex gap-2">
            <IconButton
              title="Pobierz wybrane (ZIP)"
              onClick={bulkDownloadZip}
              variant="secondary"
            >
              <IconDownload />
            </IconButton>
            <button
              className="btn-secondary"
              onClick={bulkExportEPP}
              disabled={!selected.length}
              title="Eksport .epp"
              aria-label="Eksport EPP"
            >
              .epp
            </button>
            <IconButton
              title="Usuń zaznaczone"
              onClick={bulkDelete}
              variant="danger"
            >
              <IconTrash />
            </IconButton>
          </div>
        </div>
      </div>

      {/* Form */}
      {formOpen && (
        <div ref={formRef} className="card-lg" onKeyDown={onFormKeyDown}>
          <div className="grid md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="block text-sm mb-1">Numer *</label>
              <input
                className="input w-full"
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm mb-1">Klient *</label>
              <input
                className="input w-full"
                list="clients-list"
                value={form.client}
                onChange={(e) => handleClientChange(e.target.value)}
                required
                placeholder="Zacznij pisać, aby wybrać..."
              />
              <datalist id="clients-list">
                {clientNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-sm mb-1">NIP</label>
              <input
                className="input w-full"
                value={form.buyer_nip}
                onChange={(e) => onChangeNip(e.target.value)}
                disabled={!!form.buyer_pesel}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">PESEL</label>
              <input
                className="input w-full"
                value={form.buyer_pesel}
                onChange={(e) => onChangePesel(e.target.value)}
                disabled={!!form.buyer_nip}
              />
            </div>

            {/* ====== НОВЕ: окремі поля адреси ====== */}
            <div>
              <label className="block text-sm mb-1">Kod pocztowy</label>
              <input
                className="input w-full"
                placeholder="31-875"
                value={form.buyer_postal}
                onChange={(e) =>
                  setForm((f) => ({ ...f, buyer_postal: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Miasto</label>
              <input
                className="input w-full"
                placeholder="Kraków"
                value={form.buyer_city}
                onChange={(e) =>
                  setForm((f) => ({ ...f, buyer_city: e.target.value }))
                }
              />
            </div>
            <div className="md:col-span-4">
              <label className="block text-sm mb-1">Ulica</label>
              <input
                className="input w-full"
                placeholder="Ulica 1/2"
                value={form.buyer_street}
                onChange={(e) =>
                  setForm((f) => ({ ...f, buyer_street: e.target.value }))
                }
              />
            </div>
            {/* ====== кінець нових полів адреси ====== */}

            <div>
              <label className="block text-sm mb-1">Data wystawienia *</label>
              <input
                type="date"
                className="input w-full"
                value={form.issueDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({
                    ...f,
                    issueDate: v,
                    dueDate: f.dueDate || plusDaysISO(v, 7),
                    number: f.number || suggestNextNumber(v),
                  }));
                }}
                required
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Termin płatności *</label>
              <input
                type="date"
                className="input w-full"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Status</label>
              <select
                className={`input w-40 text-center font-medium rounded-md border ${
                  form.status === "paid"
                    ? "bg-green-100 text-green-800 border-green-200"
                    : form.status === "overdue"
                    ? "bg-rose-100 text-rose-800 border-rose-200"
                    : "bg-amber-100 text-amber-900 border-amber-200"
                }`}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="issued">wystawiona</option>
                <option value="paid">opłacona</option>
                <option value="overdue">przeterminowana</option>
              </select>
            </div>
          </div>

          {/* Items */}
          <div className="mt-4">
            <div className="font-normal text-sm mb-2">
              Pozycje (wszystkie pola wymagane)
            </div>

            <div className="overflow-x-auto">
              <table className="table w-full table-fixed">
                <colgroup>
                  {[
                    <col key="c1" style={{ width: "58%" }} />,
                    <col key="c2" style={{ width: "12ch" }} />,
                    <col key="c3" style={{ width: "14ch" }} />,
                    <col key="c4" style={{ width: "12ch" }} />,
                    <col key="c5" style={{ width: "12ch" }} />,
                    <col key="c6" style={{ width: "12ch" }} />,
                    <col key="c7" style={{ width: "12ch" }} />,
                    <col key="c8" style={{ width: "8ch" }} />,
                  ]}
                </colgroup>

                <thead>
                  <tr className="text-xs font-normal">
                    <th className="text-left whitespace-nowrap" scope="col">
                      Nazwa towaru / usługi *
                    </th>
                    <th
                      className="text-center whitespace-normal break-words"
                      scope="col"
                    >
                      Ilość *
                    </th>
                    <th
                      className="text-right whitespace-normal break-words"
                      scope="col"
                    >
                      Cena brutto (szt.) *
                    </th>
                    <th
                      className="text-center whitespace-normal break-words"
                      scope="col"
                    >
                      VAT % *
                    </th>
                    <th
                      className="text-right whitespace-normal break-words"
                      scope="col"
                    >
                      Wartość netto
                    </th>
                    <th
                      className="text-right whitespace-normal break-words"
                      scope="col"
                    >
                      Wartość VAT
                    </th>
                    <th
                      className="text-right whitespace-normal break-words"
                      scope="col"
                    >
                      Wartość brutto
                    </th>
                    <th
                      className="text-center whitespace-normal break-words"
                      scope="col"
                    >
                      —
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((it, idx) => {
                    const q = Number(it.qty || 0);
                    const gU = Number(it.price_gross || 0);
                    const v = Number(it.vat_rate || 23);
                    const nU = gU / (1 + v / 100);
                    const g = gU * q;
                    const n = nU * q;
                    const vv = g - n;
                    return (
                      <tr key={idx}>
                        <td className="align-middle">
                          <input
                            className="input w-full"
                            list="services-list"
                            value={it.name}
                            onChange={(e) =>
                              updateItemField(idx, "name", e.target.value)
                            }
                            placeholder="Zacznij pisać, aby wybrać…"
                            required
                          />
                        </td>
                        <td className="text-center align-middle">
                          <input
                            type="number"
                            min="1"
                            className="input w-full text-right"
                            style={{ minWidth: "10ch" }}
                            value={it.qty}
                            onChange={(e) =>
                              updateItemField(
                                idx,
                                "qty",
                                Number(e.target.value) || 1
                              )
                            }
                            required
                          />
                        </td>
                        <td className="text-right align-middle">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input w-full text-right"
                            value={it.price_gross}
                            onChange={(e) =>
                              updateItemField(
                                idx,
                                "price_gross",
                                Number(e.target.value) || 0
                              )
                            }
                            required
                          />
                        </td>
                        <td className="text-center align-middle">
                          <select
                            className="input w-full text-right"
                            style={{ minWidth: "10ch" }}
                            value={it.vat_rate}
                            onChange={(e) =>
                              updateItemField(
                                idx,
                                "vat_rate",
                                Number(e.target.value) || 23
                              )
                            }
                            required
                          >
                            <option value={23}>23</option>
                            <option value={8}>8</option>
                            <option value={5}>5</option>
                            <option value={0}>0</option>
                          </select>
                        </td>
                        <td className="text-right align-middle">{to2(n)}</td>
                        <td className="text-right align-middle">{to2(vv)}</td>
                        <td className="text-right align-middle">{to2(g)}</td>
                        <td className="text-center align-middle">
                          <button
                            type="button"
                            className="btn-danger px-2 py-1 text-white"
                            onClick={() => removeItemRow(idx)}
                            title="Usuń pozycję"
                            aria-label={`Usuń pozycję ${idx + 1}`}
                          >
                            <IconTrash />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <datalist id="services-list">
                {servicesDict.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>

            <div className="mt-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={addItemRow}
              >
                ➕ Dodaj pozycję
              </button>
            </div>

            <div className="mt-3 text-right text-sm text-gray-700">
              {(() => {
                const totals = (form.items || []).reduce(
                  (a, it) => {
                    const q = Number(it.qty || 0);
                    const gU = Number(it.price_gross || 0);
                    const v = Number(it.vat_rate || 23);
                    const nU = gU / (1 + v / 100);
                    a.gross += gU * q;
                    a.net += nU * q;
                    return a;
                  },
                  { net: 0, gross: 0 }
                );
                const vat = totals.gross - totals.net;
                return (
                  <div className="inline-block">
                    <div>
                      Razem netto: <b>{to2(totals.net)}</b>
                    </div>
                    <div>
                      Razem VAT: <b>{to2(vat)}</b>
                    </div>
                    <div>
                      Razem brutto: <b>{to2(totals.gross)}</b>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="pt-4 flex gap-2">
            <button type="button" className="btn-primary" onClick={saveForm}>
              Zapisz fakturę
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setFormOpen(false);
                setEditingIndex(null);
              }}
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card-lg overflow-x-auto">
        <div className="mb-2 flex items-center gap-3">
          <label className="text-sm">Na stronę:</label>
          <select
            className="input w-24"
            value={perPage}
            onChange={(e) => {
              setPerPage(Number(e.target.value) || 50);
              setPage(1);
            }}
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
          <div className="ml-auto text-sm text-gray-600">
            Wyniki: {filtered.length} • Strona {pageSafe}/{totalPages}
          </div>
        </div>

        <table className="table w-full">
          <thead>
            <tr>
              <th className="text-center" scope="col">
                <input
                  type="checkbox"
                  checked={
                    pageSlice.length > 0 &&
                    pageSlice.every((i) => selected.includes(i.filename))
                  }
                  onChange={toggleSelectAllOnPage}
                  aria-label="Zaznacz wszystkie na stronie"
                />
              </th>
              <th className="whitespace-nowrap" scope="col">
                #
              </th>
              <th className="whitespace-normal" scope="col">
                Klient
              </th>
              <th className="whitespace-nowrap text-right" scope="col">
                Brutto
              </th>
              <th className="whitespace-nowrap text-center" scope="col">
                Wystawiono
              </th>
              <th className="whitespace-nowrap text-center" scope="col">
                Termin
              </th>
              <th className="whitespace-nowrap text-center" scope="col">
                Status
              </th>
              <th className="whitespace-nowrap text-center" scope="col">
                Akcje
              </th>
            </tr>
          </thead>
          <tbody>
            {pageSlice.map((inv, idx) => {
              const indexInAll = invoices.indexOf(inv);
              return (
                <tr key={`${inv.number}-${idx}`} className="hover:bg-gray-50">
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={selected.includes(inv.filename)}
                      onChange={() =>
                        setSelected((prev) =>
                          prev.includes(inv.filename)
                            ? prev.filter((f) => f !== inv.filename)
                            : [...prev, inv.filename]
                        )
                      }
                      aria-label={`Zaznacz ${inv.number}`}
                    />
                  </td>
                  <td className="whitespace-nowrap">{inv.number}</td>
                  <td className="whitespace-normal">{inv.client}</td>
                  <td className="text-right whitespace-nowrap">
                    {inv.gross} zł
                  </td>
                  <td className="text-center whitespace-nowrap">
                    {inv.issueDate}
                  </td>
                  <td className="text-center whitespace-nowrap">
                    {inv.dueDate}
                  </td>
                  <td className="text-center whitespace-nowrap">
                    <select
                      className={`input w-40 text-center font-medium rounded-md border ${
                        (inv.status || "issued") === "paid"
                          ? "bg-green-100 text-green-800 border-green-200"
                          : (inv.status || "issued") === "overdue"
                          ? "bg-rose-100 text-rose-800 border-rose-200"
                          : "bg-amber-100 text-amber-900 border-amber-200"
                      }`}
                      value={inv.status || "issued"}
                      onChange={(e) => updateStatus(inv, e.target.value)}
                      title="Zmień status"
                    >
                      <option value="issued">wystawiona</option>
                      <option value="paid">opłacona</option>
                      <option value="overdue">przeterminowana</option>
                    </select>
                  </td>
                  <td className="text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <IconButton
                        title={`Edytuj ${inv.number}`}
                        onClick={() => startEdit(inv, indexInAll)}
                        variant="secondary"
                      >
                        <IconPencil />
                      </IconButton>

                      <IconButton
                        title={`Podgląd ${inv.number}`}
                        onClick={() => openPreviewNoCache(inv)}
                        variant="secondary"
                      >
                        <IconEye />
                      </IconButton>

                      <IconButton
                        title={`Pobierz ${inv.number}`}
                        onClick={() => downloadInvoiceNoCache(inv)}
                        variant="secondary"
                      >
                        <IconDownload />
                      </IconButton>

                      <IconButton
                        title={`Usuń ${inv.number}`}
                        onClick={() => askDelete(inv)}
                        variant="danger"
                      >
                        <IconTrash />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pageSlice.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-6 text-gray-500">
                  Brak wyników.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={pageSafe <= 1}
          >
            ←
          </button>
          <div className="text-sm">
            Strona {pageSafe} z {totalPages}
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={pageSafe >= totalPages}
          >
            →
          </button>
        </div>
      </div>

      {/* Delete modal */}
      <ConfirmModal
        open={confirmOpen}
        title="Potwierdź usunięcie"
        message={
          toDelete?.list === "bulk"
            ? "Czy na pewno chcesz usunąć zaznaczone faktury?"
            : `Czy na pewno chcesz usunąć fakturę ${
                toDelete?.one?.number || ""
              }?`
        }
        onCancel={() => {
          setConfirmOpen(false);
          setToDelete(null);
        }}
        onConfirm={confirmDelete}
      />

      {/* Модальне прев’ю */}
      {USE_BUILTIN_PREVIEW_MODAL && (
        <PreviewModal
          open={preview.open}
          src={preview.src}
          onClose={() => setPreview({ open: false, src: "" })}
        />
      )}

      {!USE_BUILTIN_PREVIEW_MODAL && preview.open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-lg w-full max-w-5xl h-[85vh] flex flex-col">
            <div className="p-3 flex items-center justify-between border-b">
              <div className="font-semibold text-sm">
                Podgląd: {preview.src.split("/").pop()}
              </div>
              <div className="flex gap-2">
                <a
                  className="btn-secondary"
                  href={preview.src}
                  target="_blank"
                  rel="noreferrer"
                >
                  Otwórz w nowej karcie
                </a>
                <button
                  className="btn-primary"
                  onClick={() => setPreview({ open: false, src: "" })}
                >
                  Zamknij
                </button>
              </div>
            </div>
            <iframe
              key={preview.src}
              src={preview.src}
              title="Podgląd faktury"
              className="flex-1 w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
