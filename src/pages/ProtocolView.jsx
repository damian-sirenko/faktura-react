import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { api, apiFetch, apiJson } from "../utils/api";

/* ===== Helpers ===== */
const getClientName = (c) => String(c?.name || c?.Klient || "").trim() || "—";
const getClientAddress = (c) => {
  const a =
    c?.address ||
    c?.Adres ||
    [
      [c?.street, c?.city].filter(Boolean).join(" "),
      [c?.postal, c?.post || c?.miejscowosc].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join(" ");
  return String(a || "").trim() || "—";
};
const getTaxLabelValue = (c) => {
  const nip =
    c?.nip ?? c?.NIP ?? c?.vat ?? c?.VAT ?? c?.taxId ?? c?.TaxId ?? null;
  const pesel = c?.pesel ?? c?.PESEL ?? null;
  if (nip) return { label: "NIP", value: String(nip).trim() };
  if (pesel) return { label: "PESEL", value: String(pesel).trim() };
  return { label: "NIP/PESEL", value: "—" };
};

const toClientId = (c) =>
  c?.id ||
  c?.ID ||
  String(c?.name || c?.Klient || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/* Абсолютний URL для підписів (бо бек на 3000, фронт на 5173) */
const absSig = (src) =>
  typeof src === "string" && src.startsWith("/signatures/") ? api(src) : src;

function iso10(v) {
  if (!v) return "";
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}
function iso10Local(v) {
  if (!v) return "";
  if (v instanceof Date && !isNaN(v)) {
    const Y = v.getFullYear();
    const M = String(v.getMonth() + 1).padStart(2, "0");
    const D = String(v.getDate()).padStart(2, "0");
    return `${Y}-${M}-${D}`;
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, "0");
    const D = String(d.getDate()).padStart(2, "0");
    return `${Y}-${M}-${D}`;
  }
  const s10 = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s10) ? s10 : "";
}
const plDate = (iso) => {
  const s = iso10Local(iso);
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
};

/* ==== робочі дні (UTC-safe) ==== */
const parseISO = (iso) => {
  const [y, m, d] = String(iso || "")
    .split("-")
    .map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
};
const fmtISO = (d) => d.toISOString().slice(0, 10);

function isWeekendISO(iso) {
  const wd = parseISO(iso).getUTCDay();
  return wd === 0 || wd === 6;
}
function addDaysISO(iso, days) {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtISO(d);
}
function nextBusinessDay(iso) {
  let next = addDaysISO(iso, 1);
  while (isWeekendISO(next)) next = addDaysISO(next, 1);
  return next;
}
function normalizeToBusinessDay(iso) {
  if (!iso) return iso;
  let d = iso;
  while (isWeekendISO(d)) d = addDaysISO(d, 1);
  return d;
}

// Місяці PL
const MONTHS_PL = [
  "styczeń",
  "luty",
  "marzec",
  "kwiecień",
  "maj",
  "czerwiec",
  "lipiec",
  "sierpień",
  "wrzesień",
  "październik",
  "listopad",
  "grudzień",
];
const ymToLabel = (ym) => {
  const [y, m] = (ym || "").split("-");
  const name = MONTHS_PL[(Number(m) || 1) - 1] || m || "—";
  return { y: y || "rrrr", m, mWord: name };
};

const serviceLabel = (row) => {
  if (row?.shipping) return "Wysyłka";
  if (row?.delivery === "odbior") return "Kurier x1";
  if (row?.delivery === "odbior+dowoz") return "Kurier x2";
  return "—";
};

function namesEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const an = String(a[i]?.name || "")
      .trim()
      .toLowerCase();
    const bn = String(b[i]?.name || "")
      .trim()
      .toLowerCase();
    if (an !== bn) return false;
  }
  return true;
}
function countsEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ac = Number(a[i]?.count || 0);
    const bc = Number(b[i]?.count || 0);
    if (ac !== bc) return false;
  }
  return true;
}

