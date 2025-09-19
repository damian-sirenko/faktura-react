// src/pages/ProtocolView.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";

/* ===== API base (prod/dev) — УНІФІКОВАНО з іншими сторінками ===== */
const API = import.meta.env.VITE_API_URL || "http://localhost:3000";
const api = (p) => `${API}${p.startsWith("/") ? p : `/${p}`}`;

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

const plDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
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
  const wd = parseISO(iso).getUTCDay(); // 0=Sun..6=Sat
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

/* ==== ДОДАНО: нормалізація місяця і жорсткі запобіжники ==== */
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
  return ""; // невалідно
}

export default function ProtocolView() {
  const params = useParams();
  const location = useLocation();

  // підтримка різних назв параметрів + читання з query string
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
  const safeMonth = useMemo(() => normalizeYm(monthParam), [monthParam]); // ✅ 'YYYY-MM' або ''

  const [loading, setLoading] = useState(true);
  const [protocol, setProtocol] = useState(null);
  const [client, setClient] = useState(null);
  const [error, setError] = useState("");

  // редактор звороту (індекс рядка -> state)
  const [edit, setEdit] = useState({});
  // вибрані для видалення/редагування рядки (чекбокси)
  const [selected, setSelected] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Fetch protocol + client
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      setEdit({});
      setSelected(new Set());

      // 🔒 Захист від неправильного маршруту / відсутніх параметрів
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
        const r = await fetch(
          api(`/protocols/${encodeURIComponent(clientId)}/${safeMonth}`)
        );
        if (!r.ok) throw new Error("HTTP " + r.status);
        const data = await r.json();

        if (!alive) return;

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
        });
      } catch (e) {
        if (!alive) return;
        setError("Nie udało się załadować protokołu.");
        setLoading(false);
        return;
      }

      try {
        const rc = await fetch(api("/clients"));
        const list = (await rc.json()) || [];
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

  function startEditRow(i) {
    if (!protocol || !protocol.entries || !protocol.entries[i]) return;
    const row = protocol.entries[i];
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
      [i]: {
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
      const el = document.getElementById(`row-${i}`);
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
      const res = await fetch(
        api(`/protocols/${encodeURIComponent(clientId)}/${safeMonth}/${i}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Request failed");
      }

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
          }));
        }
      } catch {
        // без тіла відповіді — локальне оновлення нижче
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

  // Вибір/зняття чекбоксів
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
        await fetch(
          api(`/protocols/${encodeURIComponent(clientId)}/${safeMonth}/${idx}`),
          { method: "DELETE" }
        );
      }
      const r = await fetch(
        api(`/protocols/${encodeURIComponent(clientId)}/${safeMonth}`)
      );
      const data = await r.json();
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
      });
      clearSelection();
      setEdit({});
    } finally {
      setBulkBusy(false);
    }
  }

  function openPdf() {
    if (!clientId || !safeMonth) return; // 🔒 запобіжник
    const url = api(
      `/protocols/${encodeURIComponent(
        clientId
      )}/${safeMonth}/pdf?ts=${Date.now()}`
    );
    const w = window.open(url, "_blank", "noopener,noreferrer");
    // Фолбек, якщо попап заблоковано/порожня вкладка
    if (!w || w.closed || typeof w.closed === "undefined") {
      window.location.href = url;
    }
  }

  if (loading) {
    return <div className="card p-8 text-center text-gray-500">Ładowanie…</div>;
  }
  if (error) {
    return <div className="card p-8 text-center text-red-600">{error}</div>;
  }
  if (!protocol || !(protocol.entries || []).length) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Link to="/documents/protocols" className="btn-secondary">
            ← Powrót do listy protokołów
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

  return (
    <div className="space-y-4">
      {/* PRINT CSS */}
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
        .qty-right { text-align: right; }
        .pakiety { margin-top: 2px; padding: 2px 4px; background: #e5e7eb; color: #111827; border-radius: 4px; display: inline-block; }
        .head-strip { font-size: 11px; }
        .cell-notes { word-break: break-word; }
        .sig-cell { text-align: center; vertical-align: middle; padding: 8px 6px; }
        .sig-box { display: flex; align-items: center; justify-content: center; min-height: 56px; }
        .editor { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 8px; margin-top: 6px; }
        .editor h4 { font-size: 11px; margin: 0 0 6px 0; }
        .editor .counts { display: grid; grid-template-columns: 1fr 80px; gap: 6px; }
        .editor .counts label { font-size: 10px; color: #374151; }
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

      {/* Верхня панель (не друкувати) */}
      <div className="flex items-center gap-2 no-print">
        <Link to="/documents/protocols" className="btn-secondary">
          ← Powrót
        </Link>
        <div className="flex-1" />
        <button className="btn-secondary" onClick={openPdf} aria-label="PDF">
          🖨️ PDF
        </button>
      </div>

      {/* Аркуш */}
      <div className="sheet card p-4">
        <div className="text-base font-semibold text-center mb-2">
          Protokół przekazania narzędzi
        </div>

        <div className="head-strip w-full grid grid-cols-1 md:grid-cols-3 gap-3 mb-3 rounded-lg border p-3 bg-slate-50">
          <div className="min-w-0">
            <div className="font-semibold truncate">{clientName}</div>
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

        <div>
          <table className="proto-table table w-full">
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
              {(protocol.entries || []).map((row, i) => {
                const tTools = (row.tools || []).filter((t) => t?.name);
                const tCounts = tTools.map((t) => Number(t.count || 0));
                const tClientSig = absSig(row?.signatures?.transfer?.client);
                const tStaffSig = absSig(row?.signatures?.transfer?.staff);

                const rTools = (row.returnTools || row.tools || []).filter(
                  (t) => t?.name
                );
                const rCounts = rTools.map((t) => Number(t.count || 0));
                const rClientSig = absSig(row?.signatures?.return?.client);
                const rStaffSig = absSig(row?.signatures?.return?.staff);

                const st = edit[i];
                const rDateISO =
                  (st ? st.date : row.returnDate) || nextBusinessDay(row.date);

                const tPackages = Number(row.packages || 0) || 0;
                const rPackages =
                  Number(
                    row.returnPackages != null
                      ? row.returnPackages
                      : row.packages
                  ) || 0;

                const tService = serviceLabel(row);
                const rService = serviceLabel({
                  shipping: row.returnShipping,
                  delivery: row.returnDelivery,
                });

                const onlyService =
                  (tService && tService !== "—" && tService) ||
                  (rService && rService !== "—" && rService) ||
                  "";

                return (
                  <React.Fragment key={`${row.date}-${i}`}>
                    <tr id={`row-${i}`} className="align-top">
                      <td className="cell-center">
                        <div className="no-print" style={{ marginBottom: 2 }}>
                          <input
                            type="checkbox"
                            checked={selected.has(i)}
                            onChange={() => toggleSelect(i)}
                            aria-label={`Zaznacz wiersz ${i + 1}`}
                          />
                        </div>
                        <div>{i + 1}</div>
                      </td>
                      <td className="cell-center">
                        <div className="rowline">{plDate(row.date)}</div>
                      </td>
                      <td className="cell-left">
                        {tTools.length ? (
                          tTools.map((t, k) => (
                            <div key={k} className="rowline">
                              {t.name}
                            </div>
                          ))
                        ) : (
                          <div className="rowline muted">—</div>
                        )}
                        <div className="rowline pakiety">
                          <b>Pakiety</b>
                        </div>
                      </td>
                      <td className="qty-right">
                        {tTools.length ? (
                          tCounts.map((c, k) => (
                            <div key={k} className="rowline">
                              {c}
                            </div>
                          ))
                        ) : (
                          <div className="rowline muted">—</div>
                        )}
                        <div className="rowline pakiety">
                          <b>{tPackages}</b>
                        </div>
                      </td>
                      <td className="sig-cell">
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
                      <td className="sig-cell">
                        <div className="sig-box">
                          {tStaffSig ? (
                            <img
                              className="sig-img"
                              src={tStaffSig}
                              alt="Podpis Usługodawcy (прzekazanie)"
                            />
                          ) : (
                            <span className="text-xs muted">—</span>
                          )}
                        </div>
                      </td>
                      <td className="cell-center">
                        <div className="rowline">{plDate(rDateISO)}</div>
                      </td>
                      <td className="qty-right">
                        {rCounts.length ? (
                          rCounts.map((c, k) => (
                            <div key={k} className="rowline">
                              {c}
                            </div>
                          ))
                        ) : (
                          <div className="rowline muted">—</div>
                        )}
                        <div className="rowline pakiety">
                          <b>{rPackages}</b>
                        </div>
                      </td>
                      <td className="sig-cell">
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
                      <td className="sig-cell">
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
                      <td className="cell-left cell-notes">
                        {onlyService ? (
                          <div className="rowline">{onlyService}</div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>

                    {edit[i] && (
                      <tr className="no-print">
                        <td colSpan={11}>
                          <div className="editor">
                            <h4>Zwrot narzędzi — zapis do protokołu</h4>

                            <div className="row">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={edit[i].sameAsTransfer}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setEdit((prev) => ({
                                      ...prev,
                                      [i]: {
                                        ...prev[i],
                                        sameAsTransfer: checked,
                                      },
                                    }));
                                    if (checked) applySameAsTransfer(i);
                                  }}
                                />
                                <span>Zwrot = ilości при przekazaniu</span>
                              </label>
                              {!edit[i].sameAsTransfer && (
                                <button
                                  className="btn-secondary btn-xs"
                                  onClick={() => applySameAsTransfer(i)}
                                >
                                  Skopiuj ilości з przekazania
                                </button>
                              )}
                            </div>

                            {!edit[i].sameAsTransfer && (
                              <div className="counts mt-3">
                                {tTools.map((t, k) => (
                                  <React.Fragment key={k}>
                                    <label>{t.name}</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={Number(edit[i].counts?.[k] ?? 0)}
                                      onChange={(e) => {
                                        const v = Math.max(
                                          0,
                                          parseInt(e.target.value || "0", 10)
                                        );
                                        setEdit((prev) => {
                                          const arr = [
                                            ...(prev[i].counts || []),
                                          ];
                                          arr[k] = v;
                                          return {
                                            ...prev,
                                            [i]: { ...prev[i], counts: arr },
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
                                  value={edit[i].date}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    setEdit((prev) => ({
                                      ...prev,
                                      [i]: { ...prev[i], date: raw },
                                    }));
                                  }}
                                  onBlur={(e) => {
                                    const fixed = normalizeToBusinessDay(
                                      e.target.value
                                    );
                                    if (fixed !== e.target.value) {
                                      setEdit((prev) => ({
                                        ...prev,
                                        [i]: { ...prev[i], date: fixed },
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
                                  value={edit[i].packages}
                                  onChange={(e) =>
                                    setEdit((prev) => ({
                                      ...prev,
                                      [i]: {
                                        ...prev[i],
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

                            {edit[i].error ? (
                              <div className="text-red-600 text-xs mt-2">
                                {edit[i].error}
                              </div>
                            ) : null}

                            <div className="actions">
                              <button
                                className="btn-primary btn-sm"
                                onClick={() => saveReturn(i)}
                                disabled={edit[i].saving}
                              >
                                {edit[i].saving
                                  ? "Zapisywanie..."
                                  : "Zapisz zwrot"}
                              </button>
                              <button
                                className="btn-secondary btn-sm"
                                onClick={() => cancelEditRow(i)}
                                disabled={edit[i].saving}
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
