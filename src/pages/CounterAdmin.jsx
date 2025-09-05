// src/pages/CounterAdmin.jsx
import React, { useEffect, useState, useMemo } from "react";

function prevMonthOfToday() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export default function CounterAdmin() {
  // ---- SETTINGS ----
  const [settings, setSettings] = useState({
    perPiecePriceGross: 6,
    defaultVat: 23,
    currentIssueMonth: new Date().toISOString().slice(0, 7),
    courierPriceGross: 0,
    shippingPriceGross: 0,
  });
  const [settingsMsg, setSettingsMsg] = useState("");

  // ---- COUNTERS ----
  const [counters, setCounters] = useState({});
  const [year, setYear] = useState(prevMonthOfToday().year);
  const [month, setMonth] = useState(prevMonthOfToday().month);
  const [seed, setSeed] = useState(1);
  const [msg, setMsg] = useState("");

  // ceny / przełączniki (залишаю, як у тебе було — НЕ видаляю)
  const [perPiecePriceGross, setPerPiecePriceGross] = useState(6);
  const [defaultVat, setDefaultVat] = useState(23);
  const [currentIssueMonth, setCurrentIssueMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );

  const [courierEnabled, setCourierEnabled] = useState(false);
  const [courierPriceGross, setCourierPriceGross] = useState(0);

  const [shippingEnabled, setShippingEnabled] = useState(false);
  const [shippingPriceGross, setShippingPriceGross] = useState(0);

  const [saving, setSaving] = useState(false); // не видаляю

  // ---- PER-CLIENT OVERRIDES (indywidualne ceny kuriera) ----
  const [clients, setClients] = useState([]);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientCourierEnabled, setClientCourierEnabled] = useState(false);
  const [clientCourierPrice, setClientCourierPrice] = useState("");

  // load both on mount
  useEffect(() => {
    loadCounters();
    loadSettings();
    loadClients();
  }, []);

  const loadCounters = async () => {
    try {
      const res = await fetch("/upload/counters");
      setCounters(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const loadSettings = async () => {
    try {
      const r = await fetch("/settings");
      if (!r.ok) throw new Error("Nie udało się pobrać ustawień");
      const s = await r.json();
      // оновлюємо головний об'єкт
      setSettings({
        perPiecePriceGross: Number(s.perPiecePriceGross ?? 6),
        defaultVat: Number(s.defaultVat ?? 23),
        currentIssueMonth:
          typeof s.currentIssueMonth === "string" &&
          /^\d{4}-\d{2}$/.test(s.currentIssueMonth)
            ? s.currentIssueMonth
            : new Date().toISOString().slice(0, 7),
        courierPriceGross: Number(s.courierPriceGross ?? 0),
        shippingPriceGross: Number(s.shippingPriceGross ?? 0),
      });

      // синхронізуємо дублікати станів (як ти вже мав)
      setPerPiecePriceGross(Number(s.perPiecePriceGross ?? 6));
      setDefaultVat(Number(s.defaultVat ?? 23));
      setCurrentIssueMonth(
        typeof s.currentIssueMonth === "string" &&
          /^\d{4}-\d{2}$/.test(s.currentIssueMonth)
          ? s.currentIssueMonth
          : new Date().toISOString().slice(0, 7)
      );

      const cPrice = Number(s.courierPriceGross ?? 0);
      const shPrice = Number(s.shippingPriceGross ?? 0);
      setCourierPriceGross(cPrice);
      setShippingPriceGross(shPrice);
      setCourierEnabled(cPrice > 0);
      setShippingEnabled(shPrice > 0);
    } catch (e) {
      console.error(e);
    }
  };

  const loadClients = async () => {
    try {
      const r = await fetch("/clients");
      const data = await r.json();
      setClients(Array.isArray(data) ? data : []);
    } catch (e) {
      // нічого
    }
  };

  const saveSettings = async () => {
    setSettingsMsg("");
    try {
      // формуємо тіло з урахуванням чекбоксів
      const payload = {
        ...settings,
        // якщо вимкнено — записуємо 0, щоб генератор НЕ додавав позицію
        courierPriceGross: courierEnabled ? Number(courierPriceGross) || 0 : 0,
        shippingPriceGross: shippingEnabled
          ? Number(shippingPriceGross) || 0
          : 0,
        perPiecePriceGross: Number(settings.perPiecePriceGross) || 0,
        defaultVat: Number(settings.defaultVat) || 0,
        currentIssueMonth:
          typeof settings.currentIssueMonth === "string" &&
          /^\d{4}-\d{2}$/.test(settings.currentIssueMonth)
            ? settings.currentIssueMonth
            : new Date().toISOString().slice(0, 7),
      };

      const r = await fetch("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Błąd zapisu ustawień");
      setSettingsMsg("✅ Zapisano ustawienia");

      // оновимо локальні стани з відповіді (щоб точно збігались)
      if (data?.settings) {
        const s = data.settings;
        const cPrice = Number(s.courierPriceGross ?? 0);
        const shPrice = Number(s.shippingPriceGross ?? 0);

        setSettings((prev) => ({
          ...prev,
          perPiecePriceGross: Number(s.perPiecePriceGross ?? 0),
          defaultVat: Number(s.defaultVat ?? 0),
          currentIssueMonth:
            typeof s.currentIssueMonth === "string"
              ? s.currentIssueMonth
              : prev.currentIssueMonth,
          courierPriceGross: cPrice,
          shippingPriceGross: shPrice,
        }));

        // 🔄 одразу синхронізуємо тумблери, щоб UI не «відставав»
        setCourierEnabled(cPrice > 0);
        setShippingEnabled(shPrice > 0);
      }
    } catch (e) {
      setSettingsMsg(`❌ ${e.message}`);
    }
  };

  const initCounter = async () => {
    setMsg("");
    try {
      const y = Number(year) || new Date().getFullYear();
      let m = Number(month) || new Date().getMonth() + 1;
      m = Math.min(12, Math.max(1, m));

      const res = await fetch("/upload/counters/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: y,
          month: m,
          seed: Number(seed) || 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Błąd");
      setMsg(`OK: ${data.counter.key} = ${data.counter.value}`);
      await loadCounters();
    } catch (e) {
      setMsg(`Błąd: ${e.message}`);
    }
  };

  // ---- helpers for per-client override ----
  const clientNames = useMemo(
    () =>
      Array.from(
        new Set(
          clients.map((c) => (c.name || c.Klient || "").trim()).filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, "pl")),
    [clients]
  );

  const findClientByName = (name) =>
    clients.find(
      (c) => (c.name || c.Klient || "").trim() === String(name || "").trim()
    ) || null;

  const onPickClient = (name) => {
    setClientSearch(name);
    const c = findClientByName(name);
    setSelectedClient(c || null);
    if (c) {
      const v = Number(c.courierPriceGross ?? 0);
      setClientCourierPrice(v ? String(v) : "");
      setClientCourierEnabled(v > 0);
    } else {
      setClientCourierPrice("");
      setClientCourierEnabled(false);
    }
  };

  const saveClientOverride = async () => {
    if (!selectedClient) {
      alert("Wybierz klienta.");
      return;
    }
    const list = [...clients];
    const idx = list.indexOf(selectedClient);
    if (idx === -1) {
      alert("Nie znaleziono klienta na liście.");
      return;
    }
    const price = clientCourierEnabled ? Number(clientCourierPrice) || 0 : 0;

    const updatedClient = {
      ...list[idx],
      // записуємо у запис клієнта (поля NIE usuwam)
      courierPriceGross: price,
    };
    list[idx] = updatedClient;

    try {
      let r = await fetch("/save-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(list),
      });
      if (!r.ok) throw new Error("Nie udało się zapisać klienta");
      setClients(list);
      setSelectedClient(updatedClient);
      alert("✅ Zapisano cenę indywidualną kuriera dla klienta.");
    } catch (e) {
      alert(`❌ ${e.message}`);
    }
  };

  // відсортований список лічильників для охайного відображення
  const sortedCounters = useMemo(
    () =>
      Object.entries(counters).sort(([a], [b]) =>
        String(a).localeCompare(String(b))
      ),
    [counters]
  );

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">⚙️ Ustawienia i licznik</h1>

      {/* SETTINGS CARD */}
      <div className="card-lg space-y-3">
        <div className="font-semibold">Ustawienia globalne</div>

        <div className="grid md:grid-cols-2 gap-3">
          {/* Miesiąc */}
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

          {/* Per piece */}
          <div>
            <label className="block text-sm mb-1">
              Cena 1 pakietu (per&nbsp;piece) — brutto
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

          {/* VAT */}
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

        {/* Kurier / Wysyłka */}
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

      {/* (СЕКЦІЮ "INDYWIDUALNE CENY KURIERA" ВИДАЛЕНО ЗА ПРОХАННЯМ) */}

      {/* COUNTER CARD (jak było) */}
      <div className="card-lg space-y-3">
        <div className="font-semibold">Licznik faktur</div>
        <div className="flex gap-2 items-end flex-wrap">
          <div>
            <label className="block text-sm">Rok</label>
            <input
              type="number"
              value={year}
              onChange={(e) =>
                setYear(Number(e.target.value) || new Date().getFullYear())
              }
              className="input w-32"
            />
          </div>
          <div>
            <label className="block text-sm">Miesiąc (1–12)</label>
            <input
              type="number"
              min="1"
              max="12"
              value={month}
              onChange={(e) => {
                const raw = Number(e.target.value);
                const safe = Math.min(12, Math.max(1, raw || 1));
                setMonth(safe);
              }}
              className="input w-32"
            />
          </div>
          <div>
            <label className="block text-sm">Start (seed)</label>
            <input
              type="number"
              min="1"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 1)}
              className="input w-32"
            />
          </div>
          <button onClick={initCounter} className="btn-primary">
            Zapisz licznik
          </button>
        </div>

        {msg && <div className="text-sm">{msg}</div>}

        <div>
          <h2 className="font-semibold mb-1">Istniejące liczniki</h2>
          {Object.keys(counters).length === 0 ? (
            <div className="text-gray-600 text-sm">Brak</div>
          ) : (
            <table className="text-sm border w-full">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border px-2 py-1">Miesiąc</th>
                  <th className="border px-2 py-1">Następny numer</th>
                </tr>
              </thead>
              <tbody>
                {sortedCounters.map(([k, v]) => (
                  <tr key={k}>
                    <td className="border px-2 py-1">{k}</td>
                    <td className="border px-2 py-1">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