/* ==== нормалізація місяця ==== */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function normalizeYm(m) {
  const s = String(m || "").trim();
  if (MONTH_RE.test(s)) return s;
  const mm = s.match(/^(\d{4})-(\d{1,2})$/);
  if (mm) {
    const y = mm[1];
    const mo = String(mm[2]).padStart(2, "0");
    if (/^(0[1-9]|1[0-2])$/.test(mo)) return `${y}-${mo}`;
  }
  return "";
}

/* ==== інвентар рядків ==== */
function normalizeTools(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((t) => t && String(t.name || "").trim())
    .map((t) => ({
      name: String(t.name).trim(),
      count: Number(t.count || 0) || 0,
    }));
}

function buildToolLines(row) {
  const norm = (raw) =>
    (Array.isArray(raw) ? raw : [])
      .filter((t) => t && String(t.name || "").trim())
      .map((t) => ({
        name: String(t.name).trim(),
        count: Number(t.count || 0) || 0,
      }));

  const tTools = norm(row.tools);
  const rTools = norm(row.returnTools);

  const rMap = new Map(
    rTools.map((t) => [t.name.toLowerCase(), Number(t.count || 0) || 0])
  );

  const same =
    !rTools.length ||
    (tTools.length === rTools.length &&
      tTools.every(
        (t, i) =>
          t.name.toLowerCase() === rTools[i].name.toLowerCase() &&
          t.count === rTools[i].count
      ));

  const items = tTools.map((t, idx) => {
    const key = t.name.toLowerCase();
    const tQty = t.count;
    let rQty = tQty;
    if (!same) {
      if (rMap.has(key)) rQty = rMap.get(key);
      else if (rTools[idx]) rQty = Number(rTools[idx].count || 0) || 0;
    } else if (rTools[idx]) {
      rQty = Number(rTools[idx].count || tQty) || 0;
    }
    return { name: t.name, tQty, rQty, isSum: false };
  });

  const tPackages = Number(row.packages || 0) || 0;
  const rawRP = row.returnPackages;
  const rPackages =
    rawRP == null || rawRP === "" || Number(rawRP) <= 0
      ? tPackages
      : Number(rawRP) || tPackages;

  items.push({
    name: "Pakiety",
    tQty: tPackages,
    rQty: rPackages,
    isSum: true,
  });
  return items;
}

