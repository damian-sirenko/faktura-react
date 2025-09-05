// src/components/clients/ClientProtocol.jsx
import React, { useEffect, useRef, useState, useCallback } from "react";

import SignaturePad from "../SignaturePad.jsx";
/* === PDF + локальне сховище документів (стабільні шляхи) === */
import { buildProtocolPdf } from "../../utils/ProtocolPdf.js";
import { saveProtocolDocMeta } from "../../utils/docStore.js";

// --- Icon button (узгоджений стиль як на сторінці клієнтів) ---
const DeleteIcon = ({ className = "" }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const IconButton = ({
  title,
  onClick,
  className = "",
  variant = "danger", // danger | primary | secondary
  children,
}) => {
  // квадратний фон (а не круглий)
  const base =
    "inline-flex items-center justify-center w-8 h-8 rounded-lg p-1.5 transition focus:outline-none focus:ring";
  const variants = {
    danger: "bg-red-100 text-red-700 hover:bg-red-200 focus:ring-red-300",
    primary: "bg-blue-100 text-blue-700 hover:bg-blue-200 focus:ring-blue-300",
    secondary:
      "bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-300",
  };
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

/** Helpers */
const ymOf = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);

// стабільний slug без діакритиків — як на бекенді
function stripDiacritics(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function slugFromName(name) {
  return stripDiacritics(String(name || "client"))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function MonthPicker({ value, onChange }) {
  return (
    <input
      type="month"
      className="input w-40"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function ClientProtocol({ client }) {
  // стабільний clientId
  const clientId =
    client?.id ||
    client?.ID ||
    slugFromName(client?.name || client?.Klient || "client");

  // зберігаємо/відновлюємо останній вибраний місяць для цього клієнта
  const lastMonthKey = `proto:lastMonth:${clientId}`;
  const [month, setMonth] = useState(() => {
    try {
      return localStorage.getItem(lastMonthKey) || ymOf(new Date());
    } catch {
      return ymOf(new Date());
    }
  });
  useEffect(() => {
    // якщо змінився клієнт — підвантажити його останній місяць
    try {
      const m = localStorage.getItem(lastMonthKey);
      if (m) setMonth(m);
      else setMonth(ymOf(new Date()));
    } catch {
      setMonth(ymOf(new Date()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  useEffect(() => {
    try {
      localStorage.setItem(lastMonthKey, month);
    } catch {}
  }, [lastMonthKey, month]);

  // протокол
  const [proto, setProto] = useState({
    id: clientId,
    month,
    entries: [],
    totals: { totalPackages: 0 },
  });

  // словник інструментів
  const [dict, setDict] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/services");
        const data = await r.json();
        if (Array.isArray(data)) setDict(data);
      } catch {}
    })();
  }, []);

  // завантаження протоколу
  const load = async () => {
    if (!clientId || !month) return;
    try {
      const r = await fetch(
        `/protocols/${encodeURIComponent(clientId)}/${month}`
      );
      const data = await r.json();
      setProto({
        id: data.id || clientId,
        month: data.month || month,
        entries: Array.isArray(data.entries) ? data.entries : [],
        totals: data.totals || { totalPackages: 0 },
      });
    } catch {
      setProto({
        id: clientId,
        month,
        entries: [],
        totals: { totalPackages: 0 },
      });
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, month]);

  /** ======= ФОРМА ДОДАВАННЯ ЗАПИСУ ======= */
  const emptyToolRow = { name: "", count: "" };
  const initialTools = Array.from({ length: 8 }, () => ({ ...emptyToolRow }));

  // зберігаємо як рядки (щоб не губити "порожнє" значення)
  const [entry, setEntry] = useState({
    date: todayISO(),
    tools: initialTools,
    packages: "",
    courierMode: "",
    shipping: false,
    comment: "",
  });

  // ------ Чернетка (LocalStorage) ------
  const draftKey = `protodraft:${clientId}:${month}`;
  const DRAFTS_POOL = "protodrafts:v1";

  const saveDraft = useCallback(() => {
    try {
      const payload = {
        date: entry.date,
        tools: entry.tools,
        packages: entry.packages,
        courierMode: entry.courierMode,
        shipping: entry.shipping,
        comment: entry.comment,
      };
      localStorage.setItem(draftKey, JSON.stringify(payload));
      const mapRaw = localStorage.getItem(DRAFTS_POOL);
      const map = mapRaw ? JSON.parse(mapRaw) : {};
      map[`${clientId}::${month}`] = payload;
      localStorage.setItem(DRAFTS_POOL, JSON.stringify(map));
    } catch {}
  }, [draftKey, entry, clientId, month]);

  // завантаження чернетки
  useEffect(() => {
    try {
      let draft = null;
      const raw = localStorage.getItem(draftKey);
      if (raw) draft = JSON.parse(raw);

      if (!draft) {
        const mapRaw = localStorage.getItem(DRAFTS_POOL);
        if (mapRaw) {
          const map = JSON.parse(mapRaw);
          draft = map?.[`${clientId}::${month}`] || null;
        }
      }

      if (draft) {
        setEntry({
          date: draft.date || todayISO(),
          tools:
            Array.isArray(draft.tools) && draft.tools.length
              ? draft.tools
              : initialTools,
          packages: draft.packages ?? "",
          courierMode: draft.courierMode || "",
          shipping: !!draft.shipping,
          comment: draft.comment || "",
        });
      } else {
        setEntry({
          date: todayISO(),
          tools: initialTools,
          packages: "",
          courierMode: "",
          shipping: false,
          comment: "",
        });
      }
    } catch {
      setEntry({
        date: todayISO(),
        tools: initialTools,
        packages: "",
        courierMode: "",
        shipping: false,
        comment: "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, month]);

  // автосейв на кожну зміну entry
  useEffect(() => {
    saveDraft();
  }, [saveDraft]);

  // автосейв при приховуванні вкладки/закритті
  useEffect(() => {
    const handler = () => saveDraft();
    document.addEventListener("visibilitychange", handler);
    window.addEventListener("beforeunload", handler);
    window.addEventListener("pagehide", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("pagehide", handler);
      handler();
    };
  }, [saveDraft]);

  const addToolRows = (rows = 2) =>
    setEntry((e) => ({
      ...e,
      tools: [
        ...e.tools,
        ...Array.from({ length: rows }, () => ({ ...emptyToolRow })),
      ],
    }));

  const updateTool = (idx, key, val) =>
    setEntry((e) => {
      const tools = [...e.tools];
      tools[idx] = { ...tools[idx], [key]: val };
      return { ...e, tools };
    });

  const removeTool = (idx) =>
    setEntry((e) => ({ ...e, tools: e.tools.filter((_, i) => i !== idx) }));

  const focusById = (id) => {
    const el = document.getElementById(id);
    if (el && typeof el.focus === "function") el.focus();
  };
  const onNameKeyDown = (idx, ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    focusById(`tool-qty-${idx}`);
  };
  const onQtyKeyDown = (idx, ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const indices = entry.tools.map((_, i) => i);
    const leftIdxs = indices.filter((i) => i % 2 === 0);
    const rightIdxs = indices.filter((i) => i % 2 === 1);
    const isLeft = idx % 2 === 0;
    if (isLeft) {
      const pos = leftIdxs.indexOf(idx);
      if (pos >= 0 && pos < leftIdxs.length - 1) {
        const nextIdx = leftIdxs[pos + 1];
        focusById(`tool-name-${nextIdx}`);
      } else if (rightIdxs.length > 0) {
        focusById(`tool-name-${rightIdxs[0]}`);
      }
    } else {
      const pos = rightIdxs.indexOf(idx);
      if (pos >= 0 && pos < rightIdxs.length - 1) {
        const nextIdx = rightIdxs[pos + 1];
        focusById(`tool-name-${nextIdx}`);
      }
    }
  };

  /* ===== Підписи для вибраних записів ===== */
  const [signModalOpen, setSignModalOpen] = useState(false);
  const transferClientRef = useRef(null);
  const transferStaffRef = useRef(null);
  const returnClientRef = useRef(null);
  const returnStaffRef = useRef(null);
  const [sigEmpty, setSigEmpty] = useState({
    transferClient: true,
    transferStaff: true,
    returnClient: true,
    returnStaff: true,
  });

  /* ===== Вибірка рядків таблиці ===== */
  const [selected, setSelected] = useState(() => new Set());
  const allChecked =
    proto.entries.length > 0 && selected.size === proto.entries.length;

  const [queueTypeForSelection, setQueueTypeForSelection] = useState(null); // 'courier' | 'point' | null
  const canSign = selected.size > 0 && !!queueTypeForSelection;

  // --- Відстеження, які саме записи були "додані до протоколу" (локально) ---
  const ADDED_KEY = `protocol:added:${clientId}:${month}`;
  const [addedHashes, setAddedHashes] = useState(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ADDED_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      setAddedHashes(new Set(Array.isArray(arr) ? arr : []));
    } catch {
      setAddedHashes(new Set());
    }
  }, [ADDED_KEY]);

  const persistAdded = (setObj) => {
    try {
      localStorage.setItem(ADDED_KEY, JSON.stringify(Array.from(setObj)));
    } catch {}
  };

  const signatureEntry = (row) => {
    const tools = (row?.tools || [])
      .map((t) => ({
        name: String(t?.name || "").trim(),
        count: Number(t?.count || 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.count - b.count);

    const sigObj = {
      date: row?.date || "",
      tools,
      packages: Number(row?.packages || 0),
      delivery: row?.delivery || null,
      shipping: !!row?.shipping,
      comment: row?.comment || "",
    };
    return JSON.stringify(sigObj);
  };

  const isRowAdded = (row) => addedHashes.has(signatureEntry(row));

  const toggleRow = (idx) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      setQueueTypeForSelection(null);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const n = allChecked
        ? new Set()
        : new Set(proto.entries.map((_, i) => i));
      setQueueTypeForSelection(null);
      return n;
    });

  const clearSelection = () => {
    setSelected(new Set());
    setQueueTypeForSelection(null);
  };

  const hasSelection = selected.size > 0;

  /* ===== Збірник payload для створення ===== */
  const buildCreatePayload = () => {
    const toolsPayload = entry.tools
      .filter((t) => String(t.name || "").trim())
      .map((t) => ({
        name: String(t.name || "").trim(),
        count:
          t.count === "" ? 0 : Number(String(t.count).replace(",", ".")) || 0,
      }));

    return {
      date: entry.date,
      tools: toolsPayload,
      packages: Number(String(entry.packages).replace(",", ".")) || 0,
      delivery: entry.shipping
        ? null
        : entry.courierMode === "x2"
        ? "odbior+dowoz"
        : entry.courierMode === "x1"
        ? "odbior"
        : null,
      shipping: !!entry.shipping,
      comment: entry.comment || "",
    };
  };

  const clearAfterSave = () => {
    const cleared = {
      date: todayISO(),
      tools: initialTools,
      packages: "",
      courierMode: "",
      shipping: false,
      comment: "",
    };
    setEntry(cleared);
    try {
      localStorage.removeItem(draftKey);
      const mapRaw = localStorage.getItem(DRAFTS_POOL);
      if (mapRaw) {
        const map = JSON.parse(mapRaw);
        delete map[`${clientId}::${month}`];
        localStorage.setItem(DRAFTS_POOL, JSON.stringify(map));
      }
    } catch {}
  };

  /* ====== Збереження нового запису (з валідацією) ====== */
  const saveEntry = async () => {
    if (!entry.date) return alert("Wpis: podaj datę.");

    const toolsValid = entry.tools.some(
      (t) =>
        String(t.name || "").trim() &&
        Number(String(t.count).replace(",", ".")) > 0
    );
    const packagesNum =
      entry.packages === ""
        ? NaN
        : Number(String(entry.packages).replace(",", "."));

    if (!(packagesNum >= 1)) {
      return alert("Wpis: liczba pakietów jest obowiązkowa (min. 1).");
    }
    if (!toolsValid) {
      return alert(
        "Wpis: dodaj co najmniej jedną pozycję narzędzi z ilością > 0."
      );
    }

    const payload = buildCreatePayload();

    try {
      const r = await fetch(
        `/protocols/${encodeURIComponent(clientId)}/${month}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.error || "Błąd zapisu wpisu.");
      }
      const data = await r.json();
      setProto({
        id: data?.protocol?.id || clientId,
        month: data?.protocol?.month || month,
        entries: data?.protocol?.entries || [],
        totals: data?.protocol?.totals || { totalPackages: 0 },
      });
      clearAfterSave();
      // (не активуємо тут "Dodaj do protokołu"; тепер воно залежить від чекбоксів/черги/подписів)
    } catch (e) {
      alert(e.message || "Nie udało się dodać wpisu.");
    }
  };

  /* ======= Toast ======= */
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const showToast = (msg) => {
    setToastMsg(msg);
    setToastVisible(true);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToastVisible(false), 3500);
  };

  /* ====== Дії для обраних рядків ====== */
  const addToQueue = async (type /* 'courier'|'point' */) => {
    if (!hasSelection) return;
    const other = type === "courier" ? "point" : "courier";
    setQueueTypeForSelection(type);

    try {
      await Promise.all(
        Array.from(selected).flatMap((idx) => [
          fetch(
            `/protocols/${encodeURIComponent(clientId)}/${month}/${idx}/queue`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type, pending: true }),
            }
          ),
          fetch(
            `/protocols/${encodeURIComponent(clientId)}/${month}/${idx}/queue`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: other, pending: false }),
            }
          ),
        ])
      );
      await load();
      showToast(
        type === "courier"
          ? "Zaznaczone wpisy oznaczono do podpisu — kurier."
          : "Zaznaczone wpisy oznaczono do podpisu — punkt."
      );
    } catch {
      setQueueTypeForSelection(null);
      alert("Nie udało się dodać do kolejki.");
    }
  };

  const signSelected = async () => {
    if (!canSign) return;
    const chosenQueue = queueTypeForSelection;

    const tClient =
      transferClientRef.current?.toDataURL && !sigEmpty.transferClient
        ? transferClientRef.current.toDataURL()
        : null;
    const tStaff =
      transferStaffRef.current?.toDataURL && !sigEmpty.transferStaff
        ? transferStaffRef.current.toDataURL()
        : null;
    const rClient =
      returnClientRef.current?.toDataURL && !sigEmpty.returnClient
        ? returnClientRef.current.toDataURL()
        : null;
    const rStaff =
      returnStaffRef.current?.toDataURL && !sigEmpty.returnStaff
        ? returnStaffRef.current.toDataURL()
        : null;

    if (!tClient && !tStaff && !rClient && !rStaff) {
      return alert("Brak podpisów do zapisania.");
    }

    try {
      for (const idx of Array.from(selected)) {
        if (tClient || tStaff) {
          await fetch(
            `/protocols/${encodeURIComponent(clientId)}/${month}/${idx}/sign`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                leg: "transfer",
                client: tClient || undefined,
                staff: tStaff || undefined,
              }),
            }
          );
        }
        if (rClient || rStaff) {
          await fetch(
            `/protocols/${encodeURIComponent(clientId)}/${month}/${idx}/sign`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                leg: "return",
                client: rClient || undefined,
                staff: rStaff || undefined,
              }),
            }
          );
        }
      }
      await load();
      setSignModalOpen(false);
      transferClientRef.current?.clear?.();
      transferStaffRef.current?.clear?.();
      returnClientRef.current?.clear?.();
      returnStaffRef.current?.clear?.();
      setSigEmpty({
        transferClient: true,
        transferStaff: true,
        returnClient: true,
        returnStaff: true,
      });

      showToast(
        chosenQueue === "courier"
          ? "Podpisy zapisane. Kolejka: kurier."
          : "Podpisy zapisane. Kolejka: punkt."
      );

      // ⚠️ НЕ чистимо вибір — щоб можна було одразу додати до протоколу.
      // clearSelection();
    } catch {
      alert("Nie udało się zapisać podpisów.");
    }
  };

  const deleteEntry = async (idx) => {
    if (!confirm("Usunąć wpis?")) return;
    const rowSig =
      proto.entries && proto.entries[idx]
        ? signatureEntry(proto.entries[idx])
        : null;

    try {
      const r = await fetch(
        `/protocols/${encodeURIComponent(clientId)}/${month}/${idx}`,
        { method: "DELETE" }
      );
      if (!r.ok) throw new Error("Błąd usuwania wpisu.");
      const data = await r.json();
      setProto({
        id: data?.protocol?.id || clientId,
        month: data?.protocol?.month || month,
        entries: data?.protocol?.entries || [],
        totals: data?.protocol?.totals || { totalPackages: 0 },
      });
      if (rowSig) {
        const s = new Set(addedHashes);
        s.delete(rowSig);
        setAddedHashes(s);
        persistAdded(s);
      }

      setSelected((s) => {
        const n = new Set(
          Array.from(s)
            .filter((i) => i !== idx)
            .map((i) => (i > idx ? i - 1 : i))
        );
        return n;
      });
    } catch (e) {
      alert(e.message || "Nie udało się usunąć wpisu.");
    }
  };

  // Підсумок пакунків
  const totalPackages =
    (proto?.totals && Number(proto.totals.totalPackages)) ||
    (Array.isArray(proto.entries)
      ? proto.entries.reduce((a, r) => a + (Number(r?.packages || 0) || 0), 0)
      : 0);

  /* ===== Upsert протоколу місяця у „Dokumenty → Protokoły” ===== */
  const upsertProtocolDoc = async ({ download = false } = {}) => {
    try {
      const r = await fetch(
        `/protocols/${encodeURIComponent(clientId)}/${month}`
      );
      const data = await r.json();
      const protocol = {
        id: data.id || clientId,
        month: data.month || month,
        entries: Array.isArray(data.entries) ? data.entries : [],
        totals: data.totals || { totalPackages: 0 },
      };

      if (!protocol.entries.length) {
        return alert("Brak wpisów w tym miesiącu.");
      }

      const { doc, fileName } = buildProtocolPdf({
        month: protocol.month,
        client,
        protocol,
      });

      const dataUrl = doc.output("datauristring");
      saveProtocolDocMeta({
        id: `${clientId}:${protocol.month}`,
        clientId,
        clientName: String(client?.name || client?.Klient || "—"),
        month: protocol.month,
        fileName,
        createdAt: new Date().toISOString(),
        dataUrl,
      });

      if (download) doc.save(fileName);

      showToast("Dodano do protokołu (lista dokumentów zaktualizowana).");
    } catch {
      alert("Nie udało się zaktualizować протокоłu.");
    }
  };

  // ====== Умова активності "Dodaj zaznaczone do protokołu"
  const selectedRows = Array.from(selected)
    .map((i) => proto.entries[i])
    .filter(Boolean);

  const allHaveStaffSig =
    selectedRows.length > 0 &&
    selectedRows.every(
      (r) =>
        (r?.signatures?.transfer?.staff ? true : false) ||
        (r?.signatures?.return?.staff ? true : false)
    );

  const allHaveChosenQueue =
    queueTypeForSelection === "courier"
      ? selectedRows.every((r) => r?.queue?.courierPending)
      : queueTypeForSelection === "point"
      ? selectedRows.every((r) => r?.queue?.pointPending)
      : false;

  const canAddSelectedToProtocol =
    selectedRows.length > 0 && allHaveStaffSig && allHaveChosenQueue;
  const addSelectedToProtocol = async () => {
    if (!canAddSelectedToProtocol) return;
    // позначаємо вибрані як "додані"
    const newSet = new Set(addedHashes);
    selectedRows.forEach((r) => newSet.add(signatureEntry(r)));
    setAddedHashes(newSet);
    persistAdded(newSet);

    await upsertProtocolDoc({ download: false });
    showToast("Dodano zaznaczone do protokołu.");
  };

  /** ======= РЕНДЕР ======= */
  return (
    <div className="space-y-4">
      {/* Toast */}
      {toastVisible && (
        <div className="fixed bottom-4 right-4 z-[99999]">
          <div className="rounded-lg shadow-xl bg-gray-900 text-white px-4 py-3 text-sm">
            {toastMsg}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="text-lg font-semibold">
          Protokół przekazania narzędzi
        </div>
        <div className="flex-1" />
        <MonthPicker value={month} onChange={setMonth} />
      </div>

      {/* Форма */}
      <div className="card">
        <div className="font-medium mb-2">Dodaj wpis</div>

        <div className="grid md:grid-cols-4 gap-3 items-start">
          <div>
            <label className="block text-sm mb-1">Data</label>
            <input
              type="date"
              className="input w-full"
              value={entry.date}
              onChange={(e) => setEntry({ ...entry, date: e.target.value })}
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-sm mb-1">Usługi dodatkowe</label>
            <div className="flex flex-wrap gap-4 items-center">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={entry.courierMode === "x1"}
                  disabled={entry.shipping}
                  onChange={() =>
                    setEntry((e) => ({
                      ...e,
                      courierMode: e.courierMode === "x1" ? "" : "x1",
                    }))
                  }
                />
                <span>Kurier (x1)</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={entry.courierMode === "x2"}
                  disabled={entry.shipping}
                  onChange={() =>
                    setEntry((e) => ({
                      ...e,
                      courierMode: e.courierMode === "x2" ? "" : "x2",
                    }))
                  }
                />
                <span>Kurier (x2)</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={entry.shipping}
                  onChange={() =>
                    setEntry((e) => ({
                      ...e,
                      shipping: !e.shipping,
                      courierMode: !e.shipping ? "" : e.courierMode,
                    }))
                  }
                  disabled={entry.courierMode !== ""}
                />
                <span>Wysyłka</span>
              </label>
            </div>
          </div>
        </div>

        {/* Дві колонки інструментів */}
        <div className="mt-3 grid md:grid-cols-2 gap-3">
          {[0, 1].map((col) => (
            <div key={col} className="overflow-visible">
              <table className="table w-full">
                <thead>
                  <tr className="text-xs font-normal">
                    <th className="text-left px-2">Nazwa</th>
                    <th className="text-right px-2" style={{ width: "12ch" }}>
                      Sztuki
                    </th>
                    <th className="text-center px-2" style={{ width: "7ch" }}>
                      —
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entry.tools
                    .map((t, idx) => ({ t, idx }))
                    .filter((_, i) => i % 2 === col)
                    .map(({ t, idx }) => (
                      <tr key={idx}>
                        <td className="px-2">
                          <input
                            id={`tool-name-${idx}`}
                            className="input w-full"
                            list="tools-list"
                            value={t.name}
                            onChange={(e) =>
                              updateTool(idx, "name", e.target.value)
                            }
                            onKeyDown={(e) => onNameKeyDown(idx, e)}
                            placeholder="np. Nożyczki"
                          />
                        </td>
                        <td className="text-right px-2">
                          <input
                            id={`tool-qty-${idx}`}
                            type="number"
                            min="0"
                            className="input w-full text-right"
                            style={{ minWidth: "12ch" }}
                            value={t.count}
                            onChange={(e) =>
                              updateTool(
                                idx,
                                "count",
                                e.target.value === "" ? "" : e.target.value
                              )
                            }
                            onKeyDown={(e) => onQtyKeyDown(idx, e)}
                          />
                        </td>
                        <td className="text-center px-2">
                          <IconButton
                            title="Usuń"
                            onClick={() => removeTool(idx)}
                            variant="danger"
                          >
                            <DeleteIcon className="w-4 h-4" />
                          </IconButton>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* автопідказки з бази */}
        <datalist id="tools-list">
          {dict.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => addToolRows(2)}
          >
            ➕ Dodaj 2 wiersze
          </button>
        </div>

        {/* Коментар */}
        <div className="mt-4">
          <label className="block text-sm mb-1">Komentarz / uwagi</label>
          <textarea
            className="input w-full min-h-[90px]"
            value={entry.comment}
            onChange={(e) => setEntry({ ...entry, comment: e.target.value })}
            placeholder="Opcjonalnie: dodatkowe informacje do wpisu…"
          />
        </div>

        {/* Пакети + КНОПКИ */}
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="mr-4">
            <label className="block text-sm mb-1">Pakiety (suma)</label>
            <input
              type="number"
              min="0"
              className="input w-40 text-right"
              value={entry.packages}
              onChange={(e) => setEntry({ ...entry, packages: e.target.value })}
            />
          </div>
          <div className="flex-1" />
          <button
            type="button"
            className="btn-primary"
            onClick={saveEntry}
            title="Zapisz wpis"
          >
            Zapisz wpis
          </button>

          {/* ➕ ДОДАТИ ДО ПРОТОКОЛУ — за умовами (чекбокси + kolejka + podpis pracownika) */}
          <button
            type="button"
            className={`btn-secondary ${
              !canAddSelectedToProtocol ? "opacity-50 cursor-not-allowed" : ""
            }`}
            onClick={() => canAddSelectedToProtocol && addSelectedToProtocol()}
            disabled={!canAddSelectedToProtocol}
            title={
              canAddSelectedToProtocol
                ? "Dodaj zaznaczone do protokołu"
                : "Zaznacz wpis(y), ustaw kolejkę (kurier/punkt) i dodaj podpis pracownika"
            }
          >
            ➕ Dodaj zaznaczone do protokołu
          </button>
        </div>
      </div>

      {/* Список записів */}
      <div className="card">
        <div className="flex items-center gap-2">
          <div className="font-medium">Wpisy za {month}</div>
          <div className="ml-auto text-sm text-gray-700">
            Razem pakietów:{" "}
            <span className="font-semibold">{totalPackages}</span>
          </div>
        </div>

        {/* Панель дій для ВИБРАНИХ записів */}
        <div className="mt-2 flex flex-wrap gap-2 items-center">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => addToQueue("courier")}
            title="Wyślij zaznaczone do kolejki kuriera"
            disabled={selected.size === 0}
          >
            📦 Do podpisu — przez kuriera
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => addToQueue("point")}
            title="Wyślij zaznaczone do kolejki punktu"
            disabled={selected.size === 0}
          >
            🏷️ Do podpisu — w punkcie
          </button>
          <div className="flex-1" />
          <button
            type="button"
            className={`btn-primary ${
              !canSign ? "opacity-50 cursor-not-allowed" : ""
            }`}
            onClick={() => canSign && setSignModalOpen(true)}
            disabled={!canSign}
            title={
              selected.size
                ? queueTypeForSelection
                  ? "Dodaj podpisy do zaznaczonych"
                  : "Najpierw wybierz: kurier lub punkt"
                : "Najpierw zaznacz wiersze"
            }
          >
            ✍️ Dodaj podpis
          </button>
        </div>

        {/* Таблиця */}
        <div className="mt-2">
          <table className="table w-full">
            <thead>
              <tr className="text-xs font-normal">
                <th className="text-center w-[3.5rem] px-2">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Zaznacz wszystkie"
                  />
                </th>
                <th className="text-center w-[9ch] px-2">Data</th>
                <th className="px-2" style={{ width: "38%" }}>
                  Narzędzia (szt.)
                </th>
                <th className="text-center w-[16ch] px-2">Usługi</th>
                <th className="text-center w-[18ch] px-2">
                  Podpisy (przekazanie)
                </th>
                <th className="text-center w-[18ch] px-2">Podpisy (zwrot)</th>
                <th className="text-center w-[10ch] px-2">Pakiety</th>
                {/* ⛔️ Колонку з кнопками (Dodaj do protokołu) прибрано */}
              </tr>
            </thead>
            <tbody>
              {(proto.entries || []).map((row, idx) => (
                <tr key={`${row.date}-${idx}`}>
                  <td className="text-center align-top py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(idx)}
                      onChange={() => toggleRow(idx)}
                      aria-label={`Zaznacz wiersz ${idx + 1}`}
                    />
                  </td>
                  <td className="text-center whitespace-nowrap align-top py-2 px-2">
                    <div>{row.date}</div>
                    {isRowAdded(row) && (
                      <div className="mt-1 text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 inline-block">
                        Dodano do protokołu
                      </div>
                    )}
                  </td>
                  <td className="align-top py-2 px-2">
                    <div className="space-y-0.5 break-words">
                      {(row.tools || [])
                        .filter((t) => t?.name)
                        .map((t, i) => (
                          <div key={i} className="text-sm leading-snug">
                            {t.name}: <b>{t.count}</b> szt.
                          </div>
                        ))}
                      {!row.tools?.length && (
                        <span className="text-gray-500 text-sm">—</span>
                      )}
                      {row.comment ? (
                        <div className="text-xs text-gray-600 mt-1">
                          {row.comment}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="text-center align-top py-2 px-2">
                    <div className="flex flex-wrap gap-1 justify-center">
                      {row.shipping ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">
                          Wysyłka
                        </span>
                      ) : row.delivery === "odbior" ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                          Kurier x1
                        </span>
                      ) : row.delivery === "odbior+dowoz" ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                          Kurier x2
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </div>
                  </td>

                  {/* ПІДПИСИ — przekazanie */}
                  <td className="text-center align-top py-2 px-2">
                    {row.signatures?.transfer?.client ||
                    row.signatures?.transfer?.staff ? (
                      <div className="flex flex-col items-center justify-start gap-1 max-h-24 overflow-auto">
                        {row.signatures?.transfer?.client && (
                          <img
                            src={row.signatures.transfer.client}
                            alt="podpis klienta (przekazanie)"
                            className="h-7 w-auto max-w-[90%] object-contain border rounded bg-white p-0.5"
                          />
                        )}
                        {row.signatures?.transfer?.staff && (
                          <img
                            src={row.signatures.transfer.staff}
                            alt="podpis serwisu (przekazanie)"
                            className="h-7 w-auto max-w-[90%] object-contain border rounded bg-white p-0.5"
                          />
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>

                  {/* ПІДПИСИ — zwrot */}
                  <td className="text-center align-top py-2 px-2">
                    {row.signatures?.return?.client ||
                    row.signatures?.return?.staff ? (
                      <div className="flex flex-col items-center justify-start gap-1 max-h-24 overflow-auto">
                        {row.signatures?.return?.client && (
                          <img
                            src={row.signatures.return.client}
                            alt="podpis klienta (zwrot)"
                            className="h-7 w-auto max-w-[90%] object-contain border rounded bg-white p-0.5"
                          />
                        )}
                        {row.signatures?.return?.staff && (
                          <img
                            src={row.signatures.return.staff}
                            alt="podpis serwisu (zwrot)"
                            className="h-7 w-auto max-w-[90%] object-contain border rounded bg-white p-0.5"
                          />
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>

                  <td className="text-center align-top py-2 px-2">
                    <span className="text-base font-bold leading-none">
                      {row.packages}
                    </span>
                  </td>
                </tr>
              ))}
              {(!proto.entries || proto.entries.length === 0) && (
                <tr>
                  <td colSpan={7} className="text-center py-6 text-gray-500">
                    Brak wpisów w tym miesiącu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selected.size > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-sm text-gray-700">
              Zaznaczone: {selected.size}
            </span>
            <button
              type="button"
              className="btn-danger px-3 py-1 text-white"
              onClick={async () => {
                if (!confirm("Usunąć zaznaczone wpisy?")) return;
                // видалити по одному, від найбільших індексів
                const toDelete = Array.from(selected).sort((a, b) => b - a);
                for (const idx of toDelete) {
                  await deleteEntry(idx);
                }
                clearSelection();
              }}
            >
              Usuń zaznaczone
            </button>
          </div>
        )}
      </div>

      {/* MODAL: Podpisy (dla wybranych) */}
      {signModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-lg w-full max-w-5xl max-h-[90vh] overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-semibold">
                Podpisy — zaznaczone wpisy
              </div>
              <button
                className="btn-secondary"
                onClick={() => setSignModalOpen(false)}
              >
                Zamknij
              </button>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <div>
                <div className="font-semibold mb-2">Przekazanie</div>
                <div className="mb-4">
                  <div className="text-sm mb-1">Klient</div>
                  <SignaturePad
                    ref={transferClientRef}
                    onChange={(empty) =>
                      setSigEmpty((s) => ({ ...s, transferClient: empty }))
                    }
                  />
                </div>
                <div>
                  <div className="text-sm mb-1">Pracownik serwisu</div>
                  <SignaturePad
                    ref={transferStaffRef}
                    onChange={(empty) =>
                      setSigEmpty((s) => ({ ...s, transferStaff: empty }))
                    }
                  />
                </div>
              </div>

              <div>
                <div className="font-semibold mb-2">
                  Zwrot (opcjonalnie teraz)
                </div>
                <div className="mb-4">
                  <div className="text-sm mb-1">Klient</div>
                  <SignaturePad
                    ref={returnClientRef}
                    onChange={(empty) =>
                      setSigEmpty((s) => ({ ...s, returnClient: empty }))
                    }
                  />
                </div>
                <div>
                  <div className="text-sm mb-1">Pracownik serwisu</div>
                  <SignaturePad
                    ref={returnStaffRef}
                    onChange={(empty) =>
                      setSigEmpty((s) => ({ ...s, returnStaff: empty }))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                className={`btn-primary ${
                  !canSign ? "opacity-50 cursor-not-allowed" : ""
                }`}
                onClick={signSelected}
                disabled={!canSign}
                title={
                  canSign
                    ? "Zapisz podpisy do zaznaczonych"
                    : "Najpierw wybierz: курier або пункт"
                }
              >
                Zapisz podpisy do zaznaczonych
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSignModalOpen(false)}
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
