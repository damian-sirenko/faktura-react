// src/pages/SignQueue.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import SignaturePad from "../components/SignaturePad.jsx";

/* ========= Helpers ========= */
const todayISO = () => new Date().toISOString().slice(0, 10);
const getQuery = () => new URLSearchParams(window.location.search);
const legLabelPL = (leg) => (leg === "transfer" ? "Przekazanie" : "Zwrot");
const legFromSelect = (val) => (val === "Przekazanie" ? "transfer" : "return");

/* Базовий URL бекенду (узгоджено зі сторінкою Dokumenty → Protokoły) */
const API = import.meta.env.VITE_API_URL || "http://localhost:3000";
/* Абсолютний URL для підписів */
const absSig = (src) => {
  if (!src || typeof src !== "string") return src;
  // data: URL або повний http(s) — віддаємо як є
  if (src.startsWith("data:") || /^https?:\/\//i.test(src)) return src;
  // вже абсолютний шлях типу /signatures/...
  if (src.startsWith("/signatures/")) return `${API}${src}`;
  // голе ім'я файлу (наприклад "169...png") -> /signatures/<name>
  return `${API}/signatures/${src}`;
};

/* Клієнт */
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

/* PDF / Документи */
import { buildProtocolPdf } from "../utils/ProtocolPdf";
import { saveProtocolDocMeta } from "../utils/docStore";

/* ==== Додано: нормалізація місяця і елементів черги ==== */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function normalizeYm(m) {
  const s = String(m ?? "").trim();
  if (MONTH_RE.test(s)) return s;
  const s2 = s.replace(/[\/_.]/g, "-");
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

/** Приводимо будь-який item з /sign-queue або з локального білду до спільного формату */
function normalizeQueueItem(it = {}) {
  // clientId з різних можливих ключів
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
    it.id; // інколи сервер кладе id протоколу = clientId

  const clientId = clientIdRaw ? String(clientIdRaw).trim() : "";

  // month з різних ключів або з дати
  const monthRaw =
    it.month ??
    it.ym ??
    it.yy_mm ??
    (typeof it.date === "string" ? it.date.slice(0, 7) : null) ??
    (it.entry && typeof it.entry.date === "string"
      ? it.entry.date.slice(0, 7)
      : null);

  const month = normalizeYm(monthRaw);

  // index
  const idxRaw =
    it.index ?? it.idx ?? it.entryIndex ?? it.entry_index ?? it.i ?? null;
  const index = toIntMaybe(idxRaw);

  // інші поля
  const date =
    it.date ??
    (it.entry ? it.entry.date : null) ??
    (Array.isArray(it.dates) ? it.dates[0] : null) ??
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
  };

  // валідність
  if (!clientId || !month || index === null || index < 0) return null;

  return {
    clientId,
    clientName: it.clientName || it.client_name || it.name || null,
    month,
    index,
    date,
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
  const [month, setMonth] = useState(() =>
    new Date().toISOString().slice(0, 7)
  );
  const [clientsMap, setClientsMap] = useState({});
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [view, setView] = useState("list"); // "list" | "card"
  const [active, setActive] = useState(null); // елемент черги
  const [activeLeg, setActiveLeg] = useState("transfer");
  const [signDate, setSignDate] = useState(() => todayISO());

  // модалка підпису
  const [inlineTarget, setInlineTarget] = useState(null); // { leg, role }
  const padRef = useRef(null);
  const [padEmpty, setPadEmpty] = useState(true);

  /* Esc → закрити модалку */
  useEffect(() => {
    if (!inlineTarget) return;
    const onKey = (e) => {
      if (e.key === "Escape") setInlineTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inlineTarget]);

  /* Клієнти */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/clients`);
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

  /* ==== Fallback: локальне складання черги з /protocols ==== */
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
          clientName: p.clientName, // може бути відсутнє — не критично
          month: p.month,
          index: idx,
          date: e.date,
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

  /* Черга */
  const loadQueue = async () => {
    setLoading(true);
    try {
      // 1) Перший варіант — серверний /sign-queue (якщо є)
      const r = await fetch(
        `${API}/sign-queue?type=${encodeURIComponent(
          type
        )}&month=${month}&strict=1`
      );

      if (r.ok) {
        const data = await r.json().catch(() => ({}));
        const loaded = Array.isArray(data.items) ? data.items : [];
        // НОРМАЛІЗАЦІЯ ↓↓↓
        const normalized = loaded.map(normalizeQueueItem).filter(Boolean);
        setItems(normalized);
        return normalized;
      }

      // 2) Fallback — зібрати зі списку /protocols
      const r2 = await fetch(`${API}/protocols`);
      const all = await r2.json().catch(() => []);
      const local = buildQueueFromProtocols(all, month, type);
      setItems(local);
      return local;
    } catch {
      // 3) Якщо взагалі щось пішло не так — показуємо порожній список
      setItems([]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, month]);

  const openCard = (item, defaultLeg) => {
    setActive(item);
    setActiveLeg(defaultLeg || "transfer");
    setSignDate(todayISO());
    setInlineTarget(null);
    setPadEmpty(true);
    setView("card");
  };
  const backToList = () => {
    setActive(null);
    setInlineTarget(null);
    setView("list");
  };

  const suggestLeg = (entry) => {
    const t = entry?.signatures?.transfer;
    const r = entry?.signatures?.return;
    const tDone = !!(t?.client && t?.staff);
    const rDone = !!(r?.client && r?.staff);
    if (!tDone) return "transfer";
    if (!rDone) return "return";
    return "transfer";
  };

  const saveSignatureSlot = async () => {
    const target = inlineTarget;
    if (!active || !target) return;
    if (padEmpty || padRef.current?.isEmpty?.()) {
      return alert("Brak podpisu.");
    }

    try {
      const dataURL = padRef.current?.toDataURL?.("image/png");
      if (!dataURL) return;

      const { leg, role } = target; // role: 'client'|'staff'
      const body = { leg };
      if (role === "client") body.client = dataURL;
      if (role === "staff") body.staff = dataURL;

      const r = await fetch(
        `${API}/protocols/${encodeURIComponent(active.clientId)}/${
          active.month
        }/${active.index}/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
      if (updated) {
        setActive(updated);
        setActiveLeg(suggestLeg(updated));
      } else {
        backToList();
      }

      setInlineTarget(null);
      setPadEmpty(true);
    } catch (e) {
      alert(e.message || "Nie udało się zapisać podpisu.");
    }
  };

  const removeFromQueue = async () => {
    if (!active) return;
    try {
      await fetch(
        `${API}/protocols/${encodeURIComponent(active.clientId)}/${
          active.month
        }/${active.index}/queue`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: type === "point" ? "point" : "courier",
            pending: false,
          }),
        }
      );
      await loadQueue();
      backToList();
    } catch {
      alert("Nie udało się usunąć з kolejki.");
    }
  };

  const deleteEntry = async () => {
    if (!active) return;
    if (!confirm("Usunąć cały wpis з протокоłu?")) return;
    try {
      await fetch(
        `${API}/protocols/${encodeURIComponent(active.clientId)}/${
          active.month
        }/${active.index}`,
        { method: "DELETE" }
      );
      await loadQueue();
      backToList();
    } catch {
      alert("Nie udało się usunąć wpisu.");
    }
  };

  // Видалення прямо зі списку
  const deleteItemFromList = async (it) => {
    if (!confirm("Usunąć wpis з протокоłu?")) return;
    try {
      await fetch(
        `${API}/protocols/${encodeURIComponent(it.clientId)}/${it.month}/${
          it.index
        }`,
        { method: "DELETE" }
      );
      await loadQueue();
    } catch {
      alert("Nie udało się usunąć wpisu.");
    }
  };

  // Перемикач Kurier/Punkt завжди повертає до списку
  const switchType = (t) => {
    setType(t);
    setView("list");
  };

  /* ===== Zapis/aktualizacja PDF протоколу для клієнта/місяця ===== */
  const saveProtocolFor = async (clientId, monthStr) => {
    const cid = String(clientId || "").trim();
    const ym = normalizeYm(monthStr || month);
    if (!cid || !ym) {
      alert("Brak ID klienta lub nieprawidłowy miesiąc.");
      return;
    }
    try {
      const r = await fetch(
        `${API}/protocols/${encodeURIComponent(cid)}/${ym}`
      );
      const data = await r.json();
      const protocol = {
        id: data.id || cid,
        month: data.month || ym,
        entries: Array.isArray(data.entries) ? data.entries : [],
        totals: data.totals || { totalPackages: 0 },
      };
      if (!protocol.entries.length) {
        return alert("Brak wpisów w tym miesiącu.");
      }

      const clientObj = clientsMap[cid] || {};
      const { doc, fileName } = buildProtocolPdf({
        month: protocol.month,
        client: clientObj,
        protocol,
      });

      // lokalnie:
      doc.save(fileName);

      // і в “Документy → Protokoły”
      const dataUrl = doc.output("datauristring");
      saveProtocolDocMeta({
        id: `${cid}:${protocol.month}`,
        clientId: cid,
        clientName: getClientName(clientObj) || data.clientName || cid || "—",
        month: protocol.month,
        fileName,
        createdAt: new Date().toISOString(),
        dataUrl,
      });
      alert("Zapisano/odświeżono protokół w Dokumenty → Protokoły.");
    } catch {
      alert("Nie udało się zapisać протокоłu.");
    }
  };

  /* ==== Рендери ==== */

  const TopBar = () => (
    <div className="flex flex-wrap items-center gap-3 mb-3">
      <div className="text-lg font-semibold">Protokoły do podpisu</div>
      <div className="flex-1" />
      <input
        type="month"
        className="input w-44"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      />
      <div className="inline-flex rounded-lg overflow-hidden border">
        <button
          className={`px-3 py-1.5 text-sm ${
            type === "courier" ? "bg-blue-600 text-white" : "bg-white"
          }`}
          onClick={() => switchType("courier")}
        >
          Kurier
        </button>
        <button
          className={`px-3 py-1.5 text-sm ${
            type === "point" ? "bg-blue-600 text-white" : "bg-white"
          }`}
          onClick={() => switchType("point")}
        >
          Punkt
        </button>
      </div>
    </div>
  );

  const Badge = ({ children }) => (
    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
      {children}
    </span>
  );

  const ListView = () => (
    <div className="space-y-3">
      <TopBar />
      <div className="card">
        {loading ? (
          <div className="py-8 text-center text-gray-500">Ładowanie…</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            Brak pozycji w kolejce do podpisu.
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((it) => {
              const client = clientsMap[it.clientId] || {};
              const name =
                getClientName(client) || it.clientName || it.clientId;
              const addr = getClientAddress(client) || "—";
              const suggested = suggestLeg(it);
              const legClasses =
                suggested === "transfer"
                  ? "bg-amber-100 text-amber-800 border-amber-200"
                  : "bg-emerald-100 text-emerald-800 border-emerald-200";

              return (
                <li
                  key={`${it.clientId}-${it.index}-${it.month}`}
                  className="py-3 px-2 flex flex-wrap items-center gap-3"
                >
                  <div className="min-w-[16rem]">
                    <div className="text-sm text-gray-500 mb-0.5">
                      {it.date || "—"}
                    </div>
                    <div className="text-2xl font-bold leading-tight">
                      {name}
                    </div>
                    <div className="text-lg text-gray-700">{addr}</div>
                  </div>

                  <div className="ml-auto shrink-0 flex flex-col items-end gap-3">
                    <div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${legClasses}`}
                        title="Rodzaj wpisu"
                      >
                        {legLabelPL(suggested)}
                      </span>
                    </div>
                    <div className="flex gap-2 whitespace-nowrap flex-nowrap">
                      <button
                        className="btn-secondary"
                        onClick={() =>
                          saveProtocolFor(it.clientId, it.month || month)
                        }
                        title="Dodaj/odśwież w protokole (PDF)"
                      >
                        Do protokołu
                      </button>
                      <button
                        className="btn-primary"
                        onClick={() => openCard(it, suggested)}
                        title="Otwórz kartę wpisu"
                      >
                        Otwórz
                      </button>
                      <button
                        className="btn-danger text-white"
                        onClick={() => deleteItemFromList(it)}
                        title="Usuń wpis"
                      >
                        Usuń
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
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

    const sig = active.signatures || {};
    const t = sig.transfer || {};
    const r = sig.return || {};

    const services = active.shipping
      ? ["Wysyłka"]
      : active.delivery === "odbior"
      ? ["Kurier x1"]
      : active.delivery === "odbior+dowoz"
      ? ["Kurier x2"]
      : [];

    const SignatureTile = ({ src, leg, role, onClick }) => {
      const isClient = role === "client";
      const label = `${legLabelPL(leg)} — ` + (isClient ? "Klient" : "Serwis");
      const baseBorderClass = isClient
        ? "border-slate-400"
        : "border-slate-200";
      const baseBgClass = isClient ? "bg-slate-50" : "bg-white";

      return (
        <button
          type="button"
          onClick={onClick}
          title={label}
          className={`relative w-44 ${baseBgClass} ${baseBorderClass} rounded-xl p-2 flex flex-col items-center gap-1 hover:shadow-sm transition text-left`}
        >
          <div className="w-full flex items-center justify-between">
            <div
              className={`text-[11px] ${
                isClient ? "text-slate-900" : "text-slate-600"
              }`}
            >
              {label}
            </div>
            {isClient && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                Klient
              </span>
            )}
          </div>

          {src ? (
            <img
              src={absSig(src)}
              alt={label}
              className="h-9 w-auto object-contain border rounded bg-white px-1"
            />
          ) : (
            <div className="h-9 w-full flex items-center justify-center text-xs text-gray-400">
              brak
            </div>
          )}
        </button>
      );
    };

    return (
      <div className="space-y-3">
        <TopBar />

        {/* Повернення до списку */}
        <button className="btn-link" onClick={backToList}>
          ← Powrót do listy
        </button>

        <div className="card p-0 overflow-hidden">
          {/* Заголовок картки */}
          <div className="bg-slate-50 border-b px-4 py-3">
            <div className="text-xl font-semibold leading-tight">{name}</div>
            <div className="text-sm text-slate-700">{addr}</div>
            <div className="text-sm text-slate-600 mt-0.5">NIP: {nip}</div>
          </div>

          {/* Тіло */}
          <div className="p-4 grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1">
                    Data wykonania usługi
                  </label>
                  <input
                    type="date"
                    className="input w-full"
                    value={signDate}
                    onChange={(e) => setSignDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm mb-1">Usługi dodatkowe</label>
                  {services.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {services.map((s, i) => (
                        <Badge key={i}>{s}</Badge>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">—</div>
                  )}
                </div>
              </div>

              <div>
                <div className="font-medium mb-1">Narzędzia (szt.)</div>
                <div className="rounded-lg border p-3 bg-white">
                  {(active.tools || []).filter((t) => t?.name).length ? (
                    <ul className="list-disc pl-5 space-y-1">
                      {(active.tools || [])
                        .filter((t) => t?.name)
                        .map((t, i) => (
                          <li key={i} className="text-sm">
                            {t.name}: <b>{t.count}</b> szt.
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <div className="text-gray-500 text-sm">—</div>
                  )}
                </div>
              </div>

              {/* Пакети */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-xl font-semibold">Pakiety:</div>
                <span className="inline-flex items-center px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-100 text-emerald-800 text-2xl font-bold leading-none">
                  {active.packages || 0}
                </span>
                {active.comment ? (
                  <div className="text-sm text-gray-700">
                    <span className="text-gray-500">Komentarz:</span>{" "}
                    {active.comment}
                  </div>
                ) : null}
              </div>

              {/* Дії для картки */}
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-secondary"
                  onClick={() =>
                    saveProtocolFor(active.clientId, active.month || month)
                  }
                >
                  Zapisz do protokołu
                </button>
                <button className="btn-secondary" onClick={removeFromQueue}>
                  Usuń z kolejki
                </button>
                <button className="btn-danger text-white" onClick={deleteEntry}>
                  Usuń wpis
                </button>
              </div>
            </div>

            {/* Права частина — підписи */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">Podpisy</div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-700">
                    Rodzaj podpisu:
                  </label>
                  <select
                    className="input w-44"
                    value={legLabelPL(activeLeg)}
                    onChange={(e) =>
                      setActiveLeg(legFromSelect(e.target.value))
                    }
                  >
                    <option>Przekazanie</option>
                    <option>Zwrot</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-600">
                  Klient — podpis tutaj
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SignatureTile
                    src={t.client}
                    leg="transfer"
                    role="client"
                    onClick={() => {
                      setInlineTarget({ leg: "transfer", role: "client" });
                      setPadEmpty(true);
                    }}
                  />
                  <SignatureTile
                    src={r.client}
                    leg="return"
                    role="client"
                    onClick={() => {
                      setInlineTarget({ leg: "return", role: "client" });
                      setPadEmpty(true);
                    }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-600">Serwis</div>
                <div className="grid grid-cols-2 gap-2">
                  <SignatureTile
                    src={t.staff}
                    leg="transfer"
                    role="staff"
                    onClick={() => {
                      setInlineTarget({ leg: "transfer", role: "staff" });
                      setPadEmpty(true);
                    }}
                  />
                  <SignatureTile
                    src={r.staff}
                    leg="return"
                    role="staff"
                    onClick={() => {
                      setInlineTarget({ leg: "return", role: "staff" });
                      setPadEmpty(true);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* МОДАЛКА ПІДПИСУ */}
        {inlineTarget &&
          createPortal(
            <div
              className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
              role="dialog"
              aria-modal="true"
              onClick={() => setInlineTarget(null)}
              style={{ background: "rgba(0,0,0,0.45)" }}
            >
              <div
                className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl p-5"
                style={{ pointerEvents: "auto" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="text-lg font-semibold">
                    {legLabelPL(inlineTarget.leg)} —{" "}
                    {inlineTarget.role === "client" ? "Klient" : "Serwis"}
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

                <div className="inline-block relative">
                  <SignaturePad
                    ref={padRef}
                    onChange={setPadEmpty}
                    width={640}
                    height={220}
                  />
                  <div
                    className="pointer-events-none absolute inset-0 rounded-xl"
                    style={{
                      boxShadow:
                        inlineTarget.leg === activeLeg
                          ? "inset 0 0 0 6px #f59e0b"
                          : "inset 0 0 0 4px #cbd5e1",
                      borderRadius: "0.75rem",
                    }}
                  />
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
