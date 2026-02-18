// src/pages/DocumentsProtocols.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";

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

async function downloadZip(_apiUrl, pairs, zipNamePrefix = "protokoly") {
  const r = await apiFetch("/protocols/zip", {
    method: "POST",
    json: { pairs },
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

      const stampMs = (p.entries || [])
        .map((e) => {
          const v =
            e?.createdAt ||
            e?.created_at ||
            e?.ts ||
            e?.timestamp ||
            e?.dateTime ||
            e?.datetime;
          const ms = v ? Date.parse(v) : NaN;
          return Number.isFinite(ms) ? ms : null;
        })
        .filter((ms) => ms !== null)
        .sort((a, b) => a - b);

      const createdAt = stampMs.length
        ? new Date(stampMs[stampMs.length - 1]).toISOString()
        : new Date(`${lastEntryDate}T12:00:00`).toISOString();

      const clientName =
        String(
          clientsMap[p.id]?.name || clientsMap[p.id]?.Klient || ""
        ).trim() ||
        p.clientName ||
        p.id;

      const totalPackages = (p.entries || []).reduce(
        (s, e) => s + Number(e.packages || 0),
        0
      );

      const totalShipments = (p.entries || []).filter(
        (e) => e.shipping === true || e.shipping === 1
      ).length;

      const courierTrips = (p.entries || []).reduce((s, e) => {
        if (!e.delivery) return s;
        if (e.delivery === "odbior" || e.delivery === "dowoz") return s + 1;
        if (e.delivery === "odbior+dowoz") return s + 2;
        return s;
      }, 0);

      return {
        id: `${p.id}:${p.month}`,
        clientId: p.id,
        clientName,
        month: p.month,
        createdAt,
        summarized: !!p.summarized,
        lastEntryDate,
        displayMonth: lastEntryDate.slice(0, 7),

        totalPackages,
        totalShipments,
        courierTrips,
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef(null);

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

  useEffect(() => {
    if (!actionsOpen) return;

    const handleClickOutside = (e) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target)) {
        setActionsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setActionsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionsOpen]);

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

  const groupedRows = useMemo(() => {
    const out = [];
    let lastYm = null;

    for (let idx = 0; idx < filtered.length; idx++) {
      const it = filtered[idx];
      const ym = it.displayMonth;

      if (ym !== lastYm) {
        if (lastYm !== null) {
          const sumItems = filtered.filter((x) => x.displayMonth === lastYm);
          out.push({
            kind: "summary",
            key: `summary:${lastYm}`,
            sums: {
              packages: sumItems.reduce((s, x) => s + x.totalPackages, 0),
              shipments: sumItems.reduce((s, x) => s + x.totalShipments, 0),
              courier: sumItems.reduce((s, x) => s + x.courierTrips, 0),
            },
          });
        }

        lastYm = ym;
        const { year, monthWord } = monthParts(ym);
        out.push({
          kind: "group",
          key: `group:${ym}`,
          ym,
          title: `${monthWord} ${year}`,
        });
      }

      out.push({
        kind: "item",
        key: it.id,
        it,
        idx,
      });
    }

    return out;
  }, [filtered]);

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
      {/* HEADER — unified style */}
      <div className="card-lg border-2 border-blue-200 bg-blue-50/60">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">Protokoły przekazania narzędzi</h1>
        </div>
        <div className="mt-3 flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs mb-1 text-gray-600">
              Nazwa protokołu / klient
            </label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="input w-72"
            />
          </div>

          <div>
            <label className="block text-xs mb-1 text-gray-600">Miesiąc</label>
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="input w-48"
            />
          </div>

          <div
            className="ml-auto flex items-center gap-2 relative"
            ref={actionsRef}
          >
            <button
              className="btn-primary"
              onClick={() => navigate("/protocol-entry")}
            >
              Dodaj wpis do protokołu
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={() => setActionsOpen((v) => !v)}
            >
              Akcje ▾
            </button>

            {actionsOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border bg-white shadow-lg z-50">
                <button
                  className="dropdown-link w-full text-left"
                  onClick={() => {
                    setActionsOpen(false);
                    if (!selectedProtocolIds.size) {
                      alert("Zaznacz protokoły.");
                      return;
                    }
                    alert(
                      "Usuwanie całych protokołów z serwera nie jest dostępne.\nUsuń wpisy ręcznie."
                    );
                  }}
                >
                  Usuń zaznaczone protokoły
                </button>

                <button
                  className="dropdown-link w-full text-left"
                  onClick={async () => {
                    setActionsOpen(false);
                    if (!selectedProtocolIds.size) {
                      alert("Zaznacz protokoły.");
                      return;
                    }
                    const pairs = Array.from(selectedProtocolIds).map((id) => {
                      const [clientId, month] = id.split(":");
                      return { clientId, month };
                    });
                    try {
                      await downloadZip(null, pairs, "protokoly_zaznaczone");
                    } catch {
                      alert("Błąd ZIP.");
                    }
                  }}
                >
                  Pobierz zaznaczone (ZIP)
                </button>

                <button
                  className="dropdown-link w-full text-left"
                  onClick={async () => {
                    setActionsOpen(false);
                    if (!selectedProtocolIds.size) {
                      alert("Zaznacz protokoły.");
                      return;
                    }
                    if (!confirm("Oznaczyć jako podsumowane?")) return;

                    try {
                      const ids = Array.from(selectedProtocolIds.values());
                      await Promise.all(
                        ids.map(async (pair) => {
                          const [cid, ym] = pair.split(":");
                          await apiFetch(
                            `/protocols/${encodeURIComponent(
                              cid
                            )}/${ym}/summarize`,
                            {
                              method: "POST",
                              json: { summarized: true },
                            }
                          );
                        })
                      );
                      await load();
                    } catch {
                      alert("Błąd sumowania.");
                    }
                  }}
                >
                  Zsumuj zaznaczone
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

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

      {/* Список протоколів */}
      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          Brak zapisanych protokołów.
        </div>
      ) : (
        <div className="card p-0">
          <div className="px-3 py-2 text-sm text-gray-600 bg-blue-50 border-b">
            Zapisane: {filtered.length}
          </div>
          <table className="table w-full table-fixed">
            <thead>
              <tr className="bg-gray-50">
                <th
                  className="w-[3.5rem] text-center hidden sm:table-cell
"
                >
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Zaznacz wszystkie"
                  />
                </th>

                <th
                  className="w-[6ch] text-center hidden sm:table-cell
"
                >
                  #
                </th>

                <th className="w-full">
                  <div className="w-full flex items-center gap-2">
                    <div className="min-[1001px]:hidden w-[3.5rem] flex justify-center">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={toggleAll}
                        aria-label="Zaznacz wszystkie"
                      />
                    </div>

                    <div className="flex-1 text-center min-[1001px]:text-left">
                      Nazwa protokołu
                    </div>

                    <div className="min-[1001px]:hidden w-[4.5rem]" />
                  </div>
                </th>
                <th className="w-[9ch] text-center align-middle whitespace-nowrap hidden sm:table-cell">
                  Pakiety
                </th>
                <th className="w-[9ch] text-center align-middle whitespace-nowrap hidden sm:table-cell">
                  Wysyłki
                </th>
                <th className="w-[9ch] text-center align-middle whitespace-nowrap hidden sm:table-cell">
                  Kurier
                </th>

                <th
                  className="w-[16ch] text-center hidden sm:table-cell
"
                >
                  Miesiąc
                </th>
                <th
                  className="w-[10ch] text-center hidden sm:table-cell
"
                >
                  Rok
                </th>
              </tr>
            </thead>

            <tbody>
              {groupedRows.map((row) => {
                if (row.kind === "group") {
                  return (
                    <tr key={row.key} className="bg-blue-50">
                      <td
                        colSpan={8}
                        className="px-3 py-2 text-sm text-gray-700 capitalize text-center min-[1001px]:text-left"
                      >
                        {row.title}
                      </td>
                    </tr>
                  );
                }

                if (row.kind === "summary") {
                  return (
                    <tr
                      key={row.key}
                      className="bg-gray-50 font-bold border-t-2 border-b-2 border-gray-400"
                    >
                      <td colSpan={3} className="text-right px-3">
                        Razem:
                      </td>
                      <td className="text-center">
                        {row.sums.packages || "–"}
                      </td>
                      <td className="text-center">
                        {row.sums.shipments || "–"}
                      </td>
                      <td className="text-center">{row.sums.courier || "–"}</td>
                      <td colSpan={2}></td>
                    </tr>
                  );
                }
                

                const it = row.it;
                const idx = row.idx;

                const { year, monthWord } = monthParts(it.displayMonth);
                const protoName = `Protokół_${monthWord}_${year}_${
                  it.clientName || ""
                }`;

                return (
                  <tr key={row.key} className="hover:bg-gray-50 h-12">
                    <td className="text-center hidden sm:table-cell h-full">
                      <input
                        type="checkbox"
                        checked={selectedProtocolIds.has(it.id)}
                        onChange={() => toggleOneProtocol(it.id)}
                        aria-label={`Zaznacz ${protoName}`}
                      />
                    </td>
                    <td className="text-center hidden sm:table-cell h-full">
                      {idx + 1}
                    </td>

                    <td className="min-w-0 align-middle">
                      <div className="w-full flex items-center gap-2 min-w-0 h-full">
                        <div className="min-[1001px]:hidden w-[4.5rem] pt-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-[3ch] text-right">
                              {idx + 1}.
                            </span>
                            <input
                              type="checkbox"
                              checked={selectedProtocolIds.has(it.id)}
                              onChange={() => toggleOneProtocol(it.id)}
                              aria-label={`Zaznacz ${protoName}`}
                            />
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-1 min-[1001px]:flex-row min-[1001px]:items-center min-[1001px]:gap-2 min-w-0">
                            <button
                              type="button"
                              className="text-blue-700 hover:underline truncate text-left"
                              onClick={() => navigateToView(it)}
                              title="Otwórz stronę protokołu"
                            >
                              {protoName}
                            </button>

                            {it.summarized ? (
                              <span
                                className="inline-flex items-center gap-1 text-green-700 text-xs border border-green-300 bg-green-50 px-2 py-0.5 rounded-full self-start min-[1001px]:self-auto min-[1001px]:shrink-0"
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
                        </div>
                      </div>
                    </td>

                    <td className="hidden sm:table-cell relative">
                      <div className="absolute inset-0 flex items-center justify-center">
                        {it.totalPackages}
                      </div>
                    </td>
                    <td className="hidden sm:table-cell relative">
                      <div className="absolute inset-0 flex items-center justify-center">
                        {it.totalShipments > 0 ? it.totalShipments : "–"}
                      </div>
                    </td>
                    <td className="hidden sm:table-cell relative">
                      <div className="absolute inset-0 flex items-center justify-center">
                        {it.courierTrips > 0 ? it.courierTrips : "–"}
                      </div>
                    </td>

                    <td
                      className="text-center capitalize hidden sm:table-cell
"
                    >
                      {monthWord}
                    </td>

                    <td className="text-center hidden sm:table-cell h-full">
                      {year}
                    </td>
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
