// src/pages/StatsPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api/base";


const getAuth = () => {
  const token =
    localStorage.getItem("authToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("jwt") ||
    sessionStorage.getItem("authToken") ||
    sessionStorage.getItem("token") ||
    "";
  return {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  };
};

/* ===== Helpers ===== */
const fmtLocal = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const todayISO = () => fmtLocal(new Date());

const addMonths = (iso, n) => {
  const d = iso ? new Date(iso) : new Date();
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return fmtLocal(d);
};

const firstOfMonth = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  d.setDate(1);
  return fmtLocal(d);
};

const lastDayOfMonth = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return fmtLocal(end);
};

const startOfYear = (yyyy) => `${yyyy}-01-01`;

const to2 = (x) => Number(x || 0).toFixed(2);
const to0 = (x) => String(Math.round(Number(x || 0)));
const ymOf = (iso) => (typeof iso === "string" ? iso.slice(0, 7) : "");
const inRange = (iso, from, to) => {
  if (!iso) return false;
  const s = String(iso).slice(0, 10);
  return s >= from && s <= to;
};

/* Brutto kwota faktury (fallback jeśli brak total_gross) */
const grossOfInvoice = (inv) => {
  const direct =
    inv?.gross_sum ??
    inv?.gross ??
    inv?.brutto ??
    inv?.total_gross ??
    inv?.total;
  if (direct != null && direct !== "")
    return Number(String(direct).replace(",", "."));
  const items = Array.isArray(inv?.items) ? inv.items : [];
  return items.reduce((s, it) => {
    const v =
      it?.gross_total ??
      it?.grossTotal ??
      it?.total_gross ??
      it?.brutto ??
      it?.total;
    return s + (v ? Number(String(v).replace(",", ".")) : 0);
  }, 0);
};

/* Brutto kwota pozycji */
const itemGross = (it) => {
  const g =
    it?.gross_total ??
    it?.grossTotal ??
    it?.total_gross ??
    it?.brutto ??
    it?.total;
  if (g != null && g !== "") return Number(String(g).replace(",", "."));
  const q =
    it?.qty ?? it?.quantity ?? it?.count ?? it?.amount ?? it?.ilosc ?? 1;
  const u =
    it?.gross_unit ??
    it?.unit_gross ??
    it?.price_gross ??
    it?.unitPriceGross ??
    it?.price;
  if (u != null && u !== "")
    return Number(String(u).replace(",", ".")) * Number(q || 1);
  return 0;
};

/* Ilość pozycji */
const itemQty = (it) =>
  Number(
    it?.qty ?? it?.quantity ?? it?.count ?? it?.amount ?? it?.ilosc ?? 1
  ) || 0;