export default function ProtocolView() {
  const params = useParams();
  const location = useLocation();

  const clientIdParam =
    params.clientId ??
    params.client ??
    params.id ??
    params.cid ??
    params.client_id ??
    params.ClientId ??
    params.ClientID;

  let monthParam =
    params.month ?? params.ym ?? params.yymm ?? params.m ?? params.MM;

  if (!clientIdParam || !monthParam) {
    const qs = new URLSearchParams(location.search || "");
    monthParam =
      monthParam ||
      qs.get("month") ||
      qs.get("ym") ||
      qs.get("yymm") ||
      qs.get("m") ||
      qs.get("MM");
  }

  const clientId = clientIdParam;
  const safeMonth = useMemo(() => normalizeYm(monthParam), [monthParam]);

  const [loading, setLoading] = useState(true);
  const [protocol, setProtocol] = useState(null);
  const [client, setClient] = useState(null);
  const [error, setError] = useState("");

  const [edit, setEdit] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Fetch protocol + client (через apiJson/apiFetch)
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      setEdit({});
      setSelected(new Set());

      if (!clientId || !safeMonth) {
        if (!alive) return;
        setError(
          "Nieprawidłowy adres protokołu (brak ID klienta lub miesiąc w złym formacie)."
        );
        setProtocol(null);
        setClient(null);
        setLoading(false);
        return;
      }

      try {
        const data = await apiJson(
          `/protocols/${encodeURIComponent(clientId)}/${safeMonth}`
        );
        

        if (!alive) return;

        const entries = Array.isArray(data?.entries)
          ? data.entries.map((e) => ({
              ...e,
              date: iso10Local(e?.date),
              returnDate: iso10Local(e?.returnDate),
            }))
          : [];

        setProtocol({
          id: data?.id || clientId,
          month: data?.month || safeMonth,
          entries,
          totals: data?.totals || {
            totalPackages: entries.reduce(
              (a, rr) => a + (Number(rr?.packages || 0) || 0),
              0
            ),
          },
          summarized: !!data?.summarized,
        });
      } catch (e) {
        if (!alive) return;
        setError(
          e?.message?.includes("Unauthorized")
            ? "Sesja wygasła. Zaloguj się ponownie."
            : "Nie udało się załadować protokołu."
        );
        setLoading(false);
        return;
      }

      try {
        const list = (await apiJson("/clients")) || [];

        const found = list.find((c) => toClientId(c) === clientId) || null;
        if (alive) setClient(found);
      } catch {
        if (alive) setClient(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, safeMonth, location.search]);

  const clientName = getClientName(client);
  const clientAddr = getClientAddress(client);
  const { label: taxLabel, value: taxValue } = getTaxLabelValue(client);
  const monthLabel = useMemo(
    () => ymToLabel(protocol?.month),
    [protocol?.month]
  );

  const totalPackages = useMemo(
    () =>
      protocol?.totals?.totalPackages ??
      (protocol?.entries || []).reduce(
        (a, r) => a + (Number(r?.packages || 0) || 0),
        0
      ),
    [protocol]
  );
  const totalTransfers = useMemo(
    () => (protocol?.entries || []).length,
    [protocol]
  );

  const sortedEntries = useMemo(() => {
    const ymd = (s) => {
      const [Y, M, D] = String(s || "")
        .split("-")
        .map((n) => parseInt(n, 10) || 0);
      return Y * 10000 + M * 100 + D;
    };
    return (protocol?.entries || [])
      .map((row, i) => ({ row, origIndex: i }))
      .filter((x) => x.row && x.row.date)
      .sort((a, b) => ymd(a.row.date) - ymd(b.row.date));
  }, [protocol]);

  function startEditRow(origIdx) {
    if (!protocol || !protocol.entries || !protocol.entries[origIdx]) return;
    const row = protocol.entries[origIdx];
    const tTools = (row.tools || []).filter((t) => t?.name);
    const rTools = (row.returnTools || []).filter((t) => t?.name);
    const same =
      !rTools.length ||
      (namesEqual(tTools, rTools) && countsEqual(tTools, rTools));

    const baseCounts = (same ? tTools : rTools).map((t) =>
      Number(t.count || 0)
    );
    const defaultReturn = nextBusinessDay(row.date);

    setEdit((prev) => ({
      ...prev,
      [origIdx]: {
        sameAsTransfer: same,
        counts: baseCounts,
        date: row.returnDate || defaultReturn,
        packages:
          Number(
            row.returnPackages != null ? row.returnPackages : row.packages
          ) || 0,
        saving: false,
        error: "",
      },
    }));

    setTimeout(() => {
      const el = document.getElementById(`row-${origIdx}-0`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  function cancelEditRow(i) {
    setEdit((prev) => {
      const p = { ...prev };
      delete p[i];
      return p;
    });
  }

  function applySameAsTransfer(i) {
    setEdit((prev) => {
      const st = prev[i];
      if (!st) return prev;
      const row = protocol.entries[i];
      const tTools = (row.tools || []).filter((t) => t?.name);
      return {
        ...prev,
        [i]: {
          ...st,
          sameAsTransfer: true,
          counts: tTools.map((t) => Number(t.count || 0)),
          packages: Number(row.packages || 0) || 0,
        },
      };
    });
  }

  async function saveReturn(i) {
    const st = edit[i];
    if (!st) return;
    const row = protocol.entries[i];

    const tTools = (row.tools || []).filter((t) => t?.name);
    const payloadReturnTools = tTools.map((t, idx) => ({
      name: t.name,
      count: st.sameAsTransfer
        ? Number(t.count || 0)
        : Number(st.counts?.[idx] || 0),
    }));

    const chosen = st.date || nextBusinessDay(row.date);
    const safeDate = normalizeToBusinessDay(chosen);

    const body = {
      returnTools: payloadReturnTools,
      returnPackages: Number(st.packages || 0),
      returnDate: safeDate,
    };

    setEdit((prev) => ({ ...prev, [i]: { ...st, saving: true, error: "" } }));
    try {
      const res = await apiFetch(
        `/protocols/${encodeURIComponent(clientId)}/${safeMonth}/${i}`,
        {
          method: "PATCH",
          json: body,
        }
      );
      

      let updated = null;
      try {
        const json = await res.json();
        updated = json?.entry || null;

        if (updated) {
          updated = {
            ...updated,
            returnTools: updated.returnTools ?? body.returnTools,
            returnPackages: updated.returnPackages ?? body.returnPackages,
            returnDate: updated.returnDate ?? body.returnDate,
          };
        }

        if (json?.protocol) {
          setProtocol((prev) => ({
            ...(prev || {}),
            entries: json.protocol.entries || prev.entries,
            totals: json.protocol.totals || prev.totals,
            summarized: prev?.summarized ?? false,
          }));
        }
      } catch {
        // без JSON тіла — локальне оновлення
      }

      setProtocol((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        const arr = [...next.entries];
        if (updated) {
          arr[i] = updated;
        } else {
          arr[i] = {
            ...arr[i],
            returnTools: body.returnTools,
            returnPackages: body.returnPackages,
            returnDate: body.returnDate,
          };
        }
        next.entries = arr;
        return next;
      });

      cancelEditRow(i);
    } catch (e) {
      setEdit((prev) => ({
        ...prev,
        [i]: { ...st, saving: false, error: e.message || "Błąd zapisu" },
      }));
    }
  }

  function toggleSelect(i) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function deleteSelected() {
    if (!protocol) return;
    const idxs = Array.from(selected).sort((a, b) => b - a);
    if (!idxs.length) return;
    setBulkBusy(true);
    try {
      for (const idx of idxs) {
        await apiFetch(
          `/protocols/${encodeURIComponent(clientId)}/${safeMonth}/${idx}`,
          { method: "DELETE" }
        );
        
      }
      const data = await apiJson(
        `/protocols/${encodeURIComponent(clientId)}/${safeMonth}`
      );
      
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      setProtocol({
        id: data?.id || clientId,
        month: data?.month || safeMonth,
        entries,
        totals: data?.totals || {
          totalPackages: entries.reduce(
            (a, rr) => a + (Number(rr?.packages || 0) || 0),
            0
          ),
        },
        summarized: !!data?.summarized,
      });
      clearSelection();
      setEdit({});
    } finally {
      setBulkBusy(false);
    }
  }

  function openPdf(e) {
    e?.preventDefault();
    if (!clientId || !safeMonth) return;

    const base = api(
      `/protocols/${encodeURIComponent(
        clientId
      )}/${safeMonth}/pdf?ts=${Date.now()}`
    );

    const token =
      localStorage.getItem("authToken") ||
      localStorage.getItem("token") ||
      localStorage.getItem("jwt") ||
      sessionStorage.getItem("authToken") ||
      sessionStorage.getItem("token") ||
      "";

    // додаємо токен у query (або спрацює сесійний cookie)
    const href = token ? `${base}&bearer=${encodeURIComponent(token)}` : base;

    // штучне посилання — не блокується попап-блокером
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (loading) {
    return <div className="card p-8 text-center text-gray-500">Ładowanie…</div>;
  }
  if (error) {
    return <div className="card p-8 text-center text-red-600">{error}</div>;
  }
  if (!protocol || !(protocol.entries || []).length) {
    const backHref = location.state?.backTo || "/documents/protocols";
    const backLabel =
      location.state?.backLabel || "← Powrót do listy protokołów";
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Link to={backHref} className="btn-secondary">
            {backLabel}
          </Link>
          <div className="flex-1" />
          <button className="btn-secondary no-print" onClick={openPdf}>
            🖨️ PDF
          </button>
        </div>
        <div className="card p-8 text-center text-gray-500">
          Brak wpisów w tym miesiącu.
        </div>
      </div>
    );
  }

  const backHref = location.state?.backTo || "/documents/protocols";
  const backLabel = location.state?.backLabel || "← Powrót do listy protokołów";

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 overflow-x-hidden">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .sheet { box-shadow: none !important; border: 0 !important; }
        }
        .sheet { font-size: 10px; }
        .proto-table { width: 100%; table-layout: fixed; border-collapse: collapse; }
        .proto-table th, .proto-table td { padding: 4px 6px; vertical-align: top; border: 1px solid #e5e7eb; }
        .proto-table thead th { font-size: 10px; background: #f8fafc; white-space: normal; line-height: 1.2; }
        .proto-table td { font-size: 10px; }
        .rowline { line-height: 1.15; margin: 0; padding: 0; }
        .sig-img { height: 30px; max-width: 100%; object-fit: contain; }
        .cell-center { text-align: center; white-space: nowrap; }
        .cell-left { text-align: left; }
        .qty-right { text-align: right; white-space: nowrap; }
        .pakiety-chip { margin-top: 2px; padding: 2px 4px; background: #e5e7eb; color: #111827; border-radius: 4px; display: inline-block; }
        .head-strip { font-size: 11px; }
        .cell-notes { word-break: break-word; }
        .sig-cell { text-align: center; vertical-align: middle; padding: 8px 6px; }
        .sig-box { display: flex; align-items: center; justify-content: center; min-height: 56px; }
        .editor { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 8px; margin-top: 6px; }
        .editor h4 { font-size: 11px; margin: 0 0 6px 0; }
        .editor .counts { display: grid; grid-template-columns: 1fr 80px; gap: 6px; }
        .editor .counts label { font-size: 10px; }
        .editor .counts input { width: 100%; font-size: 12px; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 6px; text-align: right; }
        .editor .row { display:flex; gap:8px; flex-wrap: wrap; align-items: center; margin-top: 6px; }
        .editor .row input[type="date"] { font-size: 12px; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 6px; }
        .editor .actions { display:flex; gap:8px; align-items:center; margin-top: 8px; }
        .badge { background:#e2e8f0; color:#0f172a; border-radius:999px; padding:2px 8px; font-size:10px; }
        .muted { color:#6b7280; }
        .toolbar { display:flex; gap:10px; align-items:center; flex-wrap: wrap; }
        .toolbar .select { min-width: 220px; font-size: 12px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; }
        .btn-xs { font-size: 12px; padding: 4px 8px; border-radius: 6px; }
        .total-row td { font-size: 12px !important; font-weight: 700 !important; }
      `}</style>

      <div className="flex items-center gap-2 no-print">
        <Link to={backHref} className="btn-secondary">
          {backLabel}
        </Link>
        <div className="flex-1" />
        <button
          type="button"
          className="btn-secondary"
          onClick={openPdf}
          aria-label="PDF"
        >
          🖨️ PDF
        </button>
      </div>

      <div className="sheet card p-4 flex-1 min-h-0 flex flex-col">
        <div className="text-base font-semibold text-center mb-2">
          Protokół przekazania narzędzi
        </div>

        <div className="head-strip w-full grid grid-cols-1 md:grid-cols-3 gap-3 mb-3 rounded-lg border p-3 bg-slate-50">
          <div className="min-w-0">
            <div className="font-semibold truncate">{clientName}</div>
            {protocol?.summarized ? (
              <div
                className="mt-1 inline-flex items-center gap-1 text-green-700 text-xs border border-green-300 bg-green-50 px-2 py-0.5 rounded-full"
                title="Protokół oznaczony jako podsumowany — pieczęć będzie w PDF"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Podsumowany
              </div>
            ) : null}

            <div className="text-[11px] text-gray-700 break-words">
              {clientAddr}
            </div>
            <div className="text-[11px] text-gray-700">
              {taxLabel}: <b>{taxValue}</b>
            </div>
            <div className="text-[11px] text-gray-600">
              ID: <b>{clientId}</b>
            </div>
          </div>

          <div className="no-print">
            <div className="toolbar">
              <button
                className="btn-secondary btn-xs"
                disabled={!(selected.size === 1)}
                onClick={() => {
                  if (selected.size === 1) {
                    const idx = Array.from(selected.values())[0];
                    startEditRow(idx);
                  }
                }}
              >
                ✏️ Edytuj zwrot
              </button>

              <button
                className="btn-danger btn-xs"
                disabled={!selected.size || bulkBusy}
                onClick={deleteSelected}
                title="Usuń zaznaczone wpisy"
              >
                🗑️ Usuń zaznaczone {selected.size ? `(${selected.size})` : ""}
              </button>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-[11px] text-gray-500">Okres</div>
            <div className="text-sm">
              <b className="capitalize">{monthLabel.mWord}</b> {monthLabel.y}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          <table className="proto-table table w-full min-w-[1100px]">
            <colgroup>
              <col style={{ width: "4ch" }} />
              <col style={{ width: "11ch" }} />
              <col style={{ width: "25ch" }} />
              <col style={{ width: "9ch" }} />
              <col style={{ width: "12ch" }} />
              <col style={{ width: "12ch" }} />
              <col style={{ width: "11ch" }} />
              <col style={{ width: "9ch" }} />
              <col style={{ width: "12ch" }} />
              <col style={{ width: "12ch" }} />
              <col style={{ width: "18ch" }} />
            </colgroup>

            <thead>
              <tr>
                <th className="cell-center" scope="col">
                  L.p.
                </th>
                <th className="cell-center" scope="col">
                  Data przekazania
                </th>
                <th className="cell-left" scope="col">
                  Nazwa narzędzi
                </th>
                <th className="cell-center" scope="col">
                  Ilość
                </th>
                <th className="cell-center" scope="col">
                  Podpis Usługobiorcy
                </th>
                <th className="cell-center" scope="col">
                  Podpis Usługodawcy
                </th>
                <th className="cell-center" scope="col">
                  Data zwrotu
                </th>
                <th className="cell-center" scope="col">
                  Ilość
                </th>
                <th className="cell-center" scope="col">
                  Podpis Usługobiorcy
                </th>
                <th className="cell-center" scope="col">
                  Podpis Usługodawcy
                </th>
                <th className="cell-left" scope="col">
                  Komentarz
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map(({ row, origIndex }, displayIndex) => {
                const tClientSig = absSig(row?.signatures?.transfer?.client);
                const tStaffSig = absSig(row?.signatures?.transfer?.staff);
                const rClientSig = absSig(row?.signatures?.return?.client);
                const rStaffSig = absSig(row?.signatures?.return?.staff);

                const st = edit[origIndex];
                const transferISO = iso10Local(row?.date);
                const rDateISO =
                  iso10Local(st ? st.date : row?.returnDate) ||
                  (transferISO ? nextBusinessDay(transferISO) : "");

                const tService = serviceLabel(row);
                const rService = serviceLabel({
                  shipping: row.returnShipping,
                  delivery: row.returnDelivery,
                });
                const onlyService =
                  (tService && tService !== "—" && tService) ||
                  (rService && rService !== "—" && rService) ||
                  "";

                const lines = buildToolLines(row);
                const rs = lines.length;

                return (
                  <React.Fragment key={`${row.date}-${origIndex}`}>
                    <tr id={`row-${origIndex}-0`} className="align-top">
                      <td className="cell-center" rowSpan={rs}>
                        <div className="no-print" style={{ marginBottom: 2 }}>
                          <input
                            type="checkbox"
                            checked={selected.has(origIndex)}
                            onChange={() => toggleSelect(origIndex)}
                            aria-label={`Zaznacz wiersz ${displayIndex + 1}`}
                          />
                        </div>
                        <div>{displayIndex + 1}</div>
                      </td>

                      <td className="cell-center" rowSpan={rs}>
                        <div className="rowline">{plDate(iso10(row.date))}</div>
                      </td>

                      <td className="cell-left">
                        <div
                          className={
                            lines[0].isSum ? "rowline pakiety-chip" : "rowline"
                          }
                        >
                          {lines[0].isSum ? <b>Pakiety</b> : lines[0].name}
                        </div>
                      </td>

                      <td className="qty-right">
                        <div className="rowline">
                          {lines[0].isSum ? (
                            <b>{lines[0].tQty}</b>
                          ) : (
                            lines[0].tQty
                          )}
                        </div>
                      </td>

                      <td className="sig-cell" rowSpan={rs}>
                        <div className="sig-box">
                          {tClientSig ? (
                            <img
                              className="sig-img"
                              src={tClientSig}
                              alt="Podpis Usługobiorcy (przekazanie)"
                            />
                          ) : (
                            <span className="text-xs muted">—</span>
                          )}
                        </div>
                      </td>
                      <td className="sig-cell" rowSpan={rs}>
                        <div className="sig-box">
                          {tStaffSig ? (
                            <img
                              className="sig-img"
                              src={tStaffSig}
                              alt="Podpis Usługodawcy (przekazanie)"
                            />
                          ) : (
                            <span className="text-xs muted">—</span>
                          )}
                        </div>
                      </td>

                      <td className="cell-center" rowSpan={rs}>
                        <div className="rowline">{plDate(rDateISO)}</div>
                      </td>

                      <td className="qty-right">
                        <div className="rowline">
                          {lines[0].isSum ? (
                            <b>{lines[0].rQty}</b>
                          ) : (
                            lines[0].rQty
                          )}
                        </div>
                      </td>

                      <td className="sig-cell" rowSpan={rs}>
                        <div className="sig-box">
                          {rClientSig ? (
                            <img
                              className="sig-img"
                              src={rClientSig}
                              alt="Podpis Usługobiorcy (zwrot)"
                            />
                          ) : (
                            <span className="text-xs muted">—</span>
                          )}
                        </div>
                      </td>
                      <td className="sig-cell" rowSpan={rs}>
                        <div className="sig-box">
                          {rStaffSig ? (
                            <img
                              className="sig-img"
                              src={rStaffSig}
                              alt="Podpis Usługodawcy (zwrot)"
                            />
                          ) : (
                            <span className="text-xs muted">—</span>
                          )}
                        </div>
                      </td>

                      <td className="cell-left cell-notes" rowSpan={rs}>
                        {onlyService ? (
                          <div className="rowline">{onlyService}</div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>

                    {lines.slice(1).map((ln, k) => (
                      <tr
                        key={`sub-${origIndex}-${k + 1}`}
                        className="align-top"
                      >
                        <td className="cell-left">
                          <div
                            className={
                              ln.isSum ? "rowline pakiety-chip" : "rowline"
                            }
                          >
                            {ln.isSum ? <b>Pakiety</b> : ln.name}
                          </div>
                        </td>
                        <td className="qty-right">
                          <div className="rowline">
                            {ln.isSum ? <b>{ln.tQty}</b> : ln.tQty}
                          </div>
                        </td>
                        <td className="qty-right">
                          <div className="rowline">
                            {ln.isSum ? <b>{ln.rQty}</b> : ln.rQty}
                          </div>
                        </td>
                      </tr>
                    ))}

                    {edit[origIndex] && (
                      <tr className="no-print">
                        <td colSpan={11}>
                          <div className="editor">
                            <h4>Zwrot narzędzi — zapis do protokołu</h4>

                            <div className="row">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={edit[origIndex].sameAsTransfer}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setEdit((prev) => ({
                                      ...prev,
                                      [origIndex]: {
                                        ...prev[origIndex],
                                        sameAsTransfer: checked,
                                      },
                                    }));
                                    if (checked) applySameAsTransfer(origIndex);
                                  }}
                                />
                                <span>Zwrot = ilości przy przekazaniu</span>
                              </label>
                              {!edit[origIndex].sameAsTransfer && (
                                <button
                                  className="btn-secondary btn-xs"
                                  onClick={() => applySameAsTransfer(origIndex)}
                                >
                                  Skopiuj ilości z przekazania
                                </button>
                              )}
                            </div>

                            {!edit[origIndex].sameAsTransfer && (
                              <div className="counts mt-3">
                                {normalizeTools(row.tools).map((t, k) => (
                                  <React.Fragment key={k}>
                                    <label>{t.name}</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={Number(
                                        edit[origIndex].counts?.[k] ?? 0
                                      )}
                                      onChange={(e) => {
                                        const v = Math.max(
                                          0,
                                          parseInt(e.target.value || "0", 10)
                                        );
                                        setEdit((prev) => {
                                          const arr = [
                                            ...(prev[origIndex].counts || []),
                                          ];
                                          arr[k] = v;
                                          return {
                                            ...prev,
                                            [origIndex]: {
                                              ...prev[origIndex],
                                              counts: arr,
                                            },
                                          };
                                        });
                                      }}
                                    />
                                  </React.Fragment>
                                ))}
                              </div>
                            )}

                            <div className="row">
                              <label>
                                Data zwrotu:&nbsp;
                                <input
                                  type="date"
                                  value={edit[origIndex].date}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    setEdit((prev) => ({
                                      ...prev,
                                      [origIndex]: {
                                        ...prev[origIndex],
                                        date: raw,
                                      },
                                    }));
                                  }}
                                  onBlur={(e) => {
                                    const fixed = normalizeToBusinessDay(
                                      e.target.value
                                    );
                                    if (fixed !== e.target.value) {
                                      setEdit((prev) => ({
                                        ...prev,
                                        [origIndex]: {
                                          ...prev[origIndex],
                                          date: fixed,
                                        },
                                      }));
                                    }
                                  }}
                                />
                              </label>

                              <label>
                                Pakiety (zwrot):&nbsp;
                                <input
                                  type="number"
                                  min="0"
                                  value={edit[origIndex].packages}
                                  onChange={(e) =>
                                    setEdit((prev) => ({
                                      ...prev,
                                      [origIndex]: {
                                        ...prev[origIndex],
                                        packages: Math.max(
                                          0,
                                          parseInt(e.target.value || "0", 10)
                                        ),
                                      },
                                    }))
                                  }
                                  style={{
                                    width: 100,
                                    border: "1px solid #d1d5db",
                                    borderRadius: 6,
                                    padding: "4px 6px",
                                  }}
                                />
                              </label>
                            </div>

                            {edit[origIndex].error ? (
                              <div className="text-red-600 text-xs mt-2">
                                {edit[origIndex].error}
                              </div>
                            ) : null}

                            <div className="actions">
                              <button
                                className="btn-primary btn-sm"
                                onClick={() => saveReturn(origIndex)}
                                disabled={edit[origIndex].saving}
                              >
                                {edit[origIndex].saving
                                  ? "Zapisywanie..."
                                  : "Zapisz zwrot"}
                              </button>
                              <button
                                className="btn-secondary btn-sm"
                                onClick={() => cancelEditRow(origIndex)}
                                disabled={edit[origIndex].saving}
                              >
                                Anuluj
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              <tr className="bg-slate-50 total-row">
                <td className="cell-left" colSpan={3}>
                  Razem przekazań:
                </td>
                <td className="cell-center">{totalTransfers}</td>
                <td colSpan={7}></td>
              </tr>

              <tr className="bg-slate-50 total-row">
                <td className="cell-left" colSpan={3}>
                  Razem pakietów:
                </td>
                <td className="cell-center">{totalPackages}</td>
                <td colSpan={7}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
