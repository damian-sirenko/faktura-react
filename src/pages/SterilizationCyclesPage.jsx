import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/api";

const PAGE_SIZE = 20;

export default function SterilizationCyclesPage() {
  const navigate = useNavigate();

  const [cycles, setCycles] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);

  const [offset, setOffset] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const [filters, setFilters] = useState({
    cycleNumber: "",
    status: "",
    clientIdentifier: "",
    program: "",
  });

  async function checkUsbConnection() {
    try {
      const res = await fetch("http://localhost:4545/usb-status");
      if (!res.ok) return;

      const data = await res.json();
      setImportModalVisible(!!data.connected);
    } catch {
      setImportModalVisible(false);
    }
  }

  useEffect(() => {
    checkUsbConnection();

    const interval = setInterval(checkUsbConnection, 2000);

    return () => clearInterval(interval);
  }, []);
  async function loadCycles(newOffset = 0) {
    try {
      setLoading(true);

      const res = await apiFetch(
        `/sterilization/cycles/list?limit=${PAGE_SIZE}&offset=${newOffset}`
      );

      const data = await res.json();
      setCycles(data);

      setOffset(newOffset);
    } finally {
      setLoading(false);
    }
  }

  async function searchCycles() {
    try {
      setLoading(true);

      const clean = Object.fromEntries(
        Object.entries(filters).filter(([_, v]) => v !== "")
      );

      const params = new URLSearchParams(clean).toString();

      const res = await apiFetch(`/sterilization/cycles/search?${params}`);

      setCycles(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function batchPrint() {
    if (!selected.length) return alert("Wybierz cykle");

    const approved = selected.filter((id) => {
      const c = cycles.find((x) => x.id === id);
      return c?.status === "APPROVED";
    });

    if (!approved.length) {
      return alert("Można drukować tylko zatwierdzone cykle");
    }

    try {
      const res = await apiFetch("/sterilization/print-batch", {
        method: "POST",
        body: JSON.stringify({ cycleIds: approved }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt);
      }

      const json = await res.json();

      if (json.file) {
        window.open(json.file, "_blank");
      }
    } catch (e) {
      console.error(e);
      alert("Błąd drukowania");
    }
  }
  async function deleteSelected() {
    if (!selected.length) return alert("Wybierz cykle");

    if (!confirm("Usunąć wybrane cykle?")) return;

    try {
      await apiFetch("/sterilization/cycles/delete-many", {
        method: "DELETE",
        body: JSON.stringify({ ids: selected }),
      });

      setSelected([]);
      await loadCycles(offset);
    } catch {
      alert("Błąd usuwania cykli");
    }
  }

  async function markDocumented(cycleId) {
    try {
      await apiFetch("/sterilization/cycle/mark-documented", {
        method: "POST",
        body: JSON.stringify({ cycleId }),
      });

      await loadCycles(offset);
    } catch {
      alert("Błąd kończenia dokumentacji");
    }
  }

  async function deleteSingle(cycleId) {
    if (!confirm("Usunąć ten cykl?")) return;

    try {
      await apiFetch("/sterilization/cycle/delete", {
        method: "DELETE",
        body: JSON.stringify({ cycleId }),
      });

      await loadCycles(offset);
    } catch {
      alert("Błąd usuwania cyklu");
    }
  }

  async function generateReport(cycleId) {
    try {
      const res = await apiFetch("/sterilization/cycle/generate-report", {
        method: "POST",
        body: JSON.stringify({ cycleId }),
      });

      const data = await res.json();

      if (data.file) {
        window.open(data.file, "_blank");
      }

      await loadCycles(offset);
    } catch {
      alert("Błąd generowania protokołu");
    }
  }
  function toggleSelect(id) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  async function approveCycle(cycleId) {
    if (!confirm("Zatwierdzić cykl sterylizacji?")) return;

    try {
      await apiFetch("/sterilization/cycle/approve", {
        method: "POST",
        body: JSON.stringify({ cycleId }),
      });

      await loadCycles(offset);
    } catch (e) {
      alert("Błąd zatwierdzania cyklu");
    }
  }
  async function rejectCycle(cycleId) {
    const reason = prompt("Powód odrzucenia (opcjonalnie):");

    if (reason === null) return;

    try {
      await apiFetch("/sterilization/cycle/reject", {
        method: "POST",
        body: JSON.stringify({ cycleId, reason }),
      });

      await loadCycles(offset);
    } catch {
      alert("Błąd odrzucania cyklu");
    }
  }

  const STATUS_COLORS = {
    IMPORTED: "bg-slate-200 text-slate-800 border border-slate-300",

    READY: "bg-amber-100 text-amber-800 border border-amber-300",

    APPROVED: "bg-emerald-100 text-emerald-800 border border-emerald-300",

    DOCUMENTED: "bg-blue-500 text-white border border-blue-700",

    REJECTED: "bg-red-100 text-red-800 border border-red-300",

    TEST: "bg-indigo-100 text-indigo-800 border border-indigo-300",
  };

  function translateStatus(status) {
    const map = {
      IMPORTED: "Zaimportowany",
      READY: "Gotowy do zatwierdzenia",
      APPROVED: "Zatwierdzony",
      REJECTED: "Odrzucony",
      DOCUMENTED: "Udokumentowany",
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
    loadCycles(0);
  }, []);

  useEffect(() => {
    const delay = setTimeout(() => {
      searchCycles();
    }, 400);

    return () => clearTimeout(delay);
  }, [filters]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setActionsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function formatDate(dateStr) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString();
  }

  return (
    <div className="layout-container space-y-4">
      <div className="card-lg border-2 border-blue-200 bg-blue-50/60">
        <div className="mb-4">
          <h1 className="text-2xl font-bold">Ewidencja sterylizacji</h1>
        </div>
        {/* MOBILE */}
        <div className="flex flex-col md:hidden gap-3 w-full">
          <input
            placeholder="Nr cyklu"
            className="input w-full"
            value={filters.cycleNumber}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                cycleNumber: e.target.value,
              }))
            }
          />

          <input
            placeholder="ID klienta"
            className="input w-full"
            value={filters.clientIdentifier}
            onChange={(e) =>
              setFilters({ ...filters, clientIdentifier: e.target.value })
            }
          />

          <select
            className="input w-full"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">Status</option>
            <option value="IMPORTED">Zaimportowany</option>
            <option value="READY">Gotowy do zatwierdzenia</option>
            <option value="APPROVED">Zatwierdzony</option>
            <option value="REJECTED">Odrzucony</option>
          </select>

          <select
            className="input w-full"
            value={filters.program || ""}
            onChange={(e) =>
              setFilters({ ...filters, program: e.target.value })
            }
          >
            <option value="">Program</option>
            <option value="134℃">134℃</option>
            <option value="121℃">121℃</option>
            <option value="B-D">B-D test</option>
          </select>

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
              <div className="absolute left-0 mt-2 w-full bg-white border rounded-lg shadow-md z-50">
                <button
                  className="block w-full text-left px-4 py-2 hover:bg-gray-100"
                  onClick={() => {
                    batchPrint();
                    setActionsOpen(false);
                  }}
                >
                  Drukuj wybrane
                </button>

                <button
                  className="block w-full text-left px-4 py-2 hover:bg-gray-100"
                  onClick={() => {
                    deleteSelected();
                    setActionsOpen(false);
                  }}
                >
                  Usuń wybrane
                </button>
              </div>
            )}
          </div>
        </div>

        {/* DESKTOP */}
        <div className="hidden md:grid md:grid-cols-5 gap-2 items-end w-full">
          <input
            placeholder="Nr cyklu"
            className="input"
            value={filters.cycleNumber}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                cycleNumber: e.target.value,
              }))
            }
          />

          <input
            placeholder="ID klienta"
            className="input"
            value={filters.clientIdentifier}
            onChange={(e) =>
              setFilters({ ...filters, clientIdentifier: e.target.value })
            }
          />

          <select
            className="input"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">Status</option>
            <option value="IMPORTED">Zaimportowany</option>
            <option value="READY">Gotowy do zatwierdzenia</option>
            <option value="APPROVED">Zatwierdzony</option>
            <option value="REJECTED">Odrzucony</option>
          </select>

          <select
            className="input"
            value={filters.program || ""}
            onChange={(e) =>
              setFilters({ ...filters, program: e.target.value })
            }
          >
            <option value="">Program</option>
            <option value="134℃">134℃</option>
            <option value="121℃">121℃</option>
            <option value="B-D">B-D test</option>
          </select>

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
              <div className="absolute right-0 mt-2 w-48 bg-white border rounded-lg shadow-md z-50">
                <button
                  className="block w-full text-left px-4 py-2 hover:bg-gray-100"
                  onClick={() => {
                    batchPrint();
                    setActionsOpen(false);
                  }}
                >
                  Drukuj wybrane
                </button>

                <button
                  className="block w-full text-left px-4 py-2 hover:bg-gray-100"
                  onClick={() => {
                    deleteSelected();
                    setActionsOpen(false);
                  }}
                >
                  Usuń wybrane
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div className="card-lg w-full overflow-x-auto md:overflow-x-visible">
        <table className="w-full md:min-w-0 min-w-[1100px] text-sm text-center table-fixed">
          <colgroup>
            <col style={{ width: "5%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "35%" }} />
            <col style={{ width: "15%" }} />
          </colgroup>

          <thead className="bg-gray-100">
            <tr>
              <th className="text-center"></th>
              <th className="text-center">Nr cyklu</th>
              <th className="text-center">Program</th>
              <th className="text-center">Status</th>
              <th className="text-center">Klienci</th>
              <th className="text-right pr-3">Finalizacja</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan="6" className="text-center py-6">
                  Ładowanie...
                </td>
              </tr>
            )}

            {cycles.map((c, index) => {
              const prev = cycles[index - 1];

              const showDateSeparator =
                !prev ||
                formatDate(prev.cycle_start_datetime) !==
                  formatDate(c.cycle_start_datetime);

              return (
                <React.Fragment key={c.id}>
                  {showDateSeparator && (
                    <tr className="bg-gray-200">
                      <td
                        colSpan="6"
                        className="text-left px-3 py-1 text-xs font-semibold"
                      >
                        {formatDate(c.cycle_start_datetime)}
                      </td>
                    </tr>
                  )}

                  <tr className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        onChange={() => toggleSelect(c.id)}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <button
                        onClick={() => navigate(`/sterilization/cycle/${c.id}`)}
                        className="px-3 py-1 rounded-md bg-indigo-100 text-indigo-800 font-mono text-sm border border-indigo-300 hover:bg-indigo-200 hover:shadow-sm transition"
                      >
                        {c.cycle_number}
                      </button>
                    </td>

                    <td className="px-3 py-2 whitespace-nowrap">
                      {c.program || "-"}
                    </td>

                    <td className="px-3 py-2">{statusBadge(c.status)}</td>

                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex flex-wrap justify-center gap-1 break-words">
                        {c.clients_list
                          ? c.clients_list.split(",").map((client, i) => {
                              const parts = client.trim().split("|");
                              const id = parts[0];
                              const name = parts[1] || id;

                              return (
                                <span
                                  key={i}
                                  title={name}
                                  className="px-2 py-0.5 rounded text-xs bg-gray-800 text-white font-bold"
                                >
                                  {id}
                                </span>
                              );
                            })
                          : "-"}
                      </div>
                    </td>

                    <td className="px-3 py-2 text-right">
                      <button
                        className="btn-primary"
                        disabled={c.status !== "APPROVED"}
                        onClick={() => markDocumented(c.id)}
                      >
                        Finalizuj
                      </button>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* PAGINATION */}

      <div className="card-lg flex justify-between">
        <button
          className="btn-secondary"
          disabled={offset === 0}
          onClick={() => loadCycles(Math.max(offset - PAGE_SIZE, 0))}
        >
          Poprzednia
        </button>

        <button
          className="btn-secondary"
          onClick={() => loadCycles(offset + PAGE_SIZE)}
        >
          Następna
        </button>
      </div>
      {importModalVisible && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full text-center space-y-3">
            <h2 className="text-lg font-bold">
              Przełącz pamięć USB do autoklawu
            </h2>

            <p className="text-sm text-gray-700">
              Import zakończony. Wyjmij USB i włóż je z powrotem do autoklawu.
            </p>

            <p className="text-xs text-gray-500">
              Okno zamknie się automatycznie po odłączeniu USB.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
