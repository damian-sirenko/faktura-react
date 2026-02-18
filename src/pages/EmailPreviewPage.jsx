import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/api";

export default function EmailPreviewPage() {
  const navigate = useNavigate();
  const { search } = useLocation();

  const { month, clientIds } = React.useMemo(() => {
    const params = new URLSearchParams(search);
    return {
      month: params.get("month") || "",
      clientIds: params.get("clients")
        ? params.get("clients").split(",").filter(Boolean)
        : [],
    };
  }, [search]);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [sendLog, setSendLog] = useState(null);
  const [checked, setChecked] = useState(false);
  const [checkResult, setCheckResult] = useState([]);
  const [checkMessage, setCheckMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [modal, setModal] = useState(null);
  const [liveLog, setLiveLog] = useState([]);
  const [summaryModal, setSummaryModal] = useState(null);
  const stopRef = useRef(false);

  const [message, setMessage] = useState(
    `Dzień dobry,
  
  w załączniku przesyłamy fakturę nr {invoiceNumber} za usługę sterylizacji narzędzi.
  Prosimy o terminową wpłatę. Termin płatności: {dueDate}.
  
  Pozdrawiamy,
  Punkt Sterylizacji Narzędzi
  STERYL SERWIS
  www.sterylserwis.pl
  +48 739 015 287`
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!month || !clientIds.length) {
        setLoading(false);
        setRows([]);
        setErr("Brak danych wejściowych");
        return;
      }

      try {
        setLoading(true);
        setErr("");
        const res = await apiFetch("/mail/preview-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month, clientIds }),
        });

        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(t || "Błąd pobierania danych");
        }

        const data = await res.json().catch(() => []);
        if (!alive) return;

        setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!alive) return;
        setRows([]);
        setErr("Nie udało się pobrać danych do wysyłki");
        console.error(e);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [month, clientIds]);

  if (loading) {
    return (
      <div className="card-lg">
        <div className="text-sm text-gray-600">
          Ładowanie danych do wysyłki…
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="card-lg space-y-3">
        <div className="text-lg">{err}</div>
        <button className="btn-primary" onClick={() => navigate(-1)}>
          Wróć
        </button>
      </div>
    );
  }

  return (
    <div className="card-lg space-y-4">
      <h1 className="text-2xl font-bold">Podgląd wysyłki e-mail — {month}</h1>

      <div className="border rounded-xl overflow-hidden">
        <div className="grid grid-cols-[minmax(320px,3fr)_1fr_1fr] bg-gray-100 text-sm">
          <div className="px-3 py-2">Klient</div>
          <div className="px-3 py-2 text-center">Faktura</div>
          <div className="px-3 py-2 text-center">Protokół</div>
        </div>

        {rows.map((r) => (
          <div
            key={r.clientId}
            className="grid grid-cols-[minmax(320px,3fr)_1fr_1fr] border-t text-sm items-center"
          >
            <div className="px-3 py-2 leading-snug break-words">
              {r.clientName || "—"}
            </div>

            <div className="px-3 py-2 text-center">
              {r.invoiceFile ? (
                <span className="inline-block bg-green-100 text-green-800 px-2 py-1 rounded text-xs break-all">
                  {r.invoiceFile}
                </span>
              ) : (
                <span className="text-gray-400 text-xs">brak</span>
              )}
            </div>

            <div className="px-3 py-2 text-center">
              {r.protocolFile ? (
                <span className="inline-block bg-green-100 text-green-800 px-2 py-1 rounded text-xs break-all">
                  {r.protocolFile}
                </span>
              ) : (
                <span className="text-gray-400 text-xs">brak</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Treść wiadomości e-mail</div>
        <textarea
          className="w-full min-h-[160px] border rounded-lg p-3 text-sm"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="text-xs text-gray-500">
          Dostępne zmienne: {`{invoiceNumber}`}, {`{dueDate}`}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          Wróć
        </button>

        <button
          className="btn-secondary"
          onClick={async () => {
            setChecked(false);
            setCheckMessage("Sprawdzanie załączników…");

            try {
              const res = await apiFetch("/mail/check-attachments", {
                method: "POST",
                json: {
                  month,
                  clients: rows.map((r) => ({
                    clientId: String(r.clientId).toUpperCase(),
                  })),
                },
              });

              const data = await res.json();
              setCheckResult(data);
              console.log("CHECK RESULT:", data);

              const allOk = data.every((r) => r.invoice === true);

              if (allOk) {
                setChecked(true);
                setCheckMessage("✅ Wszystkie wymagane załączniki są dostępne");
              } else {
                setChecked(false);
                setCheckMessage(
                  "❌ Brakuje faktur lub wymaganych protokołów u niektórych klientów"
                );
              }
            } catch {
              setChecked(false);
              setCheckMessage("❌ Błąd podczas sprawdzania załączników");
            }
          }}
        >
          Sprawdź załączniki
        </button>
        {checkMessage && <div className="text-sm mt-1">{checkMessage}</div>}

        <button
          className="btn-primary"
          disabled={!checked || sending}
          onClick={async () => {
            try {
              stopRef.current = false;
              setSending(true);
              setProgress(0);
              setLiveLog([]);

              const subject = `Faktura Steryl Serwis — ${month}`;

              let done = 0;
              let success = 0;
              let failed = 0;

              for (const r of rows) {
                if (stopRef.current) {
                  break;
                }

                try {
                  const res = await apiFetch("/mail/send", {
                    method: "POST",
                    json: {
                      subject,
                      html: message,
                      month,
                      clientId: String(r.clientId).toUpperCase(),
                      to: r.clientEmail,
                    },
                  });

                  if (!res.ok) throw new Error();

                  success++;

                  setLiveLog((prev) => [
                    ...prev,
                    {
                      clientName: r.clientName || r.clientId,
                      email: r.clientEmail,
                      status: "SENT",
                    },
                  ]);
                } catch {
                  failed++;

                  setLiveLog((prev) => [
                    ...prev,
                    {
                      clientName: r.clientName || r.clientId,
                      email: r.clientEmail,
                      status: "ERROR",
                    },
                  ]);
                }

                done++;
                setProgress(Math.round((done / rows.length) * 100));

                // 🔥 ОБОВ'ЯЗКОВА ПАУЗА 7 секунд між email
                if (done < rows.length && !stopRef.current) {
                  await new Promise((resolve) => setTimeout(resolve, 7000));
                }
              }

              setSending(false);

              // ✅ Фінальна модалка
              setSummaryModal({
                success,
                failed,
                total: rows.length,
                stopped: stopRef.current,
              });
            } catch {
              setSending(false);
            }
          }}
        >
          Wyślij e-maile
        </button>
        {sending && (
          <button
            className="btn-danger"
            onClick={() => {
              stopRef.current = true;
              setSending(false);
            }}
          >
            STOP
          </button>
        )}
      </div>
      {liveLog.length > 0 && (
        <div className="border rounded-lg p-4 text-sm space-y-2 mt-4">
          <div className="font-medium">📤 Status wysyłki</div>

          {liveLog.map((r, i) => (
            <div
              key={i}
              className={`p-2 rounded ${
                r.status === "SENT"
                  ? "bg-green-50 text-green-800"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {r.clientName} — {r.email} —{" "}
              {r.status === "SENT" ? "wysłano" : "błąd"}
            </div>
          ))}
        </div>
      )}
      {sendLog && (
        <div className="border rounded-lg p-4 text-sm space-y-3 mt-4">
          <div className="font-medium">📤 Wynik wysyłki</div>

          <div>✅ Wysłane: {sendLog.sent}</div>
          <div>❌ Błędy: {sendLog.failed}</div>

          {sendLog.errors?.length > 0 && (
            <div className="pt-2 space-y-1">
              {sendLog.errors.map((e, i) => {
                const client = rows.find((r) => r.clientId === e.clientId);
                return (
                  <div key={i} className="text-red-600">
                    {client?.clientName || e.clientId} —{" "}
                    {client?.clientEmail || "brak email"} — {e.error}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {sending && (
        <div className="w-full mt-3 bg-gray-200 rounded h-3">
          <div
            className="bg-green-500 h-3 rounded transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-2xl p-5 space-y-4">
            <div className="flex justify-between items-center">
              <div className="text-lg font-semibold">📤 Wynik wysyłki</div>
              <button
                className="text-gray-500 hover:text-black"
                onClick={() => setModal(null)}
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-sm max-h-[50vh] overflow-auto">
              {modal.results.map((r, i) => (
                <div
                  key={i}
                  className={`p-2 rounded ${
                    r.status === "SENT"
                      ? "bg-green-50 text-green-800"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  {r.clientName} — {r.email} —{" "}
                  {r.status === "SENT" ? "wysłano" : r.error}
                </div>
              ))}
            </div>

            <div className="text-right">
              <button className="btn-primary" onClick={() => setModal(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {summaryModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 text-center">
            <div className="text-xl font-semibold">
              {summaryModal.stopped ? "Proces zatrzymany" : "Proces zakończony"}
            </div>

            <div className="text-sm space-y-1">
              <div>📧 Wysłano: {summaryModal.success}</div>
              <div>❌ Błędy: {summaryModal.failed}</div>
              <div>📊 Razem: {summaryModal.total}</div>
            </div>

            <button
              className="btn-primary"
              onClick={() => setSummaryModal(null)}
            >
              Zamknij
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
