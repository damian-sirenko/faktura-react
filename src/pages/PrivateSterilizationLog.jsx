// src/pages/PrivateSterilizationLog.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, apiFetch } from "../utils/api";

/* ========= Helpers ========= */
const ymOf = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const nextYm = (ym) => {
  const [y, m] = String(ym || "")
    .split("-")
    .map(Number);
  if (!y || !m) return ymOf();
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return ymOf(d);
};
const prevYm = (ym) => {
  const [y, m] = String(ym || "")
    .split("-")
    .map(Number);
  if (!y || !m) return ymOf();
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return ymOf(d);
};
const fmtPLYM = (ym) => {
  const months = [
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
  const [y, m] = String(ym || "").split("-");
  const mi = Math.max(1, Math.min(12, Number(m || 0))) - 1;
  return `${months[mi] || m} ${y}`;
};
const to2 = (x) => Number(x || 0).toFixed(2);
const uid = () => Math.random().toString(36).slice(2, 10);

const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const fmtPLDate = (iso) => {
  const s = String(iso || "");
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]}.${m[2]}.${m[1]}`;
};

const normalizeISODate = (v) => {
  if (!v) return "";
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (isNaN(d)) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
};

const isYm = (s) => typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
const clampYm = (s) => {
  if (isYm(s)) return s;
  try {
    const d = new Date(s);
    if (!isNaN(d)) return ymOf(d);
  } catch {}
  return ymOf();
};
const isPastYm = (ym) => {
  if (!isYm(ym)) return false;
  return ym < ymOf();
};

// порядок навігації Enter
const COL_ORDER = ["date", "client", "qty", "ship"];

/* ========= LocalStorage keys ========= */
const LS_IDX = "PSL_SAVED_INDEX";
const LS_DRAFT_KEY = (ym) => `PSL_DRAFT_${ym}`;
const LS_ACTIVE_YM = "PSL_ACTIVE_YM";
const LS_WORKSPACE_YM = "PSL_WORKSPACE_YM";

const DEFAULT_COL_PCTS = [5, 18, 30, 10, 15, 10, 12];

const PSL_COL_PCTS = DEFAULT_COL_PCTS;

const normalizeApiFetchPath = (u) => {
  const s = String(u || "");
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;

  let p = s;

  p = p.replace(/^\/api\/api(\/|$)/, "/");

  p = p.replace(/^\/api(\/|$)/, "/");

  p = p.replace(/^api(\/|$)/, "/");

  if (!p.startsWith("/")) p = `/${p}`;
  return p;
};

const getJSON = async (u) => {
  const r = await apiFetch(normalizeApiFetchPath(u), { method: "GET" });
  return typeof r?.json === "function" ? await r.json() : r;
};

const sendJSON = async (u, method, body) => {
  const r = await apiFetch(normalizeApiFetchPath(u), { method, json: body });
  return typeof r?.json === "function" ? await r.json() : r;
};

const checkServer = async () => {
  try {
    await getJSON(api(`/psl/workspace`));
    return true;
  } catch {
    return false;
  }
};

/* ========= Mini Confirm Dialog ========= */
function ConfirmDialog({ open, title, message, onCancel, onConfirm }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white border p-4 shadow">
        <div className="text-lg font-semibold mb-2">{title}</div>
        <div className="text-sm text-gray-700 mb-4">{message}</div>
        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onCancel}>
            Anuluj
          </button>
          <button className="btn-danger" onClick={onConfirm}>
            Usuń
          </button>
        </div>
      </div>
    </div>
  );
}

const emptyRow = () => ({
  id: uid(),
  date: "",
  clientId: "",
  clientName: "",
  qty: "",
  sterilCost: 0,
  shipOrCourier: "",
  total: 0,
  isNew: false,
});

const normalizeRow = (r) => {
  const qty = r?.qty ?? r?.packages ?? r?.packs ?? r?.count ?? r?.ilosc ?? "";
  const ship =
    r?.shipOrCourier ??
    r?.ship ??
    r?.courier ??
    r?.shippingCost ??
    r?.deliveryCost ??
    r?.wysylka ??
    "";

  const hasAnyData =
    String(r?.clientName || r?.client || r?.name || "").trim() !== "" ||
    qty !== "" ||
    ship !== "";

  return {
    id: String(r?.id || r?._id || "").trim() ? String(r.id || r._id) : uid(),

    date: normalizeISODate(r?.date ?? r?.rowDate ?? r?.day ?? r?.createdDate),
    clientId: String(r?.clientId || r?.client_id || "").trim(),
    clientName: String(
      r?.clientName || r?.client || r?.name || r?.Klient || ""
    ).trim(),
    qty: qty === "" ? "" : Number(qty) || 0,
    shipOrCourier: ship === "" ? "" : Number(ship) || 0,
    sterilCost: Number(r?.sterilCost || 0) || 0,
    total: Number(r?.total || 0) || 0,
    isNew: false,
  };
};

export default function PrivateSterilizationLog() {
  const [viewMode, setViewMode] = useState("workspace");
  const [serverOnline, setServerOnline] = useState(true);

  // refs для фокусу і навігації
  const inputRefs = useRef(new Map());
  const addBtnRef = useRef(null);
  const workspaceSnapshotRef = useRef(null);

  const registerInputRef = (rowId, col) => (el) => {
    const key = `${rowId}:${col}`;
    if (el) inputRefs.current.set(key, el);
    else inputRefs.current.delete(key);
  };

  const focusCell = (rowId, col) => {
    const el = inputRefs.current.get(`${rowId}:${col}`);
    if (!el || typeof el.focus !== "function") return;
    el.focus();
    try {
      const isNumber =
        el.tagName === "INPUT" && String(el.type).toLowerCase() === "number";
      if (!isNumber && typeof el.value === "string" && el.setSelectionRange) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    } catch {}
  };

  const handleEnter = (rowId, col) => (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();

    // підтвердження підказки по клієнту
    if (col === "client") {
      const el = inputRefs.current.get(`${rowId}:client`);
      const typed = (el?.value || "").trim().toLowerCase();
      const matches = clients.filter((c) =>
        c.name.toLowerCase().includes(typed)
      );

      if (matches.length) {
        const picked = matches[activeSuggestIndex] || matches[0];
        updateRow(rowId, { clientName: picked.name, clientId: picked.id });
        setActiveSuggestRow(null);
        setActiveSuggestIndex(0);
      }
    }

    const idx = COL_ORDER.indexOf(col);
    const nextCol = COL_ORDER[idx + 1];
    if (nextCol) return focusCell(rowId, nextCol);
    if (addBtnRef.current) addBtnRef.current.focus();
  };
  /* Settings price (fallback 6) */
  const [pricePerPack, setPricePerPack] = useState(6);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const pick = (s) => {
        if (cancel) return;
        const v = Number(s?.perPiecePriceGross ?? s?.price_per_pack ?? 6);
        setPricePerPack(Number.isFinite(v) && v > 0 ? v : 6);
      };
      try {
        const s1 = await getJSON(api(`/settings`));
        if (s1) return pick(s1);
      } catch {}
      try {
        const s2 = await getJSON(api(`/settings.json`));
        if (s2) return pick(s2);
      } catch {}
      pick({ perPiecePriceGross: 6 });
    })();
    return () => (cancel = true);
  }, []);

  /* Clients (for autocomplete) */
  const [clients, setClients] = useState([]);
  const [activeSuggestRow, setActiveSuggestRow] = useState(null);
  const [activeSuggestIndex, setActiveSuggestIndex] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const list = await getJSON(api(`/clients`));
        const norm = (c) => ({
          id: String(c.id || c.ID || "").trim(),
          name: c.name || c.Klient || "",
        });
        setClients((Array.isArray(list) ? list : []).map(norm));
      } catch {
        setClients([]);
      }
    })();
  }, []);

  // активний місяць
  const [activeYm, setActiveYm] = useState("");
  useEffect(() => {
    if (!activeYm) return;
    localStorage.setItem(LS_ACTIVE_YM, activeYm);
    if (viewMode === "workspace") {
      localStorage.setItem(LS_WORKSPACE_YM, activeYm);
    }
  }, [activeYm, viewMode]);

  /* Rows in workspace */
  const [rows, setRows] = useState([]);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);

  useEffect(() => {
    if (viewMode !== "workspace") return;
    if (!activeYm) return;
    workspaceSnapshotRef.current = { ym: activeYm, rows };
  }, [viewMode, activeYm, rows]);

  const hasData = (r) => {
    const name = String(r?.clientName || "").trim();
    const qtyRaw = r?.qty;
    const shipRaw = r?.shipOrCourier;

    const qty = qtyRaw === "" || qtyRaw == null ? 0 : Number(qtyRaw) || 0;
    const ship = shipRaw === "" || shipRaw == null ? 0 : Number(shipRaw) || 0;

    return name !== "" || qty > 0 || ship > 0;
  };

  const sanitizeWorkspaceRows = (arr) => {
    return (Array.isArray(arr) ? arr : [])
      .map(normalizeRow)
      .map(recalc)
      .filter((r) => hasData(r));
  };

  // фільтр
  const [nameFilter, setNameFilter] = useState("");

  const visibleRows = useMemo(() => {
    const nf = nameFilter.trim().toLowerCase();

    if (viewMode === "saved") {
      if (!nf) return rows;
      return rows.filter((r) =>
        String(r.clientName || "")
          .toLowerCase()
          .includes(nf)
      );
    }

    const base = rows.filter((r) => hasData(r) || r.isNew);

    if (!nf) return base;

    return base.filter((r) =>
      String(r.clientName || "")
        .toLowerCase()
        .includes(nf)
    );
  }, [rows, nameFilter, viewMode]);

  const rowsToRender = useMemo(() => {
    return visibleRows;
  }, [visibleRows]);

  /* Saved index (sidebar) */
  const [savedIndex, setSavedIndex] = useState([]);
  const [currentSavedId, setCurrentSavedId] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  // коалесінг автозбереження
  const lastPayloadRef = useRef(null);
  const draftLoadedRef = useRef(false);
  const suspendAutosaveRef = useRef(false);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);

  async function saveWorkspaceNow(payload) {
    try {
      if (viewMode !== "workspace") return;
      savingRef.current = true;
      const rowsClean = (payload.rows || []).map(({ isNew, ...rest }) => rest);
      await sendJSON(api(`/psl/workspace`), "PUT", { rows: rowsClean });
    } catch {
      // тихо
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        const latest = lastPayloadRef.current;
        if (latest) saveWorkspaceNow(latest);
      }
    }
  }

  // завантажити saved-index
  useEffect(() => {
    (async () => {
      try {
        const idx = await getJSON(api(`/psl/saved-index`));
        setSavedIndex(Array.isArray(idx) ? idx : []);
        localStorage.setItem(LS_IDX, JSON.stringify(idx || []));
      } catch {
        try {
          const idx = JSON.parse(localStorage.getItem(LS_IDX) || "[]");
          setSavedIndex(Array.isArray(idx) ? idx : []);
        } catch {
          setSavedIndex([]);
        }
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingWorkspace(true);
      suspendAutosaveRef.current = true;
      draftLoadedRef.current = false;

      const online = await checkServer();
      if (!online) {
        setServerOnline(false);
        setActiveYm(ymOf());
        setRows([{ ...emptyRow(), isNew: true }]);
        setLoadingWorkspace(false);
        setViewMode("workspace");
        draftLoadedRef.current = true;
        suspendAutosaveRef.current = false;
        return;
      }

      setServerOnline(true);

      try {
        const ws = await getJSON(api(`/psl/workspace`));
        if (cancelled) return;
        const currentYm = ymOf();

        let ym = clampYm(ws?.ym || currentYm);

        // якщо з localStorage прийшов старий місяць — ігноруємо
        if (ym < currentYm) {
          ym = currentYm;
        }

        if (isPastYm(ym)) {
          ym = ymOf();
        }

        const arr = Array.isArray(ws?.rows) ? ws.rows : [];
        setActiveYm(ym);
        const clean = sanitizeWorkspaceRows(arr);

        setRows(clean);

        setViewMode("workspace");

        if (arr.length) {
          localStorage.setItem(
            LS_DRAFT_KEY(ym),
            JSON.stringify({ ym, rows: arr })
          );
        }
        localStorage.setItem(LS_ACTIVE_YM, ym);

        draftLoadedRef.current = true;
      } catch {
        if (!cancelled) {
          const ym = ymOf();
          setActiveYm(ym);
          setRows([{ ...emptyRow(), isNew: true }]);
          setViewMode("workspace");
          draftLoadedRef.current = true;
        }
      } finally {
        setLoadingWorkspace(false);
        suspendAutosaveRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // автозбереження
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    if (suspendAutosaveRef.current) return;
    if (viewMode !== "workspace") return;
    if (!serverOnline) return;

    const payload = { ym: activeYm, rows };
    lastPayloadRef.current = payload;

    if (savingRef.current) {
      pendingRef.current = true;
    } else {
      saveWorkspaceNow(payload);
    }
  }, [activeYm, rows, viewMode, serverOnline]);

  // аварійне збереження
  useEffect(() => {
    const handler = () => {
      try {
        if (viewMode !== "workspace") return;
        const payload = lastPayloadRef.current || { rows };
        const rowsClean = (payload.rows || []).map(
          ({ isNew, ...rest }) => rest
        );
        const blob = new Blob([JSON.stringify({ rows: rowsClean })], {
          type: "application/json",
        });
        const url = api(`/psl/workspace`);
        navigator.sendBeacon && navigator.sendBeacon(url, blob);
      } catch {}
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [rows, viewMode]);

  /* Похідні підсумки */
  const totals = useMemo(() => {
    const qty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const steril = rows.reduce((s, r) => s + (Number(r.sterilCost) || 0), 0);
    const ship = rows.reduce((s, r) => s + (Number(r.shipOrCourier) || 0), 0);
    const total = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
    return { qty, steril, ship, total };
  }, [rows]);

  /* Row handlers */
  const recalc = (r) => {
    const qty = Number(r.qty) || 0;
    const sterilCost = qty * pricePerPack;
    const ship = Number(r.shipOrCourier) || 0;
    return {
      ...r,
      sterilCost,
      total: sterilCost + ship,
    };
  };
  useEffect(() => {
    setRows((prev) => prev.map((r) => (hasData(r) ? recalc(r) : r)));
  }, [pricePerPack]);

  const updateRow = (id, patch) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;

        const next = { ...r, ...patch };
        const nextWithDate = next;

        const nextHasData = hasData(nextWithDate);

        return recalc({
          ...nextWithDate,
          isNew: nextHasData ? false : nextWithDate.isNew,
        });
      })
    );
  };

  const addRow = () => {
    const newRow = {
      ...emptyRow(),
      date: todayISO(),
      isNew: true,
    };

    setRows((prev) => [...prev, newRow]);

    setTimeout(() => {
      focusCell(newRow.id, "date");
    }, 0);
  };

  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  // зміна робочого місяця
  const readDraftRows = (ym) => {
    try {
      const raw = localStorage.getItem(LS_DRAFT_KEY(ym));
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed?.rows) ? parsed.rows : [];
    } catch {
      return [];
    }
  };

  const setWorkspaceMonth = async (ym) => {
    const next = clampYm(ym);

    try {
      await sendJSON(api(`/settings`), "POST", { currentIssueMonth: next });
    } catch {}

    try {
      const ws = await getJSON(api(`/psl/workspace`));
      const newYm = String(ws?.ym || next);
      const arrServer = Array.isArray(ws?.rows) ? ws.rows : [];

      setActiveYm(newYm);
      setRows(sanitizeWorkspaceRows(arrServer));
      setViewMode("workspace");
    } catch {
      setActiveYm(next);
      setRows([{ ...emptyRow(), isNew: true }]);
      setViewMode("workspace");
    }
  };

  // фіналізація місяця
  const finalizeMonth = async () => {
    suspendAutosaveRef.current = true;
    const title = fmtPLYM(activeYm);
    const snapshot = {
      ym: activeYm,
      title,
      createdAt: new Date().toISOString(),
      rows,
      totals,
      pricePerPack,
    };

    try {
      const saved = await sendJSON(api(`/psl/finalize`), "POST", snapshot);
      const id = saved?.id || `${activeYm}-${Date.now()}`;

      try {
        const idx = await getJSON(api(`/psl/saved-index`));
        setSavedIndex(Array.isArray(idx) ? idx : []);
        localStorage.setItem(LS_IDX, JSON.stringify(idx || []));
      } catch {
        const newIdx = [
          ...savedIndex.filter((x) => x.id !== id),
          { id, ym: activeYm, title, totals, createdAt: snapshot.createdAt },
        ].sort((a, b) =>
          a.ym < b.ym ? 1 : a.createdAt < b.createdAt ? 1 : -1
        );
        setSavedIndex(newIdx);
        localStorage.setItem(LS_IDX, JSON.stringify(newIdx));
      }

      await sendJSON(api(`/psl/workspace`), "PUT", {
        ym: nextYm(activeYm),
        rows: [],
      });

      lastPayloadRef.current = { ym: activeYm, rows: [] };

      setRows([{ ...emptyRow(), isNew: true }]);

      suspendAutosaveRef.current = false;
    } catch {
      alert(
        "⚠️ Serwer niedostępny — zapisano tylko lokalną kopię. Spróbuj później."
      );
    }
  };

  const openSaved = async (id) => {
    try {
      if (viewMode === "workspace") {
        workspaceSnapshotRef.current = { ym: activeYm, rows };
        if (activeYm) localStorage.setItem(LS_WORKSPACE_YM, activeYm);
      }

      const snap = await getJSON(api(`/psl/saved/${encodeURIComponent(id)}`));
      if (!snap) throw new Error("Brak danych");

      setCurrentSavedId(id);

      suspendAutosaveRef.current = true;
      draftLoadedRef.current = false;

      setActiveYm(snap.ym);
      setRows(
        Array.isArray(snap.rows) ? snap.rows.map(normalizeRow).map(recalc) : []
      );

      setViewMode("saved");

      draftLoadedRef.current = true;
      suspendAutosaveRef.current = false;
    } catch (e) {
      alert("Nie udało się otworzyć zapisanego miesiąca.");
    }
  };

  const restoreFromSaved = async () => {
    if (!currentSavedId) return;
    try {
      const snap = await getJSON(
        api(`/psl/saved/${encodeURIComponent(currentSavedId)}`)
      );
      if (!snap) return;

      const rowsClean = (Array.isArray(snap.rows) ? snap.rows : []).map(
        ({ isNew, ...rest }) => rest
      );
      await sendJSON(api(`/psl/workspace`), "PUT", { rows: rowsClean });

      suspendAutosaveRef.current = true;
      draftLoadedRef.current = false;

      setActiveYm(snap.ym);
      setRows(rowsClean.map(normalizeRow).map(recalc));
      setViewMode("workspace");

      localStorage.setItem(
        LS_DRAFT_KEY(snap.ym),
        JSON.stringify({ ym: snap.ym, rows: rowsClean })
      );
      localStorage.setItem(LS_ACTIVE_YM, snap.ym || "");

      draftLoadedRef.current = true;
      suspendAutosaveRef.current = false;
    } catch (e) {
      alert("Не вдалося відновити збережений місяць у робоче полотно.");
    }
  };

  // повернутися до робочого полотна
  const openWorkspace = async () => {
    suspendAutosaveRef.current = true;
    draftLoadedRef.current = false;

    try {
      const ws = await getJSON(api(`/psl/workspace`));
      const ym = clampYm(ws?.ym || ymOf());

      const arrServer = Array.isArray(ws?.rows) ? ws.rows : [];
      const arr = arrServer;

      setActiveYm(ym);
      setRows(sanitizeWorkspaceRows(arr));

      setViewMode("workspace");
      setCurrentSavedId(null);
    } catch {
      const ym = ymOf();
      setActiveYm(ym);
      setRows([{ ...emptyRow(), isNew: true }]);
      setViewMode("workspace");
      setCurrentSavedId(null);
    } finally {
      draftLoadedRef.current = true;
      suspendAutosaveRef.current = false;
    }
  };

  /* мапа ім'я → id */
  const clientIdByName = (name) =>
    clients.find((c) => c.name === name)?.id || "";

  const inputsDisabled = (row) => viewMode === "saved" || !serverOnline;

  return (
    <div className="container-app w-full max-w-full min-w-0 overflow-x-hidden space-y-4">
      {/* HEADER — ЗАВЖДИ ЗВЕРХУ */}
      <div className="card-lg border-2 border-blue-200 bg-blue-50/60">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">
            Ewidencja sterylizacji prywatnej
          </h1>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <input
            type="search"
            placeholder="Szukaj klienta…"
            className="input w-full sm:w-60"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
        </div>
      </div>

      {!serverOnline && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          ⚠️ Brak połączenia z serwerem. Edycja danych jest tymczasowo
          zablokowana.
        </div>
      )}

      {/* GRID: SIDEBAR + TABLE */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-6">
        <aside className="space-y-3 min-w-0">
          <div className="card">
            <div className="font-semibold mb-2">Bieżący miesiąc</div>
            <div className="text-sm text-gray-700">
              <div className="mb-1">
                <span className="text-gray-500">Miesiąc: </span>
                <span className="font-medium">{fmtPLYM(activeYm)}</span>
              </div>
              <div className="text-xs text-gray-500">
                Cena za pakiet: {to2(pricePerPack)} zł
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2">
              <label className="text-sm text-gray-600">
                Wybierz miesiąc roboczy
              </label>
              <input
                type="month"
                className="input"
                value={isYm(activeYm) ? activeYm : ""}
                onChange={(e) => setWorkspaceMonth(e.target.value)}
                disabled={viewMode === "saved"}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setWorkspaceMonth(ymOf())}
                disabled={viewMode !== "saved"}
                title={
                  viewMode === "saved"
                    ? "Wróć do roboczego"
                    : "Dostępne tylko w podglądzie zapisanych"
                }
              >
                Obecny miesiąc
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={finalizeMonth}
                title="Zapisz jako zakończony miesiąc i dodaj do listy"
                disabled={viewMode !== "workspace"}
              >
                Podsumuj i zapisz miesiąc
              </button>
            </div>
          </div>

          <div className="card">
            <div className="font-semibold mb-2">Zapisane miesiące</div>
            <div className="space-y-2">
              {savedIndex.length === 0 && (
                <div className="text-sm text-gray-500">
                  Brak zapisanych tabel.
                </div>
              )}
              {savedIndex.map((it) => (
                <div
                  key={it.id}
                  className="rounded border p-2 flex items-center justify-between min-w-0"
                >
                  <button
                    type="button"
                    className="text-left btn-link flex-1 min-w-0"
                    title="Otwórz zapisany miesiąc"
                    onClick={() => openSaved(it.id)}
                  >
                    <div className="font-medium">{it.title}</div>
                    <div className="text-xs text-gray-500">
                      Razem: {to2(it.totals?.total)} zł • Pakiety:{" "}
                      {it.totals?.qty ?? 0}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-lg p-2 border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                    title="Usuń tabelę"
                    onClick={() => setToDelete(it)}
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          </div>

          {viewMode === "saved" && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 space-y-2">
              <div>
                Przeglądasz zapisany miesiąc. Edycja i autozapis wyłączone.
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary whitespace-normal max-w-full"
                  onClick={restoreFromSaved}
                  disabled={!currentSavedId}
                  title="Przywróć zawartość tego zapisu do roboczego pola i włącz edycję"
                >
                  Przywróć do roboczego
                </button>
              </div>
            </div>
          )}
        </aside>

        <main className="space-y-3 min-w-0">
          <div className="card-lg">
            <div className="w-full min-w-0 max-[999px]:overflow-x-auto min-[1000px]:overflow-x-hidden">
              <table className="table table-fixed w-full min-w-0 max-[999px]:min-w-[760px]">
                <colgroup>
                  <col style={{ width: `${PSL_COL_PCTS[0]}%` }} />
                  <col style={{ width: `${PSL_COL_PCTS[1]}%` }} />
                  <col style={{ width: `${PSL_COL_PCTS[2]}%` }} />
                  <col style={{ width: `${PSL_COL_PCTS[3]}%` }} />
                  <col style={{ width: `${PSL_COL_PCTS[4]}%` }} />
                  <col style={{ width: `${PSL_COL_PCTS[5]}%` }} />
                  <col style={{ width: `${PSL_COL_PCTS[6]}%` }} />
                </colgroup>

                <thead>
                  <tr>
                    <th className="text-center">#</th>
                    <th className="text-center">Data</th>
                    <th>Klient</th>
                    <th className="text-center">Pakiety</th>
                    <th className="text-center">Koszt sterylizacji</th>
                    <th className="text-center">Wysyłka</th>
                    <th className="text-center">Razem</th>
                  </tr>
                </thead>

                <tbody>
                  {rowsToRender.map((r, i) => (
                    <tr key={r.id} className="hover:bg-gray-50 align-middle">
                      <td className="text-center">
                        <div className="flex items-center justify-center h-full">
                          {i + 1}
                        </div>
                      </td>
                      <td className="text-center whitespace-nowrap">
                        <input
                          type="date"
                          className="input w-full text-center"
                          value={r.date || ""}
                          onChange={(e) =>
                            updateRow(r.id, {
                              date: normalizeISODate(e.target.value),
                            })
                          }
                          ref={registerInputRef(r.id, "date")}
                          onKeyDown={handleEnter(r.id, "date")}
                          disabled={inputsDisabled(r)}
                        />
                      </td>

                      <td className="max-w-0 relative">
                        <input
                          className="input w-full"
                          value={r.clientName}
                          onChange={(e) => {
                            updateRow(r.id, {
                              clientName: e.target.value,
                              clientId: "",
                            });
                            setActiveSuggestRow(r.id);
                          }}
                          onFocus={() => setActiveSuggestRow(r.id)}
                          onBlur={() =>
                            setTimeout(() => setActiveSuggestRow(null), 150)
                          }
                          placeholder="Wybierz klienta…"
                          ref={registerInputRef(r.id, "client")}
                          onKeyDown={(e) => {
                            if (e.key === "ArrowDown") {
                              e.preventDefault();
                              setActiveSuggestIndex((i) => i + 1);
                              return;
                            }
                            if (e.key === "ArrowUp") {
                              e.preventDefault();
                              setActiveSuggestIndex((i) => Math.max(0, i - 1));
                              return;
                            }
                            handleEnter(r.id, "client")(e);
                          }}
                          disabled={inputsDisabled(r)}
                          autoComplete="off"
                        />

                        {activeSuggestRow === r.id && r.clientName && (
                          <div className="absolute z-30 bottom-full mb-1 w-full max-h-48 overflow-auto rounded-md border bg-white shadow">
                            {clients
                              .filter((c) =>
                                c.name
                                  .toLowerCase()
                                  .includes(r.clientName.toLowerCase())
                              )
                              .slice(0, 20)
                              .map((c, idx) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  className={`block w-full px-3 py-2 text-left text-sm ${
                                    idx === activeSuggestIndex
                                      ? "bg-blue-100"
                                      : "hover:bg-blue-50"
                                  }`}
                                  onMouseDown={() => {
                                    updateRow(r.id, {
                                      clientName: c.name,
                                      clientId: c.id,
                                    });
                                    setActiveSuggestRow(null);
                                  }}
                                >
                                  {c.name}
                                </button>
                              ))}
                          </div>
                        )}
                      </td>
                      <td className="text-right">
                        <input
                          className="input w-full text-right no-spin"
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={r.qty === "" ? "" : r.qty}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateRow(r.id, { qty: v === "" ? "" : Number(v) });
                          }}
                          title="Ilość pakietów"
                          ref={registerInputRef(r.id, "qty")}
                          onKeyDown={handleEnter(r.id, "qty")}
                          disabled={inputsDisabled(r)}
                        />
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end h-full">
                          {to2(r.sterilCost)} zł
                        </div>
                      </td>
                      <td className="text-right">
                        <input
                          className="input w-full text-right no-spin"
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={r.shipOrCourier === "" ? "" : r.shipOrCourier}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateRow(r.id, {
                              shipOrCourier: v === "" ? "" : Number(v),
                            });
                          }}
                          title="Kwota wysyłki lub dojazdu"
                          ref={registerInputRef(r.id, "ship")}
                          onKeyDown={handleEnter(r.id, "ship")}
                          disabled={inputsDisabled(r)}
                        />
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end h-full">
                          {to2(r.total)} zł
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>

                <tfoot>
                  <tr className="bg-blue-50 font-semibold">
                    <td colSpan={3} className="text-right">
                      Razem:
                    </td>
                    <td className="text-right">{totals.qty}</td>
                    <td className="text-right">{to2(totals.steril)} zł</td>
                    <td className="text-right">{to2(totals.ship)} zł</td>
                    <td className="text-right">{to2(totals.total)} zł</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="btn-primary"
                onClick={addRow}
                ref={addBtnRef}
              >
                + Dodaj wiersz
              </button>
            </div>
          </div>
        </main>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Usuń zapisaną tabelę?"
        message={
          toDelete
            ? `Czy na pewno chcesz usunąć tabelę "${toDelete.title}"? Operacji nie można cofnąć.`
            : ""
        }
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          const id = toDelete.id;
          try {
            await apiFetch(
              normalizeApiFetchPath(
                `/psl/saved/${encodeURIComponent(id)}?confirm=psl:delete-saved`
              ),
              {
                method: "DELETE",
                headers: { "x-confirm-action": "psl:delete-saved" },
              }
            );
          } catch {}
          const newIdx = savedIndex.filter((x) => x.id !== id);
          setSavedIndex(newIdx);
          localStorage.setItem(LS_IDX, JSON.stringify(newIdx));
          setToDelete(null);
        }}
      />
    </div>
  );
}
