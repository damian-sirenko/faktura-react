// src/pages/ClientsPage.jsx
import React, { useState, useEffect, useMemo } from "react";
import ClientList from "../components/clients/ClientList";
import ClientCard from "../components/clients/ClientCard";
import * as XLSX from "xlsx";
import Modal from "../components/ui/Modal";

// --- helpers ---
function addMonths(dateStr, monthsToAdd) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + monthsToAdd);
  return d.toISOString().split("T")[0];
}
function normalizeExcelDate(val) {
  if (!val && val !== 0) return "";
  if (typeof val === "number") {
    try {
      if (XLSX?.SSF?.parse_date_code) {
        const p = XLSX.SSF.parse_date_code(val);
        if (p && p.y && p.m && p.d) {
          const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
          if (!Number.isNaN(dt.getTime()))
            return dt.toISOString().split("T")[0];
        }
      }
    } catch {}
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().split("T")[0];
  }
  const s = String(val).trim();
  if (!s) return "";
  const asDate = new Date(s);
  if (!Number.isNaN(asDate.getTime()))
    return asDate.toISOString().split("T")[0];
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = parseInt(m[3], 10);
    const dt = new Date(Date.UTC(year, month, day));
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().split("T")[0];
  }
  return "";
}
function endOfNextMonthISO(from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 2);
  d.setUTCDate(0);
  return d.toISOString().split("T")[0];
}
function pick(row, keys) {
  for (const k of keys) {
    if (row?.[k] != null && String(row[k]).trim() !== "") return row[k];
  }
  const map = {};
  Object.keys(row || {}).forEach((k) => {
    map[k.trim().toLowerCase()] = row[k];
  });
  for (const k of keys) {
    const v = map[k.trim().toLowerCase()];
    if (v != null && String(v).trim() !== "") return v;
  }
  return "";
}
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ===== helper для завантаження ZIP з POST ===== */
async function postForDownload(url, payload, fallbackName = "faktury.zip") {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const ct = (r.headers.get("content-type") || "").toLowerCase();
  const disp = r.headers.get("content-disposition") || "";

  if (!r.ok) {
    let msg = "Błąd generowania";
    try {
      msg = ct.includes("application/json")
        ? (await r.json())?.error || msg
        : await r.text();
    } catch {}
    throw new Error(msg);
  }

  const looksLikeFile =
    ct.includes("application/zip") ||
    ct.includes("application/octet-stream") ||
    ct.includes("binary") ||
    /attachment/i.test(disp);

  if (looksLikeFile) {
    const blob = await r.blob();
    const urlObj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = urlObj;
    const m = /filename="([^"]+)"/i.exec(disp);
    a.download = m ? m[1] : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(urlObj);
    return true;
  }

  const data = await r.json().catch(() => null);
  if (data?.error) throw new Error(data.error);
  return data;
}

// допоміжно: стабільне визначення ідентифікатора
const getId = (c) =>
  String(
    c?.id ??
      c?.ID ??
      c?.Id ??
      c?.iD ??
      c?.["Id"] ??
      c?.["ID "] ??
      c?.[" id"] ??
      ""
  ).trim();

