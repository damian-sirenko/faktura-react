// src/pages/StatsPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

const todayISO = () => new Date().toISOString().slice(0, 10);
const addMonths = (iso, n) => {
  const d = iso ? new Date(iso) : new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};
const firstOfMonth = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};
const to2 = (x) => Number(x || 0).toFixed(2);

// ✅ невеличкий утилітний експорт у CSV
const downloadCsv = (rows, headers, filename = "export.csv") => {
  const esc = (v) => {
    const s = String(v ?? "");
    // якщо є коми/лапки/переноси — загортаємо в лапки та екрануємо подвійну лапку
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = headers.map((h) => esc(h.label)).join(",");
  const body = rows
    .map((r) => headers.map((h) => esc(h.get(r))).join(","))
    .join("\r\n");
  const csv = `${head}\r\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

function LineChart({ data, height = 240, label = "PLN" }) {
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

        {/* лінія */}
        <path d={path} fill="none" stroke="#2563eb" strokeWidth="2.5" />
        {/* точки + title (tooltip браузера) */}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.value)} r="3" fill="#2563eb">
              <title>
                {d.label}: {to2(d.value)} {label}
              </title>
            </circle>
          </g>
        ))}

        <text x={12} y={16} fontSize="11" fill="#374151">
          {label}
        </text>
      </svg>
    </div>
  );
}

export default function StatsPage() {
  const [mode, setMode] = useState("last12"); // last12 | thisMonth | lastMonth | ytd | custom
  const [from, setFrom] = useState(firstOfMonth(addMonths(todayISO(), -11)));
  const [to, setTo] = useState(todayISO());

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(""); // ✅ покажемо помилку в UI
  const abortRef = useRef(null); // ✅ скасування попередніх запитів

  const applyPreset = (m) => {
    setMode(m);
    const today = todayISO();
    if (m === "thisMonth") {
      setFrom(firstOfMonth(today));
      setTo(today);
    } else if (m === "lastMonth") {
      const f = firstOfMonth(addMonths(today, -1));
      setFrom(f);
      setTo(addMonths(f, 1));
    } else if (m === "ytd") {
      const d = new Date();
      const y0 = `${d.getFullYear()}-01-01`;
      setFrom(y0);
      setTo(today);
    } else if (m === "last12") {
      const f = firstOfMonth(addMonths(today, -11));
      setFrom(f);
      setTo(today);
    } else if (m === "custom") {
      // залишаємо як є
    }
  };

  useEffect(() => {
    applyPreset("last12");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ якщо користувач помилково вибрав from > to — обережно міняємо місцями
  useEffect(() => {
    if (!from || !to) return;
    const df = new Date(from);
    const dt = new Date(to);
    if (df > dt) {
      // swap
      setFrom(to);
      setTo(from);
    }
  }, [from, to]);

  const load = async () => {
    // відміняємо попередній запит
    abortRef.current?.abort?.();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError("");
    try {
      const r = await fetch("/analytics/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
        signal: ac.signal,
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      setData(d);
    } catch (e) {
      if (e.name === "AbortError") return; // тихо, зроблено навмисно
      setError("Błąd pobierania statystyk.");
      alert("Błąd pobierania statystyk."); // оригінальну поведінку лишаю
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const revenueSeries = useMemo(
    () =>
      (data?.monthly || []).map((m) => ({
        label: m.ym,
        value: Number(m.total || 0),
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

  const lastRet = data?.retention?.last || null;

  // ✅ експорт кнопки
  const exportMonthsCsv = () => {
    const rows = (data?.monthly || []).map((m) => ({
      ym: m.ym,
      total: Number(m.total || 0),
      packages:
        (data?.monthlyPackages || []).find((p) => p.ym === m.ym)?.packages ?? 0,
    }));
    downloadCsv(
      rows,
      [
        { label: "Miesiąc", get: (r) => r.ym },
        { label: "Przychód (brutto)", get: (r) => to2(r.total) },
        { label: "Pakiety (szt.)", get: (r) => r.packages },
      ],
      "miesiace.csv"
    );
  };
  const exportClientsCsv = () => {
    const rows = data?.byClient || [];
    downloadCsv(
      rows,
      [
        { label: "Klient", get: (r) => r.client },
        { label: "Przychód (brutto)", get: (r) => to2(r.total) },
      ],
      "klienci.csv"
    );
  };

  const noData =
    !loading &&
    data &&
    revenueSeries.length === 0 &&
    packagesSeries.length === 0 &&
    !(data?.byClient || []).length;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">📊 Statystyki</h1>

      {/* Фільтри */}
      <div className="card-lg space-y-3">
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-sm mb-1">Zakres</label>
            <select
              className="input"
              value={mode}
              onChange={(e) => applyPreset(e.target.value)}
            >
              <option value="last12">Ostatnie 12 mies.</option>
              <option value="thisMonth">Bieżący miesiąc</option>
              <option value="lastMonth">Poprzedni miesiąc</option>
              <option value="ytd">YTD (od 01.01)</option>
              <option value="custom">Własny zakres</option>
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
              }}
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
              }}
            />
          </div>

          <div className="flex-1" />

          <div className="flex gap-2">
            <button
              className="btn-secondary"
              onClick={exportMonthsCsv}
              disabled={
                !data ||
                (!data.monthly?.length && !data.monthlyPackages?.length)
              }
              title="Eksport miesięcy do CSV"
            >
              CSV: Miesiące
            </button>
            <button
              className="btn-secondary"
              onClick={exportClientsCsv}
              disabled={!data || !(data.byClient || []).length}
              title="Eksport klientów do CSV"
            >
              CSV: Klienci
            </button>
            <button className="btn-secondary" onClick={load} disabled={loading}>
              {loading ? "…" : "Odśwież"}
            </button>
          </div>
        </div>

        {data && (
          <div className="text-sm text-gray-600">
            Zakres: {data.range?.from} → {data.range?.to}
          </div>
        )}
        {error && <div className="text-sm text-rose-700">{error}</div>}
      </div>

      {/* Якщо зовсім немає даних */}
      {noData && (
        <div className="card p-6 text-center text-gray-600">
          Brak danych w wybranym zakresie.
        </div>
      )}

      {/* KPI: базові + retention */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="card text-center">
            <div className="text-xs text-gray-500">Nowi klienci</div>
            <div className="text-2xl font-bold">
              {data.kpis?.newClients ?? 0}
            </div>
          </div>
          <div className="card text-center">
            <div className="text-xs text-gray-500">Aktywni klienci</div>
            <div className="text-2xl font-bold">
              {data.kpis?.activeClients ?? 0}
            </div>
          </div>
          <div className="card text-center">
            <div className="text-xs text-gray-500">Pakiety</div>
            <div className="text-2xl font-bold">{data.kpis?.packages ?? 0}</div>
          </div>
          <div className="card text-center">
            <div className="text-xs text-gray-500">Przychód (brutto)</div>
            <div className="text-2xl font-bold">
              {to2(data.kpis?.revenue?.total ?? 0)} zł
            </div>
          </div>
          <div className="card text-center">
            <div className="text-xs text-gray-500">Retencja (ostatni m-c)</div>
            <div className="text-2xl font-bold">
              {lastRet
                ? `${(Number(lastRet.retentionRate || 0) * 100).toFixed(0)}%`
                : "—"}
            </div>
          </div>
          <div className="card text-center">
            <div className="text-xs text-gray-500">Śr. retencja</div>
            <div className="text-2xl font-bold">
              {data.retention
                ? `${(
                    Number(data.retention.avgRetentionRate || 0) * 100
                  ).toFixed(0)}%`
                : "—"}
            </div>
          </div>
        </div>
      )}

      {/* Розбивка доходу */}
      {data && (
        <div className="card-lg">
          <div className="font-semibold mb-2">Struktura przychodu</div>
          <div className="grid md:grid-cols-5 gap-2 text-center">
            <div className="p-3 rounded bg-blue-50">
              <div className="text-xs text-gray-600">Abonamenty</div>
              <div className="text-lg font-bold">
                {to2(data.kpis?.revenue?.abon ?? 0)} zł
              </div>
            </div>
            <div className="p-3 rounded bg-blue-50">
              <div className="text-xs text-gray-600">Poza abonamentem</div>
              <div className="text-lg font-bold">
                {to2(data.kpis?.revenue?.overquota ?? 0)} zł
              </div>
            </div>
            <div className="p-3 rounded bg-blue-50">
              <div className="text-xs text-gray-600">Wysyłka</div>
              <div className="text-lg font-bold">
                {to2(data.kpis?.revenue?.shipping ?? 0)} zł
              </div>
            </div>
            <div className="p-3 rounded bg-blue-50">
              <div className="text-xs text-gray-600">Dojazd kuriera</div>
              <div className="text-lg font-bold">
                {to2(data.kpis?.revenue?.courier ?? 0)} zł
              </div>
            </div>
            <div className="p-3 rounded bg-blue-50">
              <div className="text-xs text-gray-600">Inne</div>
              <div className="text-lg font-bold">
                {to2(data.kpis?.revenue?.other ?? 0)} zł
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ARPU (ост. місяць + середній), по сегментах */}
      {data && (
        <div className="card-lg space-y-3">
          <div className="font-semibold">ARPU — przychód/klient/mies.</div>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="card text-center">
              <div className="text-xs text-gray-500">Ostatni m-c (ogółem)</div>
              <div className="text-2xl font-bold">
                {to2(data.arpu?.latestMonth?.overall ?? 0)} zł
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Średnio: {to2(data.arpu?.averageMonthly?.overall ?? 0)} zł
              </div>
            </div>
            <div className="card text-center">
              <div className="text-xs text-gray-500">
                Firma / OP (ostatni m-c)
              </div>
              <div className="text-sm">
                <b>Firma:</b> {to2(data.arpu?.latestMonth?.byType?.firma ?? 0)}{" "}
                zł
              </div>
              <div className="text-sm">
                <b>OP:</b> {to2(data.arpu?.latestMonth?.byType?.op ?? 0)} zł
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Śr. Firma: {to2(data.arpu?.averageMonthly?.byType?.firma ?? 0)}{" "}
                zł • Śr. OP: {to2(data.arpu?.averageMonthly?.byType?.op ?? 0)}{" "}
                zł
              </div>
            </div>
            <div className="card text-center">
              <div className="text-xs text-gray-500">
                Abonament / Na sztuki (ostatni m-c)
              </div>
              <div className="text-sm">
                <b>Abon:</b>{" "}
                {to2(data.arpu?.latestMonth?.byBilling?.abonament ?? 0)} zł
              </div>
              <div className="text-sm">
                <b>Na szt.:</b>{" "}
                {to2(data.arpu?.latestMonth?.byBilling?.perpiece ?? 0)} zł
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Śr. Abon:{" "}
                {to2(data.arpu?.averageMonthly?.byBilling?.abonament ?? 0)} zł •
                Śr. Na szt.:{" "}
                {to2(data.arpu?.averageMonthly?.byBilling?.perpiece ?? 0)} zł
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Графіки */}
      {data && (
        <div className="grid md:grid-cols-1 gap-4">
          <div className="card-lg">
            <div className="font-semibold mb-2">Przychód miesięczny</div>
            <LineChart data={revenueSeries} label="PLN (brutto)" />
          </div>
          <div className="card-lg">
            <div className="font-semibold mb-2">Pakiety miesięcznie</div>
            <LineChart data={packagesSeries} label="Pakiety (szt.)" />
          </div>
        </div>
      )}

      {/* Top klienci */}
      {data && (
        <div className="card-lg">
          <div className="font-semibold mb-2">Top klienci (przychód)</div>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Klient</th>
                  <th className="text-right">Przychód (zł)</th>
                </tr>
              </thead>
              <tbody>
                {(data.byClient || []).map((r) => (
                  <tr key={r.client}>
                    <td>{r.client}</td>
                    <td className="text-right">{to2(r.total)}</td>
                  </tr>
                ))}
                {!(data.byClient || []).length && (
                  <tr>
                    <td colSpan={2} className="text-center py-4 text-gray-500">
                      Brak danych.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
