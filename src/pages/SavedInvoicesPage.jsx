// src/pages/SavedInvoicesPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, apiFetch } from "../utils/api";
import servicesSeed from "../../data/services.json";

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

/* ====== Узгоджений IconButton ====== */
const IconButton = ({ title, onClick, variant = "secondary", children }) => {
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

/* ====== № фактури: парсер і сортування ====== */
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

const shortInvNumber = (no) => String(no || "").split("/")[0] || "";

/* ====== money helpers ====== */
const to2 = (x) => Number(x || 0).toFixed(2);

const pl2 = (n) => {
  const v = Number(String(n ?? 0).replace(",", "."));
  return Number.isFinite(v) ? v.toFixed(2).replace(".", ",") : "0,00";
};
const parsePL = (s) => {
  const v = Number(
    String(s ?? "")
      .trim()
      .replace(/\s+/g, "")
      .replace(",", ".")
  );
  return Number.isFinite(v) ? v : 0;
};

const fmtPLN = (n) => `${pl2(n)} PLN`;

/* ====== перерахунок позиції ====== */
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

/* ====== уніфікація шляхів до файлів ====== */
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

/* ✅ НОВЕ: “поза абонементом” від Steryl NN */
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
    if (EXTRA_RE.test(name)) return { ...it, price_gross: perPackageGross };
    return it;
  });
}

/* ========= адреса ========= */
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

