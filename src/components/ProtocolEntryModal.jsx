import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../utils/api";

// тільки для src картинок підписів треба повна база бекенду
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const withBase = (p) => `${API_BASE}${p}`;

/* === Utilities === */
function stripDiacriticsKeepLetters(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function normalizeSearch(s) {
  return stripDiacriticsKeepLetters(s)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
function toSlug(s) {
  return normalizeSearch(s)
    .replace(/[^0-9a-z\u0400-\u04FF]+/gi, "-")
    .replace(/(^-|-$)/g, "");
}

function toISODatePlain(v) {
  const s = String(v || "");
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  if (v instanceof Date && !isNaN(v)) {
    const Y = v.getFullYear();
    const M = String(v.getMonth() + 1).padStart(2, "0");
    const D = String(v.getDate()).padStart(2, "0");
    return `${Y}-${M}-${D}`;
  }
  return "";
}
function plDate(iso) {
  const s = toISODatePlain(iso);
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}

const monthFromDate = (iso) => String(iso || "").slice(0, 7);
const ymOf = (s) => (/^\d{4}-\d{2}$/.test(s) ? s : monthFromDate(s));
const absSig = (src) =>
  typeof src === "string" && src.startsWith("/signatures/")
    ? withBase(src)
    : src;

export default function ProtocolEntryModal({
  isOpen,
  onClose,
  clients = [],
  preselect = null, // {clientId, clientName, month?}
}) {
  if (!isOpen) return null;

  // ======= STATE =======
  const [toast, setToast] = useState(null);

  const todayISO = toISODatePlain(new Date());

  const [clientQuery, setClientQuery] = useState("");
  const [pickedClient, setPickedClient] = useState(null);
  const [entriesMonth, setEntriesMonth] = useState(monthFromDate(todayISO));

  const [monthEntries, setMonthEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  // форма додання/редагування
  const initialRows = 6;
  const [dateISO, setDateISO] = useState(todayISO);
  const [tools, setTools] = useState(
    Array.from({ length: initialRows }, () => ({ name: "", count: "" }))
  );
  const [packages, setPackages] = useState("");
  const [svcShip, setSvcShip] = useState(false);
  const [svcK1, setSvcK1] = useState(false);
  const [svcK2, setSvcK2] = useState(false);
  const [comment, setComment] = useState("");
  const [editingIndex, setEditingIndex] = useState(null);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState(null);

  const nameRefs = useRef([]);
  const countRefs = useRef([]);
  const pkgRef = useRef(null);
  const dateRef = useRef(null);
  const commentRef = useRef(null);
  const clientInputRef = useRef(null);

  const [signing, setSigning] = useState(null); // {idx, leg}
  const [clientActiveIdx, setClientActiveIdx] = useState(-1); // для клієнта
  const [activeSuggestIndex, setActiveSuggestIndex] = useState(-1); // для інструментів (поточний рядок)

  // === ДОВІДНИК ІНСТРУМЕНТІВ з /tools (cosmetic + medical) ===
  const [services, setServices] = useState([]);

  // Канонічні назви (точно як у довіднику)
  const serviceNames = useMemo(() => {
    return (services || []).map((s) => String(s || "").trim()).filter(Boolean);
  }, [services]);

  // Мапа: normalized -> canonical
  const nameMap = useMemo(() => {
    const map = new Map();
    for (const n of serviceNames) {
      const key = normalizeSearch(n);
      if (!map.has(key)) map.set(key, n);
    }
    return map;
  }, [serviceNames]);

  const [activeSuggestRow, setActiveSuggestRow] = useState(null);

  function getNameSuggestions(q) {
    const key = normalizeSearch(q);
    if (!key) return [];
    return serviceNames
      .filter((n) => normalizeSearch(n).includes(key))
      .slice(0, 8);
  }

  function canonicalizeToolName(name) {
    const raw = String(name || "").trim();
    if (!raw) return "";
    const key = normalizeSearch(raw);
    return nameMap.get(key) || raw;
  }

  // ⬇️ беремо інструменти з /tools
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const r = await apiFetch("/tools");
        if (!ignore && r.ok) {
          const data = await r.json();
          const cos = Array.isArray(data?.cosmetic) ? data.cosmetic : [];
          const med = Array.isArray(data?.medical) ? data.medical : [];
          const seen = new Set();
          const merged = [];
          for (const arr of [cos, med]) {
            for (const item of arr) {
              const v = String(item || "").trim();
              const k = normalizeSearch(v);
              if (v && !seen.has(k)) {
                merged.push(v);
                seen.add(k);
              }
            }
          }
          setServices(merged);
        }
      } catch {
        if (!ignore) setServices([]);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  // ====== клієнт з предзаповнення ======
  useEffect(() => {
    if (!preselect) return;
    const { clientId, clientName, month } = preselect;
    const found =
      clients.find(
        (c) =>
          (c?.id || c?.ID || toSlug(c?.name || c?.Klient || "")) === clientId
      ) || null;
    setPickedClient(found);
    setClientQuery(clientName || found?.name || found?.Klient || "");
    if (month) setEntriesMonth(month);
    if (found) fetchEntriesFor(found, month || todayISO);
  }, [preselect, clients]);

  // ==== Список за місяць
  const fetchEntriesFor = async (clientObj, ymOrDateISO) => {
    if (!clientObj || !ymOrDateISO) {
      setMonthEntries([]);
      return;
    }
    const clientId =
      clientObj?.id ||
      clientObj?.ID ||
      toSlug(clientObj?.name || clientObj?.Klient || "");
    const ym = ymOf(ymOrDateISO);
    if (!clientId || !/^\d{4}-\d{2}$/.test(ym)) {
      setMonthEntries([]);
      return;
    }
    setLoadingEntries(true);
    try {
      const r = await apiFetch(
        `/protocols/${encodeURIComponent(clientId)}/${ym}`
      );

      if (r.ok) {
        const data = await r.json();
        const entries = Array.isArray(data?.entries) ? data.entries : [];
        setMonthEntries(
          entries.map((e) => ({
            ...e,
            date: toISODatePlain(e?.date),
            returnDate: toISODatePlain(e?.returnDate),
          }))
        );
      } else {
        setMonthEntries([]);
      }
    } catch {
      setMonthEntries([]);
    } finally {
      setLoadingEntries(false);
    }
  };

  // ==== Suggestions клієнта
  const clientSuggestions = useMemo(() => {
    const key = normalizeSearch(clientQuery);
    if (!key || pickedClient) return [];
    return (clients || [])
      .map((c) => {
        const id = c?.id || c?.ID || toSlug(c?.name || c?.Klient || "");
        const name = c?.name || c?.Klient || id;
        return { id, name, raw: c };
      })
      .filter(
        (x) =>
          normalizeSearch(x.name).includes(key) ||
          normalizeSearch(x.id).includes(key)
      )
      .slice(0, 10);
  }, [clientQuery, clients, pickedClient]);

  const pickSuggestion = (s) => {
    setPickedClient(s.raw);
    setClientQuery(`${s.name}`);
    setEditingIndex(null);
    setSelectedEntryIndex(null);
    fetchEntriesFor(s.raw, entriesMonth || dateISO);
  };

  const onClientInputKeyDown = (e) => {
    if (!clientSuggestions.length && e.key !== "Escape") return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setClientActiveIdx(
        (i) => (i + 1) % Math.max(1, clientSuggestions.length)
      );
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setClientActiveIdx((i) =>
        i <= 0 ? clientSuggestions.length - 1 : i - 1
      );
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (pickedClient) return;
      const idx = clientActiveIdx >= 0 ? clientActiveIdx : 0;
      const pick = clientSuggestions[idx];
      if (pick) {
        pickSuggestion(pick);
        setClientActiveIdx(-1);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setClientActiveIdx(-1);
      return;
    }
  };

  // взаємовиключні чекбокси
  const toggleShip = (checked) => {
    if (checked) {
      setSvcShip(true);
      setSvcK1(false);
      setSvcK2(false);
    } else {
      setSvcShip(false);
    }
  };
  const toggleK1 = (checked) => {
    if (checked) {
      setSvcShip(false);
      setSvcK1(true);
      setSvcK2(false);
    } else {
      setSvcK1(false);
    }
  };
  const toggleK2 = (checked) => {
    if (checked) {
      setSvcShip(false);
      setSvcK2(true);
    } else {
      setSvcK2(false);
    }
  };

  // формування payload (канонізуємо назви)
  const buildEntryPayload = () => {
    const filteredTools = tools
      .filter((t) => String(t.name || "").trim() && Number(t.count) > 0)
      .map((t) => ({
        name: canonicalizeToolName(t.name),
        count: Number(t.count || 0) || 0,
      }));
    return {
      date: dateISO,
      tools: filteredTools,
      packages: Number(packages || 0) || 0,
      shipping: !!svcShip,
      delivery: svcK2 ? "odbior+dowoz" : svcK1 ? "odbior" : "",
      comment: String(comment || "").trim(),
    };
  };

  const doSave = async () => {
    if (!pickedClient) return;
    const clientId =
      pickedClient?.id ||
      pickedClient?.ID ||
      toSlug(pickedClient?.name || pickedClient?.Klient || "");
    const ym = monthFromDate(dateISO);
    const body = buildEntryPayload();

    try {
      let r;
      if (editingIndex == null) {
        r = await apiFetch(`/protocols/${encodeURIComponent(clientId)}/${ym}`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else {
        r = await apiFetch(
          `/protocols/${encodeURIComponent(clientId)}/${ym}/${editingIndex}`,
          {
            method: "PATCH",
            body: JSON.stringify(body),
          }
        );
      }
      if (!r.ok) {
        const txt = await r.text();
        alert(`Błąd zapisu: ${txt || r.status}`);
        return;
      }
      const resp = await r.json().catch(() => ({}));
      let newIdx = editingIndex;
      if (editingIndex == null) {
        const len = resp?.protocol?.entries?.length;
        newIdx = Number.isFinite(len) && len > 0 ? len - 1 : null;
      }

      await fetchEntriesFor(pickedClient, entriesMonth || dateISO);
      if (newIdx != null) setSelectedEntryIndex(newIdx);

      setToast("✅ Wpis został pomyślnie zapisany.");
      setTimeout(() => setToast(null), 2200);

      if (editingIndex == null) {
        setTools(
          Array.from({ length: initialRows }, () => ({ name: "", count: "" }))
        );
        setPackages("");
        setSvcShip(false);
        setSvcK1(false);
        setSvcK2(false);
        setComment("");
        nameRefs.current[0]?.focus();
      } else {
        setEditingIndex(null);
      }
    } catch (e) {
      alert(`Błąd zapisu: ${e?.message || "nieznany"}`);
    }
  };

  // видалення запису
  const deleteEntry = async (idx) => {
    if (!pickedClient) return;
    const ok = confirm(`Usunąć wpis nr ${idx + 1}?`);
    if (!ok) return;
    const clientId =
      pickedClient?.id ||
      pickedClient?.ID ||
      toSlug(pickedClient?.name || pickedClient?.Klient || "");
    const ym = entriesMonth || monthFromDate(dateISO);
    try {
      const r = await apiFetch(
        `/protocols/${encodeURIComponent(clientId)}/${ym}/${idx}`,
        { method: "DELETE" }
      );
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt || `HTTP ${r.status}`);
      }
      await fetchEntriesFor(pickedClient, ym);
      if (selectedEntryIndex === idx) setSelectedEntryIndex(null);
      if (editingIndex === idx) setEditingIndex(null);
    } catch (e) {
      alert(e?.message || "Nie udało się usunąć wpisu.");
    }
  };

  // почати редагування
  const startEditEntry = (idx) => {
    const row = monthEntries[idx];
    if (!row) return;
    setEditingIndex(idx);
    setSelectedEntryIndex(idx);

    setDateISO(toISODatePlain(row.date) || todayISO);

    setPackages(String(Number(row.packages || 0) || ""));
    setSvcShip(!!row.shipping);
    setSvcK1(row.delivery === "odbior");
    setSvcK2(row.delivery === "odbior+dowoz");
    setComment(row.comment || row.notes || "");
    const len = Math.max(initialRows, (row.tools || []).length);
    setTools(
      Array.from({ length: len }, (_, i) => {
        const src = (row.tools || [])[i];
        return {
          name: src?.name || "",
          count: src?.count != null ? String(src.count) : "",
        };
      })
    );
  };

  // дублікат
  const duplicateFromSelected = () => {
    if (selectedEntryIndex == null) {
      alert("Zaznacz wiersz w tabeli poniżej (checkbox).");
      return;
    }
    const row = monthEntries[selectedEntryIndex];
    if (!row) return;
    setEditingIndex(null);
    setPackages(row.packages != null ? String(row.packages) : "");
    setSvcShip(!!row.shipping);
    setSvcK1(row.delivery === "odbior");
    setSvcK2(row.delivery === "odbior+dowoz");
    setComment(row.comment || row.notes || "");
    const len = Math.max(initialRows, (row.tools || []).length);
    setTools(
      Array.from({ length: len }, (_, i) => {
        const src = (row.tools || [])[i];
        return {
          name: src?.name || "",
          count: src?.count != null ? String(src.count) : "",
        };
      })
    );
    setTimeout(() => nameRefs.current?.[0]?.focus(), 0);
  };

  const enqueueForSigning = async (queueType /* 'courier' | 'point' */) => {
    if (!pickedClient) {
      alert("Najpierw wybierz klienta.");
      return;
    }
    if (selectedEntryIndex == null) {
      alert("Zaznacz jeden wpis w tabeli poniżej (pierwsza kolumna).");
      return;
    }

    const clientId =
      pickedClient?.id ||
      pickedClient?.ID ||
      toSlug(pickedClient?.name || pickedClient?.Klient || "");
    const ym = entriesMonth || monthFromDate(dateISO);

    try {
      const r = await apiFetch(
        `/protocols/${encodeURIComponent(
          clientId
        )}/${ym}/${selectedEntryIndex}/queue`,
        {
          method: "POST",
          body: JSON.stringify({
            type: queueType, // 'courier' | 'point'
            pending: true,
          }),
        }
      );

      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(txt || `HTTP ${r.status}`);
      }

      await fetchEntriesFor(pickedClient, ym);

      setToast(
        `✅ Dodano do kolejki (${queueType === "courier" ? "kurier" : "punkt"})`
      );
      setTimeout(() => setToast(null), 2200);
    } catch (e) {
      alert(
        `Nie udało się dodać do kolejki (${
          queueType === "courier" ? "kurier" : "punkt"
        }). ${e?.message || ""}`
      );
    }
  };

  // ✅ Підпис сервіса — дефолтний підпис staff з бекенду
  const signStaff = async (idx, leg) => {
    if (!pickedClient) return;
    setSigning({ idx, leg });
    const clientId =
      pickedClient?.id ||
      pickedClient?.ID ||
      toSlug(pickedClient?.name || pickedClient?.Klient || "");
    const ym = entriesMonth || monthFromDate(dateISO);
    try {
      const r = await apiFetch(
        `/protocols/${encodeURIComponent(clientId)}/${ym}/${idx}/sign`,
        {
          method: "POST",
          body: JSON.stringify({ leg, useDefaultStaff: true }),
        }
      );

      if (!r.ok) {
        let message = "";
        try {
          const j = await r.json();
          message = j?.error || "";
        } catch {
          try {
            message = await r.text();
          } catch {
            message = "";
          }
        }
        throw new Error(message || `HTTP ${r.status}`);
      }

      await fetchEntriesFor(pickedClient, ym);
      setToast(
        `✅ Podpis (${
          leg === "transfer" ? "przekazanie" : "zwrot"
        }, serwis) zapisany.`
      );
      setTimeout(() => setToast(null), 2200);
    } catch (e) {
      alert(e?.message || "Nie udało się zapisać podpisu (serwis).");
    } finally {
      setSigning(null);
    }
  };

  // видалення підпису сервісу
  const removeStaffSignature = async (idx, leg) => {
    if (!pickedClient) return;
    const clientId =
      pickedClient?.id ||
      pickedClient?.ID ||
      toSlug(pickedClient?.name || pickedClient?.Klient || "");
    const ym = entriesMonth || monthFromDate(dateISO);
    try {
      const r = await apiFetch(
        `/protocols/${encodeURIComponent(clientId)}/${ym}/${idx}/sign`,
        {
          method: "DELETE",
          body: JSON.stringify({ leg, who: "staff" }),
        }
      );
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt || `HTTP ${r.status}`);
      }
      await fetchEntriesFor(pickedClient, ym);
      setToast(
        `🗑 Usunięto podpis (${
          leg === "transfer" ? "przekazanie" : "zwrot"
        }, serwis).`
      );
      setTimeout(() => setToast(null), 2200);
    } catch (e) {
      alert(e?.message || "Nie udało się usunąć podpisu (serwis).");
    }
  };

  // автопідтягнення при зміні дати/місяця/клієнта
  useEffect(() => {
    if (pickedClient && dateISO) fetchEntriesFor(pickedClient, dateISO);
    // eslint-disable-next-line
  }, [dateISO]);

  useEffect(() => {
    if (pickedClient && entriesMonth)
      fetchEntriesFor(pickedClient, entriesMonth);
    // eslint-disable-next-line
  }, [entriesMonth, pickedClient]);

  const totalPackages = useMemo(
    () =>
      (monthEntries || []).reduce(
        (s, r) => s + (Number(r?.packages || 0) || 0),
        0
      ),
    [monthEntries]
  );
  const viewEntries = useMemo(() => {
    const ymdKey = (s) => {
      const [Y, M, D] = String(s || "")
        .split("-")
        .map((n) => parseInt(n, 10) || 0);
      return Y * 10000 + M * 100 + D;
    };
    return (monthEntries || [])
      .map((row, i) => ({ row, i }))
      .filter((x) => x.row && x.row.date)
      .sort((a, b) => ymdKey(a.row.date) - ymdKey(b.row.date));
  }, [monthEntries]);

  // валідація форми
  const canSave = useMemo(() => {
    const pkgOk = Number(packages) > 0;
    const anyToolOk = tools.some(
      (t) => String(t.name || "").trim() && Number(t.count) > 0
    );
    return Boolean(pickedClient && pkgOk && anyToolOk && dateISO);
  }, [pickedClient, packages, tools, dateISO]);

  // helper enter навігації
  const focusNext = (index, col) => {
    if (col === 0) {
      countRefs.current[index]?.focus();
      return;
    }
    if (index < tools.length - 1) {
      nameRefs.current[index + 1]?.focus();
    } else {
      pkgRef.current?.focus();
    }
  };

  // === RENDER MODAL ===
  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      /* ❌ прибрано onClick={onClose}, щоб клік по оверлею НЕ закривав модалку */
      style={{ background: "rgba(0,0,0,0.45)" }}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[1200px] h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* toast */}
        {toast && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
            <div className="px-4 py-2 rounded-lg bg-emerald-600 text-white shadow-lg">
              {toast}
            </div>
          </div>
        )}

        {/* Header */}
        <div className="px-4 py-3 border-b flex items-center gap-3">
          <div className="font-semibold text-base">
            Dodaj/edytuj wpis protokołu
          </div>
          <div className="flex-1" />
          {/* кнопка із хрестиком для закриття */}
          <button
            className="btn-secondary !px-3 !py-1.5"
            onClick={onClose}
            aria-label="Zamknij"
            title="Zamknij"
          >
            ✕
          </button>
        </div>

        {/* wybór klientа */}
        <div className="p-4 border-b">
          <div className="grid md:grid-cols-[1fr_auto_auto] gap-3 items-end">
            <div className="relative">
              <label className="block text-xs mb-1 text-gray-600">
                Klient (wpisz fragment nazwy lub ID)
              </label>
              <input
                ref={clientInputRef}
                className="input w-full"
                value={clientQuery}
                onChange={(e) => {
                  setClientQuery(e.target.value);
                  setPickedClient(null);
                  setMonthEntries([]);
                  setEditingIndex(null);
                  setSelectedEntryIndex(null);
                  setClientActiveIdx(-1); // reset highlight
                }}
                onKeyDown={onClientInputKeyDown}
              />
              {clientQuery && !pickedClient && clientSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-10 max-h-60 overflow-auto">
                  {clientSuggestions.map((s, i) => (
                    <button
                      key={s.id}
                      type="button"
                      className={
                        "w-full text-left px-3 py-2 hover:bg-gray-100 " +
                        (i === clientActiveIdx ? "bg-gray-100" : "")
                      }
                      onMouseEnter={() => setClientActiveIdx(i)}
                      onMouseLeave={() => setClientActiveIdx(-1)}
                      onClick={() => {
                        pickSuggestion(s);
                        setClientActiveIdx(-1);
                      }}
                    >
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-gray-500">{s.id}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="md:justify-self-end">
              <label className="block text-xs mb-1 text-gray-600">
                Data przekazania
              </label>
              <input
                ref={dateRef}
                type="date"
                className="input w-48"
                value={dateISO}
                onChange={(e) => setDateISO(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setPickedClient(null);
                  setClientQuery("");
                  setMonthEntries([]);
                  setEditingIndex(null);
                  setSelectedEntryIndex(null);
                }}
                disabled={!clientQuery && !pickedClient}
              >
                Wyczyść
              </button>
            </div>
          </div>

          {/* фільтр місяця */}
          <div className="mt-3">
            <label className="block text-xs mb-1 text-gray-600">
              Miesiąc wpisów (filtr)
            </label>
            <input
              type="month"
              className="input w-48"
              value={entriesMonth}
              onChange={(e) => setEntriesMonth(e.target.value)}
              aria-label="Filtr miesiąca wpisów w protokole"
            />
          </div>

          {pickedClient ? (
            <div className="mt-2 text-sm">
              Wybrano:{" "}
              <b>{pickedClient?.name || pickedClient?.Klient || "—"}</b>{" "}
              <span className="text-gray-600">
                (
                {pickedClient?.id ||
                  pickedClient?.ID ||
                  toSlug(pickedClient?.name || pickedClient?.Klient || "")}
                )
              </span>
              <span className="ml-2 text-gray-500">
                • Miesiąc: <b>{entriesMonth}</b>
              </span>
            </div>
          ) : (
            <div className="mt-2 text-sm text-gray-500">
              Wybierz klienta, aby dodać wpis.
            </div>
          )}
        </div>

        {/* Форма + entries */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Narzędzia + komentarz */}
          <div className="card print-full-width print-reset-pad">
            {/* ✅ вирівнюємо назви колонок на одному рівні */}
            <div className="grid md:grid-cols-2 gap-6 items-start">
              {/* LEFT (Narzędzia) */}
              <div>
                <label className="block text-sm mb-2 font-medium">
                  Narzędzia
                </label>
                <div className="grid grid-cols-[minmax(0,1fr)_12ch] gap-x-3 gap-y-2">
                  {tools.map((t, i) => {
                    const suggestions = getNameSuggestions(t.name);
                    return (
                      <React.Fragment key={i}>
                        <div className="relative">
                          <input
                            ref={(el) => (nameRefs.current[i] = el)}
                            className="input w-full truncate"
                            value={String(t.name || "")}
                            placeholder={`Narzędzie ${i + 1}`}
                            onFocus={() => setActiveSuggestRow(i)}
                            onBlur={(e) => {
                              const canon = canonicalizeToolName(
                                e.target.value
                              );
                              if (canon !== e.target.value) {
                                setTools((prev) => {
                                  const n = [...prev];
                                  n[i] = { ...n[i], name: canon };
                                  return n;
                                });
                              }
                              setTimeout(() => {
                                setActiveSuggestRow(null);
                                setActiveSuggestIndex(-1);
                              }, 120);
                            }}
                            onChange={(e) => {
                              const v = e.target.value;
                              setTools((prev) => {
                                const n = [...prev];
                                n[i] = { ...n[i], name: v };
                                return n;
                              });
                              if (activeSuggestRow !== i)
                                setActiveSuggestRow(i);
                              setActiveSuggestIndex(0);
                            }}
                            onKeyDown={(e) => {
                              const suggestions = getNameSuggestions(t.name);

                              if (e.key === "ArrowDown" && suggestions.length) {
                                e.preventDefault();
                                if (activeSuggestRow !== i)
                                  setActiveSuggestRow(i);
                                setActiveSuggestIndex(
                                  (idx) =>
                                    (idx + 1) % Math.max(1, suggestions.length)
                                );
                                return;
                              }
                              if (e.key === "ArrowUp" && suggestions.length) {
                                e.preventDefault();
                                if (activeSuggestRow !== i)
                                  setActiveSuggestRow(i);
                                setActiveSuggestIndex((idx) =>
                                  idx <= 0 ? suggestions.length - 1 : idx - 1
                                );
                                return;
                              }

                              if (e.key === "Enter") {
                                e.preventDefault();
                                const pick =
                                  suggestions.length && activeSuggestIndex >= 0
                                    ? suggestions[activeSuggestIndex]
                                    : suggestions[0];

                                if (pick) {
                                  setTools((prev) => {
                                    const n = [...prev];
                                    n[i] = { ...n[i], name: pick };
                                    return n;
                                  });
                                  setActiveSuggestRow(null);
                                  setActiveSuggestIndex(-1);
                                  focusNext(i, 0);
                                  return;
                                }
                                // якщо підказок нема — канонізуємо та вперед
                                const canon = canonicalizeToolName(t.name);
                                if (canon !== t.name) {
                                  setTools((prev) => {
                                    const n = [...prev];
                                    n[i] = { ...n[i], name: canon };
                                    return n;
                                  });
                                }
                                focusNext(i, 0);
                                return;
                              }

                              if (e.key === "Escape") {
                                e.preventDefault();
                                setActiveSuggestRow(null);
                                setActiveSuggestIndex(-1);
                                return;
                              }
                            }}
                          />
                          {activeSuggestRow === i &&
                            String(t.name || "").trim() &&
                            suggestions.length > 0 && (
                              <div className="absolute left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-10 max-h-48 overflow-auto">
                                {suggestions.map((name, si) => (
                                  <button
                                    key={name}
                                    type="button"
                                    className={
                                      "w-full text-left px-3 py-2 hover:bg-gray-100 " +
                                      (activeSuggestRow === i &&
                                      si === activeSuggestIndex
                                        ? "bg-gray-100"
                                        : "")
                                    }
                                    onMouseEnter={() => {
                                      setActiveSuggestRow(i);
                                      setActiveSuggestIndex(si);
                                    }}
                                    onMouseDown={(ev) => ev.preventDefault()}
                                    onClick={() => {
                                      setTools((prev) => {
                                        const n = [...prev];
                                        n[i] = { ...n[i], name };
                                        return n;
                                      });
                                      setActiveSuggestRow(null);
                                      setActiveSuggestIndex(-1);
                                      setTimeout(
                                        () => countRefs.current[i]?.focus(),
                                        0
                                      );
                                    }}
                                  >
                                    {name}
                                  </button>
                                ))}
                              </div>
                            )}
                        </div>

                        <input
                          ref={(el) => (countRefs.current[i] = el)}
                          className="input w-[12ch] text-right"
                          type="number"
                          min="0"
                          value={t.count}
                          placeholder="0"
                          onChange={(e) => {
                            const v = e.target.value;
                            setTools((prev) => {
                              const n = [...prev];
                              n[i] = { ...n[i], count: v };
                              return n;
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              focusNext(i, 1);
                            }
                          }}
                        />
                      </React.Fragment>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="btn-secondary mt-3"
                  onClick={() =>
                    setTools((prev) => [
                      ...prev,
                      ...Array.from({ length: 6 }, () => ({
                        name: "",
                        count: "",
                      })),
                    ])
                  }
                >
                  ➕ Dodaj kolejne wiersze
                </button>
              </div>

              {/* RIGHT (Komentarz) */}
              <div>
                <label className="block text-sm mb-2 font-medium">
                  Komentarz
                </label>
                <textarea
                  ref={commentRef}
                  className="input w-full min-h-[240px]"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={700}
                  placeholder="Uwagi do wpisu…"
                />
                <div className="text-xs text-gray-500 mt-1">
                  {String(comment || "").length}/700
                </div>
              </div>
            </div>
          </div>

          {/* Pakiety + услуги */}
          <div className="card grid md:grid-cols-2 gap-3 items-start">
            <div>
              <label className="block text-sm mb-1">Pakiety (szt.) *</label>
              <input
                type="number"
                min="0"
                className="input w-full text-right"
                value={packages}
                onChange={(e) => setPackages(e.target.value)}
                ref={pkgRef}
              />
            </div>
            <div>
              <label className="block text-sm mb-2">Dodatkowe usługi</label>
              <div className="flex flex-col gap-2">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={svcShip}
                    onChange={(e) => toggleShip(e.target.checked)}
                  />
                  Wysyłka
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={svcK1}
                    onChange={(e) => toggleK1(e.target.checked)}
                  />
                  Kurier x1
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={svcK2}
                    onChange={(e) => toggleK2(e.target.checked)}
                  />
                  Kurier x2
                </label>
              </div>
            </div>
          </div>

          {/* Кнопки збереження + черга підпису */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn-primary"
              onClick={doSave}
              disabled={!canSave}
              title={
                canSave
                  ? "Zapisz wpis do protokołu"
                  : "Uzupełnij: co najmniej 1 narzędzie + ilość, oraz Pakiety."
              }
            >
              {editingIndex == null ? "Zapisz wpis" : "Zapisz zmiany"}
            </button>

            <button
              type="button"
              className="btn-secondary"
              disabled={selectedEntryIndex == null}
              onClick={duplicateFromSelected}
              title="Wypełnij formularz danymi z zaznaczonego wpisu (tabela poniżej)"
            >
              Wypełnij z zaznaczonego
            </button>

            {editingIndex != null && (
              <button
                className="btn-secondary"
                onClick={() => {
                  setEditingIndex(null);
                  setTools(
                    Array.from({ length: initialRows }, () => ({
                      name: "",
                      count: "",
                    }))
                  );
                  setPackages("");
                  setSvcShip(false);
                  setSvcK1(false);
                  setSvcK2(false);
                  setComment("");
                }}
              >
                Anuluj edycję
              </button>
            )}

            {/* === кнопки в чергу на підпис === */}
            <button
              type="button"
              className="btn-secondary"
              disabled={selectedEntryIndex == null || !pickedClient}
              onClick={() => enqueueForSigning("courier")}
              title="Dodaj zaznaczony wpis do kolejki podpisów — kurier"
            >
              Do podpisu: kurier
            </button>

            <button
              type="button"
              className="btn-secondary"
              disabled={selectedEntryIndex == null || !pickedClient}
              onClick={() => enqueueForSigning("point")}
              title="Dodaj zaznaczony wpis do kolejki podpisów — punkt"
            >
              Do podpisu: punkt
            </button>
          </div>

          {/* Entries list */}
          <div className="card">
            <div className="font-semibold mb-2">
              Wpisy w protokole —{" "}
              {pickedClient
                ? pickedClient?.name || pickedClient?.Klient || ""
                : "—"}{" "}
              • {entriesMonth}
            </div>

            {!pickedClient ? (
              <div className="text-gray-500">Wybierz klienta powyżej.</div>
            ) : loadingEntries ? (
              <div className="text-gray-600">Ładowanie wpisów…</div>
            ) : monthEntries.length === 0 ? (
              <div className="text-gray-500">Brak wpisów w tym miesiącu.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table w-full table-fixed print-table">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-center w-[5ch]">✓</th>
                      <th className="text-center w-[6ch]">#</th>
                      <th className="text-center w-[12ch]">Data</th>
                      <th className="w-[26%] md:w-[28%] lg:w-[30%]">
                        Narzędzie
                      </th>
                      <th className="text-center w-[12ch]">Ilość</th>
                      <th className="text-center w-[14ch]">Podpisy (Serwis)</th>
                      <th className="text-center w-[14ch]">Podpisy (Klient)</th>
                      <th className="w-[24%] md:w-[26%] lg:w-[28%]">
                        Komentarz / Usługa
                      </th>
                      <th className="text-center w-[12ch]">Akcje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewEntries.map(({ row, i: origIndex }, displayIndex) => {
                      const toolsList = (row.tools || []).filter(
                        (t) => t?.name
                      );
                      const tClientSig = absSig(
                        row?.signatures?.transfer?.client
                      );
                      const tStaffSig = absSig(
                        row?.signatures?.transfer?.staff
                      );
                      const rClientSig = absSig(
                        row?.signatures?.return?.client
                      );
                      const rStaffSig = absSig(row?.signatures?.return?.staff);

                      const service = row.shipping
                        ? "Wysyłka"
                        : row.delivery === "odbior"
                        ? "Kurier x1"
                        : row.delivery === "odbior+dowoz"
                        ? "Kurier x2"
                        : "—";

                      const quantities = toolsList.map((t) =>
                        Number(t.count || 0)
                      );
                      const isSelected = selectedEntryIndex === origIndex;

                      return (
                        <React.Fragment key={`${row.date}-${origIndex}`}>
                          <tr className="align-top">
                            <td className="text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() =>
                                  setSelectedEntryIndex((prev) =>
                                    prev === origIndex ? null : origIndex
                                  )
                                }
                                aria-label={`Zaznacz wiersz ${
                                  displayIndex + 1
                                }`}
                              />
                            </td>

                            {/* # у відсортованому вигляді */}
                            <td className="text-center">{displayIndex + 1}</td>

                            <td className="text-center">{plDate(row.date)}</td>

                            <td className="align-top break-words">
                              {toolsList.length ? (
                                toolsList.map((t, k) => (
                                  <div
                                    key={k}
                                    className="leading-tight truncate"
                                  >
                                    {t.name}
                                  </div>
                                ))
                              ) : (
                                <span className="text-gray-500">—</span>
                              )}
                            </td>

                            <td className="text-center align-top">
                              {toolsList.length ? (
                                quantities.map((q, k) => (
                                  <div key={k} className="leading-tight">
                                    {q}
                                  </div>
                                ))
                              ) : (
                                <span className="text-gray-500">—</span>
                              )}
                            </td>

                            {/* Podpisy (Serwis) */}
                            <td className="text-center align-top">
                              <div className="min-h-[42px]">
                                {tStaffSig ? (
                                  <button
                                    className="inline-flex items-center justify-center h-7 px-2 text-[11px] leading-none rounded border border-red-600 bg-red-600 text-white hover:bg-red-700"
                                    onClick={() =>
                                      removeStaffSignature(
                                        origIndex,
                                        "transfer"
                                      )
                                    }
                                    title="Usuń podpis serwisu (przekazanie)"
                                  >
                                    Usuń podpis
                                  </button>
                                ) : (
                                  <button
                                    className={`inline-flex items-center justify-center h-7 px-2 text-[11px] leading-none rounded border border-blue-600 bg-blue-600 text-white ${
                                      signing?.idx === origIndex &&
                                      signing?.leg === "transfer"
                                        ? "opacity-50 cursor-wait"
                                        : ""
                                    }`}
                                    onClick={() =>
                                      signStaff(origIndex, "transfer")
                                    }
                                    title="Podpisz (serwis) — przekazanie"
                                  >
                                    Podpisz przekazanie
                                  </button>
                                )}
                              </div>

                              <div className="min-h-[42px] mt-1">
                                {rStaffSig ? (
                                  <button
                                    className="inline-flex items-center justify-center h-7 px-2 text-[11px] leading-none rounded border border-red-600 bg-red-600 text-white hover:bg-red-700"
                                    onClick={() =>
                                      removeStaffSignature(origIndex, "return")
                                    }
                                    title="Usuń podpis serwisu (zwrot)"
                                  >
                                    Usuń podpis
                                  </button>
                                ) : (
                                  <button
                                    className={`inline-flex items-center justify-center h-7 px-2 text-[11px] leading-none rounded border border-blue-600 bg-blue-600 text-white ${
                                      signing?.idx === origIndex &&
                                      signing?.leg === "return"
                                        ? "opacity-50 cursor-wait"
                                        : ""
                                    }`}
                                    onClick={() =>
                                      signStaff(origIndex, "return")
                                    }
                                    title="Podpisz (serwis) — zwrot"
                                  >
                                    Podpisz zwrot
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* Podpisy (Klient) */}
                            <td className="text-center align-top">
                              <div className="min-h-[42px]">
                                {tClientSig ? (
                                  <img
                                    src={tClientSig}
                                    alt="Klient — przekazanie"
                                    className="max-h-5 mx-auto object-contain block"
                                  />
                                ) : (
                                  <div className="text-[11px] text-gray-400">
                                    — brak —
                                  </div>
                                )}
                              </div>
                              <div className="min-h-[42px] mt-1">
                                {rClientSig ? (
                                  <img
                                    src={rClientSig}
                                    alt="Klient — zwrot"
                                    className="max-h-5 mx-auto object-contain block"
                                  />
                                ) : (
                                  <div className="text-[11px] text-gray-400">
                                    — brak —
                                  </div>
                                )}
                              </div>
                            </td>

                            <td className="align-top break-words">
                              <div className="mb-1 text-[12px] leading-snug">
                                {row.comment || row.notes || (
                                  <span className="text-gray-500">—</span>
                                )}
                              </div>
                              <div className="text-xs text-gray-600">
                                Usługa: <b>{service}</b>
                              </div>
                            </td>

                            <td className="text-center align-top">
                              <div className="inline-flex flex-col gap-1">
                                <button
                                  className="btn-secondary"
                                  onClick={() => startEditEntry(origIndex)}
                                  title="Edytuj wpis"
                                >
                                  Edytuj
                                </button>
                                <button
                                  className="btn-danger"
                                  onClick={() => deleteEntry(origIndex)}
                                  title="Usuń wpis"
                                >
                                  Usuń
                                </button>
                              </div>
                            </td>
                          </tr>

                          <tr className="bg-gray-50">
                            <td />
                            <td />
                            <td className="text-right pr-2 font-medium">
                              Pakiety:
                            </td>
                            <td />
                            <td className="text-center font-semibold">
                              {row.packages ?? 0}
                            </td>
                            <td colSpan={4} />
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>

                  <tfoot>
                    <tr className="bg-blue-50">
                      <td />
                      <td />
                      <td className="text-right pr-2 font-semibold">
                        Suma pakietów w miesiącu:
                      </td>
                      <td />
                      <td className="text-center font-bold">{totalPackages}</td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t flex items-center justify-between text-xs text-gray-600">
          {/* порожньо або кнопки */}
        </div>
      </div>
    </div>
  );
}
