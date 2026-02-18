// src/pages/CounterAdmin.jsx
import React, { useEffect, useState, useMemo } from "react";

// лише відносні шляхи — Vite проксить на бекенд
const api = (p) => `/api${p.startsWith("/") ? p : `/${p}`}`;

const authHeaders = (() => {
  const token =
    localStorage.getItem("authToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("jwt") ||
    sessionStorage.getItem("authToken") ||
    sessionStorage.getItem("token") ||
    "";
  return token ? { Authorization: `Bearer ${token}` } : {};
})();

const commonFetchOpts = { credentials: "include" };

function todayYm() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export default function CounterAdmin() {
  // ---- SETTINGS ----
  const [settings, setSettings] = useState({
    perPiecePriceGross: 6,
    defaultVat: 23,
    currentIssueMonth: todayYm(),
    courierPriceGross: 0,
    shippingPriceGross: 0,
    dueMode: "days", // "days" | "fixed"
    dueDays: 7,
    dueFixedDate: "",
    counters: {}, // ← тут зберігаємо лічильники { "YYYY-MM": nextNumber }
  });
  const [settingsMsg, setSettingsMsg] = useState("");

  // дублікати під існуючу логіку UI
  const [courierEnabled, setCourierEnabled] = useState(false);
  const [courierPriceGross, setCourierPriceGross] = useState(0);
  const [shippingEnabled, setShippingEnabled] = useState(false);
  const [shippingPriceGross, setShippingPriceGross] = useState(0);

  useEffect(() => {
    loadSettings();
  }, []);

  const buildSettingsPayload = (s) => {
    // нормалізуємо і зберігаємо все одним пострілом
    const cPrice = courierEnabled ? Number(courierPriceGross) || 0 : 0;
    const shPrice = shippingEnabled ? Number(shippingPriceGross) || 0 : 0;

    const safeCurrentYm =
      typeof s.currentIssueMonth === "string" &&
      /^\d{4}-(0[1-9]|1[0-2])$/.test(s.currentIssueMonth)
        ? s.currentIssueMonth
        : todayYm();

    return {
      perPiecePriceGross: Number(s.perPiecePriceGross) || 0,
      defaultVat: Number(s.defaultVat) || 0,
      currentIssueMonth: safeCurrentYm,
      courierPriceGross: cPrice,
      shippingPriceGross: shPrice,
      dueMode: s.dueMode === "fixed" ? "fixed" : "days",
      dueDays: Number(s.dueDays) || 0,
      dueFixedDate:
        s.dueMode === "fixed" &&
        typeof s.dueFixedDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(s.dueFixedDate)
          ? s.dueFixedDate
          : "",
      // ВАЖЛИВО: зберігаємо лічильники разом із налаштуваннями
      counters: s.counters && typeof s.counters === "object" ? s.counters : {},
    };
  };

  const loadSettings = async () => {
    try {
      const r = await fetch(api("/settings"), {
        ...commonFetchOpts,
        headers: { ...authHeaders },
        cache: "no-store",
      });
      if (!r.ok) throw new Error("Nie udało się pobrać ustawień");
      const s = await r.json();

      // підняти у стани
      const currYm =
        typeof s.currentIssueMonth === "string" &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(s.currentIssueMonth)
          ? s.currentIssueMonth
          : todayYm();

      const cPrice = Number(s.courierPriceGross ?? 0);
      const shPrice = Number(s.shippingPriceGross ?? 0);

      setSettings({
        perPiecePriceGross: Number(s.perPiecePriceGross ?? 6),
        defaultVat: Number(s.defaultVat ?? 23),
        currentIssueMonth: currYm,
        courierPriceGross: cPrice,
        shippingPriceGross: shPrice,
        dueMode: s.dueMode === "fixed" ? "fixed" : "days",
        dueDays: Number(s.dueDays ?? 7),
        dueFixedDate:
          typeof s.dueFixedDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(s.dueFixedDate)
            ? s.dueFixedDate
            : "",
        counters:
          s.counters && typeof s.counters === "object" ? s.counters : {},
      });

      setCourierEnabled(cPrice > 0);
      setShippingEnabled(shPrice > 0);
      setCourierPriceGross(cPrice);
      setShippingPriceGross(shPrice);
    } catch (e) {
      console.error(e);
      // fallback мінімальний
      setSettings((prev) => ({ ...prev, counters: {} }));
    }
  };

  const saveSettings = async () => {
    setSettingsMsg("");
    try {
      const payload = buildSettingsPayload({
        ...settings,
        courierPriceGross,
        shippingPriceGross,
      });

      const r = await fetch(api("/settings"), {
        method: "POST",
        ...commonFetchOpts,
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });

      const ct = (r.headers.get("content-type") || "").toLowerCase();
      const data = ct.includes("application/json")
        ? await r.json()
        : await r.text();

      if (!r.ok)
        throw new Error(
          typeof data === "string"
            ? data
            : data?.error || "Błąd zapisu ustawień"
        );

      // оновлюємо локальний стан тим, що повернув бек (або payload, якщо бек не віддає echo)
      const s =
        (data && data.settings && typeof data.settings === "object"
          ? data.settings
          : payload) || payload;

      setSettings({
        perPiecePriceGross: Number(
          s.perPiecePriceGross ?? payload.perPiecePriceGross
        ),
        defaultVat: Number(s.defaultVat ?? payload.defaultVat),
        currentIssueMonth: s.currentIssueMonth || payload.currentIssueMonth,
        courierPriceGross: Number(
          s.courierPriceGross ?? payload.courierPriceGross
        ),
        shippingPriceGross: Number(
          s.shippingPriceGross ?? payload.shippingPriceGross
        ),
        dueMode: s.dueMode === "fixed" ? "fixed" : "days",
        dueDays: Number(s.dueDays ?? payload.dueDays),
        dueFixedDate:
          typeof s.dueFixedDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(s.dueFixedDate)
            ? s.dueFixedDate
            : "",
        counters:
          s.counters && typeof s.counters === "object"
            ? s.counters
            : payload.counters,
      });

      setCourierEnabled((s.courierPriceGross ?? payload.courierPriceGross) > 0);
      setShippingEnabled(
        (s.shippingPriceGross ?? payload.shippingPriceGross) > 0
      );

      setSettingsMsg("✅ Zapisano ustawienia");
    } catch (e) {
      setSettingsMsg(`❌ ${e.message}`);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="card-lg border-2 border-blue-200 bg-blue-50/60">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Ustawienia</h1>
            <div className="text-sm text-gray-600">
              Globalne ustawienia rozliczeń i fakturowania
            </div>
          </div>

          <div className="text-sm text-gray-700 flex items-center gap-2">
            {settingsMsg && (
              <span
                className={
                  settingsMsg.startsWith("✅")
                    ? "text-green-700 bg-green-100 px-2 py-0.5 rounded"
                    : "text-amber-700 bg-amber-100 px-2 py-0.5 rounded"
                }
              >
                {settingsMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="card-lg space-y-3">
        <div className="font-semibold">Ustawienia globalne</div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">
              Aktualny miesiąc rozliczeń (YYYY-MM)
            </label>
            <input
              className="input w-full"
              type="month"
              value={settings.currentIssueMonth}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  currentIssueMonth: e.target.value,
                }))
              }
            />
          </div>

          <div>
            <label className="block text-sm mb-1">
              Cena 1 pakietu (per piece) — brutto
            </label>
            <input
              className="input w-full"
              type="number"
              min="0"
              step="0.01"
              value={settings.perPiecePriceGross}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  perPiecePriceGross: Number(e.target.value) || 0,
                }))
              }
            />
          </div>

          <div>
            <label className="block text-sm mb-1">VAT % (globalnie)</label>
            <input
              className="input w-full"
              type="number"
              min="0"
              step="1"
              value={settings.defaultVat}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  defaultVat: Number(e.target.value) || 0,
                }))
              }
            />
          </div>
        </div>

        <div className="mt-2 space-y-2">
          <div className="font-medium text-sm">Termin zapłaty</div>

          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="dueMode"
              checked={settings.dueMode === "days"}
              onChange={() => setSettings((s) => ({ ...s, dueMode: "days" }))}
            />
            <span className="select-none">Liczba dni od daty wystawienia</span>
          </label>
          {settings.dueMode === "days" && (
            <div className="pl-6">
              <input
                type="number"
                min="0"
                className="input w-40"
                value={settings.dueDays}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    dueDays: Number(e.target.value) || 0,
                  }))
                }
              />
              <span className="ml-2 text-sm text-gray-600">dni</span>
            </div>
          )}

          <label className="flex items-center gap-2 mt-2">
            <input
              type="radio"
              name="dueMode"
              checked={settings.dueMode === "fixed"}
              onChange={() => setSettings((s) => ({ ...s, dueMode: "fixed" }))}
            />
            <span className="select-none">Konkretny dzień (YYYY-MM-DD)</span>
          </label>
          {settings.dueMode === "fixed" && (
            <div className="pl-6">
              <input
                type="date"
                className="input w-56"
                value={settings.dueFixedDate || ""}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, dueFixedDate: e.target.value }))
                }
              />
            </div>
          )}
        </div>

        <div className="mt-2 space-y-3">
          <div className="grid md:grid-cols-[auto,1fr] gap-3 items-end">
            <label className="flex items-center gap-2 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={courierEnabled}
                onChange={(e) => setCourierEnabled(e.target.checked)}
              />
              <span>Włącz koszt dojazdu kuriera</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input w-full"
              value={courierPriceGross}
              onChange={(e) => setCourierPriceGross(e.target.value)}
              placeholder="np. 10.00"
              disabled={!courierEnabled}
            />
          </div>

          <div className="grid md:grid-cols-[auto,1fr] gap-3 items-end">
            <label className="flex items-center gap-2 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={shippingEnabled}
                onChange={(e) => setShippingEnabled(e.target.checked)}
              />
              <span>Włącz koszt wysyłki</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input w-full"
              value={shippingPriceGross}
              onChange={(e) => setShippingPriceGross(e.target.value)}
              placeholder="np. 12.00"
              disabled={!shippingEnabled}
            />
          </div>
        </div>

        <div className="pt-1">
          <button className="btn-primary" onClick={saveSettings}>
            Zapisz ustawienia
          </button>
          {settingsMsg && <div className="text-sm mt-2">{settingsMsg}</div>}
        </div>
      </div>
    </div>
  );
}