/* ====== НОВЕ: ефективний статус з автопротермінуванням ====== */
const effectiveStatusOf = (inv) => {
  const stored = String(inv.status || "issued");
  if (stored === "paid") return "paid";
  const due = String(inv.dueDate || "").slice(0, 10);
  const today = todayISO();
  if (due && due < today) return "overdue";
  return stored;
};
function StatusDotMenu({ value, effective, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const onDoc = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const eff = effective || value;

  const dotClass =
    eff === "paid"
      ? "bg-green-500"
      : eff === "overdue"
      ? "bg-rose-500"
      : "bg-amber-500";

  const options = [
    { k: "issued", label: "wystawiona", dot: "bg-amber-500" },
    { k: "paid", label: "opłacona", dot: "bg-green-500" },
    { k: "overdue", label: "przeterminowana", dot: "bg-rose-500" },
  ];

  const title =
    effective && effective !== value
      ? "Status nadpisany automatycznie (przeterminowana)"
      : "Zmień status";

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        className="inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-md border bg-white hover:bg-gray-50 text-xs"
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-label="Zmień status"
      >
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${dotClass}`} />
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 w-36 rounded-xl border bg-white shadow-lg p-1 z-50">
          {options.map((o) => (
            <button
              key={o.k}
              type="button"
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm hover:bg-gray-50 ${
                o.k === value ? "bg-gray-50" : ""
              }`}
              onClick={() => {
                onChange?.(o.k);
                setOpen(false);
              }}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${o.dot}`} />
              <span className="text-left">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SavedInvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [preview, setPreview] = useState({ open: false, src: "" });

  const [servicesCatalog, setServicesCatalog] = useState({});
  const [servicesDict, setServicesDict] = useState([]);

  const [searchClient, setSearchClient] = useState("");
  const [searchNumber, setSearchNumber] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [perPage, setPerPage] = useState(200);
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingOriginalNumber, setEditingOriginalNumber] = useState(null);
  const [editingOriginalFilename, setEditingOriginalFilename] = useState(null);

  const [form, setForm] = useState({
    number: "",
    client: "",
    buyer_nip: "",
    buyer_pesel: "",
    buyer_kind: "firma",
    buyer_address: "",
    buyer_street: "",
    buyer_postal: "",
    buyer_city: "",
    issueDate: todayISO(),
    dueDate: plusDaysISO(todayISO(), 7),
    status: "issued",
    payment_method: "transfer",
    items: [{ name: "", qty: 1, price_gross: 0, vat_rate: 23 }],
  });

  const [duePreset, setDuePreset] = useState("7");
  const [dueCustomDays, setDueCustomDays] = useState(7);

  const getDueDays = () => {
    const d =
      duePreset === "custom"
        ? Number(dueCustomDays || 0)
        : Number(duePreset || 0);
    return Number.isFinite(d) && d >= 0 ? d : 7;
  };

  const applyDueFromIssue = (issueISO) => {
    const days = getDueDays();
    setForm((f) => ({
      ...f,
      dueDate: plusDaysISO(issueISO || f.issueDate, days),
    }));
  };

  const inferDuePresetFromDates = (issueISO, dueISO) => {
    const a = issueISO ? new Date(issueISO) : null;
    const b = dueISO ? new Date(dueISO) : null;
    if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
      setDuePreset("7");
      setDueCustomDays(7);
      return;
    }
    const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
    if (diff === 1 || diff === 3 || diff === 7) {
      setDuePreset(String(diff));
      setDueCustomDays(diff);
    } else {
      setDuePreset("custom");
      setDueCustomDays(diff >= 0 ? diff : 7);
    }
  };

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const formRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch("/invoices");
        const data = await r.json();
        const arr = Array.isArray(data) ? data : [];
        arr.sort(sortByNumberDesc);
        setInvoices(arr);

        let catalog = {};
        try {
          const list = Array.isArray(servicesSeed) ? servicesSeed : [];
          for (const s of list) {
            const name = String(s?.name || "").trim();
            if (!name) continue;
            catalog[name] = {
              price_gross: Number(s?.price_gross ?? 0) || 0,
              vat_rate: Number(s?.vat_rate ?? 23) || 23,
            };
          }
        } catch {}

        setServicesCatalog(catalog);
        setServicesDict(Object.keys(catalog).sort());
      } catch {}

      apiFetch("/clients")
        .then((r) => r.json())
        .then((data) => setClients(Array.isArray(data) ? data : []));
    })();
  }, []);

  useEffect(() => {
    if (!preview.open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setPreview({ open: false, src: "" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview.open]);

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

  const handleClientChange = (val) => {
    const v = String(val ?? "");

    setForm((f) => ({
      ...f,
      client: v,
      buyer_address: "",
      buyer_street: "",
      buyer_postal: "",
      buyer_city: "",
      buyer_nip: "",
      buyer_pesel: "",
    }));

    const found =
      clients.find(
        (c) => (c.name || c.Klient || "").trim() === String(v).trim()
      ) || null;

    if (!found) return;

    const isFirma =
      String(found.type || found["Firma - OP"] || "op").toLowerCase() ===
      "firma";
    const nip = found.nip || found.NIP || "";
    const pesel = found.pesel || found.Pesel || "";
    const address = found.address || found.Adres || "";

    const { street, postal, city } = splitAddress(address);

    setForm((f) => ({
      ...f,
      client: v,
      buyer_kind: isFirma ? "firma" : "op",
      buyer_address: address || joinAddress(street, postal, city),
      buyer_street: street,
      buyer_postal: postal,
      buyer_city: city,
      buyer_nip: isFirma ? nip : "",
      buyer_pesel: !isFirma ? pesel : "",
    }));
  };

  const onChangeNip = (v) =>
    setForm((f) => ({
      ...f,
      buyer_nip: v,
      buyer_pesel: v ? "" : f.buyer_pesel,
    }));

  const onChangePesel = (v) =>
    setForm((f) => ({ ...f, buyer_pesel: v, buyer_nip: v ? "" : f.buyer_nip }));

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
      if (to) to.setDate(to.getDate() + 1);

    }
    return invoices.filter((inv) => {
      const rawDate =
        inv.createdAt || inv.created_at || inv.created || inv.issueDate;
      const d = rawDate ? new Date(rawDate) : null;
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

      const eff = effectiveStatusOf(inv);
      const okStatus = statusFilter === "all" ? true : eff === statusFilter;

      return okName && okNo && okStatus;
    });
  }, [filteredByDate, searchClient, searchNumber, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageSafe = Math.min(page, totalPages);
  const pageSlice = filtered.slice(
    (pageSafe - 1) * perPage,
    pageSafe * perPage
  );

  const toggleSelectAllOnPage = () => {
    const pageFiles = pageSlice.map((i) => i.filename).filter(Boolean);

    const allSelected = pageFiles.every((f) => selected.includes(f));
    if (allSelected)
      setSelected(selected.filter((f) => !pageFiles.includes(f)));
    else setSelected(Array.from(new Set([...selected, ...pageFiles])));
  };

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
    const r = await apiFetch("/download-multiple", {
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

  const bulkExportEPPAndListPDF = async () => {
    if (!selected.length) return alert("Nie wybrano żadnych faktur.");
    console.log("[UI] bulkExportEPPAndListPDF start, selected =", selected);
    try {
      const body = JSON.stringify({ files: selected });

      const eppReq = apiFetch("/export-epp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }).then(async (r) => {
        if (!r.ok) throw new Error("Błąd eksportu .epp");
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "export.epp";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      });

      const pdfReq = apiFetch("/export-invoice-list-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }).then(async (r) => {
        if (!r.ok) throw new Error("Błąd generowania PDF listy");
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "lista_faktur.pdf";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      });

      await Promise.all([eppReq, pdfReq]);
    } catch (e) {
      alert(e?.message || "Nie udało się wyeksportować (.epp + PDF).");
    }
  };

  const openPreviewNoCache = (inv) => {
    const base = previewSrcFor(inv);
    const url = `${base}${base.includes("?") ? "&" : "?"}r=${Date.now()}`;
    setPreview({ open: true, src: url });
  };

  const downloadInvoiceNoCache = async (inv) => {
    try {
      const base = downloadHrefFor(inv);
      const url = `${base}${base.includes("?") ? "&" : "?"}r=${Date.now()}`;
      const resp = await apiFetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
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
      const fallback = `${downloadHrefFor(inv)}&r=${Date.now()}`;
      window.open(fallback, "_blank", "noopener,noreferrer");
    }
  };

  const startEdit = (inv, idxInAll) => {
    setEditingIndex(idxInAll);
    setEditingOriginalNumber(inv.number || "");
    setEditingOriginalFilename(inv.filename || "");

    const idParsed = parseBuyerIdentifier(inv.buyer_identifier || "");
    let buyerAddress =
      inv.buyer_address ||
      inv.address ||
      (inv.buyer && inv.buyer.address) ||
      "";
    let buyerNip = inv.buyer_nip || idParsed.nip || "";
    let buyerPesel = inv.buyer_pesel || idParsed.pesel || "";

    let buyerStreet = inv.buyer_street || "";
    let buyerPostal = inv.buyer_postal || "";
    let buyerCity = inv.buyer_city || "";
    if (!buyerStreet && !buyerPostal && !buyerCity) {
      const parsed = splitAddress(buyerAddress);
      buyerStreet = parsed.street;
      buyerPostal = parsed.postal;
      buyerCity = parsed.city;
    }

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
      buyer_kind: buyerNip ? "firma" : "op",
      buyer_address:
        buyerAddress || joinAddress(buyerStreet, buyerPostal, buyerCity),
      buyer_street: buyerStreet,
      buyer_postal: buyerPostal,
      buyer_city: buyerCity,
      issueDate: inv.issueDate || todayISO(),
      dueDate: inv.dueDate || plusDaysISO(inv.issueDate || todayISO(), 7),
      payment_method: inv.payment_method || inv.paymentMethod || "transfer",
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
    inferDuePresetFromDates(clone.issueDate, clone.dueDate);
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
    try {
      if (toDelete.list === "bulk" && Array.isArray(toDelete.filenames)) {
        await Promise.all(
          toDelete.filenames.map((fn) =>
            apiFetch(`/invoices/by-filename/${encodeURIComponent(fn)}`, {
              method: "DELETE",
              headers: { "x-confirm-action": "delete-invoice" },
            })
          )
        );
      } else if (toDelete.one) {
        const fn = toDelete.one.filename;
        await apiFetch(`/invoices/by-filename/${encodeURIComponent(fn)}`, {
          method: "DELETE",
          headers: { "x-confirm-action": "delete-invoice" },
        });
        
      }
    } catch (e) {
      alert("Błąd usuwania faktury.");
    } finally {
      setConfirmOpen(false);
      setToDelete(null);
      setSelected([]);
      try {
        const r = await apiFetch("/invoices", { cache: "no-store" });
        const data = await r.json();
        const arr = Array.isArray(data) ? data : [];
        arr.sort(sortByNumberDesc);
        setInvoices(arr);
      } catch {}
    }
  };

  const updateStatus = async (inv, newStatus) => {
    try {
      await apiFetch(`/invoices/${encodeURIComponent(inv.number || "")}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-update-status-only": "1",
        },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (e) {}

    try {
      const r = await apiFetch("/invoices", { cache: "no-store" });
      const data = await r.json();
      const arr = Array.isArray(data) ? data : [];
      arr.sort(sortByNumberDesc);
      setInvoices(arr);
    } catch (e) {
      setInvoices((prev) => {
        const next = prev.map((i) =>
          i === inv ? { ...i, status: newStatus } : i
        );
        next.sort(sortByNumberDesc);
        return next;
      });
    }
  };

  const updateItemField = (idx, key, val) =>
    setForm((f) => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [key]: val };
      return { ...f, items };
    });

  const updateItemNameAndAutofill = (idx, name) => {
    setForm((f) => {
      const items = [...f.items];
      const current = { ...items[idx], name };
      const rec = servicesCatalog[String(name || "").trim()];
      if (rec) {
        current.price_gross = Number(rec.price_gross || 0);
        current.vat_rate = Number(rec.vat_rate || 23);
      }
      items[idx] = current;
      return { ...f, items };
    });
  };

  const addItemRow = () =>
    setForm((f) => ({
      ...f,
      items: [...f.items, { name: "", qty: 1, price_gross: 0, vat_rate: 23 }],
    }));
  const removeItemRow = (idx) =>
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

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

    const buyer_address_joined = joinAddress(
      form.buyer_street,
      form.buyer_postal,
      form.buyer_city
    );

    const payload = {
      ...form,
      buyer_address: buyer_address_joined || form.buyer_address || "",
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
      net: Number(to2(totals.net)),
      gross: Number(to2(totals.gross)),
    };

    const conflict = invoices.some((inv) => {
      const sameNumber =
        String(inv.number || "").trim() === String(payload.number || "").trim();
      const isSelfByOldNo =
        String(inv.number || "").trim() ===
        String(editingOriginalNumber || "").trim();
      return sameNumber && !isSelfByOldNo;
    });
    if (conflict) {
      alert(`Faktura o numerze "${payload.number}" już istnieje. Zmień numer.`);
      return;
    }

    try {
      if (editingIndex != null) {
        const oldNo =
          editingOriginalNumber || invoices[editingIndex]?.number || "";
        const oldFn =
          editingOriginalFilename || invoices[editingIndex]?.filename || "";

        if (payload.number && payload.number !== oldNo) {
          payload.filename = `Faktura_${String(payload.number).replaceAll(
            "/",
            "_"
          )}.pdf`;
          payload.oldNumber = oldNo;
          payload.oldFilename = oldFn;
          payload._renumber = true;
        }

        await apiFetch(`/invoices/${encodeURIComponent(oldNo)}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-allow-renumber": "1",
          },
          body: JSON.stringify(payload),
        });

        const r = await apiFetch("/invoices", { cache: "no-store" });
        const data = await r.json();
        const arr = Array.isArray(data) ? data : [];
        arr.sort(sortByNumberDesc);
        setInvoices(arr);

        setFormOpen(false);
        setEditingIndex(null);
        setEditingOriginalNumber(null);
        setEditingOriginalFilename(null);
      } else {
        const n = payload.number || suggestNextNumber(payload.issueDate);
        payload.number = n;
        payload.filename = `Faktura_${String(n).replaceAll("/", "_")}.pdf`;

        const next = [payload, ...invoices].sort(sortByNumberDesc);
        setInvoices(next);

        await apiFetch("/save-invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });

        setFormOpen(false);
        setEditingIndex(null);
        setEditingOriginalNumber(null);
        setEditingOriginalFilename(null);
      }
    } catch (e) {
      alert("Nie udało się zapisać faktury.");
    }
  };

  const clientNames = useMemo(
    () =>
      Array.from(
        new Set(clients.map((c) => c.name || c.Klient || "").filter(Boolean))
      ),
    [clients]
  );

  const openNewForm = () => {
    const baseDate = todayISO();
    setDuePreset("7");
    setDueCustomDays(7);
    const suggestedNo = suggestNextNumber(baseDate);
    setEditingIndex(null);
    setEditingOriginalNumber(null);

    setForm({
      number: suggestedNo,
      client: "",
      buyer_nip: "",
      buyer_pesel: "",
      buyer_kind: "firma",
      buyer_address: "",
      buyer_street: "",
      buyer_postal: "",
      buyer_city: "",
      issueDate: baseDate,
      dueDate: plusDaysISO(baseDate, 7),
      payment_method: "transfer",
      status: "issued",
      items: [{ name: "", qty: 1, price_gross: 0, vat_rate: 23 }],
    });
    setFormOpen(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditingIndex(null);
    setEditingOriginalNumber(null);
    setEditingOriginalFilename(null);
  };

  const toggleNewForm = () => {
    if (formOpen) closeForm();
    else openNewForm();
  };

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

  return (
    <div className="w-full mx-auto px-2 sm:px-3 md:px-5 lg:px-6 space-y-4 psl-page">
      <section className="psl-container">
        <div className="card-lg border-2 border-blue-200 bg-blue-50/60 space-y-3 min-w-0 w-full max-w-full">
          <h1 className="text-2xl font-bold">Wystawione faktury</h1>

          <div className="flex flex-col sm:flex-row sm:flex-wrap md:hidden gap-3 w-full min-w-0">
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <div className="w-full flex flex-col gap-2">
                <input
                  className="input w-full"
                  placeholder="Szukaj po kliencie"
                  value={searchClient}
                  onChange={(e) => {
                    setSearchClient(e.target.value);
                    setPage(1);
                  }}
                />
                <input
                  className="input w-full"
                  placeholder="Szukaj po numerze"
                  value={searchNumber}
                  onChange={(e) => {
                    setSearchNumber(e.target.value);
                    setPage(1);
                  }}
                />
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-sm mb-1">Data</label>
                    <select
                      className="input w-full"
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
                  <div className="flex-1">
                    <label className="block text-sm mb-1">Status</label>
                    <select
                      className="input w-full"
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
                </div>
                {dateFilter === "custom" && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      className="input w-full"
                      value={customFrom}
                      onChange={(e) => {
                        setCustomFrom(e.target.value);
                        setPage(1);
                      }}
                    />
                    <input
                      type="date"
                      className="input w-full"
                      value={customTo}
                      onChange={(e) => {
                        setCustomTo(e.target.value);
                        setPage(1);
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-primary flex-1 min-w-[140px]"
                  onClick={toggleNewForm}
                >
                  {formOpen ? "Zamknij formularz" : "Dodaj fakturę"}
                </button>

                <button
                  className="btn-primary flex-1 min-w-[140px]"
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
              </div>
            </div>

            <div className="flex flex-col gap-2 w-full sm:w-auto sm:items-end min-w-0">
              <div className="flex gap-2 w-full">
                <button
                  className="btn-primary flex-1 basis-1/2 justify-center"
                  title="Pobierz wybrane (ZIP)"
                  onClick={bulkDownloadZip}
                  disabled={!selected.length}
                >
                  ZIP
                </button>
                <button
                  className="btn-primary flex-1 basis-1/2 justify-center"
                  onClick={bulkExportEPPAndListPDF}
                  disabled={!selected.length}
                  title="Eksport .epp + PDF lista"
                  aria-label="Eksport EPP + PDF"
                >
                  .epp + PDF
                </button>
              </div>
              <button
                className="btn-danger w-full justify-center"
                title="Usuń zaznaczone"
                onClick={bulkDelete}
                disabled={!selected.length}
              >
                Usuń zaznaczone
              </button>
            </div>
          </div>

          <div className="hidden md:flex flex-wrap gap-3 items-end min-w-0 w-full">
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
          </div>

          <div className="hidden md:flex items-center gap-2 flex-wrap min-w-0 w-full max-w-full">
            <button
              className="btn-primary justify-center"
              onClick={toggleNewForm}
            >
              {formOpen ? "Zamknij formularz" : "Dodaj fakturę"}
            </button>

            <div className="flex items-center gap-2 flex-wrap justify-end ml-auto min-w-0">
              <button
                className="btn-primary justify-center"
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

              <div className="flex gap-2 flex-wrap items-center justify-end min-w-0">
                <button
                  className="btn-primary justify-center"
                  title="Pobierz wybrane (ZIP)"
                  onClick={bulkDownloadZip}
                  disabled={!selected.length}
                >
                  ZIP
                </button>
                <button
                  className="btn-primary justify-center"
                  onClick={bulkExportEPPAndListPDF}
                  disabled={!selected.length}
                  title="Eksport .epp + PDF lista"
                  aria-label="Eksport EPP + PDF"
                >
                  .epp + PDF
                </button>
                <button
                  className="btn-danger justify-center"
                  title="Usuń zaznaczone"
                  onClick={bulkDelete}
                  disabled={!selected.length}
                >
                  Usuń zaznaczone
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {formOpen && (
        <section className="psl-container" ref={formRef}>
          <div className="card-lg" onKeyDown={onFormKeyDown}>
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

              <div className="grid grid-cols-2 gap-3 md:col-span-2">
                <div>
                  <label className="block text-sm mb-1">Typ klienta</label>

                  <div className="rounded-lg border bg-white px-3 py-2 flex flex-col gap-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="radio"
                        name="buyer_kind"
                        value="firma"
                        checked={(form.buyer_kind || "firma") === "firma"}
                        onChange={() => {
                          setForm((f) => ({
                            ...f,
                            buyer_kind: "firma",
                            buyer_pesel: "",
                          }));
                        }}
                      />
                      <span>Firma</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="radio"
                        name="buyer_kind"
                        value="op"
                        checked={(form.buyer_kind || "firma") === "op"}
                        onChange={() => {
                          setForm((f) => ({
                            ...f,
                            buyer_kind: "op",
                            buyer_nip: "",
                          }));
                        }}
                      />
                      <span>Osoba prywatna</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm mb-1">
                    {(form.buyer_kind || "firma") === "firma" ? "NIP" : "PESEL"}
                  </label>
                  <input
                    className="input w-full"
                    value={
                      (form.buyer_kind || "firma") === "firma"
                        ? form.buyer_nip
                        : form.buyer_pesel
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => {
                        const kind = f.buyer_kind || "firma";
                        return kind === "firma"
                          ? { ...f, buyer_nip: v, buyer_pesel: "" }
                          : { ...f, buyer_pesel: v, buyer_nip: "" };
                      });
                    }}
                    placeholder={
                      (form.buyer_kind || "firma") === "firma"
                        ? "Wpisz NIP"
                        : "Wpisz PESEL"
                    }
                  />
                </div>
              </div>

              <div className="md:col-span-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-sm mb-1">Adres</label>
                  <input
                    className="input w-full"
                    placeholder="Ulica 1/2"
                    value={form.buyer_street}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, buyer_street: e.target.value }))
                    }
                  />
                </div>

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
                  <label className="block text-sm mb-1">Miejscowość</label>
                  <input
                    className="input w-full"
                    placeholder="Kraków"
                    value={form.buyer_city}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, buyer_city: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="md:col-span-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm mb-1">
                    Data wystawienia *
                  </label>
                  <input
                    type="date"
                    className="input w-full"
                    value={form.issueDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => ({
                        ...f,
                        issueDate: v,
                        dueDate: plusDaysISO(v, getDueDays()),
                        number: f.number || suggestNextNumber(v),
                      }));
                    }}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1">
                    Termin płatności (dni)
                  </label>
                  <select
                    className="input w-full"
                    value={duePreset}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDuePreset(v);
                      if (v !== "custom") {
                        const days = Number(v || 7);
                        setDueCustomDays(days);
                        setForm((f) => ({
                          ...f,
                          dueDate: plusDaysISO(f.issueDate, days),
                        }));
                      } else {
                        setForm((f) => ({
                          ...f,
                          dueDate: plusDaysISO(
                            f.issueDate,
                            Number(dueCustomDays || 7)
                          ),
                        }));
                      }
                    }}
                  >
                    <option value="1">1</option>
                    <option value="3">3</option>
                    <option value="7">7</option>
                    <option value="custom">Inny</option>
                  </select>

                  {duePreset === "custom" && (
                    <input
                      type="number"
                      min="0"
                      className="input w-full mt-2"
                      value={dueCustomDays}
                      onChange={(e) => {
                        const d = Number(e.target.value || 0);
                        setDueCustomDays(d);
                        setForm((f) => ({
                          ...f,
                          dueDate: plusDaysISO(f.issueDate, d),
                        }));
                      }}
                      placeholder="np. 14"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-sm mb-1">
                    Termin płatności *
                  </label>
                  <input
                    type="date"
                    className="input w-full"
                    value={form.dueDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => ({ ...f, dueDate: v }));
                      inferDuePresetFromDates(form.issueDate, v);
                    }}
                    required
                  />
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm mb-1">Status</label>
              <select
                className={`input w-full md:w-64 text-center font-medium rounded-md border ${
                  effectiveStatusOf(form) === "paid"
                    ? "bg-green-100 text-green-800 border-green-200"
                    : effectiveStatusOf(form) === "overdue"
                    ? "bg-rose-100 text-rose-800 border-rose-200"
                    : "bg-amber-100 text-amber-900 border-amber-200"
                }`}
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value }))
                }
              >
                <option value="issued">wystawiona</option>
                <option value="paid">opłacona</option>
                <option value="overdue">przeterminowana</option>
              </select>
            </div>

            <div className="mt-4">
              <div className="font-normal text-sm mb-2">
                Pozycje (wszystkie pola wymagane)
              </div>

              <div className="md:hidden space-y-3">
                {form.items.map((it, idx) => {
                  const q = Number(it.qty || 0);
                  const gU = Number(it.price_gross || 0);
                  const v = Number(it.vat_rate || 23);
                  const nU = gU / (1 + v / 100);
                  const g = gU * q;
                  const n = nU * q;
                  const vv = g - n;

                  return (
                    <div
                      key={idx}
                      className="rounded-xl border bg-white p-3 space-y-2"
                    >
                      <div>
                        <label className="block text-sm mb-1">
                          Nazwa towaru / usługi *
                        </label>
                        <input
                          className="input w-full"
                          list="services-list"
                          value={it.name}
                          onChange={(e) =>
                            updateItemNameAndAutofill(idx, e.target.value)
                          }
                          placeholder="Zacznij pisać, aby wybrać…"
                          required
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-sm mb-1">Ilość *</label>
                          <input
                            type="number"
                            min="1"
                            className="input w-full min-w-0 text-center"
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
                        </div>

                        <div>
                          <label className="block text-sm mb-1">VAT % *</label>
                          <select
                            className="input w-full min-w-0 text-right"
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
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-sm mb-1">
                            Cena brutto (szt.) *
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            className="input w-full text-center"
                            value={pl2(it.price_gross)}
                            onChange={(e) =>
                              updateItemField(
                                idx,
                                "price_gross",
                                parsePL(e.target.value)
                              )
                            }
                            required
                          />
                        </div>

                        <div className="rounded-lg bg-gray-50 border px-3 py-2">
                          <div className="text-xs text-gray-600">
                            Wartość brutto
                          </div>
                          <div className="text-right">{pl2(g)}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-gray-50 border px-3 py-2">
                          <div className="text-xs text-gray-600">
                            Wartość netto
                          </div>
                          <div className="text-right">{pl2(n)}</div>
                        </div>
                        <div className="rounded-lg bg-gray-50 border px-3 py-2">
                          <div className="text-xs text-gray-600">
                            Wartość VAT
                          </div>
                          <div className="text-right">{pl2(vv)}</div>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="btn-danger px-3 py-2 text-white"
                          onClick={() => removeItemRow(idx)}
                          title="Usuń pozycję"
                          aria-label={`Usuń pozycję ${idx + 1}`}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="table w-full table-fixed [&_th]:align-middle [&_td]:align-middle">
                  <colgroup>
                    <col style={{ width: "26%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "6%" }} />
                  </colgroup>

                  <thead>
                    <tr className="text-xs font-normal">
                      <th className="text-left">Nazwa towaru / usługi *</th>
                      <th className="text-center">Ilość *</th>
                      <th className="text-right">Cena brutto (szt.) *</th>
                      <th className="text-center">VAT % *</th>
                      <th className="text-right">Wartość netto</th>
                      <th className="text-right">Wartość VAT</th>
                      <th className="text-right">Wartość brutto</th>
                      <th className="text-center">—</th>
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
                          <td className="align-middle min-w-0 overflow-hidden">
                            <input
                              className="input w-full min-w-0"
                              list="services-list"
                              value={it.name}
                              onChange={(e) =>
                                updateItemNameAndAutofill(idx, e.target.value)
                              }
                              placeholder="Zacznij pisać, aby wybrać…"
                              required
                            />
                          </td>

                          <td className="text-center align-middle overflow-hidden">
                            <input
                              type="number"
                              min="1"
                              className="input w-full min-w-0 text-right"
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

                          <td className="text-right align-middle overflow-hidden">
                            <input
                              type="text"
                              inputMode="decimal"
                              className="input w-full min-w-0 text-center"
                              value={pl2(it.price_gross)}
                              onChange={(e) =>
                                updateItemField(
                                  idx,
                                  "price_gross",
                                  parsePL(e.target.value)
                                )
                              }
                              required
                            />
                          </td>

                          <td className="text-center align-middle overflow-hidden">
                            <select
                              className="input w-full min-w-0 text-right"
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

                          <td className="text-right align-middle whitespace-nowrap overflow-hidden text-ellipsis">
                            {pl2(n)}
                          </td>
                          <td className="text-right align-middle whitespace-nowrap overflow-hidden text-ellipsis">
                            {pl2(vv)}
                          </td>
                          <td className="text-right align-middle whitespace-nowrap overflow-hidden text-ellipsis">
                            {pl2(g)}
                          </td>

                          <td className="text-center align-middle overflow-hidden">
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
              </div>

              <datalist id="services-list">
                {servicesDict.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>

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
                    <div className="inline-block text-left">
                      <div>
                        Razem netto: <b>{pl2(totals.net)}</b>
                      </div>
                      <div>
                        Razem VAT: <b>{pl2(vat)}</b>
                      </div>
                      <div>
                        Razem brutto: <b>{pl2(totals.gross)}</b>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="mt-4 grid md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="block text-sm mb-1">Forma płatności</label>
                <select
                  className="input w-full"
                  value={form.payment_method || "transfer"}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, payment_method: e.target.value }))
                  }
                >
                  <option value="cash">Gotówka</option>
                  <option value="transfer">Przelew</option>
                  <option value="card">Karta</option>
                </select>
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
                  setEditingOriginalNumber(null);
                  setEditingOriginalFilename(null);
                }}
              >
                Anuluj
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="psl-container psl-table-container">
        <div className="card-lg min-w-0 w-full">
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

          <div className="mt-3 w-full">
            <div className="psl-table-scroll">
              <table className="hidden md:table table psl-table invoices-table w-full table-fixed [&_th]:align-middle [&_td]:align-middle">
                <colgroup>
                  <col style={{ width: "4%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "16%" }} />
                </colgroup>

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
                    <th scope="col">#</th>
                    <th className="whitespace-normal" scope="col">
                      Klient
                    </th>
                    <th className="text-center" scope="col">
                      Brutto
                    </th>
                    <th className="text-center" scope="col">
                      Wystawiono
                    </th>
                    <th className="text-center" scope="col">
                      Termin
                    </th>
                    <th className="text-center" scope="col">
                      Status
                    </th>
                    <th className="text-center" scope="col">
                      Akcje
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageSlice.map((inv, idx) => {
                    const indexInAll = invoices.indexOf(inv);
                    const eff = effectiveStatusOf(inv);

                    return (
                      <tr
                        key={`${inv.number}-${idx}`}
                        className="hover:bg-gray-50"
                      >
                        <td className="text-center">
                          <input
                            type="checkbox"
                            checked={selected.includes(inv.filename)}
                            onChange={() => {
                              setSelected((prev) =>
                                prev.includes(inv.filename)
                                  ? prev.filter((f) => f !== inv.filename)
                                  : [...prev, inv.filename]
                              );
                            }}
                            aria-label={`Zaznacz ${inv.number}`}
                          />
                        </td>

                        <td className="whitespace-nowrap overflow-hidden">
                          <div className="truncate">{inv.number}</div>
                        </td>

                        <td className="min-w-0 overflow-hidden">
                          <div className="break-words">{inv.client}</div>
                        </td>

                        <td className="text-right">{fmtPLN(inv.gross)}</td>
                        <td className="text-center">{inv.issueDate}</td>
                        <td className="text-center">{inv.dueDate}</td>

                        <td className="text-center">
                          <div className="flex justify-center min-w-0">
                            <select
                              className={`input w-full max-w-[9.5rem] mx-auto text-center font-medium rounded-md border ${
                                eff === "paid"
                                  ? "bg-green-100 text-green-800 border-green-200"
                                  : eff === "overdue"
                                  ? "bg-rose-100 text-rose-800 border-rose-200"
                                  : "bg-amber-100 text-amber-900 border-amber-200"
                              }`}
                              value={inv.status || "issued"}
                              onChange={(e) =>
                                updateStatus(inv, e.target.value)
                              }
                              title={
                                eff !== (inv.status || "issued")
                                  ? "Status nadpisany automatycznie (przeterminowana)"
                                  : "Zmień status"
                              }
                            >
                              <option value="issued">wystawiona</option>
                              <option value="paid">opłacona</option>
                              <option value="overdue">przeterminowana</option>
                            </select>
                          </div>
                        </td>

                        <td className="text-center">
                          <div className="inline-flex flex-wrap items-center justify-center gap-1">
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
                      <td
                        colSpan={8}
                        className="text-center py-6 text-gray-500"
                      >
                        Brak wyników.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <table className="md:hidden table psl-table invoices-table w-full table-fixed [&_th]:align-middle [&_td]:align-middle">
                <colgroup>
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "46%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "14%" }} />
                </colgroup>

                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th className="whitespace-normal" scope="col">
                      Klient
                    </th>
                    <th className="text-center" scope="col">
                      Status
                    </th>
                    <th className="text-center" scope="col">
                      Akcje
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageSlice.map((inv, idx) => {
                    const eff = effectiveStatusOf(inv);
                    const indexInAll = invoices.indexOf(inv);

                    return (
                      <tr
                        key={`${inv.number}-${idx}`}
                        className="hover:bg-gray-50"
                      >
                        <td>{shortInvNumber(inv.number)}</td>
                        <td className="whitespace-normal">{inv.client}</td>

                        <td className="text-center">
                          <StatusDotMenu
                            value={inv.status || "issued"}
                            effective={eff}
                            onChange={(s) => updateStatus(inv, s)}
                          />
                        </td>

                        <td className="text-center">
                          <div className="inline-flex flex-col items-center justify-center gap-1">
                            <IconButton
                              title={`Pobierz ${inv.number}`}
                              onClick={() => downloadInvoiceNoCache(inv)}
                              variant="secondary"
                            >
                              <IconDownload />
                            </IconButton>

                            <IconButton
                              title={`Edytuj ${inv.number}`}
                              onClick={() => startEdit(inv, indexInAll)}
                              variant="secondary"
                            >
                              <IconPencil />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {pageSlice.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="text-center py-6 text-gray-500"
                      >
                        Brak wyników.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

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
      </section>

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