function LineChart({ data, height = 240, label = "" }) {
  const padding = { top: 20, right: 20, bottom: 28, left: 48 };
  const width = Math.max(560, 60 * Math.max(1, data.length));
  const maxV = Math.max(1, ...data.map((d) => d.value));
  const minV = 0;

  const x = (i) =>
    padding.left +
    (data.length <= 1
      ? 0
      : (i * (width - padding.left - padding.right)) / (data.length - 1));
  const y = (v) =>
    padding.top +
    (1 - (v - minV) / (maxV - minV)) * (height - padding.top - padding.bottom);

  const path = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d.value)}`)
    .join(" ");
  const ticks = 5;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) =>
    Math.round(minV + (i * (maxV - minV)) / ticks)
  );

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[260px]">
        {tickVals.map((tv, i) => {
          const yy = y(tv);
          return (
            <g key={i}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={yy}
                y2={yy}
                stroke="#e5e7eb"
                strokeDasharray="4 4"
              />
              <text
                x={padding.left - 8}
                y={yy}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="10"
                fill="#6b7280"
              >
                {to2(tv)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => (
          <text
            key={i}
            x={x(i)}
            y={height - padding.bottom + 16}
            fontSize="10"
            fill="#6b7280"
            textAnchor="middle"
          >
            {d.label}
          </text>
        ))}

        <path d={path} fill="none" stroke="#2563eb" strokeWidth="2.5" />
        {data.map((d, i) => {
          const cx = x(i);
          const cy = y(d.value);
          const isMoney = /pln/i.test(label);
          const valText = isMoney ? to2(d.value) : to0(d.value);
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r="3" fill="#2563eb">
                <title>
                  {d.label}: {to2(d.value)} {label}
                </title>
              </circle>
              <text
                x={cx}
                y={cy - 8}
                fontSize="10"
                fill="#374151"
                textAnchor="middle"
                dominantBaseline="baseline"
                stroke="none"
                strokeWidth="2"
              >
                {valText}
              </text>
            </g>
          );
        })}

        {label ? (
          <text x={12} y={10} fontSize="11" fill="#374151">
            {label}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

function StatCard({
  title,
  value,
  unit = "",
  note = "",
  onClick,
  isActive = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "w-full h-full text-left rounded-lg border bg-white hover:bg-slate-50 transition " +
        (isActive ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-200")
      }
    >
      <div className="grid grid-rows-[auto_auto_1fr_auto] min-h-28 h-full p-3">
        <div className="text-xs text-gray-500">{title}</div>
        {note ? (
          <div className="text-[11px] text-gray-500 mt-0.5">{note}</div>
        ) : (
          <div />
        )}
        <div />
        <div className="self-end text-2xl font-bold">
          {unit
            ? `${Number(value || 0).toFixed(2)} ${unit}`
            : String(Math.round(Number(value || 0)))}
        </div>
      </div>
    </button>
  );
}

export default function StatsPage() {
  /* ===== Zakres (globalnie) ===== */
  const [tab, setTab] = useState("revenue");
  const [mode, setMode] = useState("lastMonth");

  const prevMonthStart = firstOfMonth(addMonths(todayISO(), -1));
  const [from, setFrom] = useState(prevMonthStart);
  const [to, setTo] = useState(lastDayOfMonth(prevMonthStart));
  const now = new Date();
  const thisYear = now.getFullYear();
  const [year, setYear] = useState(prevMonthStart.slice(0, 4));
  const [month, setMonth] = useState(prevMonthStart.slice(5, 7));
  const [clientsAll, setClientsAll] = useState([]);
  const [protocols, setProtocols] = useState([]);

  const applyQuick = (m) => {
    setMode(m);
    setYear("");
    setMonth("");
    const today = todayISO();

    if (m === "thisMonth") {
      const f = firstOfMonth(today);
      setFrom(f);
      setTo(lastDayOfMonth(today));
      setYear(f.slice(0, 4));
      setMonth(f.slice(5, 7));
    } else if (m === "lastMonth") {
      const f = firstOfMonth(addMonths(today, -1));
      setFrom(f);
      setTo(lastDayOfMonth(f));
      setYear(f.slice(0, 4));
      setMonth(f.slice(5, 7));
    } else if (m === "thisYear") {
      const y = String(thisYear);
      setFrom(`${y}-01-01`);
      setTo(`${y}-12-31`);
      setYear(y);
      setMonth("");
    } else if (m === "last12") {
      const f = firstOfMonth(addMonths(today, -11));
      setFrom(f);
      setTo(lastDayOfMonth(today));
      setYear("");
      setMonth("");
    }
  };

  useEffect(() => {
    if (!from || !to) return;
    if (new Date(from) > new Date(to)) {
      const a = from;
      setFrom(to);
      setTo(a);
    }
  }, [from, to]);

  useEffect(() => {
    if (tab === "revenue") {
      setActiveMetric({
        group: "revenue",
        key: "total",
        label: "Przychód ogółem",
        unit: "PLN",
      });
    } else if (tab === "packages") {
      setActiveMetric({
        group: "packages",
        key: "total",
        label: "Pakiety abonamentowe",
        unit: "",
      });
    } else if (tab === "payments") {
      setActiveMetric({
        group: "payments",
        key: "paidAmount",
        label: "Opłacone — kwota (miesięcznie)",
        unit: "PLN",
      });
    } else if (tab === "clients") {
      setActiveMetric({
        group: "clients",
        key: "active",
        label: "Aktywni klienci abonamentowi",
        unit: "",
      });
    }
  }, [tab]);

  useEffect(() => {
    if (year && month) {
      const f = `${year}-${month}-01`;
      setFrom(f);
      setTo(lastDayOfMonth(f));
      setMode("month");
    } else if (year && !month) {
      setFrom(startOfYear(year));
      setTo(`${year}-12-31`);
      setMode("year");
    }
  }, [year, month]);

  /* ===== Dane ===== */
  const [data, setData] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [pslRevenue, setPslRevenue] = useState(0);
  const [pslActiveCount, setPslActiveCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef(null);

  const [activeMetric, setActiveMetric] = useState({
    group: "revenue",
    key: "total",
    label: "Przychód ogółem (brutto)",
    unit: "PLN",
  });

  /* ===== Load analytics ===== */
  const loadAnalytics = async () => {
    abortRef.current?.abort?.();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");
    try {
      const { headers: authH } = getAuth();
      const r = await apiFetch(`/analytics/query?_ts=${Date.now()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authH },
        body: JSON.stringify({ from, to }),
        signal: ac.signal,
        cache: "no-store",
      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setData(d);
    } catch (e) {
      if (e.name !== "AbortError") {
        setError("Błąd pobierania statystyk.");
        console.error(e);
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  };

  /* ===== Load invoices + PSL ===== */
  const loadInvoices = async () => {
    let abonClientsIds = [];
    let abonClientNames = [];

    try {
      const { headers: authH1 } = getAuth();
      const clientsResp = await apiFetch(`/clients?_ts=${Date.now()}`, {
        cache: "no-store",
        headers: { ...authH1 },
      });

      if (clientsResp.ok) {
        const clientsList = await clientsResp.json();
        setClientsAll(Array.isArray(clientsList) ? clientsList : []);
        const abonOnly = (clientsList || []).filter(
          (c) => String(c.billingMode || "").toLowerCase() === "abonament"
        );
        abonClientsIds = abonOnly.map((c) => String(c.id || c.ID || "").trim());
        const norm = (s) =>
          String(s || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim();
        abonClientNames = abonOnly.map((c) => norm(c.name || c.Klient || ""));
      }
    } catch {
      abonClientsIds = [];
      abonClientNames = [];
    }

    setLoadingInvoices(true);
    try {
      const params = new URLSearchParams({
        from,
        to,
        _ts: String(Date.now()),
      });

      const { headers: authH2 } = getAuth();
      const r = await apiFetch(`/invoices?${params.toString()}`, {
        cache: "no-store",
        headers: { ...authH2 },
      });

      if (r.ok) {
        const list = await r.json().catch(() => []);
        const safe = (Array.isArray(list) ? list : []).filter((inv) =>
          inRange(inv?.issueDate || inv?.issue_date, from, to)
        );

        const idsSet = new Set(abonClientsIds.filter(Boolean).map(String));
        const norm = (s) =>
          String(s || "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim();
        const namesSet = new Set(abonClientNames.filter(Boolean).map(norm));

        const abonInvoices = safe.filter((inv) => {
          const id = String(inv.clientId || inv.client_id || "").trim();
          const name = norm(inv.clientName || inv.client || "");
          return (id && idsSet.has(id)) || (name && namesSet.has(name));
        });

        setInvoices(abonInvoices);
      } else {
        throw new Error(`HTTP ${r.status}`);
      }

      // PSL
      const ymFrom = String(from).slice(0, 7);
      const ymTo = String(to).slice(0, 7);
      if (ymFrom === ymTo) {
        const ym = ymFrom;
        const todayYm = todayISO().slice(0, 7);
        const { headers } = getAuth();

        if (ym === todayYm) {
          const wsResp = await apiFetch(`/psl/workspace?_ts=${Date.now()}`, {
            cache: "no-store",
            headers,
          });
          const ws = await wsResp.json().catch(() => null);
          const rows = Array.isArray(ws?.rows) ? ws.rows : [];
          const price = Number(ws?.pricePerPack || 0) || 0;

          const total = rows.reduce((s, r) => {
            const qty =
              Number(
                r?.qty ?? r?.packages ?? r?.packs ?? r?.count ?? r?.ilosc ?? 0
              ) || 0;
            const ship =
              Number(
                r?.shipOrCourier ??
                  r?.ship ??
                  r?.courier ??
                  r?.shippingCost ??
                  r?.deliveryCost ??
                  r?.wysylka ??
                  0
              ) || 0;
            const steril =
              price > 0 ? qty * price : Number(r?.sterilCost || 0) || 0;
            return s + steril + ship;
          }, 0);
          setPslRevenue(total);

          const uniq = new Set();
          for (const r of rows) {
            const qty =
              Number(
                r?.qty ?? r?.packages ?? r?.packs ?? r?.count ?? r?.ilosc ?? 0
              ) || 0;
            const totalRow = Number(r?.total || 0) || 0;
            const id = String(r?.clientId || "").trim();
            const name = String(r?.clientName || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .trim();
            const key = id ? `id:${id}` : name ? `name:${name}` : "";
            if (key && (qty > 0 || totalRow > 0)) uniq.add(key);
          }
          setPslActiveCount(uniq.size);
        } else {
          const idxResp = await apiFetch(`/psl/saved-index?_ts=${Date.now()}`, {
            cache: "no-store",
            headers,
          });
          
          const idx = await idxResp.json().catch(() => []);
          const rec = (Array.isArray(idx) ? idx : []).find(
            (x) => String(x.ym) === ym
          );

          if (rec?.id) {
            const snapResp = await apiFetch(
              `/psl/saved/${encodeURIComponent(rec.id)}?_ts=${Date.now()}`,
              {
                cache: "no-store",
                headers,
              }
            );
            
            const snap = await snapResp.json().catch(() => null);
            const rows = Array.isArray(snap?.rows) ? snap.rows : [];

            setPslRevenue(Number(snap?.totals?.total || 0));

            const uniq = new Set();
            for (const r of rows) {
              const qty =
                Number(
                  r?.qty ?? r?.packages ?? r?.packs ?? r?.count ?? r?.ilosc ?? 0
                ) || 0;
              const totalRow = Number(r?.total || 0) || 0;
              const id = String(r?.clientId || "").trim();
              const name = String(r?.clientName || "")
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .trim();
              const key = id ? `id:${id}` : name ? `name:${name}` : "";
              if (key && (qty > 0 || totalRow > 0)) uniq.add(key);
            }
            setPslActiveCount(uniq.size);
          } else {
            setPslRevenue(0);
            setPslActiveCount(0);
          }
        }
      } else {
        setPslRevenue(0);
        setPslActiveCount(0);
      }
    } catch (e) {
      console.error("Invoices load error:", e);
      setInvoices([]);
      setPslRevenue(0);
      setPslActiveCount(0);
    } finally {
      setLoadingInvoices(false);
    }
  };

  /* ===== Load protocols ===== */
  const loadProtocols = async () => {
    try {
      const { headers: authH3 } = getAuth();
      const r = await apiFetch(`/protocols?_ts=${Date.now()}`, {
        cache: "no-store",
        headers: { ...authH3 },
      });
      

      if (!r.ok) {
        console.warn("Protocols request failed:", r.status, r.statusText);
        setProtocols([]);
        return;
      }

      const text = await r.text();
      const trimmed = text.trimStart();

      // Якщо це не виглядає як JSON (починається не з { або [) — просто ігноруємо
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        console.warn(
          "Protocols: non-JSON response, first chars:",
          trimmed.slice(0, 80)
        );
        setProtocols([]);
        return;
      }

      let list = [];
      try {
        list = JSON.parse(trimmed);
      } catch (e) {
        console.warn("Protocols: JSON parse error:", e);
        setProtocols([]);
        return;
      }

      const filtered = (Array.isArray(list) ? list : []).map((p) => {
        const entries = Array.isArray(p.entries) ? p.entries : [];
        const inRangeEntries = entries.filter(
          (e) => inRange(e?.date, from, to) || inRange(e?.returnDate, from, to)
        );
        return { ...p, entries: inRangeEntries };
      });

      setProtocols(filtered);
    } catch (e) {
      console.warn("Protocols load error:", e);
      setProtocols([]);
    }
  };

  useEffect(() => {
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, data]);

  useEffect(() => {
    loadProtocols();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  /* ===== Monthly series (backend) ===== */
  const revenueSeries = useMemo(
    () =>
      (data?.monthly || []).map((m) => ({
        label: m.ym,
        value: Number(m.total || 0),
      })),
    [data]
  );
  const revenueAbonSeries = useMemo(
    () =>
      (data?.monthly || []).map((m) => ({
        label: m.ym,
        value: Number(m.abon || 0),
      })),
    [data]
  );
  const revenuePerpieceSeries = useMemo(
    () =>
      (data?.monthlyPSL || []).map((m) => ({
        label: m.ym,
        value: Number(m.steril || 0),
      })),
    [data]
  );
  const packagesSeries = useMemo(
    () =>
      (data?.monthlyPackages || []).map((m) => ({
        label: m.ym,
        value: Number(m.packages || 0),
      })),
    [data]
  );
  const packagesOverquotaCountSeries = useMemo(
    () =>
      (data?.monthly || []).map((m) => ({
        label: m.ym,
        value: Number(m.overquotaCount || 0),
      })),
    [data]
  );
  const packagesOverquotaValueSeries = useMemo(
    () =>
      (data?.monthly || []).map((m) => ({
        label: m.ym,
        value: Number(m.overquota || 0),
      })),
    [data]
  );

  const packagesTotalFromSeries = useMemo(
    () =>
      (data?.monthlyPackages || []).reduce(
        (s, m) => s + Number(m.packages || 0),
        0
      ),
    [data]
  );

  const lastPackagesFromSeries = useMemo(() => {
    const arr = data?.monthlyPackages || [];
    if (!arr.length) return 0;
    const last = arr[arr.length - 1];
    return Number(last.packages || 0);
  }, [data]);

  const abonRevenue = invoices.reduce((s, inv) => s + grossOfInvoice(inv), 0);
  const perpieceRevenue = Number(pslRevenue || 0);

  const revenueAggBackend = {
    total: abonRevenue + perpieceRevenue,
    abon: abonRevenue,
    perpiece: perpieceRevenue,
    shipping: Number(data?.kpis?.revenue?.shipping || 0),
    courier: Number(data?.kpis?.revenue?.courier || 0),
    overquota: Number(data?.kpis?.revenue?.overquota || 0),
  };

  const abonClientsCount = (Array.isArray(clientsAll) ? clientsAll : []).filter(
    (c) =>
      String(c.billingMode || "").toLowerCase() === "abonament" &&
      !Boolean(c.archived)
  ).length;

  const archivedInPeriod = (Array.isArray(clientsAll) ? clientsAll : []).filter(
    (c) => {
      if (!c || !c.archived) return false;
      const ts =
        c.archivedAt || c.updatedAt || c.modifiedAt || c.lastChange || "";
      return inRange(ts, from, to);
    }
  ).length;

  const abonClientIds = new Set(
    (Array.isArray(clientsAll) ? clientsAll : [])
      .filter((c) => String(c.billingMode || "").toLowerCase() === "abonament")
      .map((c) => String(c.id || c.ID || "").trim())
      .filter(Boolean)
  );

  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const abonClientNames = new Set(
    (Array.isArray(clientsAll) ? clientsAll : [])
      .filter((c) => String(c.billingMode || "").toLowerCase() === "abonament")
      .map((c) => norm(c.name || c.Klient || ""))
      .filter(Boolean)
  );

  const activeAbonByProtocols = (() => {
    const activeIds = new Set();
    const activeNames = new Set();

    for (const p of Array.isArray(protocols) ? protocols : []) {
      if (!Array.isArray(p.entries) || p.entries.length === 0) continue;
      const pid = String(p.id || p.clientId || "").trim();
      const pname = norm(p.clientName || p.client || "");
      if (
        (pid && abonClientIds.has(pid)) ||
        (pname && abonClientNames.has(pname))
      ) {
        if (pid) activeIds.add(pid);
        if (pname) activeNames.add(pname);
      }
    }
    return activeIds.size || activeNames.size
      ? Math.max(activeIds.size, activeNames.size)
      : 0;
  })();

  const clientsAgg = {
    newClients: Number(data?.kpis?.newClients || 0),
    archived: archivedInPeriod,
    activeClients: activeAbonByProtocols,
    abonClients: abonClientsCount,
    perpieceActive: Number(pslActiveCount || 0),
  };

  /* ===== Płatności z faktur ===== */
  const paymentsAgg = useMemo(() => {
    const paid = invoices.filter((inv) => {
      const st = String(inv?.status || "").toLowerCase();
      return st === "paid" || st === "opłacona";
    });
    const unpaid = invoices.filter((inv) => {
      const st = String(inv?.status || "").toLowerCase();
      return !(st === "paid" || st === "opłacona");
    });

    const paidCount = paid.length;
    const unpaidCount = unpaid.length;
    const totalCount = paidCount + unpaidCount;

    const paidAmount = paid.reduce((s, inv) => s + grossOfInvoice(inv), 0);
    const unpaidAmount = unpaid.reduce((s, inv) => s + grossOfInvoice(inv), 0);
    const totalAmount = paidAmount + unpaidAmount;

    const paidPct = totalAmount > 0 ? (paidAmount / totalAmount) * 100 : 0;
    const unpaidPct = totalAmount > 0 ? (unpaidAmount / totalAmount) * 100 : 0;

    return {
      paidCount,
      unpaidCount,
      totalCount,
      paidAmount,
      unpaidAmount,
      totalAmount,
      paidPct,
      unpaidPct,
    };
  }, [invoices]);

  const paymentsSeries = useMemo(() => {
    const map = new Map();
    for (const inv of invoices) {
      const ym = ymOf(inv?.issueDate || inv?.issue_date);
      if (!ym) continue;
      if (!map.has(ym))
        map.set(ym, {
          paidCount: 0,
          paidAmount: 0,
          unpaidCount: 0,
          unpaidAmount: 0,
        });
      const b = map.get(ym);
      const amt = grossOfInvoice(inv);
      const st = String(inv?.status || "").toLowerCase();
      const paid = st === "paid" || st === "opłacona";
      if (paid) {
        b.paidCount += 1;
        b.paidAmount += amt;
      } else {
        b.unpaidCount += 1;
        b.unpaidAmount += amt;
      }
    }
    const yms = Array.from(map.keys()).sort();
    return {
      paidAmount: yms.map((k) => ({ label: k, value: map.get(k).paidAmount })),
      paidCount: yms.map((k) => ({ label: k, value: map.get(k).paidCount })),
      unpaidAmount: yms.map((k) => ({
        label: k,
        value: map.get(k).unpaidAmount,
      })),
      unpaidCount: yms.map((k) => ({
        label: k,
        value: map.get(k).unpaidCount,
      })),
    };
  }, [invoices]);

  /* ===== Wysyłka / Kurier / Overquota z faktur ===== */
  const {
    shippingAgg,
    courierAgg,
    shippingSeries,
    courierSeries,
    overquotaAgg,
  } = useMemo(() => {
    const norm = (s) =>
      String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const mapShip = new Map();
    const mapCour = new Map();

    let shipAmount = 0,
      shipCount = 0,
      courAmount = 0,
      courCount = 0;
    let overquotaAmount = 0;
    let overquotaCount = 0;

    const isOverquotaName = (name) => {
      const n = norm(name);
      return (
        /(pakiet|pakiety)/.test(n) &&
        /(poza|ponad|nadlimit|nadprogramow)/.test(n) &&
        /(abonamentem|abonament)/.test(n)
      );
    };

    for (const inv of invoices) {
      const ym = ymOf(inv?.issueDate || inv?.issue_date);
      const items = Array.isArray(inv?.items) ? inv.items : [];
      for (const it of items) {
        const name = norm(it?.name ?? it?.title ?? it?.description ?? "");
        const qty = itemQty(it);
        const amt = itemGross(it);

        const isShipping = /wysyl|wysył/.test(name);
        const isCourier = /kurier|dojazd/.test(name);
        const isOverquota = isOverquotaName(name);

        if (isShipping) {
          shipAmount += amt;
          shipCount += qty;
          if (ym) {
            if (!mapShip.has(ym)) mapShip.set(ym, { amount: 0, count: 0 });
            const b = mapShip.get(ym);
            b.amount += amt;
            b.count += qty;
          }
        }
        if (isCourier) {
          courAmount += amt;
          courCount += qty;
          if (ym) {
            if (!mapCour.has(ym)) mapCour.set(ym, { amount: 0, count: 0 });
            const b = mapCour.get(ym);
            b.amount += amt;
            b.count += qty;
          }
        }
        if (isOverquota) {
          overquotaAmount += amt;
          overquotaCount += qty;
        }
      }
    }

    const ymsShip = Array.from(mapShip.keys()).sort();
    const ymsCour = Array.from(mapCour.keys()).sort();

    return {
      shippingAgg: { amount: shipAmount, count: shipCount },
      courierAgg: { amount: courAmount, count: courCount },
      shippingSeries: {
        amount: ymsShip.map((k) => ({
          label: k,
          value: mapShip.get(k).amount,
        })),
        count: ymsShip.map((k) => ({ label: k, value: mapShip.get(k).count })),
      },
      courierSeries: {
        amount: ymsCour.map((k) => ({
          label: k,
          value: mapCour.get(k).amount,
        })),
        count: ymsCour.map((k) => ({ label: k, value: mapCour.get(k).count })),
      },
      overquotaAgg: { amount: overquotaAmount, count: overquotaCount },
    };
  }, [invoices]);

  const packagesAgg = {
    total: Number(lastPackagesFromSeries || 0),
    overquotaCount: Number(overquotaAgg?.count || 0),
    overquotaValue: Number(overquotaAgg?.amount || 0),
    potential: Number(data?.kpis?.potentialCapacity || 0),
    potentialUsedPct:
      Number(data?.kpis?.potentialCapacity || 0) > 0
        ? (Number(lastPackagesFromSeries || 0) /
            Number(data?.kpis?.potentialCapacity || 0)) *
          100
        : 0,
  };

  const activeSeries = useMemo(() => {
    if (activeMetric.group === "revenue") {
      if (activeMetric.key === "total") return revenueSeries;
      if (activeMetric.key === "abon") return revenueAbonSeries;
      if (activeMetric.key === "perpiece") return revenuePerpieceSeries;
      if (activeMetric.key === "shippingAmount") return shippingSeries.amount;
      if (activeMetric.key === "shippingCount") return shippingSeries.count;
      if (activeMetric.key === "courierAmount") return courierSeries.amount;
      if (activeMetric.key === "courierCount") return courierSeries.count;
      return revenueSeries;
    }
    if (activeMetric.group === "clients") return [];
    if (activeMetric.group === "packages") {
      if (activeMetric.key === "total") return packagesSeries;
      if (activeMetric.key === "overquotaCount")
        return packagesOverquotaCountSeries;
      if (activeMetric.key === "overquotaValue")
        return packagesOverquotaValueSeries;
      return packagesSeries;
    }
    if (activeMetric.group === "payments") {
      if (activeMetric.key === "paidAmount") return paymentsSeries.paidAmount;
      if (activeMetric.key === "paidCount") return paymentsSeries.paidCount;
      if (activeMetric.key === "unpaidAmount")
        return paymentsSeries.unpaidAmount;
      if (activeMetric.key === "unpaidCount") return paymentsSeries.unpaidCount;
      return paymentsSeries.paidAmount;
    }
    return [];
  }, [
    activeMetric,
    revenueSeries,
    revenueAbonSeries,
    revenuePerpieceSeries,
    packagesSeries,
    packagesOverquotaCountSeries,
    packagesOverquotaValueSeries,
    paymentsSeries,
    shippingSeries,
    courierSeries,
  ]);

  const activeUnit =
    activeMetric.unit ||
    (activeMetric.group === "payments" &&
      (activeMetric.key.includes("Amount") ? "PLN" : "")) ||
    (activeMetric.group === "revenue" &&
      (activeMetric.key.includes("Amount")
        ? "PLN"
        : activeMetric.key.includes("Count")
        ? ""
        : "PLN")) ||
    (activeMetric.group === "packages" ? "" : "");

  const activeLabel = activeMetric.label || "";

  /* ===== UI ===== */
  const yearOptions = useMemo(() => {
    const start = 2022;
    const end = thisYear;
    return Array.from({ length: end - start + 1 }, (_, i) => String(start + i));
  }, [thisYear]);

  const shippingTotalWithPSL =
    Number(shippingAgg.amount || 0) +
    Number(data?.kpis?.pslShippingAmount || 0);
  const shippingCountWithPSL =
    Number(shippingAgg.count || 0) + Number(data?.kpis?.pslShippingCount || 0);
  const courierTotalWithPSL = Number(courierAgg.amount || 0);
  const courierCountWithPSL = Number(courierAgg.count || 0);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4 h-screen overflow-y-auto">
      <h1 className="text-2xl font-bold">📊 Statystyki</h1>

      <div className="card-lg space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm mb-1">Rok</label>
            <select
              className="input"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              title="Wybierz rok"
            >
              <option value="">— dowolny —</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Miesiąc</label>
            <select
              className="input"
              value={month}
              onChange={(e) => {
                const v = e.target.value;
                setMonth(v);
                if (!year && v) setYear(String(thisYear));
              }}
              title="Wybierz miesiąc"
            >
              <option value="">— dowolny —</option>
              {[
                ["01", "styczeń"],
                ["02", "luty"],
                ["03", "marzec"],
                ["04", "kwiecień"],
                ["05", "maj"],
                ["06", "czerwiec"],
                ["07", "lipiec"],
                ["08", "sierpień"],
                ["09", "wrzesień"],
                ["10", "październik"],
                ["11", "listopad"],
                ["12", "grudzień"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm mb-1">Od</label>
            <input
              type="date"
              className="input"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setMode("custom");
                setYear("");
                setMonth("");
              }}
              title="Data początkowa"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Do</label>
            <input
              type="date"
              className="input"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setMode("custom");
                setYear("");
                setMonth("");
              }}
              title="Data końcowa"
            />
          </div>

          <div className="flex-1" />
        </div>

        <div className="flex flex-wrap gap-2">
          <div>
            <label className="block text-sm mb-1">Szybki zakres</label>
            <select
              className="input"
              value={mode}
              onChange={(e) => applyQuick(e.target.value)}
              title="Wybierz szybki zakres"
            >
              <option value="custom">— własny —</option>
              <option value="thisMonth">Bieżący miesiąc</option>
              <option value="lastMonth">Poprzedni miesiąc</option>
              <option value="last12">Ostatnie 12 miesięcy</option>
            </select>
          </div>
        </div>

        <div className="mt-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-2">
            <div className="flex flex-wrap gap-2">
              {[
                ["revenue", "Dochody"],
                ["clients", "Klienci"],
                ["packages", "Pakiety"],
                ["payments", "Płatności"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={
                    "px-3 py-1.5 rounded border transition " +
                    (tab === key
                      ? "bg-blue-600 text-white border-blue-700 shadow"
                      : "bg-white text-blue-700 border-blue-300 hover:bg-blue-100")
                  }
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {data && (
          <div className="text-sm text-gray-600">
            Zakres: {data.range?.from || from} → {data.range?.to || to}
            {mode === "lastMonth" ? (
              <span className="ml-2 px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                Poprzedni miesiąc: {year}-{month}
              </span>
            ) : null}
          </div>
        )}

        {error && <div className="text-sm text-rose-700">{error}</div>}
      </div>

      <div className="card-lg">
        <div className="font-semibold mb-2">
          {activeLabel ||
            (tab === "revenue"
              ? "Przychód miesięczny"
              : tab === "packages"
              ? "Pakiety miesięcznie"
              : tab === "payments"
              ? "Płatności (miesięcznie)"
              : "")}
        </div>
        <LineChart data={activeSeries} label={activeUnit || ""} />
        {(loading || loadingInvoices) && (
          <div className="text-sm text-gray-500 mt-2">Ładowanie…</div>
        )}
      </div>

      {tab === "revenue" && (
        <>
          <div className="grid items-stretch grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <StatCard
              title="Przychód ogółem"
              value={revenueAggBackend.total}
              unit="zł"
              onClick={() =>
                setActiveMetric({
                  group: "revenue",
                  key: "total",
                  label: "Przychód ogółem",
                  unit: "PLN",
                })
              }
              isActive={
                activeMetric.group === "revenue" && activeMetric.key === "total"
              }
            />
            <StatCard
              title="Klienci z abonamentem"
              value={revenueAggBackend.abon}
              unit="zł"
              onClick={() =>
                setActiveMetric({
                  group: "revenue",
                  key: "abon",
                  label: "Przychód od klientów z abonamentem",
                  unit: "PLN",
                })
              }
              isActive={
                activeMetric.group === "revenue" && activeMetric.key === "abon"
              }
            />
            <StatCard
              title="Przychód od klientów prywatnych"
              value={revenueAggBackend.perpiece}
              unit="zł"
              onClick={() =>
                setActiveMetric({
                  group: "revenue",
                  key: "perpiece",
                  label: "Przychód з klientów prywatnych",
                  unit: "PLN",
                })
              }
              isActive={
                activeMetric.group === "revenue" &&
                activeMetric.key === "perpiece"
              }
            />
            <StatCard
              title="Przychód od wysyłek"
              note={`Ilość: ${to0(shippingCountWithPSL)}`}
              value={shippingTotalWithPSL}
              unit="zł"
              onClick={() =>
                setActiveMetric({
                  group: "revenue",
                  key: "shippingAmount",
                  label: "Przychód od wysyłek",
                  unit: "PLN",
                })
              }
              isActive={
                activeMetric.group === "revenue" &&
                activeMetric.key === "shippingAmount"
              }
            />
            <StatCard
              title="Przychód od dojazdów kuriera"
              value={courierTotalWithPSL}
              unit="zł"
              note={`Ilość: ${to0(courierCountWithPSL)}`}
              onClick={() =>
                setActiveMetric({
                  group: "revenue",
                  key: "courierAmount",
                  label: "Przychód od dojazdów kuriera",
                  unit: "PLN",
                })
              }
              isActive={
                activeMetric.group === "revenue" &&
                activeMetric.key === "courierAmount"
              }
            />
          </div>
        </>
      )}

      {tab === "clients" && data && (
        <>
          <div className="grid items-stretch grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <StatCard
              title="Nowi klienci"
              value={clientsAgg.newClients}
              onClick={() =>
                setActiveMetric({
                  group: "clients",
                  key: "new",
                  label: "Nowi klienci (miesięcznie)",
                })
              }
              isActive={
                activeMetric.group === "clients" && activeMetric.key === "new"
              }
            />
            <StatCard
              title="Przeniesieni do archiwum"
              value={clientsAgg.archived}
              onClick={() =>
                setActiveMetric({
                  group: "clients",
                  key: "archived",
                  label: "Przeniesieni do archiwum (miesięcznie)",
                })
              }
              isActive={
                activeMetric.group === "clients" &&
                activeMetric.key === "archived"
              }
            />
            <StatCard
              title="Klienci z abonamentem"
              value={clientsAgg.abonClients}
              onClick={() =>
                setActiveMetric({
                  group: "clients",
                  key: "abonAll",
                  label: "Klienci z abonamentem",
                })
              }
              isActive={
                activeMetric.group === "clients" &&
                activeMetric.key === "abonAll"
              }
            />
            <StatCard
              title="Aktywni klienci abonamentowi"
              value={clientsAgg.activeClients}
              onClick={() =>
                setActiveMetric({
                  group: "clients",
                  key: "active",
                  label: "Aktywni klienci abonamentowi",
                })
              }
              isActive={
                activeMetric.group === "clients" &&
                activeMetric.key === "active"
              }
            />
            <StatCard
              title="Aktywni klienci prywatni"
              value={clientsAgg.perpieceActive}
              onClick={() =>
                setActiveMetric({
                  group: "clients",
                  key: "perpieceActive",
                  label: "Aktywni klienci prywatni",
                })
              }
              isActive={
                activeMetric.group === "clients" &&
                activeMetric.key === "perpieceActive"
              }
            />
          </div>
        </>
      )}

      {tab === "packages" && data && (
        <>
          <div className="grid items-stretch grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <StatCard
              title="Ilość pakietów abonamentowych"
              value={packagesAgg.total}
              onClick={() =>
                setActiveMetric({
                  group: "packages",
                  key: "total",
                  label: "Pakiety abonamentowe",
                })
              }
              isActive={
                activeMetric.group === "packages" &&
                activeMetric.key === "total"
              }
            />
            <StatCard
              title="Ilość pakietów poza abonamentem"
              value={packagesAgg.overquotaCount}
              onClick={() =>
                setActiveMetric({
                  group: "packages",
                  key: "overquotaCount",
                  label: "Pakiety poza abonamentem",
                })
              }
              isActive={
                activeMetric.group === "packages" &&
                activeMetric.key === "overquotaCount"
              }
            />
            <StatCard
              title="Wartość sterylizacji poza abonamentem"
              value={packagesAgg.overquotaValue}
              unit="zł"
              onClick={() =>
                setActiveMetric({
                  group: "packages",
                  key: "overquotaValue",
                  label: "Wartość pakietów poza abonamentem",
                  unit: "PLN",
                })
              }
              isActive={
                activeMetric.group === "packages" &&
                activeMetric.key === "overquotaValue"
              }
            />
            <StatCard
              title="Potencjalna ilość pakietów"
              value={packagesAgg.potential}
            />
            <StatCard
              title="Wykorzystanie potencjału"
              value={packagesAgg.potentialUsedPct}
              unit="%"
              onClick={() =>
                setActiveMetric({
                  group: "packages",
                  key: "total",
                  label: "Pakiety miesięcznie (ogółem)",
                })
              }
              isActive={false}
            />
          </div>
        </>
      )}

      {tab === "payments" && (
        <>
          <div className="grid items-stretch grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <StatCard
              title="Opłacone (kwota)"
              value={paymentsAgg.paidAmount}
              unit="zł"
              note={`Udział: ${to2(paymentsAgg.paidPct)}%`}
              onClick={() =>
                setActiveMetric({
                  group: "payments",
                  key: "paidAmount",
                  label: "Opłacone — kwota (miesięcznie)",
                  unit: "PLN",
                })
              }
              isActive={
                activeMetric.group === "payments" &&
                activeMetric.key === "paidAmount"
              }
            />
            <StatCard
              title="Opłacone (liczba)"
              value={paymentsAgg.paidCount}
              onClick={() =>
                setActiveMetric({
                  group: "payments",
                  key: "paidCount",
                  label: "Opłacone — liczba faktur (miesięcznie)",
                })
              }
              isActive={
                activeMetric.group === "payments" &&
                activeMetric.key === "paidCount"
              }
            />
            <StatCard
              title="Nieopłacone (kwota)"
              value={paymentsAgg.unpaidAmount}
              unit="zł"
              note={`Udział: ${to2(paymentsAgg.unpaidPct)}%`}
              onClick={() =>
                setActiveMetric({
                  group: "payments",
                  key: "unpaidAmount",
                  label: "Nieopłacone — kwota (miesięcznie)",
                  unit: "PLN",
                })
              }
              isActive={
                activeMetric.group === "payments" &&
                activeMetric.key === "unpaidAmount"
              }
            />
            <StatCard
              title="Nieopłacone (liczba)"
              value={paymentsAgg.unpaidCount}
              onClick={() =>
                setActiveMetric({
                  group: "payments",
                  key: "unpaidCount",
                  label: "Nieopłacone — liczba faktur (miesięcznie)",
                })
              }
              isActive={
                activeMetric.group === "payments" &&
                activeMetric.key === "unpaidCount"
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
