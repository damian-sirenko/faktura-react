import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/api";

export default function DisinfectionReportDetailsPage() {
  const { cycleNumber } = useParams();
  console.log("DETAILS PARAM cycleNumber =", cycleNumber);
  const navigate = useNavigate();

  const [report, setReport] = useState(null);
  const [clients, setClients] = useState([]);
  const [newClientId, setNewClientId] = useState("");
  const [clientSuggestions, setClientSuggestions] = useState([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const inputRef = useRef(null);

  async function load() {
    const res = await apiFetch(`/disinfection/cycle/${cycleNumber}`);
    const data = await res.json().catch(() => null);

    if (!res.ok || !data) {
      setReport(null);
      setClients([]);
      return;
    }

    setReport(data);

    const clientsRes = await apiFetch(
      `/disinfection/cycle/${cycleNumber}/clients`
    );
    const clientsData = await clientsRes.json().catch(() => []);
    setClients(Array.isArray(clientsData) ? clientsData : []);
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
    console.log("DETAILS DATA:", data);
    const filtered = (Array.isArray(data) ? data : []).filter((c) => {
      const idStr = String(c.id || "").toLowerCase();
      const nameStr = String(c.name || "").toLowerCase();
      return (
        idStr.includes(v.toLowerCase()) || nameStr.includes(v.toLowerCase())
      );
    });

    setClientSuggestions(filtered.slice(0, 8));
    setActiveSuggestion(filtered.length ? 0 : -1);
  }

  async function addClient(clientIdArg) {
    const clientIdToAdd = String(clientIdArg ?? newClientId ?? "").trim();
    if (!clientIdToAdd) return false;

    if (clients.some((c) => String(c.id) === clientIdToAdd)) {
      alert("Klient już dodany do cyklu");
      return false;
    }

    const res = await apiFetch("/disinfection/cycle/add-client", {
      method: "POST",
      body: JSON.stringify({
        cycleNumber,
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

  async function removeClient(clientId, manualIdentifier) {
    await apiFetch("/disinfection/cycle/remove-client", {
      method: "POST",
      body: JSON.stringify({
        cycleNumber,
        clientId,
        manualIdentifier,
      }),
    });

    await load();
  }

  async function approve() {
    const res = await apiFetch("/disinfection/cycle/approve", {
      method: "POST",
      body: JSON.stringify({
        cycleNumber,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(json.error || "Nie można zatwierdzić raportu");
      return;
    }

    await load();
  }

  useEffect(() => {
    load();
  }, [cycleNumber]);

  const STATUS_COLORS = {
    DRAFT: "bg-slate-200 text-slate-800 border border-slate-300",
    APPROVED: "bg-emerald-100 text-emerald-800 border border-emerald-300",
  };

  if (!report) return <div>Ładowanie...</div>;

  return (
    <div className="layout-container space-y-4">
      <div className="card-lg border-2 border-blue-200 bg-blue-50/60">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            Cykl dezynfekcji nr {String(report.cycle_number).padStart(4, "0")}
          </h1>

          <div className="text-sm">
            Status:
            <span
              className={`ml-2 px-2 py-1 rounded text-xs font-semibold ${
                STATUS_COLORS[report.status]
              }`}
            >
              {report.status === "DRAFT" ? "Szkic" : "Zatwierdzony"}
            </span>
          </div>
        </div>
      </div>

      <button
        className="btn-secondary"
        onClick={() => navigate("/disinfection/report")}
      >
        ← Powrót do listy
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[70%_30%] gap-4">
        <div className="space-y-4">
          <div className="card-lg">
            <h2 className="font-semibold mb-3">Parametry cyklu</h2>

            <div>
              Data wykonania:{" "}
              <span className="font-semibold">{report.report_date}</span>
            </div>

            <div>
              Myjka:{" "}
              <span className="font-semibold">
                {{
                  W1: "№1",
                  W2: "№2",
                  MANUAL: "Wanienka",
                }[report.washer] || report.washer}
              </span>
            </div>

            <div>
              Środek:{" "}
              <span className="font-semibold">{report.disinfectant_name}</span>
            </div>
            <div>
              Stężenie:{" "}
              <span className="font-semibold">{report.concentration}</span>
            </div>
            <div>
              Czas:{" "}
              <span className="font-semibold">
                {report.immersion_time_minutes} min
              </span>
            </div>
          </div>

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

                  {report.status !== "APPROVED" && (
                    <button
                      className="text-red-600 text-sm hover:underline"
                      onClick={() =>
                        removeClient(
                          c.is_manual ? null : c.id,
                          c.is_manual ? c.id : null
                        )
                      }
                    >
                      Usuń
                    </button>
                  )}
                </div>
              ))}
            </div>

            {report.status !== "APPROVED" && (
              <div className="mt-3 relative z-10">
                <input
                  ref={inputRef}
                  className="input w-full"
                  placeholder="Wpisz ID klienta"
                  value={newClientId}
                  onChange={(e) => {
                    setNewClientId(e.target.value);
                    searchClients(e.target.value);
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (clientSuggestions.length) {
                        const picked =
                          clientSuggestions[
                            activeSuggestion >= 0 ? activeSuggestion : 0
                          ];
                        await addClient(picked?.id);
                        inputRef.current?.focus();
                      }
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
                          await addClient(c.id);
                          inputRef.current?.focus();
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

          <div className="flex gap-2 mt-4">
            {report.status !== "APPROVED" && (
              <button className="btn-primary" onClick={approve}>
                Zatwierdź protokół
              </button>
            )}

            {report.status === "APPROVED" && (
              <button
                className="btn-secondary"
                onClick={async () => {
                  await apiFetch("/disinfection/cycle/unapprove", {
                    method: "POST",
                    body: JSON.stringify({
                      cycleNumber,
                    }),
                  });
                  await load();
                }}
              >
                Cofnij zatwierdzenie
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
