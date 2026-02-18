import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/base";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";

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

const to2 = (v) => Number(v || 0).toFixed(2);

const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

const ymStartDate = (ym) => {
  const [Y, M] = String(ym)
    .split("-")
    .map((x) => parseInt(x, 10));
  return new Date(Y, M - 1, 1);
};

const ymEndDate = (ym) => {
  const [Y, M] = String(ym)
    .split("-")
    .map((x) => parseInt(x, 10));
  return new Date(Y, M, 0); // останній день місяця
};

const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const PL_MONTHS = [
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

const ymToPL = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return `${PL_MONTHS[m - 1]} ${y}`;
};

export default function StatsPage() {
  const now = new Date();
  const DEFAULT_START_YM = "2025-10";

  const currentYear = now.getFullYear();

  const [startYm, setStartYm] = useState(DEFAULT_START_YM);

  const [endYm, setEndYm] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  );

  const [monthly, setMonthly] = useState([]);
  const [paymentsMonthly, setPaymentsMonthly] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [chartMetric, setChartMetric] = useState(null);
  const [activeTab, setActiveTab] = useState("revenue"); // revenue | payments

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const { headers } = getAuth();

        const from = toISO(ymStartDate(startYm));
        const to = toISO(ymEndDate(endYm));
        if (ymStartDate(startYm) > ymEndDate(endYm)) {
          setMonthly([]);
          setPaymentsMonthly([]);
          setLoading(false);
          return;
        }

        const r = await apiFetch("/analytics/query", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ from, to }),
          cache: "no-store",
        });

        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        console.log("[ANALYTICS] raw response:", d);
        console.log("[ANALYTICS] monthly:", d?.monthly);

        console.log("API /analytics/query response:", d);
        console.log("monthly from API:", d?.monthly);
        console.log("monthly length:", d?.monthly?.length);

        const normalized = Array.isArray(d?.monthly)
          ? d.monthly.map((m) => ({
              ym: m.ym,

              total: Number(m.total || 0),

              abon: Number(m.abon?.total || 0),
              abon_base: Number(m.abon?.abon || 0),
              abon_shipping: Number(m.abon?.shipping || 0),
              abon_courier: Number(m.abon?.courier || 0),
              abon_overquota: Number(m.abon?.overquota || 0),

              perpiece_total: Number(m.perpiece?.total || 0),
              perpiece_shipping: Number(m.perpiece?.shipping || 0),
              perpiece_service: Number(m.perpiece?.service || 0),
            }))
          : [];

        setMonthly(normalized);
        setPaymentsMonthly(
          Array.isArray(d?.paymentsMonthly) ? d.paymentsMonthly : []
        );
      } catch (e) {
        console.error(e);
        setError("Błąd pobierania danych.");
        setMonthly([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [startYm, endYm]);

  console.log("RENDER monthly:", monthly);

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <div className="card-lg border-2 border-blue-200 bg-blue-50/60">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">Statystyki</h1>

          <div className="flex gap-4 flex-wrap items-end">
            <div>
              <label className="block text-sm mb-1">Od</label>
              <input
                className="input"
                type="month"
                value={startYm}
                onChange={(e) => setStartYm(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm mb-1">Do</label>
              <input
                className="input"
                type="month"
                value={endYm}
                onChange={(e) => setEndYm(e.target.value)}
              />
            </div>
          </div>
        </div>

        {error && <div className="text-sm text-rose-700 mt-2">{error}</div>}
      </div>

      <div className="card-lg">
        <div className="flex gap-2">
          <button
            className={`px-4 py-2 rounded ${
              activeTab === "revenue"
                ? "bg-blue-600 text-white"
                : "bg-slate-100 hover:bg-slate-200"
            }`}
            onClick={() => {
              setActiveTab("revenue");
              setChartMetric(null);
            }}
          >
            Dochody
          </button>

          <button
            className={`px-4 py-2 rounded ${
              activeTab === "payments"
                ? "bg-blue-600 text-white"
                : "bg-slate-100 hover:bg-slate-200"
            }`}
            onClick={() => {
              setActiveTab("payments");
              setChartMetric(null);
            }}
          >
            Płatności
          </button>
        </div>
      </div>

      {activeTab === "revenue" && (
        <div className="card-lg">
          <div className="w-full">
            {console.log("[RENDER] monthly state:", monthly)}
            {chartMetric && chartMetric.type === "total" && (
              <div className="card-lg mb-4">
                <h3 className="text-sm mb-2">{chartMetric.label}</h3>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer className="outline-none">
                    <BarChart
                      data={monthly}
                      tabIndex={-1}
                      margin={{ top: 30, right: 10, left: 10, bottom: 10 }}
                    >
                      <XAxis dataKey="ym" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey={chartMetric.key} fill="#4e8580">
                        <LabelList
                          dataKey={chartMetric.key}
                          position="top"
                          formatter={(v) => Number(v || 0).toFixed(2)}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {chartMetric && chartMetric.type === "abon" && (
              <div className="card-lg mb-4">
                <h3 className="text-sm mb-2">{chartMetric.label}</h3>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer className="outline-none pointer-events-none">
                    <BarChart
                      data={monthly}
                      tabIndex={-1}
                      margin={{ top: 30, right: 10, left: 10, bottom: 10 }}
                    >
                      <XAxis dataKey="ym" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey={chartMetric.key} fill="#4e8580">
                        <LabelList
                          dataKey={chartMetric.key}
                          position="top"
                          formatter={(v) => Number(v || 0).toFixed(2)}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            <h2 className="text-lg mb-2 font-semibold">
              Klienci z abonamentem
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm border-collapse table-fixed">
                <thead className="bg-slate-100 border border-[#b7d2cd]">
                  <tr>
                    <th className="border border-[#b7d2cd] px-3 py-2 text-left w-[260px] sticky left-0 bg-slate-100 z-10">
                      Wskaźnik
                    </th>

                    {monthly.map((m) => (
                      <th
                        key={ymToPL(m.ym)}
                        className="border border-[#b7d2cd] px-3 py-2 text-right"
                      >
                        {ymToPL(m.ym)}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  <tr>
                    <td
                      className="border border-[#b7d2cd] px-3 py-2 font-semibold cursor-pointer hover:text-[#4e8580] sticky left-0 bg-white z-10"
                      onClick={() =>
                        setChartMetric({
                          type: "total",
                          key: "total",
                          label: "Przychód ogółem",
                        })
                      }
                    >
                      Przychód ogółem
                    </td>

                    {monthly.map((m) => (
                      <td
                        key={m.ym}
                        className="border border-[#b7d2cd] px-3 py-2 text-right"
                      >
                        {to2(m.total)}
                      </td>
                    ))}
                  </tr>

                  <tr className="bg-slate-50">
                    <td
                      className="border border-[#b7d2cd] px-3 py-2 cursor-pointer font-semibold hover:text-[#4e8580] sticky left-0 bg-white z-10"
                      onClick={() =>
                        setChartMetric({
                          type: "abon",
                          key: "abon",
                          label: "Klienci z abonamentem",
                        })
                      }
                    >
                      Klienci z abonamentem
                    </td>

                    {monthly.map((m) => (
                      <td
                        key={m.ym}
                        className="border border-[#b7d2cd] px-3 py-2 text-right"
                      >
                        {to2(m.abon)}
                      </td>
                    ))}
                  </tr>

                  <tr className="bg-slate-50">
                    <td
                      className="border border-[#b7d2cd] px-3 py-2 cursor-pointer hover:text-[#4e8580] sticky left-0 bg-white z-10"
                      onClick={() =>
                        setChartMetric({
                          type: "abon",
                          key: "abon_base",
                          label: "Baza abonamentu",
                        })
                      }
                    >
                      * Baza abonamentu
                    </td>

                    {monthly.map((m) => (
                      <td
                        key={m.ym}
                        className="border border-[#b7d2cd] px-3 py-2 text-right"
                      >
                        {to2(m.abon_base)}
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <td
                      className="border border-[#b7d2cd] px-3 py-2 cursor-pointer hover:text-[#4e8580] sticky left-0 bg-white z-10"
                      onClick={() =>
                        setChartMetric({
                          type: "abon",
                          key: "abon_shipping",
                          label: "Wysyłka (abonament)",
                        })
                      }
                    >
                      * Wysyłka
                    </td>

                    {monthly.map((m) => (
                      <td
                        key={m.ym}
                        className="border border-[#b7d2cd] px-3 py-2 text-right"
                      >
                        {to2(m.abon_shipping)}
                      </td>
                    ))}
                  </tr>

                  <tr className="bg-slate-50">
                    <td
                      className="border border-[#b7d2cd] px-3 py-2 cursor-pointer hover:text-[#4e8580] sticky left-0 bg-white z-10"
                      onClick={() =>
                        setChartMetric({
                          type: "abon",
                          key: "abon_courier",
                          label: "Dojazd kuriera",
                        })
                      }
                    >
                      * Dojazd kuriera
                    </td>

                    {monthly.map((m) => (
                      <td
                        key={m.ym}
                        className="border border-[#b7d2cd] px-3 py-2 text-right"
                      >
                        {to2(m.abon_courier)}
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <td
                      className="border border-[#b7d2cd] px-3 py-2 cursor-pointer hover:text-[#4e8580] sticky left-0 bg-white z-10"
                      onClick={() =>
                        setChartMetric({
                          type: "abon",
                          key: "abon_overquota",
                          label: "Pakiety poza abonamentem",
                        })
                      }
                    >
                      * Pakiety poza abonamentem
                    </td>

                    {monthly.map((m) => (
                      <td
                        key={m.ym}
                        className="border border-[#b7d2cd] px-3 py-2 text-right"
                      >
                        {to2(m.abon_overquota)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {chartMetric && chartMetric.type === "perpiece" && (
              <div className="card-lg mb-4">
                <h3 className="text-sm mb-2">{chartMetric.label}</h3>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer className="outline-none pointer-events-none">
                    <BarChart
                      data={monthly}
                      tabIndex={-1}
                      margin={{ top: 30, right: 10, left: 10, bottom: 10 }}
                    >
                      <XAxis dataKey="ym" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey={chartMetric.key} fill="#4e8580">
                        <LabelList
                          dataKey={chartMetric.key}
                          position="top"
                          formatter={(v) => Number(v || 0).toFixed(2)}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <h2 className="text-lg mb-2 font-semibold mt-6">
              Sterylizacja na sztuki
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm border-collapse">
                <thead className="bg-slate-100 border border-[#b7d2cd]">
                  <tr>
                    <th className="border border-[#b7d2cd] px-3 py-2 text-left w-[260px] sticky left-0 bg-slate-100 z-10">
                      Wskaźnik
                    </th>
                    {monthly.map((m) => (
                      <th
                        key={m.ym}
                        className="border border-[#b7d2cd] px-3 py-2 text-right"
                      >
                        {ymToPL(m.ym)}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  <tr>
                    <td
                      className="border border-[#b7d2cd] px-3 py-2 cursor-pointer font-semibold hover:text-[#4e8580] sticky left-0 bg-white z-10"
                      onClick={() =>
                        setChartMetric({
                          type: "perpiece",
                          key: "perpiece_total",
                          label: "Razem (na sztuki)",
                        })
                      }
                    >
                      Razem (na sztuki)
                    </td>

                    {monthly.map((m) => (
                      <td
                        key={m.ym}
                        className="border border-[#b7d2cd] px-3 py-2 text-right"
                      >
                        {to2(m.perpiece_total)}
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <td
                      className="border border-[#b7d2cd] px-3 py-2 cursor-pointer hover:text-[#4e8580] sticky left-0 bg-white z-10"
                      onClick={() =>
                        setChartMetric({
                          type: "perpiece",
                          key: "perpiece_shipping",
                          label: "Wysyłka (na sztuki)",
                        })
                      }
                    >
                      * Wysyłka
                    </td>

                    {monthly.map((m) => (
                      <td
                        key={m.ym}
                        className="border border-[#b7d2cd] px-3 py-2 text-right"
                      >
                        {to2(m.perpiece_shipping)}
                      </td>
                    ))}
                  </tr>

                  <tr className="bg-slate-50">
                    <td
                      className="border border-[#b7d2cd] px-3 py-2 cursor-pointer hover:text-[#4e8580] sticky left-0 bg-white z-10"
                      onClick={() =>
                        setChartMetric({
                          type: "perpiece",
                          key: "perpiece_service",
                          label: "Usługa bez wysyłki",
                        })
                      }
                    >
                      * Usługa bez wysyłki
                    </td>

                    {monthly.map((m) => (
                      <td
                        key={m.ym}
                        className="border border-[#b7d2cd] px-3 py-2 text-right"
                      >
                        {to2(m.perpiece_service)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {loading && (
              <div className="text-sm text-gray-500 mt-3">
                Ładowanie danych…
              </div>
            )}
          </div>
        </div>
      )}
      {activeTab === "payments" && (
        <div className="card-lg">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm border-collapse">
              <thead className="bg-slate-100 border border-[#b7d2cd]">
                <tr>
                  <th className="border border-[#b7d2cd] px-3 py-2 text-left w-[260px]">
                    Wskaźnik
                  </th>
                  {paymentsMonthly.map((m) => (
                    <th
                      key={m.ym}
                      className="border border-[#b7d2cd] px-3 py-2 text-right"
                    >
                      {ymToPL(m.ym)}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                <tr>
                  <td className="border border-[#b7d2cd] px-3 py-2 font-semibold">
                    Liczba wystawionych faktur
                  </td>
                  {paymentsMonthly.map((m) => (
                    <td key={m.ym} className="border px-3 py-2 text-right">
                      {m.issued}
                    </td>
                  ))}
                </tr>

                <tr className="bg-slate-50">
                  <td className="border px-3 py-2">Liczba opłaconych faktur</td>
                  {paymentsMonthly.map((m) => (
                    <td key={m.ym} className="border px-3 py-2 text-right">
                      {m.paidCount}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="border px-3 py-2">
                    Liczba nieopłaconych faktur
                  </td>
                  {paymentsMonthly.map((m) => (
                    <td key={m.ym} className="border px-3 py-2 text-right">
                      {m.unpaidCount}
                    </td>
                  ))}
                </tr>

                <tr className="bg-slate-50">
                  <td className="border px-3 py-2">Suma opłaconych faktur</td>
                  {paymentsMonthly.map((m) => (
                    <td key={m.ym} className="border px-3 py-2 text-right">
                      {to2(m.paidSum)}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="border px-3 py-2">
                    Suma nieopłaconych faktur
                  </td>
                  {paymentsMonthly.map((m) => (
                    <td key={m.ym} className="border px-3 py-2 text-right">
                      {to2(m.unpaidSum)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