const sameClient = (a, b) => {
  if (a === b) return true;
  const ida = getId(a);
  const idb = getId(b);
  return ida && idb && ida === idb;
};

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [scrollYBeforeOpen, setScrollYBeforeOpen] = useState(0);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState(null);

  const [q, setQ] = useState("");
  const [tab, setTab] = useState("abonament"); // 'abonament' | 'perpiece'
  const [abonFilter, setAbonFilter] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [editIndex, setEditIndex] = useState(null);

  const [addedInfo, setAddedInfo] = useState({ open: false, name: "" });

  // ▼ мультивибір для генерації з бази
  const [checkedIds, setCheckedIds] = useState([]);

  // ▼ налаштування (щоб підставити місяць у модалці генерації)
  const [settings, setSettings] = useState({
    currentIssueMonth: new Date().toISOString().slice(0, 7),
  });

  const [genModal, setGenModal] = useState({
    open: false,
    issueDate: todayISO(),
    month: new Date().toISOString().slice(0, 7),
  });

  const emptyClient = {
    id: "",
    name: "",
    address: "",
    type: "op",
    nip: "",
    pesel: "",
    email: "",
    phone: "",
    agreementStart: "",
    agreementEnd: "",
    subscription: "",
    subscriptionAmount: "",
    notice: false,
    comment: "",
    billingMode: "abonament",
    // індивідуальні ціни (за замовчуванням глобальні)
    courierPriceMode: "global",
    courierPriceGross: null,
    shippingPriceMode: "global",
    shippingPriceGross: null,
  };
  const [formClient, setFormClient] = useState(emptyClient);

  // load settings
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/settings");
        if (r.ok) {
          const s = await r.json();
          setSettings((prev) => ({
            ...prev,
            currentIssueMonth:
              typeof s.currentIssueMonth === "string" &&
              /^\d{4}-\d{2}$/.test(s.currentIssueMonth)
                ? s.currentIssueMonth
                : prev.currentIssueMonth,
          }));
          // якщо модалка ще не відкрита — синхронізуємо дефолт
          setGenModal((g) =>
            g.open ? g : { ...g, month: s.currentIssueMonth || g.month }
          );
        }
      } catch {}
    })();
  }, []);

  // load clients
  useEffect(() => {
    fetch("/clients")
      .then((res) => res.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        const normalized = arr.map((r) => {
          const startISO = normalizeExcelDate(
            r.agreementStart ??
              r["Data podpisania umowy"] ??
              r.agreementSign ??
              ""
          );
          const idRaw =
            r.id ??
            r.ID ??
            r.Id ??
            r.iD ??
            r["Id"] ??
            r["ID "] ??
            r[" id"] ??
            "";
          const idFinal =
            String(idRaw || "").trim() ||
            String(r.Klient || r["Klient"] || "").trim();

          const hasAbon = !!String(
            r.subscription ?? r.Abonament ?? r.abonament ?? ""
          ).trim();
          const billingMode =
            r.billingMode || (hasAbon ? "abonament" : "perpiece");

          // ⚠️ ВАЖЛИВО: не губимо індивідуальні ціни клієнта
          const courierPriceMode =
            r.courierPriceMode === "custom" ? "custom" : "global";
          const shippingPriceMode =
            r.shippingPriceMode === "custom" ? "custom" : "global";

          const courierPriceGross =
            r.courierPriceGross != null
              ? Number(r.courierPriceGross)
              : r["courierPriceGross"] != null
              ? Number(r["courierPriceGross"])
              : null;

          const shippingPriceGross =
            r.shippingPriceGross != null
              ? Number(r.shippingPriceGross)
              : r["shippingPriceGross"] != null
              ? Number(r["shippingPriceGross"])
              : null;

          return {
            id: idFinal,
            name: r.name || r.Klient || "",
            address: r.address || r.Adres || "",
            type:
              (r.type || r["Firma - OP"] || "op").toLowerCase() === "firma"
                ? "firma"
                : "op",
            nip: r.nip || r.NIP || "",
            pesel: r.pesel || r.Pesel || "",
            email: r.email ?? r.Email ?? "",
            phone: r.phone ?? r.Telefon ?? "",
            agreementStart: startISO,
            agreementEnd: startISO ? addMonths(startISO, 6) : "",
            subscription: r.subscription ?? r.Abonament ?? r.abonament ?? "",
            subscriptionAmount: Number(
              r.subscriptionAmount ??
                r["Kwota abonamentu"] ??
                r.abonamentAmount ??
                0
            ),
            notice: Boolean(r.notice),
            comment: r.comment ?? "",
            billingMode,
            courierPriceMode,
            courierPriceGross,
            shippingPriceMode,
            shippingPriceGross,
          };
        });
        setClients(normalized);
      })
      .catch(() => {});
  }, []);

  // імпорт Excel для активної вкладки
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet);

        const mapped = rows
          .filter(
            (r) =>
              pick(r, ["Klient", "client", "nazwa"]) ||
              pick(r, ["ID", "Id", "id"])
          )
          .map((r) => {
            const idFromId = pick(r, ["ID", "Id", "id", "ID ", " id"]);
            const idFromClient = pick(r, ["Klient", "client", "nazwa"]);
            const id = String(idFromId || idFromClient || "").trim();
            const name = String(
              pick(r, ["Klient", "client", "nazwa"]) || ""
            ).trim();
            const startISO = normalizeExcelDate(
              pick(r, ["Data podpisania umowy", "agreementStart", "start"])
            );
            return {
              id,
              name,
              address: pick(r, ["Adres", "address", "adres"]),
              type:
                String(pick(r, ["Firma - OP", "type"]) || "")
                  .toLowerCase()
                  .trim() === "firma"
                  ? "firma"
                  : "op",
              nip: pick(r, ["NIP", "nip"]),
              pesel: pick(r, ["Pesel", "PESEL", "pesel"]),
              email: pick(r, ["Email", "email"]),
              phone: pick(r, ["Telefon", "phone", "telefon"]),
              agreementStart: startISO,
              agreementEnd: startISO ? addMonths(startISO, 6) : "",
              subscription: pick(r, ["Abonament", "subscription", "abonament"]),
              subscriptionAmount: Number(
                pick(r, ["Kwota abonamentu", "subscriptionAmount"]) || 0
              ),
              notice: false,
              comment: "",
              billingMode: tab,
              // нові поля залишаємо за замовчуванням (global)
              courierPriceMode: "global",
              courierPriceGross: null,
              shippingPriceMode: "global",
              shippingPriceGross: null,
            };
          });

        const next = [...clients, ...mapped];
        setClients(next);
        fetch("/save-clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        }).catch(() => {});
      } catch {}
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  // додати/редагувати
  const startAdd = () => {
    if (showAdd) {
      setShowAdd(false);
      setEditIndex(null);
      setFormClient({ ...emptyClient, billingMode: tab });
      return;
    }
    setEditIndex(null);
    setFormClient({ ...emptyClient, billingMode: tab });
    setShowAdd(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const startEdit = (client) => {
    const idxByRef = clients.findIndex((c) => c === client);
    let idx = idxByRef;
    if (idx === -1) {
      const id = getId(client);
      idx = clients.findIndex((c) => getId(c) === id);
    }
    setEditIndex(idx === -1 ? null : idx);
    setFormClient({ ...client, billingMode: client.billingMode || tab });
    setShowAdd(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = { ...formClient };
    const startISO = normalizeExcelDate(payload.agreementStart);
    payload.agreementStart = startISO;
    payload.agreementEnd = startISO ? addMonths(startISO, 6) : "";
    payload.subscriptionAmount = Number(payload.subscriptionAmount || 0);
    if (!payload.billingMode) payload.billingMode = tab;

    let updated = [...clients];
    if (editIndex !== null && editIndex >= 0) updated[editIndex] = payload;
    else updated.push(payload);

    setClients(updated);
    setShowAdd(false);
    setEditIndex(null);
    setFormClient({ ...emptyClient, billingMode: tab });

    try {
      await fetch("/save-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (editIndex === null)
        setAddedInfo({ open: true, name: payload.name || "" });
    } catch {
      alert("Nie udało się zapisać zmian.");
    }
  };

  const handleSetNotice = async (client) => {
    let idx = clients.findIndex((c) => sameClient(c, client));
    if (idx === -1) return;
    const updated = [...clients];
    const newClient = {
      ...updated[idx],
      agreementEnd: endOfNextMonthISO(new Date()),
      notice: true,
    };
    updated[idx] = newClient;
    setClients(updated);
    setSelectedClient(newClient);
    try {
      await fetch("/save-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch {
      alert("Nie udało się zapisać zmian.");
    }
  };

  const handleCancelNotice = async (client) => {
    let idx = clients.findIndex((c) => sameClient(c, client));
    if (idx === -1) return;
    const updated = [...clients];
    const startISO = updated[idx].agreementStart || "";
    const backToEnd = startISO ? addMonths(startISO, 6) : "";
    const newClient = {
      ...updated[idx],
      notice: false,
      agreementEnd: backToEnd,
    };
    updated[idx] = newClient;
    setClients(updated);
    setSelectedClient(newClient);
    try {
      await fetch("/save-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch {}
  };

  const handleUpdateClient = async (nextClient) => {
    let idx = clients.findIndex((c) => sameClient(c, selectedClient));
    if (idx === -1) {
      // остання спроба — по id з nextClient
      const nid = getId(nextClient);
      idx = clients.findIndex((c) => getId(c) === nid);
    }
    if (idx === -1) return;
    const updated = [...clients];
    updated[idx] = nextClient;
    setClients(updated);
    setSelectedClient(nextClient);
    try {
      await fetch("/save-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch {}
  };

  // ► фільтрація / вкладки
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const byTab = clients.filter((c) => (c.billingMode || "abonament") === tab);
    const byAbon =
      tab === "abonament"
        ? byTab.filter((c) =>
            abonFilter.trim()
              ? String(c.subscription || "")
                  .toLowerCase()
                  .includes(abonFilter.trim().toLowerCase())
              : true
          )
        : byTab;
    if (!s) return byAbon;
    return byAbon.filter((c) => (c.name || "").toLowerCase().includes(s));
  }, [q, clients, tab, abonFilter]);

  // ► видалення (один)
  const askDelete = (client) => {
    setClientToDelete(client);
    setConfirmOpen(true);
  };
  const confirmDelete = async () => {
    if (!clientToDelete) return;
    const delId = getId(clientToDelete);
    const updated = clients.filter((c) => getId(c) !== delId);
    setClients(updated);
    setConfirmOpen(false);
    setClientToDelete(null);
    try {
      await fetch("/save-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch {
      alert("Nie udało się zapisać zmian.");
    }
  };

  // ► перемикач вкладок
  const switchTab = (t) => {
    setTab(t);
    setSelectedClient(null);
    setShowAdd(false);
    setEditIndex(null);
    setCheckedIds([]);
  };

  // ► мультивибір
  const onToggleCheck = (id, checked) => {
    setCheckedIds((prev) =>
      checked
        ? Array.from(new Set([...prev, id]))
        : prev.filter((x) => x !== id)
    );
  };
  const onToggleCheckAll = (idsOnPage, checked) => {
    setCheckedIds((prev) => {
      if (checked) return Array.from(new Set([...prev, ...idsOnPage]));
      return prev.filter((id) => !idsOnPage.includes(id));
    });
  };

  // ► групове видалення (НОВЕ)
  const bulkDelete = async () => {
    if (!checkedIds.length) {
      alert("Zaznacz klientów do usunięcia.");
      return;
    }
    if (!confirm("Usunąć zaznaczonych klientów?")) return;
    const updated = clients.filter((c) => !checkedIds.includes(getId(c)));
    setClients(updated);
    setCheckedIds([]);
    try {
      await fetch("/save-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      alert("✅ Usunięto zaznaczonych klientów.");
    } catch {
      alert("❌ Nie udało się zapisać zmian.");
    }
  };

  // ► генерація з бази
  const openGen = () => {
    if (!checkedIds.length) {
      alert("Zaznacz klientów.");
      return;
    }
    setGenModal({
      open: true,
      issueDate: todayISO(),
      month:
        (typeof settings.currentIssueMonth === "string" &&
          /^\d{4}-\d{2}$/.test(settings.currentIssueMonth) &&
          settings.currentIssueMonth) ||
        new Date().toISOString().slice(0, 7),
    });
  };

  const confirmGen = async () => {
    try {
      await postForDownload(
        "/gen/from-clients",
        {
          // бек приймає і clientIds, і ids — дамо обидва для сумісності
          clientIds: checkedIds,
          ids: checkedIds,
          issueDate: genModal.issueDate,
          month: genModal.month, // ✅ конкретний місяць для сумування протоколів/numeracji
          mode: tab, // опційно, бек ігнорує — не завадить
        },
        "faktury.zip"
      );
      alert("✅ Wygenerowano paczkę faktur (ZIP) i pobrano plik.");
      setGenModal({
        open: false,
        issueDate: todayISO(),
        month:
          settings.currentIssueMonth || new Date().toISOString().slice(0, 7),
      });
    } catch (e) {
      alert(`❌ ${e.message || "Błąd generowania faktur."}`);
    }
  };
  const handleSelectClient = (c) => {
    setScrollYBeforeOpen(window.scrollY || window.pageYOffset || 0);
    setSelectedClient(c);
  };

  const handleBackFromCard = () => {
    setSelectedClient(null);
    // Дочекаємось, поки список перемалюється, і відновимо позицію
    setTimeout(() => {
      window.scrollTo(0, scrollYBeforeOpen || 0);
    }, 0);
  };

  return (
    <div className="space-y-4">
      {/* Шапка без дублюючих кнопок режиму */}
      <div className="card-lg border-2 border-blue-200 bg-blue-50/60">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">📒 Baza klientów</h1>
        </div>

        {/* Пошук/фільтри/імпорт/додати */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <input
            type="search"
            placeholder="Szukaj klienta…"
            className="input w-60"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {tab === "abonament" && (
            <input
              type="search"
              placeholder="Filtr abonamentu…"
              className="input w-52"
              value={abonFilter}
              onChange={(e) => setAbonFilter(e.target.value)}
              title="Filtruj po nazwie abonamentu"
            />
          )}
          <label className="btn-secondary cursor-pointer">
            Załaduj Excel ({tab === "abonament" ? "Abonament" : "Na sztuki"})
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              hidden
            />
          </label>
          <button className="btn-primary" onClick={startAdd}>
            {showAdd ? "Anuluj" : "Dodaj klienta"}
          </button>

          {/* Генерація з бази + ГРУПОВЕ ВИДАЛЕННЯ */}
          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn-danger"
              onClick={bulkDelete}
              disabled={!checkedIds.length}
              title="Usuń zaznaczonych klientów"
            >
              Usuń zaznaczone
            </button>
            <button
              className="btn-primary"
              onClick={openGen}
              disabled={!checkedIds.length}
              title="Generuj faktury z zaznaczonych klientów"
            >
              🧾 Generuj faktury
            </button>
          </div>
        </div>

        {/* === СТРІЧКА-ПЕРЕМИКАЧ (повна ширина ПІД фільтрами) === */}
        <div className="mt-3">
          <div className="w-full grid grid-cols-2 rounded-xl overflow-hidden border-2 border-blue-300 text-center select-none">
            <button
              type="button"
              className={
                "py-3 font-semibold transition " +
                (tab === "abonament"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-blue-700 hover:bg-blue-50")
              }
              onClick={() => switchTab("abonament")}
              title="Klienci z abonamentem"
            >
              Abonament
            </button>
            <button
              type="button"
              className={
                "py-3 font-semibold transition " +
                (tab === "perpiece"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-blue-700 hover:bg-blue-50")
              }
              onClick={() => switchTab("perpiece")}
              title="Klienci rozliczani na sztuki"
            >
              Na sztuki
            </button>
          </div>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={handleSubmit} className="card-lg space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">ID</label>
              <input
                className="input w-full"
                value={formClient.id}
                onChange={(e) =>
                  setFormClient({ ...formClient, id: e.target.value })
                }
                placeholder="Unikalny identyfikator (z Excel: kolumna ID)"
              />
            </div>

            <div>
              <label className="block text-sm mb-1">Nazwa *</label>
              <input
                className="input w-full"
                value={formClient.name}
                onChange={(e) =>
                  setFormClient({ ...formClient, name: e.target.value })
                }
                required
              />
            </div>

            <div>
              <label className="block text-sm mb-1">Email *</label>
              <input
                type="email"
                className="input w-full"
                value={formClient.email}
                onChange={(e) =>
                  setFormClient({ ...formClient, email: e.target.value })
                }
                required
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Telefon</label>
              <input
                className="input w-full"
                value={formClient.phone}
                onChange={(e) =>
                  setFormClient({ ...formClient, phone: e.target.value })
                }
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Adres</label>
              <input
                className="input w-full"
                value={formClient.address}
                onChange={(e) =>
                  setFormClient({ ...formClient, address: e.target.value })
                }
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Typ</label>
              <select
                className="input w-full"
                value={formClient.type}
                onChange={(e) =>
                  setFormClient({ ...formClient, type: e.target.value })
                }
              >
                <option value="op">Osoba prywatna</option>
                <option value="firma">Firma</option>
              </select>
            </div>
            {formClient.type === "firma" ? (
              <div>
                <label className="block text-sm mb-1">NIP</label>
                <input
                  className="input w-full"
                  value={formClient.nip}
                  onChange={(e) =>
                    setFormClient({ ...formClient, nip: e.target.value })
                  }
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm mb-1">PESEL</label>
                <input
                  className="input w-full"
                  value={formClient.pesel}
                  onChange={(e) =>
                    setFormClient({ ...formClient, pesel: e.target.value })
                  }
                />
              </div>
            )}

            <div>
              <label className="block text-sm mb-1">Abonament</label>
              <input
                className="input w-full"
                value={formClient.subscription}
                onChange={(e) =>
                  setFormClient({ ...formClient, subscription: e.target.value })
                }
                placeholder='Np. "STERYL 50" — zostaw puste dla "na sztuki"'
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Kwota abonamentu</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input w-full"
                value={formClient.subscriptionAmount}
                onChange={(e) =>
                  setFormClient({
                    ...formClient,
                    subscriptionAmount: e.target.value,
                  })
                }
              />
            </div>

            <div>
              <label className="block text-sm mb-1">
                Data podpisania umowy
              </label>
              <input
                type="date"
                className="input w-full"
                value={formClient.agreementStart}
                onChange={(e) => {
                  const startISO = normalizeExcelDate(e.target.value);
                  setFormClient({
                    ...formClient,
                    agreementStart: startISO,
                    agreementEnd: startISO ? addMonths(startISO, 6) : "",
                  });
                }}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Obowiązuje do</label>
              <input
                type="date"
                className="input w-full"
                value={formClient.agreementEnd}
                onChange={(e) =>
                  setFormClient({
                    ...formClient,
                    agreementEnd: normalizeExcelDate(e.target.value),
                  })
                }
              />
            </div>

            <input
              type="hidden"
              value={formClient.billingMode}
              readOnly
              aria-hidden="true"
            />
          </div>

          <div className="pt-2 flex gap-2">
            <button type="submit" className="btn-primary">
              {editIndex !== null ? "Zapisz zmiany" : "Zapisz klienta"}
            </button>
            {editIndex !== null && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowAdd(false);
                  setEditIndex(null);
                  setFormClient({ ...emptyClient, billingMode: tab });
                }}
              >
                Anuluj
              </button>
            )}
          </div>
        </form>
      )}

      {!selectedClient ? (
        <div className="card-lg overflow-x-hidden">
          <ClientList
            clients={filtered}
            onSelect={handleSelectClient}
            onEdit={startEdit}
            onDeleteRequest={askDelete}
            selectable
            checkedIds={checkedIds}
            onToggleCheck={onToggleCheck}
            onToggleCheckAll={onToggleCheckAll}
            showAbonFields={tab === "abonament"}
            /* нижче — лише передаю ознаки для адаптиву/неклікабельних контактів;
               реалізація рендеру контактів і кнопки "Szczegóły" — у ClientList */
            plainContacts
          />
        </div>
      ) : (
        <div className="card-lg">
          <ClientCard
            client={selectedClient}
            onBack={handleBackFromCard}
            onSetNotice={() => handleSetNotice(selectedClient)}
            onCancelNotice={() => handleCancelNotice(selectedClient)}
            onUpdate={handleUpdateClient}
          />
        </div>
      )}

      {/* Модалка видалення */}
      <Modal
        open={confirmOpen}
        title="Usunąć klienta?"
        onClose={() => {
          setConfirmOpen(false);
          setClientToDelete(null);
        }}
        onConfirm={confirmDelete}
        confirmText="Usuń"
        cancelText="Anuluj"
      >
        {clientToDelete ? (
          <p>
            Czy na pewno chcesz usunąć klienta{" "}
            <span className="font-semibold">{clientToDelete.name || "?"}</span>?
            Tej operacji nie można cofnąć.
          </p>
        ) : null}
      </Modal>

      {/* Модалка генерації з бази */}
      <Modal
        open={genModal.open}
        title="Generuj faktury z zaznaczonych"
        onClose={() =>
          setGenModal({
            open: false,
            issueDate: todayISO(),
            month:
              settings.currentIssueMonth ||
              new Date().toISOString().slice(0, 7),
          })
        }
        onConfirm={confirmGen}
        confirmText="Generuj"
        cancelText="Anuluj"
      >
        <div className="space-y-2">
          <div className="text-sm">Wybrano klientów: {checkedIds.length}</div>

          <label className="block text-sm">Data wystawienia</label>
          <input
            type="date"
            className="input w-full"
            value={genModal.issueDate}
            onChange={(e) =>
              setGenModal((s) => ({ ...s, issueDate: e.target.value }))
            }
          />

          <label className="block text-sm mt-2">Miesiąc rozliczeniowy</label>
          <input
            type="month"
            className="input w-full"
            value={genModal.month}
            onChange={(e) =>
              setGenModal((s) => ({ ...s, month: e.target.value }))
            }
          />
        </div>
      </Modal>

      {/* Інфо після додавання */}
      {addedInfo.open && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-md text-center">
            <div className="text-lg font-semibold mb-2">✅ Klient dodany</div>
            <div className="text-sm text-gray-700 mb-4">
              {addedInfo.name
                ? `Klient "${addedInfo.name}" został pomyślnie zapisany.`
                : "Zapisano klienta."}
            </div>
            <button
              className="btn-primary"
              onClick={() => setAddedInfo({ open: false, name: "" })}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
