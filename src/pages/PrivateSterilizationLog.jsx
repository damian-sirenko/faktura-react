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

const isYm = (s) => typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
const clampYm = (s) => {
  if (isYm(s)) return s;
  try {
    const d = new Date(s);
    if (!isNaN(d)) return ymOf(d);
  } catch {}
  return ymOf();
};

// порядок навігації Enter
const COL_ORDER = ["client", "qty", "ship"];

/* ========= LocalStorage keys ========= */
const LS_IDX = "PSL_SAVED_INDEX";
const LS_DRAFT_KEY = (ym) => `PSL_DRAFT_${ym}`;
const LS_ACTIVE_YM = "PSL_ACTIVE_YM";

/* ========= API helpers через apiFetch ========= */
const getJSON = async (u) => {
  const r = await apiFetch(u, { method: "GET" });
  return typeof r?.json === "function" ? await r.json() : r;
};
const sendJSON = async (u, method, body) => {
  const r = await apiFetch(u, { method, json: body });
  return typeof r?.json === "function" ? await r.json() : r;
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

/* ========= Row model ========= */
const emptyRow = () => ({
  id: uid(),
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
  return {
    id: r?.id || uid(),
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

  const inputRefs = useRef(new Map());
  const addBtnRef = useRef(null);

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

    if (col === "client") {
      const el = inputRefs.current.get(`${rowId}:client`);
      const typed = (el?.value || "").trim().toLowerCase();
      if (typed) {
        const best =
          clients.find((c) => c.name.toLowerCase().startsWith(typed)) ||
          clients.find((c) => c.name.toLowerCase().includes(typed));
        if (best) {
          updateRow(rowId, { clientName: best.name, clientId: best.id });
        }
      }
    }

    const idx = COL_ORDER.indexOf(col);
    const nextCol = COL_ORDER[idx + 1];
    if (nextCol) return focusCell(rowId, nextCol);
    if (addBtnRef.current) addBtnRef.current.focus();
  };

  const cols = [
    { key: "c1", width: "6ch" },
    { key: "c2", width: "auto" },
    { key: "c3", width: "12ch" },
    { key: "c4", width: "16ch" },
    { key: "c5", width: "14ch" },
    { key: "c6", width: "16ch" },
  ];

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
    if (activeYm) localStorage.setItem(LS_ACTIVE_YM, activeYm);
  }, [activeYm]);

  /* Rows in workspace */
  const [rows, setRows] = useState([{ ...emptyRow(), isNew: true }]);

  const hasData = (r) =>
    String(r?.clientName || "").trim() !== "" ||
    r?.qty !== "" ||
    r?.shipOrCourier !== "";

  // фільтр
  const [nameFilter, setNameFilter] = useState("");
  const filteredRows = useMemo(() => {
    const nf = nameFilter.trim().toLowerCase();
    if (!nf) return rows;
    return rows.filter((r) =>
      String(r.clientName || "")
        .toLowerCase()
        .includes(nf)
    );
  }, [rows, nameFilter]);

  const visibleRows = useMemo(() => {
    const base = filteredRows;
    if (viewMode === "saved") return base;
    return base.filter((r) => r.isNew || hasData(r));
  }, [filteredRows, viewMode]);

  const rowsToRender = visibleRows.length
    ? visibleRows
    : [{ ...emptyRow(), isNew: true }];

  /* Saved index (sidebar) */
  const [savedIndex, setSavedIndex] = useState([]);
  const [currentSavedId, setCurrentSavedId] = useState(null);
  const [toDelete, setToDelete] = useState(null);

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

  // завантажити workspace
  useEffect(() => {
    let cancelled = false;
    (async () => {
      suspendAutosaveRef.current = true;
      draftLoadedRef.current = false;

      try {
        const ws = await getJSON(api(`/psl/workspace`));
        if (cancelled) return;

        const ym = clampYm(
          ws?.ym || localStorage.getItem(LS_ACTIVE_YM) || ymOf()
        );

        const arr = Array.isArray(ws?.rows) ? ws.rows : [];
        setActiveYm(ym);
        const normalized = arr.length
          ? arr.map(normalizeRow)
          : [{ ...emptyRow(), isNew: true }];
        setRows(normalized.map(recalc));

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
        try {
          const lsYm = localStorage.getItem(LS_ACTIVE_YM) || prevYm(ymOf());
          const raw = localStorage.getItem(LS_DRAFT_KEY(lsYm));
          const parsed = raw ? JSON.parse(raw) : null;
          const arr = Array.isArray(parsed?.rows) ? parsed.rows : [];

          if (!cancelled) {
            setActiveYm(lsYm);
            const normalized = arr.length
              ? arr.map((r) => ({ ...r, isNew: false }))
              : [{ ...emptyRow(), isNew: true }];
            setRows(normalized);

            setViewMode("workspace");
            draftLoadedRef.current = true;
          }
        } catch {
          if (!cancelled) {
            const ym = prevYm(ymOf());
            setActiveYm(ym);
            setRows([{ ...emptyRow(), isNew: true }]);
            setViewMode("workspace");
            draftLoadedRef.current = true;
          }
        }
      } finally {
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

    const payload = { ym: activeYm, rows };
    localStorage.setItem(LS_DRAFT_KEY(activeYm), JSON.stringify(payload));
    lastPayloadRef.current = payload;

    if (savingRef.current) {
      pendingRef.current = true;
    } else {
      saveWorkspaceNow(payload);
    }
  }, [activeYm, rows, viewMode]);

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
    setRows((prev) => prev.map(recalc));
  }, [pricePerPack]);

  const updateRow = (id, patch) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? recalc({ ...r, ...patch }) : r))
    );
  };
  const addRow = () => {
    const newR = { ...emptyRow(), isNew: true };
    setRows((prev) => [...prev, newR]);
    setTimeout(() => {
      focusCell(newR.id, "client");
      const el = inputRefs.current.get(`${newR.id}:client`);
      if (el?.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }, 0);
  };
  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  // зміна робочого місяця
  const setWorkspaceMonth = async (ym) => {
    const next = clampYm(ym);
    try {
      await sendJSON(api(`/settings`), "POST", { currentIssueMonth: next });
    } catch {}
    try {
      const ws = await getJSON(api(`/psl/workspace`));
      const newYm = String(ws?.ym || next);
      const arr = Array.isArray(ws?.rows) ? ws.rows : [];
      setActiveYm(newYm);
      setRows(
        (arr.length ? arr : [{ ...emptyRow(), isNew: true }])
          .map(normalizeRow)
          .map(recalc)
      );
      setViewMode("workspace");
      localStorage.setItem(
        LS_DRAFT_KEY(newYm),
        JSON.stringify({ ym: newYm, rows: arr })
      );
    } catch {
      setActiveYm(next);
      setRows([{ ...emptyRow(), isNew: true }]);
      setViewMode("workspace");
      localStorage.setItem(
        LS_DRAFT_KEY(next),
        JSON.stringify({ ym: next, rows: [] })
      );
    }
  };

  // фіналізація місяця
  const finalizeMonth = async () => {
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
      localStorage.removeItem(LS_DRAFT_KEY(activeYm));

      setRows([{ ...emptyRow(), isNew: true }]);

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

      setRows([{ ...emptyRow(), isNew: true }]);
    } catch {
      alert(
        "⚠️ Serwer niedostępny — zapisano tylko lokalną kopię. Spróbuj później."
      );
    }
  };

  // відкрити збережений місяць
  const openSaved = async (id) => {
    try {
      const snap = await getJSON(api(`/psl/saved/${encodeURIComponent(id)}`));
      if (!snap) return;
      setCurrentSavedId(id);

      suspendAutosaveRef.current = true;
      draftLoadedRef.current = false;

      setActiveYm(snap.ym);
      setRows(
        Array.isArray(snap.rows) ? snap.rows.map(normalizeRow).map(recalc) : []
      );

      setViewMode("saved");
      localStorage.setItem(LS_ACTIVE_YM, snap.ym || "");

      draftLoadedRef.current = true;
      suspendAutosaveRef.current = false;
    } catch {}
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

  const openWorkspace = async () => {
    try {
      suspendAutosaveRef.current = true;
      draftLoadedRef.current = false;

      const ws = await getJSON(api(`/psl/workspace`));
      const ym = String(ws?.ym || "") || prevYm(ymOf());
      const arr = Array.isArray(ws?.rows) ? ws.rows : [];

      setActiveYm(ym);
      setRows(
        (arr.length ? arr : [{ ...emptyRow(), isNew: true }])
          .map(normalizeRow)
          .map(recalc)
      );
      setViewMode("workspace");

      if (arr.length) {
        localStorage.setItem(
          LS_DRAFT_KEY(ym),
          JSON.stringify({ ym, rows: arr })
        );
      }

      draftLoadedRef.current = true;
      suspendAutosaveRef.current = false;
    } catch {}
  };

  const clientIdByName = (name) =>
    clients.find((c) => c.name === name)?.id || "";

  const inputsDisabled = viewMode === "saved";

  return (
    <div className="w-full mx-auto px-3 sm:px-4 md:px-6 lg:px-8 space-y-4 psl-page overflow-x-hidden">
      {/* Верхня панель: поточний місяць + збережені */}
      <section className="psl-container space-y-3">
        <div className="psl-top-wrapper grid gap-3 md:grid-cols-2">
          <div className="card min-w-0">
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
              />
              <button
                className="btn-secondary"
                onClick={() => setWorkspaceMonth(ymOf())}
                title="Przełącz на bieżący miesiąc roboczy"
              >
                Bieżący miesiąc
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-2">
              <button
                className="btn-primary"
                onClick={finalizeMonth}
                title="Zapisz jako zakończony miesiąc i dodaj do listy"
                disabled={viewMode !== "workspace"}
              >
                Podsumuj i zapisz miesiąc
              </button>
            </div>
          </div>

          {/* Blok zapisane miesiące*/}

          <div className="card min-w-0">
            <div className="font-semibold mb-2">Zapisane miesiące</div>
            <div className="space-y-2 h-64 overflow-y-auto pr-1">
              {savedIndex.length === 0 && (
                <div className="text-sm text-gray-500">
                  Brak zapisanych tabel.
                </div>
              )}
              {savedIndex.map((it) => (
                <div
                  key={it.id}
                  className="rounded border p-2 flex items-center justify-between"
                >
                  <button
                    className="text-left btn-link"
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
        </div>
      </section>

      <section className="psl-container">
        {viewMode === "saved" && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 space-y-2">
            <div>
              Przeglądasz zapisany miesiąc. Edycja i autozapis wyłączone.
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary whitespace-normal max-w-full"
                onClick={restoreFromSaved}
                disabled={!currentSavedId}
                title="Przywróć zawartość tego запisu do roboczego pola i włącz edycję"
              >
                Przywróć do roboczego
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Таблиця з горизонтальним скролом у власному контейнері */}
      <section className="psl-container psl-table-container">
        <div className="card-lg min-w-0 w-full">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="font-semibold">
                Ewidencja sterylizacji prywatnej — {fmtPLYM(activeYm)}
                {viewMode === "saved" ? " (zapisany)" : " (roboczy)"}
              </div>
            </div>
            <div className="w-full sm:w-auto">
              <label className="block text-sm mb-1">
                Filtr: nazwa klienta
              </label>
              <input
                className="input no-spin w-full"
                placeholder="Wpisz nazwę klienta…"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-3 w-full">
            <div className="psl-table-scroll">
              <table className="table psl-table">
                <colgroup>
                  {cols.map((c) => (
                    <col key={c.key} style={{ width: c.width }} />
                  ))}
                </colgroup>

                <thead>
                  <tr>
                    <th className="w-[6ch] text-center">#</th>
                    <th>Klient</th>
                    <th className="w-[12ch] text-center">Pakiety</th>
                    <th className="w-[16ch] text-center">Koszt sterylizacji</th>
                    <th className="w-[14ch] text-center">Wysyłka</th>
                    <th className="w-[16ch] text-center">Razem</th>
                  </tr>
                </thead>

                <tbody>
                  {rowsToRender.map((r, i) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="text-center">{i + 1}</td>

                      <td className="max-w-0">
                        <input
                          list="clients-datalist"
                          className="input w-full"
                          value={r.clientName}
                          onChange={(e) =>
                            updateRow(r.id, {
                              clientName: e.target.value,
                              clientId: clientIdByName(e.target.value),
                            })
                          }
                          placeholder="Wybierz klienta…"
                          ref={registerInputRef(r.id, "client")}
                          onKeyDown={handleEnter(r.id, "client")}
                          disabled={inputsDisabled}
                        />
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
                            updateRow(r.id, {
                              qty: v === "" ? "" : Number(v),
                            });
                          }}
                          title="Ilość pakietów"
                          ref={registerInputRef(r.id, "qty")}
                          onKeyDown={handleEnter(r.id, "qty")}
                          disabled={inputsDisabled}
                        />
                      </td>

                      <td className="text-right whitespace-nowrap">
                        {to2(r.sterilCost)} zł
                      </td>

                      <td className="text-right">
                        <input
                          className="input w-full text-right no-spin"
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={
                            r.shipOrCourier === "" ? "" : r.shipOrCourier
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            updateRow(r.id, {
                              shipOrCourier: v === "" ? "" : Number(v),
                            });
                          }}
                          title="Kwota wysyłki lub dojazdu"
                          ref={registerInputRef(r.id, "ship")}
                          onKeyDown={handleEnter(r.id, "ship")}
                          disabled={inputsDisabled}
                        />
                      </td>

                      <td className="text-right whitespace-nowrap">
                        {to2(r.total)} zł
                      </td>
                    </tr>
                  ))}

                  <tr>
                    <td colSpan={6} className="text-right py-3">
                      <button
                        className="btn-primary"
                        onClick={addRow}
                        ref={addBtnRef}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addRow();
                          }
                        }}
                        disabled={inputsDisabled}
                      >
                        + Dodaj wiersz
                      </button>
                    </td>
                  </tr>
                </tbody>

                <tfoot>
                  <tr className="bg-blue-50 font-semibold">
                    <td colSpan={2} className="text-right">
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
          </div>

          <datalist id="clients-datalist">
            {clients.map((c) => (
              <option key={c.id || c.name} value={c.name} />
            ))}
          </datalist>
        </div>
      </section>

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
              api(
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
