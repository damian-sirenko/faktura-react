// src/pages/SignQueue.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import SignaturePad from "../components/SignaturePad.jsx";
import { apiUrl } from "../api/base.js";
const api = apiUrl;

/* ========= Helpers ========= */
const todayISO = () => new Date().toISOString().slice(0, 10);
const getQuery = () => new URLSearchParams(window.location.search);
const legLabelPL = (leg) => (leg === "transfer" ? "Przekazanie" : "Zwrot");
const legFromSelect = (val) => (val === "Przekazanie" ? "transfer" : "return");

/* Абсолютний/відносний шлях для підписів (img src) */
const absSig = (src) => {
  if (!src || typeof src !== "string") return src;
  if (src.startsWith("data:")) return src;
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("/signatures/")) return src;
  return `/signatures/${src}`;
};

/* Клієнт helpers */
function getClientName(c) {
  return String(c?.name || c?.Klient || "").trim();
}
function getClientId(c) {
  return (
    c?.id ||
    c?.ID ||
    String(c?.name || c?.Klient || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
  );
}
function getClientAddress(c) {
  const a =
    c?.address ||
    c?.Adres ||
    [
      [c?.street, c?.city].filter(Boolean).join(" "),
      [c?.postal, c?.post || c?.miejscowosc].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join(", ");
  return String(a || "").trim();
}
function getClientNip(c) {
  return String(c?.nip || c?.NIP || c?.vat || c?.VAT || c?.taxId || "").trim();
}

/* ==== Нормалізація місяця і елементів черги ==== */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function normalizeYm(m) {
  const s = String(m ?? "").trim();
  if (MONTH_RE.test(s)) return s;
  const s2 = s.replace(/[\/_\.]/g, "-");
  const mm = s2.match(/^(\d{4})-(\d{1,2})$/);
  if (mm) {
    const y = mm[1];
    const mo = String(mm[2]).padStart(2, "0");
    if (/^(0[1-9]|1[0-2])$/.test(mo)) return `${y}-${mo}`;
  }
  return "";
}
function toIntMaybe(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Нормалізація item з /sign-queue-db або протоколів */
function normalizeQueueItem(it = {}, defaultMonth = "") {
  const clientIdRaw =
    it.clientId ??
    it.client_id ??
    it.client ??
    it.cid ??
    (it.clientObj ? getClientId(it.clientObj) : null) ??
    (it.clientData ? getClientId(it.clientData) : null) ??
    (it.clientInfo ? getClientId(it.clientInfo) : null) ??
    (it.client && typeof it.client === "object"
      ? getClientId(it.client)
      : null) ??
    (typeof it.id === "string" && !/^\d+$/.test(it.id) ? it.id : null);

  const clientId = clientIdRaw ? String(clientIdRaw).trim() : "";

  const monthRaw =
    it.month ??
    it.ym ??
    it.yy_mm ??
    (typeof it.date === "string" ? it.date.slice(0, 7) : null) ??
    (it.entry && typeof it.entry.date === "string"
      ? it.entry.date.slice(0, 7)
      : null) ??
    defaultMonth;

  const month = normalizeYm(monthRaw);

  const idxRaw =
    it.index ??
    it.idx ??
    it.entryIndex ??
    it.entry_index ??
    it.i ??
    it.entryId ??
    it.entry_id ??
    it.rowId ??
    it.row_id ??
    (typeof it.id === "number" ? it.id : null);

  const index = toIntMaybe(idxRaw);

  const date =
    it.date ??
    (it.entry ? it.entry.date : null) ??
    (Array.isArray(it.dates) ? it.dates[0] : null) ??
    null;

  const returnDate =
    it.returnDate ??
    (it.entry ? it.entry.returnDate : null) ??
    (Array.isArray(it.returnDates) ? it.returnDates[0] : null) ??
    null;

  const tools = it.tools ?? (it.entry ? it.entry.tools : []) ?? [];
  const packages =
    it.packages ?? it.pakiety ?? (it.entry ? it.entry.packages : 0) ?? 0;

  const delivery = it.delivery ?? (it.entry ? it.entry.delivery : null) ?? null;
  const shipping =
    typeof it.shipping === "boolean"
      ? it.shipping
      : !!(it.entry && it.entry.shipping);

  const comment = it.comment ?? (it.entry ? it.entry.comment : "") ?? "";

  const signatures =
    it.signatures ?? (it.entry ? it.entry.signatures : {}) ?? {};

  const queue = it.queue ?? {
    pointPending: !!(it.pointPending ?? (it.entry && it.entry.pointPending)),
    courierPending: !!(
      it.courierPending ??
      (it.entry && it.entry.courierPending)
    ),
    courierPlannedDate:
      (it.queue && it.queue.courierPlannedDate) ||
      it.courierPlannedDate ||
      null,
  };

  if (!clientId || !month) return null;
  if (index === null || index < 0) return null;

  return {
    clientId,
    clientName: it.clientName || it.client_name || it.name || null,
    month,
    index,
    date,
    returnDate,
    tools,
    packages,
    delivery,
    shipping,
    comment,
    signatures,
    queue,
  };
}

export default function SignQueue() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = useMemo(() => getQuery(), [location.search]);

  const initialType = (query.get("type") || "courier").toLowerCase();
  const [type, setType] = useState(initialType);

  const [dateFilter, setDateFilter] = useState(todayISO());
  const month = useMemo(() => dateFilter.slice(0, 7), [dateFilter]);

  const [clientsMap, setClientsMap] = useState({});
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [view, setView] = useState("list");
  const [active, setActive] = useState(null);

  const [chosenLeg, setChosenLeg] = useState({});

  const [inlineTarget, setInlineTarget] = useState(null);
  const padRef = useRef(null);
  const [padEmpty, setPadEmpty] = useState(true);

  const [padSize, setPadSize] = useState({ w: 640, h: 220 });

  const token =
    localStorage.getItem("authToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("jwt") ||
    sessionStorage.getItem("authToken") ||
    sessionStorage.getItem("token") ||
    "";
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const commonFetchOpts = { credentials: "include" };

  useEffect(() => {
    if (!inlineTarget) return;
    const onKey = (e) => {
      if (e.key === "Escape") setInlineTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inlineTarget]);

  useEffect(() => {
    if (!inlineTarget) return;
    const compute = () => {
      const vw = Math.max(
        document.documentElement.clientWidth,
        window.innerWidth || 0
      );
      const vh = Math.max(
        document.documentElement.clientHeight,
        window.innerHeight || 0
      );
      const maxW = Math.min(Math.floor(vw - 32), 720);
      const maxH = Math.min(Math.floor(vh - 160), 360);
      const w = Math.max(320, maxW);
      const h = Math.max(160, maxH);
      setPadSize({ w, h });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [inlineTarget]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(api("/clients"), {
          ...commonFetchOpts,
          headers: { ...authHeaders },
        });
        const arr = await r.json();
        const map = {};
        for (const c of arr || []) {
          const id = getClientId(c);
          if (id) map[id] = c;
        }
        setClientsMap(map);
      } catch {
        setClientsMap({});
      }
    })();
  }, []);

  const buildQueueFromProtocols = (allProtocols, monthStr, queueType) => {
    const items = [];
    const isPoint = queueType === "point";
    for (const p of Array.isArray(allProtocols) ? allProtocols : []) {
      if (p?.month !== monthStr) continue;
      const entries = Array.isArray(p.entries) ? p.entries : [];
      entries.forEach((e, idx) => {
        const q = e?.queue || {};
        const pending = isPoint ? q.pointPending : q.courierPending;
        if (!pending) return;

        items.push({
          clientId: p.id,
          clientName: p.clientName,
          month: p.month,
          index: idx,
          date: e.date || null,
          returnDate: e.returnDate || null,
          tools: e.tools || [],
          packages: e.packages || 0,
          delivery: e.delivery || null,
          shipping: !!e.shipping,
          comment: e.comment || "",
          signatures: e.signatures || {},
          queue: q,
        });
      });
    }
    return items;
  };

  const loadQueue = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type,
        month,
      });

      // 1) ПРОБА ЧЕРГИ З БАЗИ: /sign-queue-db
      let normalized = [];
      try {
        const urlDb = `/sign-queue-db?${params.toString()}`;
        console.log("[SignQueue] try /sign-queue-db:", urlDb);

        const rDb = await fetch(api(urlDb), {
          ...commonFetchOpts,
          headers: { ...authHeaders },
        });

        if (rDb.ok) {
          const data = await rDb.json().catch(() => ({}));
          const raw = Array.isArray(data.items)
            ? data.items
            : Array.isArray(data)
            ? data
            : [];

          normalized = raw
            .map((it) => normalizeQueueItem(it, month))
            .filter(Boolean);

          console.log("[SignQueue] /sign-queue-db items:", normalized.length);
        } else {
          console.warn("[SignQueue] /sign-queue-db status", rDb.status);
        }
      } catch (e) {
        console.warn("[SignQueue] /sign-queue-db error:", e);
      }

      if (normalized.length > 0) {
        setItems(normalized);

        const init = {};
        for (const it of normalized) {
          const key = `${it.clientId}-${it.index}-${it.month}`;
          const t = it?.signatures?.transfer || {};
          const rr = it?.signatures?.return || {};
          const tDone = !!(t.client && t.staff);
          const rDone = !!(rr.client && rr.staff);
          init[key] = !tDone ? "transfer" : !rDone ? "return" : "transfer";
        }
        setChosenLeg(init);

        return normalized;
      }

      // 2) ФОЛБЕК НА СТАРИЙ ФАЙЛОВИЙ /sign-queue
      let fromFile = [];
      try {
        const urlFile = `/sign-queue?${params.toString()}`;
        console.log("[SignQueue] try /sign-queue:", urlFile);

        const rFile = await fetch(api(urlFile), {
          ...commonFetchOpts,
          headers: { ...authHeaders },
        });

        if (rFile.ok) {
          const data = await rFile.json().catch(() => ({}));
          const raw = Array.isArray(data.items)
            ? data.items
            : Array.isArray(data)
            ? data
            : [];

          fromFile = raw
            .map((it) => normalizeQueueItem(it, month))
            .filter(Boolean);

          console.log("[SignQueue] /sign-queue items:", fromFile.length);
        } else {
          console.warn("[SignQueue] /sign-queue status", rFile.status);
        }
      } catch (e) {
        console.warn("[SignQueue] /sign-queue error:", e);
      }

      if (fromFile.length > 0) {
        setItems(fromFile);

        const init = {};
        for (const it of fromFile) {
          const key = `${it.clientId}-${it.index}-${it.month}`;
          const t = it?.signatures?.transfer || {};
          const rr = it?.signatures?.return || {};
          const tDone = !!(t.client && t.staff);
          const rDone = !!(rr.client && rr.staff);
          init[key] = !tDone ? "transfer" : !rDone ? "return" : "transfer";
        }
        setChosenLeg(init);

        return fromFile;
      }

      // 3) ОСТАННІЙ ЗАПАСНИЙ ВАРІАНТ — ЗБИРАЄМО ЧЕРГУ З /protocols
      console.warn(
        "[SignQueue] both /sign-queue-db and /sign-queue empty — fallback to /protocols"
      );

      const r2 = await fetch(api("/protocols"), {
        ...commonFetchOpts,
        headers: { ...authHeaders },
      });

      if (!r2.ok) {
        console.error("[SignQueue] /protocols status", r2.status);
        setItems([]);
        setChosenLeg({});
        return [];
      }

      const all = await r2.json().catch(() => []);
      const local = buildQueueFromProtocols(all, month, type);

      setItems(local);

      const init = {};
      for (const it of local) {
        const key = `${it.clientId}-${it.index}-${it.month}`;
        const t = it?.signatures?.transfer || {};
        const rr = it?.signatures?.return || {};
        const tDone = !!(t.client && t.staff);
        const rDone = !!(rr.client && rr.staff);
        init[key] = !tDone ? "transfer" : !rDone ? "return" : "transfer";
      }
      setChosenLeg(init);

      return local;
    } catch (e) {
      console.error("[SignQueue] loadQueue error:", e);
      setItems([]);
      setChosenLeg({});
      return [];
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    const url = new URL(window.location.href);
    if ((url.searchParams.get("type") || "courier") !== type) {
      url.searchParams.set("type", type);
      navigate(`${url.pathname}?${url.searchParams.toString()}`, {
        replace: true,
      });
    }
    loadQueue();
  }, [type, month]);

  const getEffectiveDay = (it) => {
    const key = `${it.clientId}-${it.index}-${it.month}`;
    const leg = chosenLeg[key] || "transfer";
    let d = leg === "transfer" ? it.date : it.returnDate;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      d = it?.queue?.courierPlannedDate || todayISO();
    }
    if (d < dateFilter) return dateFilter;
    return d;
  };

  const grouped = useMemo(() => {
    if (type === "point") {
      return { [dateFilter]: items };
    }
    const map = {};
    for (const it of items) {
      const day = getEffectiveDay(it);
      if (!map[day]) map[day] = [];
      map[day].push(it);
    }
    Object.keys(map).forEach((d) => {
      map[d].sort((a, b) => {
        const an =
          a.clientName ||
          getClientName(clientsMap[a.clientId]) ||
          a.clientId ||
          "";
        const bn =
          b.clientName ||
          getClientName(clientsMap[b.clientId]) ||
          b.clientId ||
          "";
        return an.localeCompare(bn, "pl");
      });
    });
    return map;
  }, [items, chosenLeg, type, dateFilter, clientsMap]);

  const sortedDays = useMemo(() => {
    const arr = Object.keys(grouped);
    arr.sort();
    return arr;
  }, [grouped]);

  const openCard = (item) => {
    setActive(item);
    const key = `${item.clientId}-${item.index}-${item.month}`;
    const leg = chosenLeg[key] || "transfer";
    setInlineTarget(null);
    setPadEmpty(true);
    setView("card");
  };

  const backToList = () => {
    setActive(null);
    setInlineTarget(null);
    setView("list");
  };

  const saveSignatureSlot = async () => {
    if (!active) return;
    const key = `${active.clientId}-${active.index}-${active.month}`;
    const targetLeg = chosenLeg[key] || "transfer";
    if (padEmpty || padRef.current?.isEmpty?.()) {
      return alert("Brak podpisu.");
    }
    try {
      const dataURL = padRef.current?.toDataURL?.("image/png");
      if (!dataURL) return;

      const r = await fetch(
        api(
          `/protocols/${encodeURIComponent(active.clientId)}/${active.month}/${
            active.index
          }/sign`
        ),
        {
          method: "POST",
          ...commonFetchOpts,
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ leg: targetLeg, client: dataURL }),
        }
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.error || "Błąd zapisu podpisu");
      }

      const fresh = await loadQueue();
      const updated = fresh.find(
        (x) =>
          x.clientId === active.clientId &&
          x.month === active.month &&
          x.index === active.index
      );
      if (updated) setActive(updated);
      else backToList();

      setInlineTarget(null);
      setPadEmpty(true);
    } catch (e) {
      alert(e.message || "Nie udało się zapisać podpisu.");
    }
  };

  const removeFromQueueApi = async (it) => {
    try {
      await fetch(
        api(
          `/protocols/${encodeURIComponent(it.clientId)}/${it.month}/${
            it.index
          }/queue`
        ),
        {
          method: "POST",
          ...commonFetchOpts,
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            type: type === "point" ? "point" : "courier",
            pending: false,
          }),
        }
      );
      await loadQueue();
    } catch {
      alert("Nie udało się usunąć z kolejki.");
    }
  };

  const moveItemToDay = async (it, newDay) => {
    if (!newDay || !/^\d{4}-\d{2}-\d{2}$/.test(newDay)) return;
    const key = `${it.clientId}-${it.index}-${it.month}`;
    const leg = chosenLeg[key] || "transfer";

    try {
      const patchBody = {};
      if (leg === "transfer") {
        patchBody.date = newDay;
      } else {
        patchBody.returnDate = newDay;
      }
      if (type === "courier") {
        patchBody.courierPlannedDate = newDay;
      }

      const r1 = await fetch(
        api(
          `/protocols/${encodeURIComponent(it.clientId)}/${it.month}/${
            it.index
          }`
        ),
        {
          method: "PATCH",
          ...commonFetchOpts,
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(patchBody),
        }
      );

      if (!r1.ok) {
        const err = await r1.json().catch(() => ({}));
        throw new Error(err?.error || "Nie udało się zaktualizować daty");
      }

      await loadQueue();
    } catch (e) {
      alert(e.message || "Nie udało się przenieść wpisu на inny dzień.");
    }
  };

  const [qtyDraft, setQtyDraft] = useState({});
  const [editingKey, setEditingKey] = useState(null);

  useEffect(() => {
    if (!active || !editingKey) return;
    const el = document.getElementById(`qty-${editingKey}`);
    if (el) {
      el.focus();
      const pos = el.value.length;
      try {
        el.setSelectionRange(pos, pos);
      } catch {}
    }
  }, [qtyDraft, active, editingKey]);

  useEffect(() => {
    if (!active) return;
    const init = {};
    (active.tools || []).forEach((t, i) => {
      init[`T_${i}`] = String(Number(t.count || 0));
    });
    init["P_PACK"] = String(Number(active.packages || 0));
    setQtyDraft(init);
  }, [active]);

  const onQtyFocus = (e) => e.target.select();

  const saveQuantities = async () => {
    if (!active) return;
    const tools = (active.tools || []).map((t, i) => ({
      name: t.name,
      count: Number(qtyDraft[`T_${i}`] || 0) || 0,
    }));
    const packages = Number(qtyDraft["P_PACK"] || 0) || 0;

    try {
      const r = await fetch(
        api(
          `/protocols/${encodeURIComponent(active.clientId)}/${active.month}/${
            active.index
          }`
        ),
        {
          method: "PATCH",
          ...commonFetchOpts,
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ tools, packages }),
        }
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.error || "Błąd zapisu ilości");
      }
      const fresh = await loadQueue();
      const updated = fresh.find(
        (x) =>
          x.clientId === active.clientId &&
          x.month === active.month &&
          x.index === active.index
      );
      if (updated) setActive(updated);
    } catch (e) {
      alert(e.message || "Nie udało się zapisać ilości.");
    }
  };

  const TopBar = () => (
    <div className="flex flex-wrap items-center gap-3 mb-3">
      <div className="text-lg font-semibold">Protokoły do podpisu</div>
      <div className="flex-1" />
      <input
        type="date"
        className="input w-44"
        value={dateFilter}
        onChange={(e) => setDateFilter(e.target.value)}
      />
      <div className="inline-flex rounded-lg overflow-hidden border">
        <button
          className={`px-3 py-1.5 text-sm ${
            type === "courier" ? "bg-blue-600 text-white" : "bg-white"
          }`}
          onClick={() => setType("courier")}
          title="Kurier"
        >
          Kurier
        </button>
        <button
          className={`px-3 py-1.5 text-sm ${
            type === "point" ? "bg-blue-600 text-white" : "bg-white"
          }`}
          onClick={() => setType("point")}
          title="Punkt"
        >
          Punkt
        </button>
      </div>
    </div>
  );

  const DateHeader = ({ day }) => (
    <div className="px-2">
      <div
        className="
        w-full text-center
        bg-blue-600 text-white
        font-extrabold tracking-wide
        rounded-xl shadow-md
        px-4 py-2
      "
      >
        {day}
      </div>
    </div>
  );

  const RowControls = ({ it, sel, keyId }) => (
    <div className="w-full sm:w-auto ml-0 sm:ml-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
      <select
        className="h-9 sm:h-8 px-2 rounded-md border text-sm font-medium text-white text-center w-full sm:w-auto leading-none"
        style={{
          backgroundColor: "#166534",
          borderColor: "#14532d",
          textAlignLast: "center",
        }}
        value={legLabelPL(sel)}
        onChange={(e) =>
          setChosenLeg((m) => ({
            ...m,
            [keyId]: legFromSelect(e.target.value),
          }))
        }
        title="Rodzaj wpisu"
      >
        <option style={{ color: "#111" }}>Przekazanie</option>
        <option style={{ color: "#111" }}>Zwrot</option>
      </select>

      {type === "courier" && (
        <input
          type="date"
          className="h-9 sm:h-8 px-2 rounded-md border text-sm w-full sm:w-auto"
          value={getEffectiveDay(it)}
          onChange={(e) => moveItemToDay(it, e.target.value)}
          title="Przenieś na inny dzień"
        />
      )}

      <button
        className="h-9 sm:h-8 px-2 rounded-md border bg-red-600 text-white text-sm w-full sm:w-auto"
        onClick={() => removeFromQueueApi(it)}
        title="Usuń z kolejki"
      >
        Usuń
      </button>
    </div>
  );

  const ListView = () => (
    <div className="space-y-3">
      <TopBar />
      <div className="card">
        {loading ? (
          <div className="py-8 text-center text-gray-500">Ładowanie…</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            Brak pozycji do podpisu.
          </div>
        ) : (
          <div className="space-y-4 p-2">
            {sortedDays.map((day) => (
              <div key={day} className="space-y-2">
                <DateHeader day={day} />
                <ul className="divide-y rounded-md border overflow-hidden bg-white">
                  {grouped[day].map((it) => {
                    const client = clientsMap[it.clientId] || {};
                    const name =
                      getClientName(client) || it.clientName || it.clientId;
                    const addr = getClientAddress(client) || "—";
                    const keyId = `${it.clientId}-${it.index}-${it.month}`;
                    const sel = chosenLeg[keyId] || "transfer";
                    const shownDate =
                      sel === "transfer" ? it.date : it.returnDate;

                    return (
                      <li
                        key={`${it.clientId}-${it.index}-${it.month}`}
                        className="py-3 px-2 flex flex-col sm:flex-row sm:items-center gap-3"
                      >
                        <button
                          className="text-left w-full sm:flex-1 min-w-[12rem]"
                          onClick={() => openCard(it)}
                          title="Otwórz kartę wpisu"
                        >
                          <div className="text-xs sm:text-sm text-gray-500 mb-0.5">
                            {shownDate ||
                              it.queue?.courierPlannedDate ||
                              it.date ||
                              it.returnDate ||
                              "—"}
                          </div>
                          <div className="text-lg sm:text-xl font-bold leading-tight">
                            {name}
                          </div>
                          <div className="text-sm sm:text-base text-gray-700">
                            {addr}
                          </div>
                        </button>

                        <RowControls it={it} sel={sel} keyId={keyId} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const CardView = () => {
    if (!active) return null;
    const client = clientsMap[active.clientId] || {};
    const name = getClientName(client) || active.clientName || active.clientId;
    const addr = getClientAddress(client) || "—";
    const nip = getClientNip(client) || "—";

    const key = `${active.clientId}-${active.index}-${active.month}`;
    const activeLeg = chosenLeg[key] || "transfer";

    const toolsList = (active.tools || []).filter((t) => t?.name);
    const rows = toolsList.map((t, i) => ({
      label: t.name,
      valueKey: `T_${i}`,
      value: qtyDraft[`T_${i}`] ?? "",
    }));
    rows.push({
      label: "Pakiety",
      valueKey: "P_PACK",
      value: qtyDraft["P_PACK"] ?? "",
      total: true,
    });

    const signBtnLabel =
      activeLeg === "transfer"
        ? "Podpisz przekazanie narzędzi"
        : "Podpisz zwrot narzędzi";

    const dateForLeg =
      activeLeg === "transfer" ? active.date || "—" : active.returnDate || "—";

    return (
      <div className="space-y-3">
        <TopBar />

        <button
          className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 shadow-sm"
          onClick={backToList}
        >
          ← Powrót do listy
        </button>

        <div className="card p-0 overflow-hidden">
          <div className="bg-slate-50 border-b px-4 py-3">
            <div className="text-lg sm:text-xl md:text-2xl font-semibold leading-tight">
              {name}
            </div>
            <div className="text-sm md:text-base text-slate-700">{addr}</div>
            <div className="text-sm text-slate-600 mt-0.5">NIP: {nip}</div>
            <div className="text-sm text-slate-600 mt-0.5">
              Data: {dateForLeg}
            </div>
          </div>

          <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-3">
              <div className="font-medium mb-1">Narzędzia i pakiety</div>
              <div className="rounded-lg border bg-white overflow-hidden w-full">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col style={{ width: "auto" }} />
                    <col style={{ width: "18rem" }} />
                  </colgroup>
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="text-left px-3 py-2">Nazwa</th>
                      <th className="text-right px-3 py-2">Ilość</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={i}
                        className={r.total ? "bg-emerald-50 font-semibold" : ""}
                      >
                        <td
                          className={
                            "px-3 py-2 align-top " +
                            (r.total ? "text-base md:text-lg font-bold" : "")
                          }
                        >
                          {r.label}
                        </td>
                        <td
                          className={
                            "px-3 py-2 text-right align-top " +
                            (r.total ? "text-base md:text-lg font-bold" : "")
                          }
                        >
                          <input
                            id={`qty-${r.valueKey}`}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            className={
                              "input h-10 text-right w-full appearance-none " +
                              (r.total ? "text-base md:text-lg font-bold" : "")
                            }
                            value={r.value ?? ""}
                            onFocus={(e) => {
                              setEditingKey(r.valueKey);
                              e.target.select();
                            }}
                            onChange={(e) => {
                              const cleaned = e.target.value.replace(
                                /[^\d]/g,
                                ""
                              );
                              setQtyDraft((m) => ({
                                ...m,
                                [r.valueKey]: cleaned,
                              }));
                            }}
                            onKeyDown={(e) => {
                              const ok =
                                /[0-9]/.test(e.key) ||
                                [
                                  "Backspace",
                                  "Delete",
                                  "ArrowLeft",
                                  "ArrowRight",
                                  "Tab",
                                  "Home",
                                  "End",
                                  "Enter",
                                ].includes(e.key);
                              if (!ok) e.preventDefault();
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex justify-end">
                <button
                  className="btn-primary"
                  onClick={saveQuantities}
                  title="Zapisz ilości"
                >
                  Zapisz ilości
                </button>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-0">
              <div>
                <div className="text-sm font-medium">Dodatkowe usługi:</div>
                <div className="flex flex-wrap gap-2">
                  {active.shipping && (
                    <span className="px-3 py-1 rounded-full bg-slate-100 border text-sm">
                      Wysyłka
                    </span>
                  )}
                  {active.delivery === "odbior" && (
                    <span className="px-3 py-1 rounded-full bg-slate-100 border text-sm">
                      Kurier: odbiór
                    </span>
                  )}
                  {active.delivery === "odbior+dowoz" && (
                    <span className="px-3 py-1 rounded-full bg-slate-100 border text-sm">
                      Kurier: odbiór i dowóz
                    </span>
                  )}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium">Komentarz:</div>
                <div className="whitespace-pre-wrap text-slate-700">
                  {active.comment || ""}
                </div>
              </div>
            </div>

            <div />
          </div>

          <div className="px-4 pb-4">
            <div className="flex justify-center">
              <button
                className="btn-primary w-full sm:w-auto"
                onClick={() => {
                  setInlineTarget({ leg: activeLeg, role: "client" });
                  setPadEmpty(true);
                }}
                title="Dodaj podpis klienta"
              >
                {signBtnLabel}
              </button>
            </div>
          </div>
        </div>

        {inlineTarget &&
          createPortal(
            <div
              className="fixed inset-0 z-[99999] flex items-center justify-center p-4 overflow-auto"
              role="dialog"
              aria-modal="true"
              onClick={() => setInlineTarget(null)}
              style={{ background: "rgba(0,0,0,0.45)" }}
            >
              <div
                className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[900px] md:max-w-3xl p-4 md:p-5"
                style={{ pointerEvents: "auto" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="text-lg font-semibold">
                    {legLabelPL(inlineTarget.leg)} — Klient
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        padRef.current?.clear?.();
                        setPadEmpty(true);
                      }}
                    >
                      Wyczyść
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setInlineTarget(null)}
                    >
                      Zamknij
                    </button>
                  </div>
                </div>

                <div className="w-full">
                  <div className="mx-auto" style={{ maxWidth: "100%" }}>
                    <SignaturePad
                      ref={padRef}
                      onChange={setPadEmpty}
                      width={padSize.w}
                      height={padSize.h}
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    className={`btn-primary ${
                      padEmpty ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                    disabled={padEmpty}
                    onClick={saveSignatureSlot}
                  >
                    Zapisz podpis
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => setInlineTarget(null)}
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
      </div>
    );
  };

  return view === "list" ? <ListView /> : <CardView />;
}
