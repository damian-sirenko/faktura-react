// src/components/clients/ClientCard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { humanDateTime } from "../../utils/docStore.js";

// ===== helpers =====
function fmtPL(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "-";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}
function stripDiacritics(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function normalizeKey(s) {
  return stripDiacritics(String(s || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function slugFromName(name) {
  return normalizeKey(name).replace(/\s+/g, "-");
}
function sixMonthsMinusOneDayISO(startISO) {
  if (!startISO) return "";
  const d = new Date(startISO);
  if (Number.isNaN(d.getTime())) return "";
  const u = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  u.setUTCMonth(u.getUTCMonth() + 6);
  u.setUTCDate(u.getUTCDate() - 1);
  return u.toISOString().split("T")[0];
}

/* ===== локальний фолбек settings ===== */
const LOCAL_SETTINGS_FALLBACK = {
  perPiecePriceGross: 6,
  defaultVat: 23,
  currentIssueMonth: "2025-08",
  courierPriceGross: 12,
  shippingPriceGross: 22,
};

/* ===== Місяці PL (для назв протоколів) ===== */
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

/* ▼▼▼ ПРАЙС АБОНЕМЕНТІВ — ЯК ПРОСИЛИ ▼▼▼ */
const PRICE_LIST = [
  { name: "STERYL 20", price_gross: 110.0 },
  { name: "STERYL 30", price_gross: 140.0 },
  { name: "STERYL 50", price_gross: 210.0 },
  { name: "STERYL 100", price_gross: 300.0 },
  { name: "STERYL 150", price_gross: 360.0 },
  { name: "STERYL 200", price_gross: 430.0 },
  { name: "STERYL 300", price_gross: 550.0 },
  { name: "STERYL 500", price_gross: 780.0 },
];

// Швидкий доступ: "STERYL 50" -> 210.00
const PRICE_BY_SUBSCRIPTION = PRICE_LIST.reduce((acc, item) => {
  const key = String(item.name || "")
    .toUpperCase()
    .trim();
  if (key) acc[key] = Number(item.price_gross);
  return acc;
}, {});
function getAbonPrice(subName) {
  if (!subName) return null;
  const key = String(subName).toUpperCase().trim();
  return Object.prototype.hasOwnProperty.call(PRICE_BY_SUBSCRIPTION, key)
    ? PRICE_BY_SUBSCRIPTION[key]
    : null;
}
/* ▲▲▲ КІНЕЦЬ БЛОКУ ПРАЙСУ ▲▲▲ */

export default function ClientCard({
  client,
  onBack,
  onSetNotice,
  onCancelNotice,
  onUpdate,
  protocols,
  protocolsLoading,
  protocolsReadOnly,
  protocolsTabLabel,
  onToggleArchive,
  logisticsLabelMap = {},
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const [tab, setTab] = useState("details");

  // ✅ якщо прийшли з посиланням ?tab=protocols — одразу відкриваємо вкладку протоколів
  useEffect(() => {
    const qs = new URLSearchParams(location.search || "");
    if (qs.get("tab") === "protocols") setTab("protocols");
  }, [location.search]);

  if (!client) return null;

  // завантажуємо дефолти з бекенду → /settings.json → локально
  const [defaults, setDefaults] = useState({
    courierPriceGross: 0,
    shippingPriceGross: 0,
    perPiecePriceGross: 6,
    defaultVat: 23,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const apply = (s) => {
        if (cancelled) return;
        setDefaults({
          courierPriceGross: Number(s.courierPriceGross ?? 0),
          shippingPriceGross: Number(s.shippingPriceGross ?? 0),
          perPiecePriceGross: Number(s.perPiecePriceGross ?? 6),
          defaultVat: Number(s.defaultVat ?? 23),
        });
      };
      const tryGet = async (url) => {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      };
      let s = null;
      try {
        s = await tryGet("/settings");
      } catch {}
      if (!s) {
        try {
          s = await tryGet("/settings.json");
        } catch {}
      }
      apply(s || LOCAL_SETTINGS_FALLBACK);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    id,
    ID,
    name = "",
    address = "",
    type = "op",
    nip = "",
    pesel = "",
    email = "",
    phone = "",
    agreementStart = "",
    agreementEnd = "",
    subscription = "",
    subscriptionAmount = 0,
    notice = false,

    courierPriceMode = "global",
    courierPriceGross = null,
    shippingPriceMode = "global",
    shippingPriceGross = null,

    billingMode,
    comment = "",
  } = client;

  const effectiveBillingMode =
    billingMode ||
    (String(subscription || "").trim() ? "abonament" : "perpiece");
  const upd = (patch) => onUpdate && onUpdate({ ...client, ...patch });

  const displayId = id || ID || slugFromName(name || "");
  const todayISO = new Date().toISOString().split("T")[0];

  /* ===== Protokoły: перетворення у метадані як на DocumentsProtocols ===== */
  const protoItems = useMemo(() => {
    const arr = Array.isArray(protocols) ? protocols : [];
    return arr
      .filter(
        (p) =>
          p &&
          p.id &&
          p.month &&
          Array.isArray(p.entries) &&
          p.entries.length > 0
      )
      .map((p) => {
        const maxDate =
          p.entries
            .map((e) => e?.date)
            .filter(
              (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)
            )
            .sort()
            .slice(-1)[0] || `${p.month}-01`;
        const createdAt = new Date(`${maxDate}T00:00:00.000Z`).toISOString();
        return {
          id: `${p.id}:${p.month}`,
          clientId: p.id,
          clientName: client?.name || client?.Klient || p.clientName || p.id,
          month: p.month,
          createdAt,
        };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [protocols, client]);

  // Для вкладки „Protokoły” — тільки рендер, без додавання
  const renderProtocols = () => {
    if (protocolsLoading) {
      return (
        <div className="p-3 rounded-lg border bg-gray-50 text-gray-700 text-sm">
          Ładowanie protokołów…
        </div>
      );
    }
    if (!protoItems.length) {
      return (
        <div className="p-3 rounded-lg border bg-amber-50 text-amber-800 text-sm">
          Brak protokołów dla tego klienta.
        </div>
      );
    }

    return (
      <div className="card p-0 overflow-hidden">
        <div className="px-3 py-2 text-sm text-gray-600 bg-blue-50 border-b">
          Zapisane: {protoItems.length}
        </div>
        <table className="table w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className="w-[6ch] text-center">#</th>
              <th>Nazwa protokołu</th>
              <th className="w-[16ch] text-center">Miesiąc</th>
              <th className="w-[10ch] text-center">Rok</th>
            </tr>
          </thead>
          <tbody>
            {protoItems.map((it, idx) => {
              const { year, monthWord } = monthParts(it.month);
              const title = `Protokół_${monthWord}_${year}_${
                it.clientName || ""
              }`;
              return (
                <tr key={it.id} className="hover:bg-gray-50">
                  <td className="text-center">{idx + 1}</td>
                  <td className="truncate">
                    <button
                      type="button"
                      className="text-blue-700 hover:underline"
                      onClick={() =>
                        navigate(
                          `/documents/protocols/${encodeURIComponent(
                            it.clientId
                          )}/${it.month}`,
                          {
                            state: {
                              backTo: `/clients/${encodeURIComponent(
                                displayId
                              )}?tab=protocols`,
                              backLabel: "← Powrót do protokołów klienta",
                            },
                          }
                        )
                      }
                      title="Otwórz stronę protokołu"
                    >
                      {title}
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
    );
  };

  // 🆕 Авто-синхронізація суми з прайсом, якщо вже обрано абонемент, а суми нема/0
  useEffect(() => {
    if (
      subscription &&
      (!subscriptionAmount || Number(subscriptionAmount) === 0)
    ) {
      const p = getAbonPrice(subscription);
      if (p != null && Number(p) !== Number(subscriptionAmount)) {
        upd({ subscriptionAmount: Number(p) });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription]);

  return (
    <div className="min-w-0">
      <button onClick={onBack} className="btn-link mb-3 whitespace-nowrap">
        ← Wróć do listy
      </button>

      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{name || "Nieznany klient"}</h2>
        <div className="text-sm">
          ID:&nbsp;
          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">
            {displayId || "—"}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 border-b border-gray-200">
        <div className="flex gap-2">
          <button
            className={`px-3 py-2 rounded-t-lg ${
              tab === "details"
                ? "bg-white border border-b-white"
                : "bg-gray-100 border border-transparent"
            }`}
            onClick={() => setTab("details")}
          >
            Szczegóły
          </button>
          <button
            className={`px-3 py-2 rounded-t-lg ${
              tab === "protocols"
                ? "bg-white border border-b-white"
                : "bg-gray-100 border border-transparent"
            }`}
            onClick={() => setTab("protocols")}
          >
            {protocolsTabLabel || "Protokoły"}
          </button>
        </div>
      </div>

      {tab === "details" ? (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          <div className="card w-full">
            <div className="font-semibold mb-2">Dane podstawowe</div>
            <div className="text-sm space-y-1">
              <div>ID: {client.id}</div>
              <div>Nazwa: {client.name}</div>
              <div>Adres: {client.address}</div>
              <div>
                Email:
                {email ? (
                  <span
                    className="text-blue-700 hover:underline cursor-pointer ml-1"
                    title="Kliknij, aby skopiować e-mail"
                    onClick={() => {
                      navigator.clipboard.writeText(email);
                      alert("Skopiowano adres e-mail: " + email);
                    }}
                  >
                    {email}
                  </span>
                ) : (
                  " —"
                )}
              </div>

              <div>
                Telefon:
                {phone ? (
                  <a
                    href={`tel:${phone}`}
                    className="text-blue-700 hover:underline ml-1"
                  >
                    {phone}
                  </a>
                ) : (
                  " —"
                )}
              </div>

              <div>
                {client.type === "firma" ? (
                  <>NIP: {client.nip || "—"}</>
                ) : (
                  <>PESEL: {client.pesel || "—"}</>
                )}
              </div>

              {/* ▼▼▼ Нове поле — Logistyka ▼▼▼ */}
              <div className="mt-1">
                <span className="text-slate-500">Logistyka: </span>
                <span className="inline-block align-middle px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-800">
                  {logisticsLabelMap?.[client?.logistics] ||
                    client?.logistics ||
                    "—"}
                </span>
              </div>
              {/* ▲▲▲ Кінець блоку логістики ▲▲▲ */}
            </div>

            <div className="mt-4">
              <textarea
                className="input w-full min-h-[120px]"
                maxLength={3000}
                value={comment}
                onChange={(e) => upd({ comment: e.target.value })}
                placeholder="Uwagi / notatki o kliencie…"
              />
              <div className="text-xs text-gray-500 mt-1">
                {String(comment).length}/3000
              </div>
            </div>
          </div>

          {effectiveBillingMode !== "perpiece" && (
            <div className="card w-full">
              <div className="font-semibold mb-2">Umowa i abonament</div>
              <div className="text-sm space-y-3">
                <div>
                  <label className="block text-sm mb-1">Nazwa abonamentu</label>
                  {/* 🆕 select із фіксованими значеннями + автопрайс */}
                  <select
                    className="input w-full"
                    value={subscription || ""}
                    onChange={(e) => {
                      const nextSub = e.target.value;
                      const price = getAbonPrice(nextSub);
                      if (price != null) {
                        upd({
                          subscription: nextSub,
                          subscriptionAmount: Number(price),
                        });
                      } else {
                        upd({ subscription: nextSub });
                      }
                    }}
                  >
                    <option value="">— brak (na sztuki) —</option>
                    {PRICE_LIST.map((opt) => (
                      <option key={opt.name} value={opt.name}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm mb-1">
                    Kwota abonamentu (brutto)
                  </label>
                  <input
                    className="input w-full"
                    type="number"
                    min="0"
                    step="0.01"
                    value={Number(subscriptionAmount || 0)}
                    onChange={(e) =>
                      upd({ subscriptionAmount: Number(e.target.value) || 0 })
                    }
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    {subscription
                      ? `Sugerowana cena dla „${subscription}”: ${
                          getAbonPrice(subscription) != null
                            ? getAbonPrice(subscription).toFixed(2) + " zł"
                            : "—"
                        }`
                      : "Wybierz abonament, by podpowiedzieć cenę"}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm mb-1">
                      Data podpisania
                    </label>
                    <input
                      type="date"
                      className="input w-full"
                      value={agreementStart || ""}
                      readOnly
                      aria-readonly="true"
                    />
                    <div className="text-xs text-gray-500 mt-1">
                      {agreementStart ? fmtPL(agreementStart) : "—"}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Obowiązuje do</label>

                    {/* 🆕 Якщо wypowiedzenie — даємо редагувати вручну */}
                    {notice ? (
                      <>
                        <input
                          type="date"
                          className="input w-full"
                          value={agreementEnd || ""}
                          onChange={(e) =>
                            upd({ agreementEnd: e.target.value })
                          }
                        />
                        <div className="text-xs text-gray-500 mt-1">
                          {agreementEnd ? fmtPL(agreementEnd) : "—"}
                        </div>
                      </>
                    ) : String(agreementEnd || "") &&
                      String(agreementEnd) < todayISO ? (
                      <div className="p-2 rounded bg-amber-50 text-amber-800 text-sm">
                        czas nieokreślony
                      </div>
                    ) : (
                      <>
                        <input
                          type="date"
                          className="input w-full"
                          value={sixMonthsMinusOneDayISO(agreementStart) || ""}
                          readOnly
                          aria-readonly="true"
                        />
                        <div className="text-xs text-gray-500 mt-1">
                          {sixMonthsMinusOneDayISO(agreementStart)
                            ? fmtPL(sixMonthsMinusOneDayISO(agreementStart))
                            : "—"}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={onSetNotice}
                    disabled={Boolean(notice)}
                    className="btn-primary whitespace-nowrap min-w-[260px]"
                    title={
                      Boolean(notice)
                        ? "Wypowiedzenie już zgłoszono"
                        : "Ustaw wypowiedzenie na koniec następnego miesiąca"
                    }
                  >
                    {Boolean(notice)
                      ? "Zgłoszono wypowiedzenie umowy"
                      : "Wypowiedzenie umowy"}
                  </button>
                  {notice && (
                    <button
                      type="button"
                      onClick={onCancelNotice}
                      className="btn-secondary px-3 py-1 text-sm whitespace-nowrap"
                      title="Cofnij zgłoszone wypowiedzenie"
                    >
                      Anuluj wypowiedzenie
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="card w-full md:col-span-2">
            <div className="font-semibold mb-2">Ceny dostaw (indywidualne)</div>

            <div className="grid md:grid-cols-[1fr_auto_auto] gap-2 items-end">
              <div>
                <div className="text-sm font-medium mb-1">Dojazd kuriera</div>
                <div className="flex gap-3 items-center">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="courier-mode"
                      checked={courierPriceMode !== "custom"}
                      onChange={() => upd({ courierPriceMode: "global" })}
                    />
                    Globalny{" "}
                    <span className="text-gray-600">
                      ({defaults.courierPriceGross.toFixed(2)} zł)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="courier-mode"
                      checked={courierPriceMode === "custom"}
                      onChange={() => upd({ courierPriceMode: "custom" })}
                    />
                    Indywidualny
                  </label>
                </div>
              </div>
              <div className="md:justify-self-end">
                <label className="block text-sm mb-1">Kwota (brutto)</label>
                <input
                  className="input w-40 text-right"
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={courierPriceMode !== "custom"}
                  value={
                    courierPriceMode === "custom"
                      ? Number(courierPriceGross || 0)
                      : Number(defaults.courierPriceGross || 0)
                  }
                  onChange={(e) =>
                    upd({ courierPriceGross: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="text-xs text-gray-500 md:justify-self-end">
                1 dojazd = 1 szt. (liczone z protokołu)
              </div>
            </div>

            <div className="my-3 border-t" />

            <div className="grid md:grid-cols-[1fr_auto_auto] gap-2 items-end">
              <div>
                <div className="text-sm font-medium mb-1">Wysyłka</div>
                <div className="flex gap-3 items-center">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="shipping-mode"
                      checked={shippingPriceMode !== "custom"}
                      onChange={() => upd({ shippingPriceMode: "global" })}
                    />
                    Globalna{" "}
                    <span className="text-gray-600">
                      ({defaults.shippingPriceGross.toFixed(2)} zł)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="shipping-mode"
                      checked={shippingPriceMode === "custom"}
                      onChange={() => upd({ shippingPriceMode: "custom" })}
                    />
                    Indywidualna
                  </label>
                </div>
              </div>
              <div className="md:justify-self-end">
                <label className="block text-sm mb-1">Kwota (brutto)</label>
                <input
                  className="input w-40 text-right"
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={shippingPriceMode !== "custom"}
                  value={
                    shippingPriceMode === "custom"
                      ? Number(shippingPriceGross || 0)
                      : Number(defaults.shippingPriceGross || 0)
                  }
                  onChange={(e) =>
                    upd({ shippingPriceGross: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="text-xs text-gray-500 md:justify-self-end">
                Zliczane z protokołu (pole „Wysyłka”)
              </div>
            </div>
          </div>
        </div>
      ) : (
        // ✅ Вкладка „Protokoły” — тільки список (read-only)
        <div className="mt-4 card w-full">
          <div className="font-semibold mb-3">
            {protocolsTabLabel || "Protokoły"}
          </div>
          {renderProtocols()}
        </div>
      )}
    </div>
  );
}
