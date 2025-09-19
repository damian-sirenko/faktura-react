// src/components/clients/ClientCard.jsx
import React, { useEffect, useState } from "react";
import ClientProtocol from "./ClientProtocol";

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
function endOfNextMonthISO(from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 2);
  d.setUTCDate(0);
  return d.toISOString().split("T")[0];
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

export default function ClientCard({
  client,
  onBack,
  onSetNotice,
  onCancelNotice,
  onUpdate,
}) {
  const [tab, setTab] = useState("details");
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

  const isEnded = Boolean(
    String(agreementEnd || "") && String(agreementEnd) < todayISO
  );
  const computedSixMEnd = sixMonthsMinusOneDayISO(agreementStart);

  const isDisabled = Boolean(notice);
  const noticeBtnText = isDisabled
    ? "Zgłoszono wypowiedzenie umowy"
    : "Wypowiedzenie umowy";

  /* ✅ БЕЗПЕЧНІ ДАНІ ДЛЯ вкладки “Protokół” */
  const safeClientId = String(displayId || "").trim(); // "" якщо немає
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

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
              tab === "protocol"
                ? "bg-white border border-b-white"
                : "bg-gray-100 border border-transparent"
            }`}
            onClick={() => setTab("protocol")}
          >
            Protokół
          </button>
        </div>
      </div>

      {tab === "details" ? (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
          <div className="card w-full">
            <div className="font-semibold mb-2">Dane podstawowe</div>
            <div className="text-sm space-y-1">
              <p>
                <span className="font-medium">Adres:</span> {address || "-"}
              </p>
              <p>
                <span className="font-medium">Typ:</span>{" "}
                {type === "firma" ? "Firma" : "Osoba prywatna"}
              </p>
              {type === "firma" && nip && (
                <p>
                  <span className="font-medium">NIP:</span> {nip}
                </p>
              )}
              {type === "op" && pesel && (
                <p>
                  <span className="font-medium">PESEL:</span> {pesel}
                </p>
              )}
              <p>
                <span className="font-medium">Email:</span>{" "}
                {email ? (
                  <a href={`mailto:${email}`} className="btn-link">
                    {email}
                  </a>
                ) : (
                  "-"
                )}
              </p>
              <p>
                <span className="font-medium">Telefon:</span>{" "}
                {phone ? (
                  <a href={`tel:${phone}`} className="btn-link">
                    {phone}
                  </a>
                ) : (
                  "-"
                )}
              </p>
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
                  <input
                    className="input w-full"
                    value={subscription || ""}
                    onChange={(e) => upd({ subscription: e.target.value })}
                    placeholder="np. Steryl 50 / Plan A…"
                  />
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
                    {Boolean(
                      String(agreementEnd || "") &&
                        String(agreementEnd) < todayISO
                    ) ? (
                      <div className="p-2 rounded bg-amber-50 text-amber-800 text-sm">
                        czas nieokreślony
                      </div>
                    ) : notice && agreementEnd ? (
                      <>
                        <input
                          type="date"
                          className="input w-full"
                          value={agreementEnd}
                          readOnly
                          aria-readonly="true"
                        />
                        <div className="text-xs text-gray-500 mt-1">
                          {fmtPL(agreementEnd)}
                        </div>
                      </>
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
        // ✅ Рендеримо вкладку "Protokół" ТІЛЬКИ якщо є валідний clientId.
        <div className="mt-4">
          {safeClientId ? (
            <ClientProtocol
              client={client}
              clientId={safeClientId}
              currentMonth={currentMonth}
            />
          ) : (
            <div className="p-3 rounded-lg border bg-amber-50 text-amber-800 text-sm">
              Brak identyfikatora klienta — nie można załadować protokołu.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
