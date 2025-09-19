// src/pages/DocumentsProtocols.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { humanDateTime } from "../utils/docStore.js";
import SignaturePad from "../components/SignaturePad.jsx";

// ===== API base (як на інших сторінках) — явний fallback на :3000
const API = import.meta.env.VITE_API_URL || "http://localhost:3000";
const api = (p) => `${API}${p.startsWith("/") ? p : `/${p}`}`;

// ===== Утиліти пошуку (без діакритики, з кирилицею)
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

// Абсолютний шлях для підписів
const absSig = (src) =>
  typeof src === "string" && src.startsWith("/signatures/") ? api(src) : src;

// ===== Місяці PL
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
const monthFromDate = (iso) => String(iso || "").slice(0, 7);

// ===== Формування елементів списку протоколів з бекенду
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
      const maxDate =
        p.entries
          .map((e) => e?.date)
          .filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
          .sort()
          .slice(-1)[0] || `${p.month}-01`;
      const createdAt = new Date(`${maxDate}T00:00:00.000Z`).toISOString();
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
        month: p.month,
        createdAt,
      };
    });
};

export default function DocumentsProtocols() {
  const navigate = useNavigate();

  // ---- список протоколів ----
  const [items, setItems] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedProtocolIds, setSelectedProtocolIds] = useState(
    () => new Set()
  );
  const [q, setQ] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // ---- модалка додавання/редагування ----
  const [addOpen, setAddOpen] = useState(false);

  // вибір клієнта в модалці
  const [clientQuery, setClientQuery] = useState("");
  const [pickedClient, setPickedClient] = useState(null);

  // поля форми запису
  const todayISO = new Date().toISOString().slice(0, 10);
  const [dateISO, setDateISO] = useState(todayISO);

  // інструменти (стартово 6 рядків; можна додавати по 6)
  const initialRows = 6;
  const [tools, setTools] = useState(
    Array.from({ length: initialRows }, () => ({ name: "", count: "" }))
  );

  const [packages, setPackages] = useState("");

  // взаємовиключні чекбокси
  const [svcShip, setSvcShip] = useState(false);
  const [svcK1, setSvcK1] = useState(false);
  const [svcK2, setSvcK2] = useState(false);

  const [comment, setComment] = useState("");

  // редагування існуючого запису
  const [editingIndex, setEditingIndex] = useState(null);

  // список записів для обраного клієнта + місяця
  const [monthEntries, setMonthEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  // виділення одного запису (для підписання/черги)
  const [selectedEntryIndex, setSelectedEntryIndex] = useState(null);

  // refs для enter-навігації
  const nameRefs = useRef([]);
  const countRefs = useRef([]);
  const pkgRef = useRef(null);
  const dateRef = useRef(null);
  const commentRef = useRef(null);
  const clientInputRef = useRef(null);

  // ===== Signature modal (серwis only) =====
  const [signOpen, setSignOpen] = useState(false);
  const padTransferRef = useRef(null);
  const padReturnRef = useRef(null);
  const [padTEmpty, setPadTEmpty] = useState(true);
  const [padREmpty, setPadREmpty] = useState(true);

  // Завантаження протоколів і клієнтів
  const load = async () => {
    setErrorMsg("");
    try {
      const [protRes, clientsRes] = await Promise.all([
        fetch(api("/protocols")),
        fetch(api("/clients")),
      ]);
      if (!protRes.ok)
        throw new Error(
          `Błąd pobierania protokołów: ${protRes.status} ${protRes.statusText}`
        );
      const protocols = await protRes.json();
      const clientsArr = clientsRes.ok ? await clientsRes.json() : [];
      const arr = buildItemsFromServer(protocols, clientsArr);
      setItems(arr);
      setClients(Array.isArray(clientsArr) ? clientsArr : []);
      setSelectedProtocolIds((prev) => {
        const next = new Set();
        arr.forEach((it) => prev.has(it.id) && next.add(it.id));
        return next;
      });
    } catch (e) {
      console.error("[DocumentsProtocols] backend load error:", e);
      setItems([]);
      setSelectedProtocolIds(new Set());
      setErrorMsg(
        e?.message || "Nie udało się załadować listy protokołów z serwera."
      );
    }
  };

  useEffect(() => {
    load();
  }, []);

  // фільтрація списку протоколів
  const filtered = useMemo(() => {
    const needle = normalizeSearch(q);
    return (items || [])
      .filter((it) => {
        const byMonth = monthFilter ? it.month === monthFilter : true;
        if (!byMonth) return false;
        if (!needle) return true;
        const { year, monthWord } = monthParts(it.month);
        const protoName = normalizeSearch(
          `Protokół_${monthWord}_${year}_${it.clientName || ""}`
        );
        return (
          protoName.includes(needle) ||
          normalizeSearch(String(it.clientName || "")).includes(needle)
        );
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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

  const navigateToView = (meta) => {
    const clientId = meta.clientId || meta.id.split(":")[0];
    const month = meta.month || meta.id.split(":")[1];
    navigate(`/documents/protocols/${encodeURIComponent(clientId)}/${month}`);
  };

  // завантажити записи конкретного клієнта + місяця
  const fetchEntriesFor = async (clientObj, forDateISO) => {
    if (!clientObj || !forDateISO) {
      setMonthEntries([]);
      return;
    }
    const clientId =
      clientObj?.id ||
      clientObj?.ID ||
      toSlug(clientObj?.name || clientObj?.Klient || "");
    const ym = monthFromDate(forDateISO);
    if (!clientId || !/^\d{4}-\d{2}$/.test(ym)) {
      setMonthEntries([]);
      return;
    }
    setLoadingEntries(true);
    try {
      const r = await fetch(
        api(`/protocols/${encodeURIComponent(clientId)}/${ym}`),
        { cache: "no-store" }
      );
      if (r.ok) {
        const data = await r.json();
        const entries = Array.isArray(data?.entries) ? data.entries : [];
        setMonthEntries(entries);
      } else {
        setMonthEntries([]);
      }
    } catch {
      setMonthEntries([]);
    } finally {
      setLoadingEntries(false);
    }
  };

  // автопідстановка клієнта з виділеного протоколу
  const selectedOneMeta = useMemo(() => {
    if (selectedProtocolIds.size !== 1) return null;
    const id = Array.from(selectedProtocolIds)[0];
    return items.find((x) => x.id === id) || null;
  }, [selectedProtocolIds, items]);

  const openAddModal = () => {
    // очистити форму
    setEditingIndex(null);
    setTools(
      Array.from({ length: initialRows }, () => ({ name: "", count: "" }))
    );
    setPackages("");
    setSvcShip(false);
    setSvcK1(false);
    setSvcK2(false);
    setComment("");
    setDateISO(todayISO);
    setSelectedEntryIndex(null);

    // підставити клієнта (якщо один вибраний у списку)
    let prePicked = null;
    let query = "";
    if (selectedOneMeta) {
      const id = selectedOneMeta.clientId;
      prePicked =
        clients.find(
          (c) => (c?.id || c?.ID || toSlug(c?.name || c?.Klient || "")) === id
        ) || null;
      query =
        prePicked?.name ||
        prePicked?.Klient ||
        selectedOneMeta.clientName ||
        "";
    }
    setPickedClient(prePicked);
    setClientQuery(query);

    setAddOpen(true);
    setTimeout(() => clientInputRef.current?.focus(), 0);

    if (prePicked) fetchEntriesFor(prePicked, todayISO);
  };

  // підказки клієнтів
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
    fetchEntriesFor(s.raw, dateISO);
  };

  const onClientInputKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (pickedClient) return;
      if (clientSuggestions.length) pickSuggestion(clientSuggestions[0]);
    }
  };

  const clearPicked = () => {
    setPickedClient(null);
    setClientQuery("");
    setMonthEntries([]);
    setEditingIndex(null);
    setSelectedEntryIndex(null);
    setTimeout(() => clientInputRef.current?.focus(), 0);
  };

  // Enter-навігація між полями
  const focusNext = (index, col) => {
    // col: 0 = name, 1 = count
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

  // валідація
  const canSave = useMemo(() => {
    const pkgOk = Number(packages) > 0;
    const anyToolOk = tools.some(
      (t) => String(t.name || "").trim() && Number(t.count) > 0
    );
    return Boolean(pickedClient && pkgOk && anyToolOk && dateISO);
  }, [pickedClient, packages, tools, dateISO]);

  // маппінг чекбоксів у payload
  const serviceToPayload = () => {
    let shipping = false;
    let delivery = "";
    if (svcShip) shipping = true;
    if (svcK1) delivery = "odbior";
    if (svcK2) delivery = "odbior+dowoz";
    // якщо вибрано ship + кур'єр — ship залишиться true, delivery як вибрано
    // (але у тебе умова взаємовиключна — в UI ми відключаємо інші)
    return { shipping, delivery };
  };

  // зібрати payload
  const buildEntryPayload = () => {
    const filteredTools = tools
      .filter((t) => String(t.name || "").trim())
      .map((t) => ({
        name: String(t.name).trim(),
        count: Number(t.count || 0) || 0,
      }));

    const { shipping, delivery } = serviceToPayload();

    return {
      date: dateISO,
      tools: filteredTools,
      packages: Number(packages || 0) || 0,
      shipping: Boolean(shipping),
      delivery: delivery || "",
      comment: String(comment || "").trim(),
    };
  };

  // локальне оновлення одного рядка в monthEntries
  const applyEntryAt = (idx, partial) => {
    setMonthEntries((prev) => {
      const arr = Array.isArray(prev) ? [...prev] : [];
      const base = arr[idx] || {};
      arr[idx] = { ...base, ...partial };
      return arr;
    });
  };

  // зберегти (POST або PATCH)
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
        r = await fetch(
          api(`/protocols/${encodeURIComponent(clientId)}/${ym}`),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
      } else {
        r = await fetch(
          api(
            `/protocols/${encodeURIComponent(clientId)}/${ym}/${editingIndex}`
          ),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
      }
      if (!r.ok) {
        const txt = await r.text();
        alert(`Błąd zapisu: ${txt || r.status}`);
        return;
      }

      // Спробуємо взяти оновлений запис із відповіді (якщо бек повертає)
      let updatedEntry = null;
      try {
        const json = await r.json();
        updatedEntry =
          json?.entry ||
          (Array.isArray(json?.entries) && editingIndex != null
            ? json.entries[editingIndex]
            : null);
      } catch {}

      // або перезавантажити весь список місяця (надійніше)
      await fetchEntriesFor(pickedClient, dateISO);

      if (editingIndex == null) {
        // після додавання — очистити поля, але залишити клієнта/дату
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
        // після редагування — скинути індекс редагування
        setEditingIndex(null);
      }
    } catch (e) {
      alert(`Błąd zapisu: ${e?.message || "nieznany"}`);
    }
  };

  // почати редагування існуючого запису
  const startEditEntry = (idx) => {
    const row = monthEntries[idx];
    if (!row) return;
    setEditingIndex(idx);
    setDateISO(row.date || todayISO);
    setPackages(String(Number(row.packages != null ? row.packages : 0) || ""));
    // розкласти сервіс у чекбокси
    setSvcShip(!!row.shipping);
    setSvcK1(row.delivery === "odbior");
    setSvcK2(row.delivery === "odbior+dowoz");
    setComment(row.comment || row.notes || "");

    // інструменти (динамічна довжина)
    const len = Math.max(initialRows, (row.tools || []).length);
    setTools(
      Array.from({ length: len }, (_, i) => {
        const src = (row.tools || [])[i];
        return {
          name: src?.name || "",
          count:
            src?.count != null && !Number.isNaN(Number(src?.count))
              ? String(src.count)
              : "",
        };
      })
    );

    setSelectedEntryIndex(idx);
    setTimeout(() => nameRefs.current?.[0]?.focus(), 0);
  };

  // видалити запис
  const deleteEntry = async (idx) => {
    if (!pickedClient) return;
    if (!confirm("Usunąć ten wpis z protokołu?")) return;
    const clientId =
      pickedClient?.id ||
      pickedClient?.ID ||
      toSlug(pickedClient?.name || pickedClient?.Klient || "");
    const ym = monthFromDate(dateISO);
    try {
      const r = await fetch(
        api(`/protocols/${encodeURIComponent(clientId)}/${ym}/${idx}`),
        { method: "DELETE" }
      );
      if (!r.ok) {
        const txt = await r.text();
        alert(`Błąd usuwania: ${txt || r.status}`);
        return;
      }
      // локально прибрати рядок, без повного перезавантаження
      setMonthEntries((prev) => prev.filter((_, i) => i !== idx));
      if (editingIndex === idx) {
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
        setSelectedEntryIndex(null);
      }
      // оновити мета-список протоколів
      await load();
    } catch (e) {
      alert(`Błąd usuwania: ${e?.message || "nieznany"}`);
    }
  };

  // PATCH довільної частини запису
  const patchEntry = async (idx, patchBody) => {
    if (!pickedClient) return;
    const clientId =
      pickedClient?.id ||
      pickedClient?.ID ||
      toSlug(pickedClient?.name || pickedClient?.Klient || "");
    const ym = monthFromDate(dateISO);
    const r = await fetch(
      api(`/protocols/${encodeURIComponent(clientId)}/${ym}/${idx}`),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      }
    );
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(txt || `HTTP ${r.status}`);
    }
    // Якщо бек не повертає оновленого запису — підтягуємо весь список
    try {
      const json = await r.json();
      if (json?.entry) {
        applyEntryAt(idx, json.entry);
        return;
      }
    } catch {}
    await fetchEntriesFor(pickedClient, dateISO);
  };

  // Взаємовиключність чекбоксів
  const toggleShip = (val) => {
    setSvcShip(val);
    if (val) {
      setSvcK1(false);
      setSvcK2(false);
    }
  };
  const toggleK1 = (val) => {
    setSvcK1(val);
    if (val) {
      setSvcShip(false);
      setSvcK2(false);
    }
  };
  const toggleK2 = (val) => {
    setSvcK2(val);
    if (val) {
      setSvcShip(false);
      setSvcK1(false);
    }
  };

  // Підписання (серwis only) — відкриття модалки
  const openSignModal = () => {
    if (selectedEntryIndex == null) {
      alert("Zaznacz wiersz w tabeli poniżej (checkbox).");
      return;
    }
    setSignOpen(true);
    setPadTEmpty(true);
    setPadREmpty(true);
    // очищення падів після відкриття
    setTimeout(() => {
      padTransferRef.current?.clear?.();
      padReturnRef.current?.clear?.();
      setPadTEmpty(true);
      setPadREmpty(true);
    }, 0);
  };

  const saveStaffSignatures = async () => {
    if (selectedEntryIndex == null || !pickedClient) return;
    const clientId =
      pickedClient?.id ||
      pickedClient?.ID ||
      toSlug(pickedClient?.name || pickedClient?.Klient || "");
    const ym = monthFromDate(dateISO);
    const idx = selectedEntryIndex;

    try {
      // zapisujemy тільки te, które narysowano
      if (!padTEmpty && padTransferRef.current) {
        const dataURL = padTransferRef.current.toDataURL("image/png");
        await fetch(
          api(`/protocols/${encodeURIComponent(clientId)}/${ym}/${idx}/sign`),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leg: "transfer", staff: dataURL }),
          }
        );
      }
      if (!padREmpty && padReturnRef.current) {
        const dataURL = padReturnRef.current.toDataURL("image/png");
        await fetch(
          api(`/protocols/${encodeURIComponent(clientId)}/${ym}/${idx}/sign`),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leg: "return", staff: dataURL }),
          }
        );
      }
      setSignOpen(false);
      await fetchEntriesFor(pickedClient, dateISO);
    } catch (e) {
      alert(e?.message || "Nie udało się zapisać podpisów.");
    }
  };

  // Додати до черги (kurier / punkt)
  const enqueueFor = async (kind /* 'courier' | 'point' */) => {
    if (selectedEntryIndex == null || !pickedClient) {
      alert("Najpierw zaznacz jeden wiersz w tabeli (checkbox).");
      return;
    }
    const clientId =
      pickedClient?.id ||
      pickedClient?.ID ||
      toSlug(pickedClient?.name || pickedClient?.Klient || "");
    const ym = monthFromDate(dateISO);
    const idx = selectedEntryIndex;
    try {
      const r = await fetch(
        api(`/protocols/${encodeURIComponent(clientId)}/${ym}/${idx}/queue`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: kind === "point" ? "point" : "courier",
            pending: true,
          }),
        }
      );
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt || `HTTP ${r.status}`);
      }
      alert(
        `Dodano do kolejki podpisów klienta — ${
          kind === "point" ? "punkt" : "kurier"
        }.`
      );
    } catch (e) {
      alert(e?.message || "Nie udało się dodać do kolejki.");
    }
  };

  // оновлення списку при зміні дати
  useEffect(() => {
    if (pickedClient && dateISO) fetchEntriesFor(pickedClient, dateISO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateISO]);

  // ==== RENDER ====
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

          <button className="btn-primary px-3 py-2" onClick={openAddModal}>
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
                "Usuwanie całych protokołów z serwera nie jest dostępne.\nOtwórz protokół i usuń niepotrzebne wpisy ręcznie."
              );
            }}
          >
            🗑️ Usuń zaznaczone
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
          <table className="table w-full">
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
                const { year, monthWord } = monthParts(it.month);
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
                      <button
                        type="button"
                        className="text-blue-700 hover:underline"
                        onClick={() => navigateToView(it)}
                        title="Otwórz stronę protokołu"
                      >
                        {protoName}
                      </button>
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

      {/* ===== МОДАЛКА ДОДАВАННЯ/РЕДАГУВАННЯ ===== */}
      {addOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[1200px] h-[92vh] flex flex-col overflow-hidden">
            {/* header */}
            <div className="px-4 py-3 border-b flex items-center gap-3">
              <div className="font-semibold text-base">
                Dodaj/edytuj wpis protokołu
              </div>
              <div className="flex-1" />
              <button
                className="btn-secondary"
                onClick={() => {
                  setAddOpen(false);
                  setPickedClient(null);
                  setClientQuery("");
                  setMonthEntries([]);
                  setEditingIndex(null);
                  setSelectedEntryIndex(null);
                }}
              >
                Zamknij
              </button>
            </div>

            {/* wybór klienta */}
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
                    }}
                    onKeyDown={onClientInputKeyDown}
                  />
                  {clientQuery &&
                    !pickedClient &&
                    clientSuggestions.length > 0 && (
                      <div className="absolute left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-10 max-h-60 overflow-auto">
                        {clientSuggestions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-gray-100"
                            onClick={() => pickSuggestion(s)}
                            title={`Wybierz: ${s.name} (${s.id})`}
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
                    onClick={clearPicked}
                    disabled={!clientQuery && !pickedClient}
                  >
                    Wyczyść
                  </button>
                </div>
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
                    • Miesiąc: <b>{monthFromDate(dateISO)}</b>
                  </span>
                </div>
              ) : (
                <div className="mt-2 text-sm text-gray-500">
                  Wybierz klienta, aby dodać wpis.
                </div>
              )}
            </div>

            {/* форма запису */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* Narzędzia (адаптивні, імена звужуються) + Коментар праворуч (md+) */}
              <div className="card">
                <div className="font-semibold mb-2">
                  Narzędzia (6 wierszy startowo; możesz dodać kolejne)
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  {/* LEFT: tools */}
                  <div>
                    <div className="grid grid-cols-[minmax(0,1fr)_8ch] gap-x-3 gap-y-2">
                      {tools.map((t, i) => (
                        <React.Fragment key={i}>
                          <input
                            ref={(el) => (nameRefs.current[i] = el)}
                            className="input w-full truncate"
                            value={t.name}
                            placeholder={`Narzędzie ${i + 1}`}
                            onChange={(e) => {
                              const v = e.target.value;
                              setTools((prev) => {
                                const n = [...prev];
                                n[i] = { ...n[i], name: v };
                                return n;
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                focusNext(i, 0);
                              }
                            }}
                          />
                          <input
                            ref={(el) => (countRefs.current[i] = el)}
                            className="input w-full text-right"
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
                      ))}
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

                  {/* RIGHT: comment */}
                  <div>
                    <label className="block text-sm mb-1">Komentarz</label>
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

              {/* Pakiety + Usługi (взаємовиключні чекбокси) */}
              <div className="card grid md:grid-cols-3 gap-3 items-start">
                <div>
                  <label className="block text-sm mb-1">Pakiety (szt.) *</label>
                  <input
                    ref={pkgRef}
                    type="number"
                    min="0"
                    className="input w-full text-right"
                    value={packages}
                    onChange={(e) => setPackages(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm">
                    Dodatkowe usługi (wykluczające)
                  </label>
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

                <div className="md:self-end">
                  <label className="block text-xs text-gray-600 mb-1">
                    Data przekazania
                  </label>
                  <input
                    type="date"
                    className="input w-full md:w-48"
                    value={dateISO}
                    onChange={(e) => setDateISO(e.target.value)}
                  />
                </div>
              </div>

              {/* Кнопки збереження */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="btn-primary"
                  onClick={doSave}
                  disabled={!canSave}
                  title={
                    canSave
                      ? "Zapisz wpis do protokołu"
                      : "Uzupełnij minimum: 1 narzędzie (nazwa + ilość) oraz Pakiety"
                  }
                >
                  {editingIndex == null ? "Zapisz wpis" : "Zapisz zmiany"}
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

                {/* Дії над виділеним записом */}
                <div className="ml-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={selectedEntryIndex == null}
                    onClick={openSignModal}
                    title="Podpisy serwisu dla zaznaczonego wiersza"
                  >
                    Podpisz (serwis)
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={selectedEntryIndex == null}
                    onClick={() => enqueueFor("courier")}
                    title="Do kolejki podpisu klienta — kurier"
                  >
                    Do kolejki (kurier)
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={selectedEntryIndex == null}
                    onClick={() => enqueueFor("point")}
                    title="Do kolejki podpisu klienta — punkt"
                  >
                    Do kolejki (punkt)
                  </button>
                </div>
              </div>

              {/* Список записів за клієнта/місяць */}
              <div className="card">
                <div className="font-semibold mb-2">
                  Wpisy w protokole —{" "}
                  {pickedClient
                    ? pickedClient?.name || pickedClient?.Klient || ""
                    : "—"}{" "}
                  • {monthFromDate(dateISO)}
                </div>

                {!pickedClient ? (
                  <div className="text-gray-500">Wybierz klienta powyżej.</div>
                ) : loadingEntries ? (
                  <div className="text-gray-600">Ładowanie wpisów…</div>
                ) : monthEntries.length === 0 ? (
                  <div className="text-gray-500">
                    Brak wpisów w tym miesiącu.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table w-full">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-center w-[5ch]">✓</th>
                          <th className="text-center w-[6ch]">#</th>
                          <th className="text-center w-[12ch]">Data</th>
                          <th className="w-[30%]">Narzędzie</th>
                          <th className="text-center w-[10ch]">Ilość</th>
                          <th className="text-center w-[14ch]">
                            Podpisy (Serwis)
                          </th>
                          <th className="text-center w-[14ch]">
                            Podpisy (Klient)
                          </th>
                          <th>Komentarz / Usługa</th>
                          <th className="text-center w-[12ch]">Akcje</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthEntries.map((row, i) => {
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
                          const rStaffSig = absSig(
                            row?.signatures?.return?.staff
                          );

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
                          const isSelected = selectedEntryIndex === i;

                          return (
                            <React.Fragment key={`${row.date}-${i}`}>
                              <tr className="align-top">
                                <td className="text-center">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() =>
                                      setSelectedEntryIndex((prev) =>
                                        prev === i ? null : i
                                      )
                                    }
                                    aria-label={`Zaznacz wiersz ${i + 1}`}
                                  />
                                </td>
                                <td className="text-center">{i + 1}</td>
                                <td className="text-center">{row.date}</td>

                                {/* Narzędzie (зменшена ширина, по рядку на інструмент) */}
                                <td className="align-top">
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

                                {/* Ilość */}
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

                                {/* Podpisy (Serwis): dwa малих прев’ю один під одним */}
                                <td className="text-center align-top">
                                  <div className="min-h-[42px]">
                                    {tStaffSig ? (
                                      <img
                                        src={tStaffSig}
                                        alt="Serwis — przekazanie"
                                        className="max-h-5 mx-auto object-contain block"
                                      />
                                    ) : (
                                      <div className="text-[11px] text-gray-400">
                                        — brak —
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-h-[42px] mt-1">
                                    {rStaffSig ? (
                                      <img
                                        src={rStaffSig}
                                        alt="Serwis — zwrot"
                                        className="max-h-5 mx-auto object-contain block"
                                      />
                                    ) : (
                                      <div className="text-[11px] text-gray-400">
                                        — brak —
                                      </div>
                                    )}
                                  </div>
                                </td>

                                {/* Podpisy (Klient): два прев’ю один під одним */}
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

                                {/* Komentarz / Usługa */}
                                <td className="align-top">
                                  <div className="mb-1">
                                    {row.comment || row.notes || (
                                      <span className="text-gray-500">—</span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-600">
                                    Usługa: <b>{service}</b>
                                  </div>
                                </td>

                                {/* Akcje (вертикально) */}
                                <td className="text-center align-top">
                                  <div className="inline-flex flex-col gap-1">
                                    <button
                                      className="btn-secondary"
                                      onClick={() => startEditEntry(i)}
                                      title="Edytuj wpis"
                                    >
                                      Edytuj
                                    </button>
                                    <button
                                      className="btn-danger"
                                      onClick={() => deleteEntry(i)}
                                      title="Usuń wpis"
                                    >
                                      Usuń
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {/* Підсумок пакети */}
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
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* footer */}
            <div className="px-4 py-3 border-t flex items-center justify-between text-xs text-gray-600">
              <div>
                * Minimalne dane do zapisu: 1 narzędzie (nazwa + ilość) oraz
                liczba pakietów.
              </div>
              <div>Miesiąc protokołu przyjmowany z daty przekazania.</div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: Podpisy serwisu dla zaznaczonego wpisu ===== */}
      {signOpen && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setSignOpen(false)}
          style={{ background: "rgba(0,0,0,0.45)" }}
        >
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">Podpisy serwisu</div>
              <button
                className="btn-secondary"
                onClick={() => setSignOpen(false)}
              >
                Zamknij
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="mb-2 text-sm font-medium">
                  Przekazanie — Serwis
                </div>
                <SignaturePad
                  ref={padTransferRef}
                  onChange={setPadTEmpty}
                  width={560}
                  height={200}
                />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium">Zwrot — Serwis</div>
                <SignaturePad
                  ref={padReturnRef}
                  onChange={setPadREmpty}
                  width={560}
                  height={200}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                className={`btn-primary ${
                  padTEmpty && padREmpty ? "opacity-50 cursor-not-allowed" : ""
                }`}
                disabled={padTEmpty && padREmpty}
                onClick={saveStaffSignatures}
              >
                Zapisz podpis(y)
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  padTransferRef.current?.clear?.();
                  setPadTEmpty(true);
                  padReturnRef.current?.clear?.();
                  setPadREmpty(true);
                }}
              >
                Wyczyść oba
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
