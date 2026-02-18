import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/api";

export default function SterilizationCycleDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [cycle, setCycle] = useState(null);
  const [clients, setClients] = useState([]);
  const [newClientId, setNewClientId] = useState("");
  const [rawReport, setRawReport] = useState("");
  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const inputRef = useRef(null);
  const [showPdfModal, setShowPdfModal] = useState(false);

  function validateCycle(cycle) {
    const programStr = String(cycle.program || "").toUpperCase();

    if (programStr.includes("B-D") || programStr.includes("BD")) {
      return { isBD: true };
    }
    if (!cycle) return {};

    const programTemp = parseInt(String(cycle.program || "").match(/\d+/)?.[0]);

    const errors = {};

    if (!programTemp) {
      errors.program = true;
      return errors;
    }

    if (cycle.temperature_min < programTemp) {
      errors.temperature = true;
    }

    const minPressure = programTemp === 121 ? 100 : 200;

    if (cycle.pressure_min < minPressure) {
      errors.pressure = true;
    }

    let minDuration = programTemp === 121 ? 20 * 60 : 3.5 * 60;

    if (cycle.sterilization_duration_seconds < minDuration) {
      errors.duration = true;
    }

    return errors;
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return "-";

    const m = Math.floor(seconds / 60);
    const s = seconds % 60;

    return `${m} min ${s} s`;
  }

  async function load() {
    const res = await apiFetch(`/sterilization/cycle/${id}/full`);
    const data = await res.json();

    setCycle(data.cycle);
    setClients(data.clients);
    try {
      const raw = await apiFetch(`/sterilization/cycle/${id}/report-raw`);
      const rawData = await raw.json();
      setRawReport(rawData.content || "");
    } catch {
      setRawReport("");
    }
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

    const vv = v.toLowerCase();

    const filtered = (Array.isArray(data) ? data : []).filter((c) => {
      const idStr = String(c.id || "").toLowerCase();
      const nameStr = String(c.name || "").toLowerCase();
      return idStr.includes(vv) || nameStr.includes(vv);
    });

    setClientSuggestions(filtered.slice(0, 8));
    setActiveSuggestion(filtered.length ? 0 : -1);
  }
  async function addClient(clientIdArg) {
    const clientIdToAdd = String(clientIdArg ?? newClientId ?? "").trim();
    if (!clientIdToAdd) return false;

    if (clients.some((c) => String(c.id) === String(clientIdToAdd))) {
      alert("Klient już dodany do cyklu");
      return false;
    }

    const res = await apiFetch("/sterilization/cycle/add-client", {
      method: "POST",
      body: JSON.stringify({
        cycleId: id,
        clientId: clientIdToAdd,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(json.error || "Nie można dodać klienta");
      return false;
    }

    setNewClientId("");
    setClientSuggestions([]);
    setActiveSuggestion(-1);

    await load();
    return true;
  }
  async function removeClient(clientId) {
    const res = await apiFetch("/sterilization/cycle/remove-client", {
      method: "DELETE",
      body: JSON.stringify({
        cycleId: id,
        clientId,
      }),
    });

    await load();
  }

  async function approve() {
    const res = await apiFetch("/sterilization/cycle/approve", {
      method: "POST",
      body: JSON.stringify({ cycleId: id }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(json.error || "Nie można zatwierdzić cyklu");
      return;
    }

    await load();
  }

  async function reject() {
    const res = await apiFetch("/sterilization/cycle/reject", {
      method: "POST",
      body: JSON.stringify({ cycleId: id }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(json.error || "Nie można odrzucić cyklu");
      return;
    }

    await load();
  }

  async function revertToReady() {
    const res = await apiFetch("/sterilization/cycle/revert-to-ready", {
      method: "POST",
      body: JSON.stringify({ cycleId: id }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(json.error || "Nie można cofnąć zatwierdzenia");
      return;
    }

    await load();
  }

  useEffect(() => {
    load();
  }, [id]);

  const STATUS_COLORS = {
    IMPORTED: "bg-slate-200 text-slate-800 border border-slate-300",

    READY: "bg-amber-100 text-amber-800 border border-amber-300",

    APPROVED: "bg-emerald-100 text-emerald-800 border border-emerald-300",

    DOCUMENTED: "bg-blue-500 text-white border border-blue-700",

    REJECTED: "bg-red-100 text-red-800 border border-red-300",

    TEST: "bg-indigo-100 text-indigo-800 border border-indigo-300",
  };
  if (!cycle) return <div>Ładowanie...</div>;
  const validation = validateCycle(cycle);

  const validationErrors = Object.keys(validation).length > 0;
  const allParams = Object.entries(cycle || {});

  return (
    <div className="layout-container space-y-4">
      <div className="card-lg border-2 border-blue-200 bg-blue-50/60">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            Cykl sterylizacji nr {cycle.cycle_number}
          </h1>

          <div className="text-sm">
            Status:
            <span
              className={`ml-2 px-2 py-1 rounded text-xs font-semibold ${
                STATUS_COLORS[cycle.status]
              }`}
            >
              {{
                IMPORTED: "Zaimportowany",
                READY: "Gotowy do zatwierdzenia",
                APPROVED: "Zatwierdzony",
                REJECTED: "Odrzucony",
              }[cycle.status] || cycle.status}
            </span>
          </div>
        </div>
      </div>
      <button
        className="btn-secondary"
        onClick={() => navigate("/sterilization")}
      >
        ← Powrót do listy cykli
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[70%_30%] gap-4">
        {/* LEFT COLUMN */}
        <div className="space-y-4">
          <div className="card-lg">
            <h2 className="font-semibold mb-3">Parametry cyklu</h2>
            <div
              className={`mb-4 p-2 rounded-lg text-xs font-semibold max-w-sm ${
                validation.isBD
                  ? "bg-gray-100 text-gray-700 border border-gray-300"
                  : validationErrors
                  ? "bg-red-100 text-red-700 border border-red-300"
                  : "bg-green-100 text-green-700 border border-green-300"
              }`}
            >
              {validation.isBD
                ? "W tym cyklu wykonano test Bowie-Dick"
                : validationErrors
                ? "Parametry cyklu NIE spełniają wymagań sterylizacji"
                : "Parametry cyklu spełniają wymagania sterylizacji"}
            </div>
            <div>
              Myjka:{" "}
              <span className="font-semibold">{cycle.program || "-"}</span>
            </div>

            <div>
              Temperatura min:
              <span className="font-semibold">
                {" "}
                {cycle.temperature_min != null
                  ? Number(cycle.temperature_min).toFixed(1)
                  : "-"}{" "}
                °C
              </span>
            </div>
            <div>
              Temperatura max:
              <span className="font-semibold">
                {" "}
                {cycle.temperature_max != null
                  ? Number(cycle.temperature_max).toFixed(1)
                  : "-"}{" "}
                °C
              </span>
            </div>
            <div>
              Ciśnienie min:
              <span className="font-semibold">
                {" "}
                {cycle.pressure_min ?? "-"} kPa
              </span>
            </div>
            <div>
              Ciśnienie max:
              <span className="font-semibold">
                {" "}
                {cycle.pressure_max ?? "-"} kPa
              </span>
            </div>
            <div>
              Czas sterylizacji:
              <span className="font-semibold">
                {" "}
                {formatDuration(cycle.sterilization_duration_seconds)}
              </span>
            </div>
          </div>

          {/* CLIENTS */}
          <div className="card-lg">
            <h2 className="font-semibold mb-3">Klienci w cyklu</h2>

            <div className="space-y-2">
              {clients.map((c) => (
                <div
                  key={c.id}
                  className="border rounded-lg px-3 py-2 bg-gray-50 flex justify-between items-center"
                >
                  <span>
                    <span className="font-medium">{c.id}</span> — {c.name}
                  </span>

                  {cycle.status !== "APPROVED" && (
                    <button
                      type="button"
                      className="text-red-600 text-sm hover:underline"
                      onClick={() => removeClient(c.id)}
                    >
                      Usuń
                    </button>
                  )}
                </div>
              ))}
            </div>

            {cycle.status !== "APPROVED" && (
              <div className="mt-3 relative z-10">
                <input
                  ref={inputRef}
                  className="input w-full"
                  placeholder="Wpisz ID klienta"
                  value={newClientId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNewClientId(v);
                    searchClients(v);
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (!clientSuggestions.length) return;
                      setActiveSuggestion((prev) =>
                        prev < clientSuggestions.length - 1 ? prev + 1 : prev
                      );
                      return;
                    }

                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveSuggestion((prev) => (prev > 0 ? prev - 1 : 0));
                      return;
                    }

                    if (e.key === "Escape") {
                      setClientSuggestions([]);
                      setActiveSuggestion(-1);
                      return;
                    }

                    if (e.key === "Enter") {
                      e.preventDefault();

                      if (clientSuggestions.length) {
                        const picked =
                          clientSuggestions[
                            activeSuggestion >= 0 ? activeSuggestion : 0
                          ];

                        const added = await addClient(picked?.id);
                        if (added) inputRef.current?.focus();
                        return;
                      }

                      const added = await addClient();
                      if (added) inputRef.current?.focus();
                    }
                  }}
                />

                {clientSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 z-20 bg-white border rounded shadow-lg max-h-56 overflow-y-auto">
                    {clientSuggestions.map((c, idx) => (
                      <div
                        key={c.id}
                        className={`px-3 py-2 cursor-pointer text-sm ${
                          idx === activeSuggestion
                            ? "bg-blue-100"
                            : "hover:bg-blue-50"
                        }`}
                        onMouseEnter={() => setActiveSuggestion(idx)}
                        onClick={async () => {
                          const added = await addClient(c.id);
                          if (added) inputRef.current?.focus();
                        }}
                      >
                        <span className="font-semibold">{c.id}</span> — {c.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2 flex-wrap">
            <button
              className={`btn-primary ${
                cycle.status !== "READY" || validationErrors
                  ? "opacity-50 cursor-not-allowed"
                  : ""
              }`}
              onClick={approve}
              disabled={
                cycle.status !== "READY" || validationErrors || validation.isBD
              }
            >
              Zatwierdź protokół
            </button>

            <button
              className={`btn-secondary ${
                cycle.status !== "APPROVED"
                  ? "opacity-50 cursor-not-allowed"
                  : ""
              }`}
              onClick={revertToReady}
              disabled={cycle.status !== "APPROVED"}
            >
              Cofnij zatwierdzenie
            </button>

            <button
              className={`btn-secondary bg-red-600 text-white hover:bg-red-700 ${
                cycle.status !== "READY" ? "opacity-50 cursor-not-allowed" : ""
              }`}
              onClick={reject}
              disabled={cycle.status !== "READY"}
            >
              Odrzuć cykl
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="card-lg">
          <h2 className="font-semibold mb-3">Surowy raport autoklawu</h2>

          <pre className="mx-auto text-xs whitespace-pre-wrap bg-gray-100 p-3 rounded max-h-[700px] overflow-auto w-full">
            {rawReport}
          </pre>
          <div className="mt-4">
            <div className="mt-4">
              <button
                className="btn-secondary"
                onClick={() => setShowPdfModal(true)}
                disabled={!cycle.generated_report_path}
              >
                Podgląd protokołu PDF
              </button>

              {!cycle.generated_report_path && (
                <div className="text-sm text-gray-500 mt-2">
                  Protokół nie został jeszcze wygenerowany
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {showPdfModal && cycle.generated_report_path && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white w-[90%] h-[90%] rounded-lg shadow-lg flex flex-col">
            <div className="flex justify-between items-center p-3 border-b">
              <h2 className="font-semibold">Podgląd protokołu</h2>

              <button
                className="btn-secondary"
                onClick={() => setShowPdfModal(false)}
              >
                Zamknij
              </button>
            </div>

            <iframe
              src={`/api/generated/${cycle.generated_report_path
                .split("/")
                .pop()}`}
              className="flex-1 w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
