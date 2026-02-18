import { useEffect, useState, useRef } from "react";
import { apiFetch } from "../utils/api";
import { useNavigate } from "react-router-dom";
import React from "react";

const PAGE_SIZE = 20;

export default function DisinfectionReportsPage() {
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  const [filterDate, setFilterDate] = useState("");
  const [filterClient, setFilterClient] = useState("");

  const [selected, setSelected] = useState([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const [formDate, setFormDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [formWasher, setFormWasher] = useState("W1");
  const [formDisinfectant, setFormDisinfectant] = useState(
    "Viruton Extra (Medicept)"
  );
  const [formConcentration, setFormConcentration] = useState("1%");
  const [formTime, setFormTime] = useState("15");
  const [newClientId, setNewClientId] = useState("");
  const [pendingClients, setPendingClients] = useState([]);
  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const inputRef = useRef(null);

  const CONCENTRATIONS = {
    "Viruton Extra (Medicept)": ["1%", "0,5%"],
    "DDN 9 (Medilab)": ["1%", "0,5%"],
  };

  async function loadReports(newOffset = 0) {
    setLoading(true);

    const params = new URLSearchParams({
      limit: PAGE_SIZE,
      offset: newOffset,
      ...(filterDate && { date: filterDate }),
      ...(filterClient && { client: filterClient }),
    }).toString();

    const res = await apiFetch(`/disinfection/list?${params}`);
    const data = await res.json();

    setReports(data);
    setOffset(newOffset);
    setLoading(false);
  }

  async function saveReport() {
    if (!pendingClients.length) return;

    const createRes = await apiFetch("/disinfection/cycle/create", {
      method: "POST",
      body: JSON.stringify({
        reportDate: formDate,
        washer: formWasher,
        disinfectantName: formDisinfectant,
        concentration: formConcentration,
        immersionTimeMinutes: formTime,
      }),
    });

    const createJson = await createRes.json();
    const newCycleNumber = createJson.cycleNumber;
    for (const client of pendingClients) {
      await apiFetch("/disinfection/cycle/add-client", {
        method: "POST",
        body: JSON.stringify({
          cycleNumber: newCycleNumber,
          clientId: client.id,
        }),
      });
    }

    setPendingClients([]);
    await loadReports(0);
  }

  async function searchClients(value) {
    const v = String(value || "").trim();
    if (!v) {
      setClientSuggestions([]);
      setActiveSuggestion(-1);
      return;
    }

    const res = await apiFetch(`/clients?search=${encodeURIComponent(v)}`);
    const data = await res.json();

    const filtered = (Array.isArray(data) ? data : []).filter(
      (c) =>
        String(c.id).toLowerCase().includes(v.toLowerCase()) ||
        String(c.name).toLowerCase().includes(v.toLowerCase())
    );

    setClientSuggestions(filtered.slice(0, 8));
    setActiveSuggestion(filtered.length ? 0 : -1);
  }

  function addClient(clientIdArg) {
    const clientIdToAdd = String(clientIdArg ?? "").trim();
    if (!clientIdToAdd) return;

    const exists = pendingClients.some((c) => String(c.id) === clientIdToAdd);
    if (exists) return;

    const found = clientSuggestions.find((c) => String(c.id) === clientIdToAdd);
    if (!found) return;

    setPendingClients((prev) => [...prev, found]);

    setNewClientId("");
    setClientSuggestions([]);
    setActiveSuggestion(-1);
  }

  async function approve(reportDate, washer) {
    await apiFetch("/disinfection/report/approve", {
      method: "POST",
      body: JSON.stringify({ reportDate, washer }),
    });

    await loadReports(offset);
  }

  function toggleSelect(id) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleSelectAll() {
    if (selected.length === reports.length) {
      setSelected([]);
    } else {
      setSelected(reports.map((r) => r.id));
    }
  }

  async function printSelected() {
    if (!selected.length) return;

    const res = await apiFetch("/disinfection/reports/print-batch", {
      method: "POST",
      body: JSON.stringify({ ids: selected }),
    });

    const json = await res.json();
    if (json.file) {
      window.open(json.file, "_blank");
    }
  }
  const STATUS_COLORS = {
    DRAFT: "bg-slate-200 text-slate-800 border border-slate-300",
    APPROVED: "bg-emerald-100 text-emerald-800 border border-emerald-300",
  };

  function translateStatus(status) {
    const map = {
      DRAFT: "Szkic",
      APPROVED: "Zatwierdzony",
    };
    return map[status] || status;
  }

  function statusBadge(status) {
    return (
      <span
        className={`px-2 py-1 rounded text-xs font-semibold ${STATUS_COLORS[status]}`}
      >
        {translateStatus(status)}
      </span>
    );
  }

  useEffect(() => {
    loadReports(0);
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setActionsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const delay = setTimeout(() => {
      loadReports(0);
    }, 400);
    return () => clearTimeout(delay);
  }, [filterDate, filterClient]);

  return (
    <div className="layout-container space-y-4">
      {/* HEADER */}
      <div className="card-lg border-2 border-blue-200 bg-blue-50/60">
        <div className="space-y-3">
          <h1 className="text-2xl font-bold">Ewidencja dezynfekcji</h1>
        </div>

        {/* MOBILE */}
        <div className="flex flex-col md:hidden gap-3 w-full mt-3">
          <input
            type="date"
            className="input w-full"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
          />

          <input
            className="input w-full"
            placeholder="ID klienta"
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
          />

          <div className="relative" ref={dropdownRef}>
            <button
              className="btn-primary w-full flex items-center justify-center gap-2"
              onClick={() => setActionsOpen((v) => !v)}
            >
              Akcje
              <svg
                className={`w-4 h-4 transition-transform ${
                  actionsOpen ? "rotate-180" : ""
                }`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {actionsOpen && (
              <div className="absolute right-0 mt-2 w-full bg-white border rounded-xl shadow-lg z-20">
                <button
                  className="block w-full text-left px-4 py-2 hover:bg-gray-50"
                  onClick={printSelected}
                >
                  Drukuj wybrane raporty
                </button>

                <button
                  className="block w-full text-left px-4 py-2 text-red-600 hover:bg-red-50"
                  onClick={async () => {
                    if (!selected.length) return;
                    await apiFetch("/disinfection/reports/delete-batch", {
                      method: "POST",
                      body: JSON.stringify({ ids: selected }),
                    });
                    setSelected([]);
                    await loadReports(0);
                  }}
                >
                  Usuń wybrane raporty
                </button>
              </div>
            )}
          </div>
        </div>

        {/* DESKTOP */}
        <div className="hidden md:grid md:grid-cols-3 gap-3 items-end mt-3 w-full">
          <input
            type="date"
            className="input"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
          />

          <input
            className="input"
            placeholder="ID klienta"
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
          />

          <div className="relative justify-self-end" ref={dropdownRef}>
            <button
              className="btn-primary flex items-center gap-2"
              onClick={() => setActionsOpen((v) => !v)}
            >
              Akcje
              <svg
                className={`w-4 h-4 transition-transform ${
                  actionsOpen ? "rotate-180" : ""
                }`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {actionsOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white border rounded-xl shadow-lg z-20">
                <button
                  className="block w-full text-left px-4 py-2 hover:bg-gray-50"
                  onClick={printSelected}
                >
                  Drukuj wybrane raporty
                </button>

                <button
                  className="block w-full text-left px-4 py-2 text-red-600 hover:bg-red-50"
                  onClick={async () => {
                    if (!selected.length) return;
                    await apiFetch("/disinfection/reports/delete-batch", {
                      method: "POST",
                      body: JSON.stringify({ ids: selected }),
                    });
                    setSelected([]);
                    await loadReports(0);
                  }}
                >
                  Usuń wybrane raporty
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FORM */}
      <div className="card-lg space-y-3">
        <h2 className="font-semibold">Nowy cykl</h2>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
          <input
            type="date"
            className="input"
            value={formDate}
            onChange={(e) => setFormDate(e.target.value)}
          />

          <select
            className="input"
            value={formWasher}
            onChange={(e) => setFormWasher(e.target.value)}
          >
            <option value="W1">Myjka 1</option>
            <option value="W2">Myjka 2</option>
            <option value="MANUAL">Wanienka</option>
          </select>

          <select
            className="input"
            value={formDisinfectant}
            onChange={(e) => {
              const value = e.target.value;
              setFormDisinfectant(value);
              setFormConcentration(CONCENTRATIONS[value][0]);
            }}
          >
            <option value="Viruton Extra (Medicept)">
              Viruton Extra (Medicept)
            </option>
            <option value="DDN 9 (Medilab)">DDN 9 (Medilab)</option>
          </select>

          <select
            className="input"
            value={formConcentration}
            onChange={(e) => setFormConcentration(e.target.value)}
          >
            {CONCENTRATIONS[formDisinfectant].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            className="input"
            value={formTime}
            onChange={(e) => setFormTime(e.target.value)}
          >
            <option value="15">15 min</option>
            <option value="30">30 min</option>
          </select>

          <button className="btn-primary" onClick={saveReport}>
            Zapisz cykl
          </button>
        </div>

        {/* CLIENTS SECTION */}
        <div className="flex gap-4 items-start">
          <div className="relative w-1/3">
            <input
              ref={inputRef}
              className="input w-full"
              placeholder="Dodaj klienta"
              value={newClientId}
              onChange={(e) => {
                setNewClientId(e.target.value);
                searchClients(e.target.value);
              }}
              onKeyDown={(e) => {
                if (!clientSuggestions.length) return;

                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveSuggestion((prev) =>
                    prev < clientSuggestions.length - 1 ? prev + 1 : 0
                  );
                }

                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveSuggestion((prev) =>
                    prev > 0 ? prev - 1 : clientSuggestions.length - 1
                  );
                }

                if (e.key === "Enter") {
                  e.preventDefault();
                  const picked =
                    clientSuggestions[
                      activeSuggestion >= 0 ? activeSuggestion : 0
                    ];
                  if (picked) addClient(picked.id);
                }
              }}
            />

            {clientSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 bg-white border rounded shadow max-h-56 overflow-y-auto z-20">
                {clientSuggestions.map((c) => (
                  <div
                    key={c.id}
                    className="px-3 py-4 cursor-pointer hover:bg-blue-50"
                    onClick={() => addClient(c.id)}
                  >
                    <span className="font-semibold">{c.id}</span> — {c.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap content-center items-center gap-2 flex-1 min-h-[72px] border rounded-md px-3 py-4 bg-gray-50">
            {pendingClients.map((c) => (
              <div
                key={c.id}
                className="px-3 py-1 bg-gray-800 text-white rounded text-xs font-bold"
              >
                {c.id}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div className="card-lg w-full">
        <div className="overflow-x-auto md:overflow-x-visible">
          <table className="w-full md:min-w-0 min-w-[1100px] text-sm text-center table-fixed">
            <colgroup>
              <col style={{ width: "5%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "50%" }} />
            </colgroup>

            <thead className="bg-gray-100">
              <tr>
                <th className="text-center px-3 py-2">
                  <input
                    type="checkbox"
                    checked={
                      reports.length > 0 && selected.length === reports.length
                    }
                    onChange={() => toggleSelectAll()}
                  />
                </th>
                <th className="text-center">Nr</th>
                <th className="text-center">Myjka</th>
                <th className="text-center">Status</th>
                <th className="text-center w-[420px]">Klienci</th>
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td colSpan="6" className="py-6 text-center">
                    Ładowanie...
                  </td>
                </tr>
              )}

              {!loading && reports.length === 0 && (
                <tr>
                  <td colSpan="6" className="py-6 text-center text-gray-500">
                    Brak danych
                  </td>
                </tr>
              )}

              {reports.map((r, index) => {
                const prev = reports[index - 1];

                const showDateSeparator =
                  !prev || prev.report_date !== r.report_date;

                return (
                  <React.Fragment key={r.id}>
                    {showDateSeparator && (
                      <tr className="bg-gray-200">
                        <td
                          colSpan="5"
                          className="text-left px-3 py-1 text-xs font-semibold"
                        >
                          {r.report_date}
                        </td>
                      </tr>
                    )}

                    <tr className="border-t hover:bg-gray-50">
                      <td className="px-3 py-4">
                        <input
                          type="checkbox"
                          checked={selected.includes(r.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelect(r.id);
                          }}
                        />
                      </td>

                      <td className="px-3 py-4">
                        <button
                          onClick={() =>
                            navigate(`/disinfection/cycle/${r.cycle_number}`)
                          }
                          className="px-3 py-1 rounded-md bg-indigo-100 text-indigo-800 font-mono text-sm border border-indigo-300 hover:bg-indigo-200 hover:shadow-sm transition"
                        >
                          {String(r.cycle_number).padStart(4, "0")}
                        </button>
                      </td>

                      <td className="px-3 py-4">
                        {{
                          W1: "Myjka 1",
                          W2: "Myjka 2",
                          MANUAL: "Wanienka",
                        }[r.washer] || r.washer}
                      </td>

                      <td className="px-3 py-4">{statusBadge(r.status)}</td>

                      <td className="px-3 py-4">
                        <div className="flex flex-wrap justify-center gap-1 break-words max-w-full">
                          {r.clients_list
                            ? r.clients_list.split(",").map((client, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 rounded text-xs bg-gray-800 text-white font-bold"
                                >
                                  {client.trim()}
                                </span>
                              ))
                            : "-"}
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
