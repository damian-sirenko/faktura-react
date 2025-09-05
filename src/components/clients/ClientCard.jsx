import React, { useEffect, useState } from "react";
import ClientProtocol from "./ClientProtocol";

// dd.MM.yyyy
function fmtPL(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "-";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

// — уніфікація з бекендом: прибираємо діакритики, робимо стабільний slug
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

/* допоміжне: кінець наступного місяця (YYYY-MM-DD) */
function endOfNextMonthISO(from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 2);
  d.setUTCDate(0);
  return d.toISOString().split("T")[0];
}

/* допоміжне: start + 6 місяців − 1 день (YYYY-MM-DD) */
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

export default function ClientCard({
  client,
  onBack,
  onSetNotice,
  onCancelNotice,
  onUpdate,
}) {
  const [tab, setTab] = useState("details");
  if (!client) return null;

  // завантажуємо глобальні дефолти, щоб показати у виборі ("Global: X zł")
  const [defaults, setDefaults] = useState({
    courierPriceGross: 0,
    shippingPriceGross: 0,
    perPiecePriceGross: 6,
    defaultVat: 23,
  });
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/settings");
        if (r.ok) {
          const s = await r.json();
          setDefaults({
            courierPriceGross: Number(s.courierPriceGross ?? 0),
            shippingPriceGross: Number(s.shippingPriceGross ?? 0),
            perPiecePriceGross: Number(s.perPiecePriceGross ?? 6),
            defaultVat: Number(s.defaultVat ?? 23),
          });
        }
      } catch (_) {}
    })();
  }, []);

  const {
    id,
    ID, // з Excel
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

    // ↓↓↓ індивідуальні ціни
    courierPriceMode = "global", // "global" | "custom"
    courierPriceGross = null,
    shippingPriceMode = "global",
    shippingPriceGross = null,

    // ↓↓↓ режим розрахунку
    billingMode, // "abonament" | "perpiece" (може бути не заданий у старих записах)
    comment = "",
  } = client;

  // обчислюємо ефективний режим (на випадок старих даних без billingMode)
  const effectiveBillingMode =
    billingMode ||
    (String(subscription || "").trim() ? "abonament" : "perpiece");

  // апдейтер у батька
  const upd = (patch) => {
    onUpdate && onUpdate({ ...client, ...patch });
  };

  // ID для показу — віддаємо перевагу реальному id, інакше стабільний slug як у бекенді
  const displayId = id || ID || slugFromName(name || "");

  const todayISO = new Date().toISOString().split("T")[0];

  // логіка відображення "Obowiązuje do"
  const isEnded = Boolean(
    String(agreementEnd || "") && String(agreementEnd) < todayISO
  );
  const computedSixMEnd = sixMonthsMinusOneDayISO(agreementStart);

  const isDisabled = Boolean(notice);
  const noticeBtnText = isDisabled
    ? "Zgłoszono wypowiedzenie umowy"
    : "Wypowiedzenie umowy";

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
        {/* (прибрано) <div className="muted">Szczegóły kontrahenta</div> */}
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
          {/* Лева колонка: Dane podstawowe + Коментар */}
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

            {/* Коментар (перенесено сюди, ліміт 3000) */}
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

          {/* Права колонка: Umowa i abonament — ПРИХОВАТИ для klientów 'perpiece' */}
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

                    {/* Якщо дата закінчення ВЖЕ МИНУЛА — показуємо "czas nieokreślony" */}
                    {isEnded ? (
                      <div className="p-2 rounded bg-amber-50 text-amber-800 text-sm">
                        czas nieokreślony
                      </div>
                    ) : notice && agreementEnd ? (
                      // після "Wypowiedzenie umowy" — показуємо НЕредаговане поле з датою кінця наступного місяця
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
                      // інакше (договір ще не закінчився) — показуємо розрахунок start + 6m − 1d
                      <>
                        <input
                          type="date"
                          className="input w-full"
                          value={computedSixMEnd || ""}
                          readOnly
                          aria-readonly="true"
                        />
                        <div className="text-xs text-gray-500 mt-1">
                          {computedSixMEnd ? fmtPL(computedSixMEnd) : "—"}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={onSetNotice}
                    disabled={isDisabled}
                    className="btn-primary whitespace-nowrap min-w-[260px]"
                    title={
                      isDisabled
                        ? "Wypowiedzenie już zgłoszono"
                        : "Ustaw wypowiedzenie na koniec następnego miesiąca"
                    }
                  >
                    {noticeBtnText}
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

          {/* Ceny indywidualne: кур'єр / wysyłka */}
          <div className="card w-full md:col-span-2">
            <div className="font-semibold mb-2">Ceny dostaw (indywidualne)</div>

            {/* Kurier */}
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
                    upd({
                      courierPriceGross: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div className="text-xs text-gray-500 md:justify-self-end">
                1 dojazd = 1 szt. (liczone z protokołu)
              </div>
            </div>

            <div className="my-3 border-t" />

            {/* Wysyłka */}
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
                    upd({
                      shippingPriceGross: Number(e.target.value) || 0,
                    })
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
        <div className="mt-4">
          <ClientProtocol client={client} />
        </div>
      )}
    </div>
  );
}
