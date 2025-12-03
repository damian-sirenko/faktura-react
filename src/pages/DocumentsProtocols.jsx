// src/pages/DocumentsProtocols.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { humanDateTime } from "../utils/docStore.js";
import ProtocolEntryModal from "../components/ProtocolEntryModal.jsx";
import { apiFetch, api } from "../utils/api";

/* utils */
function stripDiacriticsKeepLetters(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function normalizeSearch(s) {
  return stripDiacriticsKeepLetters(s).toLowerCase().trim();
}
function toSlug(s) {
  return normalizeSearch(s)
    .replace(/[^0-9a-z\u0400-\u04FF]+/gi, "-")
    .replace(/(^-|-$)/g, "");
}

/* months PL */
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
const monthParts = (ym) => {
  const [y, m] = String(ym || "").split("-");
  const year = y || "";
  const mi = (Number(m) || 1) - 1;
  return { year, monthIndex: mi, monthWord: MONTHS_PL[mi] || m || "" };
};

// DocumentsProtocols.jsx — ДОДАЙ УТИЛІТУ ДЛЯ ЗАВАНТАЖЕННЯ ZIP
async function downloadZip(apiUrl, pairs, zipNamePrefix = "protokoly") {
  const r = await apiFetch(`/protocols/zip`, {
    method: "POST",
    body: JSON.stringify({ pairs }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(txt || `Błąd ZIP: ${r.status}`);
  }
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${zipNamePrefix}_${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 10000);
}

/* build items from server */
const buildItemsFromServer = (protocols = [], clients = []) => {
  const clientsMap = {};
  for (const c of clients) {
    const id = c?.id || c?.ID || toSlug(c?.name || c?.Klient || "");
    if (id) clientsMap[id] = c;
  }
  return (protocols || [])
    .filter(
      (p) =>
        p && p.id && p.month && Array.isArray(p.entries) && p.entries.length
    )
    .map((p) => {
      const dates = p.entries
        .map((e) => e?.date)
        .filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();

      const lastEntryDate = dates.length
        ? dates[dates.length - 1]
        : `${p.month}-01`;
      const createdAt = new Date(
        `${lastEntryDate}T00:00:00.000Z`
      ).toISOString();

      const clientName =
        String(
          clientsMap[p.id]?.name || clientsMap[p.id]?.Klient || ""
        ).trim() ||
        p.clientName ||
        p.id;

      return {
        id: `${p.id}:${p.month}`,
        clientId: p.id,
        clientName,
        month: p.month, // ключ бекенду (для навігації)
        createdAt, // “Utworzono” = ostatnia data wpisu
        summarized: !!p.summarized,
        lastEntryDate, // YYYY-MM-DD (ostatnia data wpisu)
        displayMonth: lastEntryDate.slice(0, 7), // YYYY-MM (miesiąc wg ostatniego wpisu)
      };
    });
};

export default function DocumentsProtocols() {
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedProtocolIds, setSelectedProtocolIds] = useState(
    () => new Set()
  );
  const [q, setQ] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // === downloads helpers ===
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const makeDownload = (url) => {
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    a.target = "_blank"; // щоб не блокувалося попапами
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const downloadOneProtocol = (clientId, ym) => {
    const url = api(`/protocols/${encodeURIComponent(clientId)}/${ym}/pdf`);
    makeDownload(url);
  };

  const downloadSelectedPDFs = async () => {
    if (!selectedProtocolIds.size) {
      alert("Zaznacz protokoły do pobrania.");
      return;
    }
    const list = Array.from(selectedProtocolIds.values()); // ["clientId:YYYY-MM", ...]
    for (let i = 0; i < list.length; i++) {
      const [cid, ym] = list[i].split(":");
      downloadOneProtocol(cid, ym);
      await sleep(200); // невелика пауза, щоб не блокувало
    }
  };

  const downloadVisiblePDFs = async () => {
    if (!filtered.length) {
      alert("Brak protokołów do pobrania.");
      return;
    }
    for (let i = 0; i < filtered.length; i++) {
      const it = filtered[i];
      downloadOneProtocol(it.clientId, it.month); // używamy oryginalnego month
      await sleep(200);
    }
  };

  const uniqueMonths = (arr) => {
    const s = new Set();
    arr.forEach((it) => it?.month && s.add(it.month));
    return Array.from(s.values()).sort();
  };

  const downloadZipForMonth = (ym) => {
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    const url = api(`/protocols/${ym}/zip`);
    makeDownload(url);
  };

  const downloadZipForScope = async () => {
    // якщо вибрано фільтр місяця — один ZIP для нього
    if (monthFilter) {
      downloadZipForMonth(monthFilter);
      return;
    }
    // інакше — ZIP по кожному місяцю, який є у відфільтрованому списку
    const months = uniqueMonths(filtered.length ? filtered : items);
    if (!months.length) {
      alert("Brak protokołów do pobrania.");
      return;
    }
    if (!confirm(`Pobrać ZIP dla wszystkich miesięcy (${months.join(", ")})?`))
      return;
    for (let i = 0; i < months.length; i++) {
      downloadZipForMonth(months[i]);
      await sleep(300);
    }
  };

  // modal state:
  const [addOpen, setAddOpen] = useState(false);

  const load = async () => {
    setErrorMsg("");
    try {
      const [protRes, clientsRes] = await Promise.all([
        apiFetch("/protocols"),
        apiFetch("/clients"),
      ]);
      if (!protRes.ok)
        throw new Error(
          `Błąd pobierania protokołów: ${protRes.status} ${protRes.statusText}`
        );
      const protocols = await protRes.json();
      const clientsArr = clientsRes.ok ? await clientsRes.json() : [];
      setClients(Array.isArray(clientsArr) ? clientsArr : []);
      const arr = buildItemsFromServer(protocols, clientsArr);
      setItems(arr);
      setSelectedProtocolIds((prev) => {
        const next = new Set();
        arr.forEach((it) => prev.has(it.id) && next.add(it.id));
        return next;
      });
    } catch (e) {
      console.error("[DocumentsProtocols] load error:", e);
      setItems([]);
      setSelectedProtocolIds(new Set());
      setErrorMsg(
        e?.message || "Nie udało się załadować listy protokołów з serwera."
      );
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = normalizeSearch(q);
    return (items || [])
      .filter((it) => {
        const byMonth = monthFilter ? it.displayMonth === monthFilter : true;
        if (!byMonth) return false;
        if (!needle) return true;
        const { year, monthWord } = monthParts(it.displayMonth);
        const protoName = normalizeSearch(
          `Protokół_${monthWord}_${year}_${it.clientName || ""}`
        );
        return (
          protoName.includes(needle) ||
          normalizeSearch(String(it.clientName || "")).includes(needle)
        );
      })
      .sort((a, b) => {
        // Спершу сортуємо за displayMonth (YYYY-MM) ↓, потім за lastEntryDate ↓
        const ma = a.displayMonth;
        const mb = b.displayMonth;
        if (ma !== mb) return ma < mb ? 1 : -1;

        const da = a.lastEntryDate || `${a.displayMonth}-01`;
        const db = b.lastEntryDate || `${b.displayMonth}-01`;
        return da < db ? 1 : -1;
      });
  }, [items, q, monthFilter]);

  const allChecked =
    filtered.length > 0 &&
    filtered.every((it) => selectedProtocolIds.has(it.id));
  const toggleAll = () =>
    setSelectedProtocolIds((s) => {
      if (allChecked) return new Set();
      const n = new Set();
      filtered.forEach((it) => n.add(it.id));
      return n;
    });

  const toggleOneProtocol = (id) =>
    setSelectedProtocolIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectedOneMeta = useMemo(() => {
    if (selectedProtocolIds.size !== 1) return null;
    const id = Array.from(selectedProtocolIds)[0];
    return items.find((x) => x.id === id) || null;
  }, [selectedProtocolIds, items]);

  const navigateToView = (meta) => {
    const clientId = meta.clientId || meta.id.split(":")[0];
    const month = meta.month || meta.id.split(":")[1]; // використовуємо оригінальний month з бекенду
    navigate(`/documents/protocols/${encodeURIComponent(clientId)}/${month}`);
  };

  return (
    <div className="space-y-3">
      <div className="text-lg font-semibold">Dokumenty → Protokoły</div>

      {errorMsg ? (
        <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800">
          {errorMsg}{" "}
          <button
            className="ml-2 underline"
            onClick={load}
            type="button"
            title="Odśwież"
          >
            Spróbuj ponownie
          </button>
        </div>
      ) : null}

      {/* Фільтри + дії */}
      <div className="card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs mb-1 text-gray-600">
              Nazwa protokołu / klient
            </label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="input w-72"
              aria-label="Filtruj po nazwie protokołu lub kliencie"
            />
          </div>

          <div>
            <label className="block text-xs mb-1 text-gray-600">Miesiąc</label>
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="input w-48"
              aria-label="Filtruj po miesiącu"
            />
          </div>

          <div className="flex-1" />

          <button
            className="btn-primary px-3 py-2"
            onClick={() => setAddOpen(true)}
          >
            <span className="inline-flex items-center gap-2">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Dodaj wpis do protokołu</span>
            </span>
          </button>

          <button
            className="btn-danger"
            onClick={() => {
              if (!selectedProtocolIds.size) {
                alert("Zaznacz co najmniej 1 protokół do usunięcia.");
                return;
              }
              alert(
                "Usuwanie całych протоколов з serwera nie jest dostępne.\nOtwórz протокол i usuń niepotrzebne wpisy ręcznie."
              );
            }}
          >
            Usuń zaznaczone
          </button>

          <button
            className="btn-secondary"
            onClick={async () => {
              if (!selectedProtocolIds.size) {
                alert("Zaznacz co najmniej 1 protokół do podsumowania.");
                return;
              }
              if (!confirm("Oznaczyć wybrane protokoły jako PODSUMOWANE?"))
                return;

              try {
                const ids = Array.from(selectedProtocolIds.values());
                await Promise.all(
                  ids.map(async (pair) => {
                    const [cid, ym] = pair.split(":");
                    const r = await apiFetch(
                      `/protocols/${encodeURIComponent(cid)}/${ym}/summarize`,
                      {
                        method: "POST",
                        body: JSON.stringify({ summarized: true }),
                      }
                    );
                    if (!r.ok) {
                      const txt = await r.text();
                      console.warn(
                        "Summarize failed:",
                        cid,
                        ym,
                        txt || r.status
                      );
                    }
                  })
                );
                await load();
                alert("Gotowe. Wybrane protokoły oznaczono: PODSUMOWANE.");
              } catch (e) {
                alert(e?.message || "Nie udało się oznaczyć podsumowania.");
              }
            }}
            title="Oznacz wybrane protokoły jako podsumowane (pieczęć w PDF)"
          >
            Zsumuj zaznaczone
          </button>
          <button
            className="btn-primary"
            onClick={async () => {
              if (!selectedProtocolIds.size) {
                alert("Zaznacz co najmniej 1 protokół.");
                return;
              }
              const pairs = Array.from(selectedProtocolIds).map((id) => {
                const [clientId, month] = id.split(":");
                return { clientId, month };
              });
              try {
                await downloadZip(api, pairs, "protokoly_zaznaczone");
              } catch (e) {
                alert(e?.message || "Nie udało się pobrać ZIP.");
              }
            }}
            title="Pobierz zaznaczone protokoły jako ZIP"
          >
            Pobierz zaznaczone (ZIP)
          </button>

          <button
            className="btn-secondary"
            onClick={async () => {
              if (!filtered.length) {
                alert("Brak widocznych protokołów do pobrania.");
                return;
              }
              const pairs = filtered.map((it) => ({
                clientId: it.clientId,
                month: it.month,
              }));
              try {
                await downloadZip(api, pairs, "protokoly_widoczne");
              } catch (e) {
                alert(e?.message || "Nie udało się pobrać ZIP.");
              }
            }}
            title="Pobierz wszystkie widoczne protokoły jako ZIP"
          >
            Pobierz widoczne (ZIP)
          </button>
        </div>
      </div>

      {/* Список протоколів */}
      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          Brak zapisanych protokołów.
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="px-3 py-2 text-sm text-gray-600 bg-blue-50 border-b">
            Zapisane: {filtered.length}
          </div>
          <table className="table w-full table-fixed">
            <thead>
              <tr className="bg-gray-50">
                <th className="w-[3.5rem] text-center">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Zaznacz wszystkie"
                  />
                </th>
                <th className="w-[6ch] text-center">#</th>
                <th>Nazwa protokołu</th>
                <th className="w-[16ch] text-center">Miesiąc</th>
                <th className="w-[10ch] text-center">Rok</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it, idx) => {
                const { year, monthWord } = monthParts(it.displayMonth);
                const protoName = `Protokół_${monthWord}_${year}_${
                  it.clientName || ""
                }`;
                return (
                  <tr key={it.id} className="hover:bg-gray-50">
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={selectedProtocolIds.has(it.id)}
                        onChange={() => toggleOneProtocol(it.id)}
                        aria-label={`Zaznacz ${protoName}`}
                      />
                    </td>
                    <td className="text-center">{idx + 1}</td>
                    <td className="truncate">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="text-blue-700 hover:underline"
                          onClick={() => navigateToView(it)}
                          title="Otwórz stronę protokołu"
                        >
                          {protoName}
                        </button>
                        {it.summarized ? (
                          <span
                            className="inline-flex items-center gap-1 text-green-700 text-xs border border-green-300 bg-green-50 px-2 py-0.5 rounded-full"
                            title="Ten protokół jest podsumowany (pieczęć w PDF)"
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
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        Utworzono: {humanDateTime(it.createdAt)}
                      </div>
                    </td>

                    <td className="text-center capitalize">{monthWord}</td>
                    <td className="text-center">{year}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Модальне вікно — окремий компонент */}
      <ProtocolEntryModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        clients={clients}
        preselect={
          selectedOneMeta
            ? {
                clientId: selectedOneMeta.clientId,
                clientName: selectedOneMeta.clientName,
                month: selectedOneMeta.month,
              }
            : null
        }
      />
    </div>
  );
}
