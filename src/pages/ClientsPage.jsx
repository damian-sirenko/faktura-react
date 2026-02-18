// Файл: src/pages/ClientsPage.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import ClientList from "../components/clients/ClientList";
import ClientCard from "../components/clients/ClientCard";
import Modal from "../components/ui/Modal";
import { jsPDF } from "jspdf";
import { apiFetch, api } from "../utils/api";

// ▼ Довідник абонементів (назви мають збігатися з тим, що у вас у базі)
const SUBSCRIPTIONS = [
  "STERYL 20",
  "STERYL 30",
  "STERYL 50",
  "STERYL 100",
  "STERYL 150",
  "STERYL 200",
  "STERYL 300",
  "STERYL 500",
];

// ▼ Kategorie logistyki klienta
const LOGI_OPTIONS = [
  { value: "punkt", label: "Dostarcza do punktu" },
  { value: "paczkomat", label: "Wysyła paczkomatem" },
  { value: "kurier", label: "Wymaga dojazdu kuriera" },
];
const LOGI_LABEL = {
  punkt: "Dostarcza do punktu",
  paczkomat: "Wysyła paczkomatem",
  kurier: "Wymaga dojazdu kuriera",
};

// --- helpers ---

function normalizeExcelDate(val) {
  if (val == null || val === "") return "";
  // Excel serial (Windows): дні від 1899-12-30
  if (typeof val === "number" && isFinite(val)) {
    const excelEpoch = Date.UTC(1899, 11, 30); // 1899-12-30
    const ms = excelEpoch + Math.round(val * 86400000);
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().split("T")[0];
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().split("T")[0];
  }
  const s = String(val).trim();
  if (!s) return "";
  // спроба парсу ISO/локальних форматів
  const asDate = new Date(s);
  if (!Number.isNaN(asDate.getTime()))
    return asDate.toISOString().split("T")[0];
  // dd.mm.yyyy або dd/mm/yyyy або dd-mm-yyyy
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

function addMonths(dateStr, monthsToAdd) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + monthsToAdd);
  return d.toISOString().split("T")[0];
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
// === bool parser: true/1/"true"/"1"/"yes"/"tak" -> true
function boolish(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return (
    s === "1" ||
    s === "true" ||
    s === "yes" ||
    s === "y" ||
    s === "tak" ||
    s === "t"
  );
}

function formatInvoiceNumberPreview(counter, ym) {
  const n = Number(counter) || 1;
  const seq = String(n).padStart(3, "0");

  let year = "";
  let month = "";
  if (typeof ym === "string" && /^\d{4}-\d{2}$/.test(ym)) {
    year = ym.slice(0, 4);
    month = ym.slice(5, 7);
  } else {
    const d = new Date();
    year = String(d.getFullYear());
    month = String(d.getMonth() + 1).padStart(2, "0");
  }
  return `ST-${seq}/${month}/${year}`;
}

// [INSERT NEAR OTHER HELPERS]

// fetch -> base64 для jsPDF VFS
async function __toBase64FromUrl(url) {
  const r = await fetch(url);
  const buf = await r.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Реєстрація шрифтів DejaVu в екземплярі jsPDF
async function __registerDejaVuFonts(doc) {
  try {
    const fonts = doc.getFontList ? doc.getFontList() : {};
    if (fonts && fonts["DejaVuSans"]) return; // вже зареєстровано

    const regular = await __toBase64FromUrl("/fonts/DejaVuSans.ttf");
    const bold = await __toBase64FromUrl("/fonts/DejaVuSans-Bold.ttf");

    doc.addFileToVFS("DejaVuSans.ttf", regular);
    doc.addFont("DejaVuSans.ttf", "DejaVuSans", "normal");

    doc.addFileToVFS("DejaVuSans-Bold.ttf", bold);
    doc.addFont("DejaVuSans-Bold.ttf", "DejaVuSans", "bold");
  } catch (e) {
    console.error("Nie udało się wczytać fontów DejaVu:", e);
  }
}

/* ===== helper для завантаження ZIP з POST ===== */
async function postForDownload(url, payload, fallbackName = "faktury.zip") {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
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

/* === Стабільні ID === */
const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

// допоміжно: стабільне визначення ідентифікатора
const getId = (c) => {
  const raw =
    c?.id ??
    c?.ID ??
    c?.Id ??
    c?.iD ??
    c?.["Id"] ??
    c?.["ID "] ??
    c?.[" id"] ??
    "";
  const id = String(raw).trim();
  if (id) return id;
  const name = String(c?.name ?? c?.Klient ?? "").trim();
  return slugify(name);
};

function idNumericValue(c) {
  const raw = getId(c);
  const m = String(raw).match(/(\d+)/);
  if (!m) return Number.POSITIVE_INFINITY;
  return parseInt(m[1], 10);
}

const sameClient = (a, b) => {
  if (a === b) return true;
  const ida = getId(a);
  const idb = getId(b);
  return ida && idb && ida === idb;
};

export default function ClientsPage({
  forcedMode = "abonament", // 'abonament' | 'perpiece' | 'all'
  hideModeSwitcher = false,
  forceArchivedView = false,
  pageTitle,
} = {}) {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [scrollYBeforeOpen, setScrollYBeforeOpen] = useState(0);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clientToDelete, setClientToDelete] = useState(null);

  const [q, setQ] = useState("");
  const [tab, setTab] = useState(
    forcedMode === "perpiece" ? "perpiece" : "abonament"
  );

  const [abonFilter, setAbonFilter] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [editIndex, setEditIndex] = useState(null);

  const [addedInfo, setAddedInfo] = useState({ open: false, name: "" });
  // прогрес генерації (оверлей із прогрес-баром)
  const [genProgress, setGenProgress] = useState({
    open: false,
    pct: 0,
    text: "",
  });
  const genProgTimerRef = useRef(null);

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
  const [invoiceNumbers, setInvoiceNumbers] = useState({
    loading: false,
    month: "",
    lastNumber: null,
    nextNumber: null,
    manualStart: "",
  });

  // ✅ ПЕРЕМИКАЧ СПИСКУ: Активні / Архів
  const [showArchived, setShowArchived] = useState(
    forceArchivedView ? true : false
  );

  // ✅ Протоколи для обраного клієнта (read-only список)
  const [clientProtocols, setClientProtocols] = useState({
    loading: false,
    list: [],
  });

  const [isNarrowTable, setIsNarrowTable] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 1100;
  });

  useEffect(() => {
    const onResize = () => setIsNarrowTable(window.innerWidth < 1100);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
    logistics: "kurier", // 'punkt' | 'paczkomat' | 'kurier' (wymagane)
    // індивідуальні ціни (за замовчуванням глобальні)
    courierPriceMode: "global",
    courierPriceGross: null,
    shippingPriceMode: "global",
    shippingPriceGross: null,
    // ✅ нове: архівація
    archived: false,
  };
  const [formClient, setFormClient] = useState(emptyClient);

  // load settings
  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch("/settings");
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
    apiFetch("/clients")
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
          const nameVal = String(r.name || r.Klient || "").trim();
          const finalId = String(idRaw || "").trim() || slugify(nameVal);

          const hasAbon = !!String(
            r.subscription ?? r.Abonament ?? r.abonament ?? ""
          ).trim();
          const billingMode =
            r.billingMode || (hasAbon ? "abonament" : "perpiece");

          const endISO = normalizeExcelDate(
            r.agreementEnd ?? r["Obowiązuje do"] ?? r.end ?? ""
          );

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
            // ► архівація
            archived: boolish(r.archived),
            archivedAt:
              r.archivedAt ||
              r.archived_at ||
              r.archiveDate ||
              r.archiwizacja ||
              r.updatedAt ||
              "",

            id: finalId,
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
            agreementEnd: endISO || (startISO ? addMonths(startISO, 6) : ""),
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
            logistics: (() => {
              const raw =
                r.logistics ??
                r.deliveryMode ??
                r.transport ??
                r["logistyka"] ??
                r["Transport"] ??
                "";
              const v = String(raw || "")
                .toLowerCase()
                .trim();
              if (v === "punkt" || /punkt/.test(v)) return "punkt";
              if (v === "paczkomat" || /paczko/.test(v)) return "paczkomat";
              if (v === "kurier" || /kurier|dojazd/.test(v)) return "kurier";
              return "kurier";
            })(),
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
    // гарантуємо дефолт логістики при редагуванні старих записів
    const withDefaultLogi = {
      ...client,
      logistics: client.logistics || "kurier",
    };
    setEditIndex(idx === -1 ? null : idx);
    setFormClient({
      ...withDefaultLogi,
      billingMode: client.billingMode || tab,
    });
    setShowAdd(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = { ...formClient };
    if (!payload.logistics) payload.logistics = "kurier";
    const startISO = normalizeExcelDate(payload.agreementStart);
    payload.agreementStart = startISO;
    payload.agreementEnd =
      normalizeExcelDate(payload.agreementEnd) ||
      (startISO ? addMonths(startISO, 6) : "");
    payload.subscriptionAmount = Number(payload.subscriptionAmount || 0);
    if (!payload.billingMode) payload.billingMode = tab;

    // ⚠️ гарантуємо стабільний id
    if (!payload.id?.trim()) {
      payload.id = slugify(payload.name);
    }

    // ✅ не даємо випадково створити архівованого клієнта
    if (payload.archived == null) payload.archived = false;

    let updated = [...clients];
    if (editIndex !== null && editIndex >= 0) updated[editIndex] = payload;
    else updated.push(payload);

    setClients(updated);
    setShowAdd(false);
    setEditIndex(null);
    setFormClient({ ...emptyClient, billingMode: tab });

    try {
      await apiFetch("/save-clients", {
        method: "POST",
        json: updated,
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
      await fetch(api("/save-clients"), {
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
      await fetch(api("/save-clients"), {
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
      await fetch(api("/save-clients"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch {}
  };

  // ✅ Завантаження протоколів для обраного клієнта
  useEffect(() => {
    const loadProtocols = async (clientObj) => {
      if (!clientObj) {
        setClientProtocols({ loading: false, list: [] });
        return;
      }
      setClientProtocols({ loading: true, list: [] });
      try {
        const r = await fetch(api("/protocols"), { cache: "no-store" });
        const all = r.ok ? await r.json() : [];
        const id = getId(clientObj);
        const name = String(clientObj.name || clientObj.Klient || "")
          .trim()
          .toLowerCase();
        const filtered = (all || []).filter(
          (p) =>
            String(p.id || "").trim() === id ||
            String(p.clientName || "")
              .trim()
              .toLowerCase() === name
        );
        setClientProtocols({ loading: false, list: filtered });
      } catch {
        setClientProtocols({ loading: false, list: [] });
      }
    };
    loadProtocols(selectedClient);
  }, [selectedClient]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();

    // 1) базовий набір по режиму (abonament/perpiece/all)
    const base =
      forcedMode === "all"
        ? clients
        : clients.filter((c) => (c.billingMode || "abonament") === tab);

    // 2) архів чи ні
    const byArchive = base.filter((c) =>
      forceArchivedView
        ? Boolean(c.archived)
        : showArchived
        ? Boolean(c.archived)
        : !Boolean(c.archived)
    );

    // 3) якщо ми у вкладці abonament — додатковий фільтр по назві абонементу
    const byAbon =
      forcedMode === "abonament" ||
      (forcedMode !== "perpiece" && tab === "abonament")
        ? byArchive.filter((c) =>
            abonFilter.trim()
              ? String(c.subscription || "")
                  .toLowerCase()
                  .includes(abonFilter.trim().toLowerCase())
              : true
          )
        : byArchive;

    // 4) пошук по імені
    const afterSearch = s
      ? byAbon.filter((c) => (c.name || "").toLowerCase().includes(s))
      : byAbon;

    // 5) СОРТУВАННЯ:
    //    якщо це "na sztuki" (perpiece), сортуємо за числовим значенням id зростаюче
    const isPerPieceView =
      forcedMode === "perpiece" ||
      (forcedMode !== "abonament" && tab === "perpiece");

    if (isPerPieceView) {
      const sorted = [...afterSearch].sort((a, b) => {
        const na = idNumericValue(a);
        const nb = idNumericValue(b);
        if (na !== nb) return na - nb;
        return (a.name || "").localeCompare(b.name || "", "pl", {
          sensitivity: "base",
          numeric: true,
        });
      });
      return sorted;
    }

    return afterSearch;
  }, [
    q,
    clients,
    tab,
    abonFilter,
    showArchived,
    forcedMode,
    forceArchivedView,
  ]);

  // ► Замість видалення — архівація (один)
  const askDelete = (client) => {
    setClientToDelete(client);
    setConfirmOpen(true);
  };
  const confirmDelete = async () => {
    if (!clientToDelete) return;
    const delId = getId(clientToDelete);
    const today = new Date().toISOString().slice(0, 10);
    const updated = clients.map((c) =>
      getId(c) === delId ? { ...c, archived: true, archivedAt: today } : c
    );
    setClients(updated);
    setConfirmOpen(false);
    setClientToDelete(null);
    try {
      await fetch(api("/save-clients"), {
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

  // ► групова архівація (замість видалення)
  const bulkDelete = async () => {
    if (!checkedIds.length) {
      alert("Zaznacz klientów do archiwizacji.");
      return;
    }
    if (!confirm("Przenieść zaznaczonych klientów do archiwum?")) return;
    const today = new Date().toISOString().slice(0, 10);
    const updated = clients.map((c) =>
      checkedIds.includes(getId(c))
        ? { ...c, archived: true, archivedAt: today }
        : c
    );

    setClients(updated);
    setCheckedIds([]);
    try {
      await fetch(api("/save-clients"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      alert("✅ Przeniesiono do archiwum.");
    } catch {
      alert("❌ Nie udało się zapisać zmian.");
    }
  };

  // ► генерація з бази
  const openGen = async () => {
    if (!checkedIds.length) {
      alert("Zaznacz klientów.");
      return;
    }

    const ym =
      (typeof settings.currentIssueMonth === "string" &&
        /^\d{4}-\d{2}$/.test(settings.currentIssueMonth) &&
        settings.currentIssueMonth) ||
      new Date().toISOString().slice(0, 7);

    setGenProgress({ open: false, pct: 0, text: "" });

    setInvoiceNumbers({
      loading: true,
      month: ym,
      lastNumber: null,
      nextNumber: null,
      manualStart: "",
    });

    try {
      const res = await apiFetch(`/invoices/next-number-preview?month=${ym}`);
      if (res.ok) {
        const data = await res.json();
        setInvoiceNumbers({
          loading: false,
          month: data.month || ym,
          lastNumber: data.lastNumber || null,
          nextNumber: data.nextNumber || null,
          manualStart: "",
        });
      } else {
        setInvoiceNumbers((prev) => ({ ...prev, loading: false }));
      }
    } catch {
      setInvoiceNumbers((prev) => ({ ...prev, loading: false }));
    }

    setGenModal({
      open: true,
      issueDate: todayISO(),
      month: ym,
    });
  };

  const openKartoteka = React.useCallback(() => {
    window.open(api("/clients/kartoteka.pdf"), "_blank", "noopener,noreferrer");
  }, []);

  // [REPLACE WHOLE FUNCTION generateLabelsPDF]
  const generateLabelsPDF = async () => {
    if (!checkedIds.length) {
      alert("Zaznacz klientów.");
      return;
    }
    const picked = clients.filter((c) => checkedIds.includes(getId(c)));
    if (!picked.length) {
      alert("Brak wybranych klientów.");
      return;
    }

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
    await __registerDejaVuFonts(doc);

    // Сталі
    const PAGE_W = 210;
    const PAGE_H = 297;

    const PAGE_MARGIN = 5; // невеликий край сторінки
    const GAP = 2; // 2 мм між етикетками
    const COLS = 3;
    const ROWS = 7;

    const ID_BAND_H = 10; // вища смуга для стабільного центрування
    const FONT_SIZE = 12;

    // Область верстки всередині полів
    const AREA_W = PAGE_W - PAGE_MARGIN * 2;
    const AREA_H = PAGE_H - PAGE_MARGIN * 2;

    // Розміри комірок: 3×7
    const cellW = (AREA_W - GAP * (COLS - 1)) / COLS;
    const cellH = (AREA_H - GAP * (ROWS - 1)) / ROWS;

    // Налаштування тексту
    doc.setFont("DejaVuSans", "bold");
    doc.setFontSize(FONT_SIZE);
    doc.setLineWidth(0.2);

    // Точні метрики рядка в мм (без дублювань)
    const mmPerPt = 0.352777778;
    const LHF =
      typeof doc.getLineHeightFactor === "function"
        ? doc.getLineHeightFactor()
        : 1.15;
    const lineH = FONT_SIZE * LHF * mmPerPt;

    // Паддінги всередині комірок
    const PAD_X = 1.5;
    const PAD_Y = 1.5;

    const labels = picked.map((c) => ({
      id: String(getId(c) || "").trim(),
      name: String(c.name || "").trim(),
    }));

    const perPage = COLS * ROWS;

    // Універсальний рендер текстового блоку по центру осередку (по X і Y)
    function drawCenteredBlock(x0, top, width, height, text) {
      const availW = width - PAD_X * 2;

      let lines = doc.splitTextToSize(String(text || ""), availW);
      const maxLines = Math.max(1, Math.floor((height - PAD_Y * 2) / lineH));
      if (lines.length > maxLines) lines = lines.slice(0, maxLines);

      const blockH = Math.max(lineH, lines.length * lineH);
      const yStart = top + (height - blockH) / 2;

      doc.text(lines, x0 + width / 2, yStart, {
        align: "center",
        baseline: "top",
        maxWidth: availW,
      });
    }

    labels.forEach((lab, idx) => {
      const pageIndex = Math.floor(idx / perPage);
      const pos = idx % perPage;
      const r = Math.floor(pos / COLS);
      const c = pos % COLS;

      if (pos === 0 && pageIndex > 0) doc.addPage();

      const x0 = PAGE_MARGIN + c * (cellW + GAP);
      const y0 = PAGE_MARGIN + r * (cellH + GAP);

      // рамка комірки
      doc.rect(x0, y0, cellW, cellH);
      // лінія між верхнім та нижнім контейнерами
      doc.line(x0, y0 + ID_BAND_H, x0 + cellW, y0 + ID_BAND_H);

      // Верхній контейнер: ID (по центру)
      drawCenteredBlock(x0, y0, cellW, ID_BAND_H, lab.id);

      // Нижній контейнер: назва (по центру)
      drawCenteredBlock(x0, y0 + ID_BAND_H, cellW, cellH - ID_BAND_H, lab.name);
    });

    doc.save("etykiety.pdf");
  };

  const confirmGen = async () => {
    setGenModal((s) => ({ ...s, open: false }));
    setGenProgress({ open: true, pct: 1, text: "Przygotowywanie…" });

    if (genProgTimerRef.current) clearInterval(genProgTimerRef.current);
    genProgTimerRef.current = setInterval(() => {
      setGenProgress((p) => {
        const next = Math.min(90, p.pct + 1.5);
        return { ...p, pct: next };
      });
    }, 300);

    try {
      if (invoiceNumbers.manualStart && invoiceNumbers.manualStart.trim()) {
        const manual = Number(invoiceNumbers.manualStart);
        if (Number.isFinite(manual) && manual > 0) {
          try {
            await apiFetch("/invoices/set-counter", {
              method: "POST",
              json: {
                month: genModal.month,
                counter: manual,
              },
            });
          } catch (e) {
            console.warn("set-counter failed:", e);
          }
        }
      }

      await postForDownload(
        api("/gen/from-clients"),
        {
          clientIds: checkedIds,
          ids: checkedIds,
          issueDate: genModal.issueDate,
          month: genModal.month,
          mode: tab,
        },
        "faktury.zip"
      );

      if (genProgTimerRef.current) clearInterval(genProgTimerRef.current);
      setGenProgress({ open: true, pct: 100, text: "Gotowe ✔" });

      setTimeout(() => {
        setGenProgress({ open: false, pct: 0, text: "" });
        setGenModal({
          open: false,
          issueDate: todayISO(),
          month:
            settings.currentIssueMonth || new Date().toISOString().slice(0, 7),
        });
        setInvoiceNumbers({
          loading: false,
          month: "",
          lastNumber: null,
          nextNumber: null,
          manualStart: "",
        });
        alert("✅ Wygenerowano paczkę faktur (ZIP) i pobrano plik.");
      }, 600);
    } catch (e) {
      if (genProgTimerRef.current) clearInterval(genProgTimerRef.current);
      setGenProgress({ open: false, pct: 0, text: "" });
      alert(`❌ ${e.message || "Błąd generowania faktur."}`);
    }
  };

  const handleSelectClient = (c) => {
    setScrollYBeforeOpen(window.scrollY || window.pageYOffset || 0);
    setSelectedClient(c);
  };

  const handleBackFromCard = () => {
    setSelectedClient(null);
    setTimeout(() => {
      window.scrollTo(0, scrollYBeforeOpen || 0);
    }, 0);
  };

  const toggleArchiveSelected = async () => {
    if (!selectedClient) return;
    const id = getId(selectedClient);
    const today = new Date().toISOString().slice(0, 10);

    const updated = clients.map((c) => {
      if (getId(c) !== id) return c;
      const nextArchived = !Boolean(c.archived);
      return {
        ...c,
        archived: nextArchived,
        archivedAt: nextArchived ? today : null,
      };
    });

    const nextSel = updated.find((c) => getId(c) === id) || null;
    setClients(updated);
    setSelectedClient(nextSel);
    try {
      await fetch(api("/save-clients"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch {}
  };
  return (
    <div className="layout-container space-y-4">
      {/* Шапка без дублюючих кнопок режиму */}
      <div className="card-lg border-2 border-blue-200 bg-blue-50/60">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">
            {pageTitle || "Klienci abonamrntowi"}
          </h1>
        </div>

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

          <button className="btn-primary" onClick={startAdd}>
            {showAdd ? "Anuluj" : "Dodaj klienta"}
          </button>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <button
              className="btn-primary"
              onClick={bulkDelete}
              disabled={!checkedIds.length}
              title="Przenieś zaznaczonych klientów do archiwum"
            >
              Archiwizuj zaznaczone
            </button>

            <button
              className="btn-primary"
              onClick={openGen}
              disabled={!checkedIds.length}
              title="Generuj faktury z zaznaczonych klientów"
            >
              Generuj faktury
            </button>

            <button
              className="btn-primary"
              onClick={openKartoteka}
              title="Generuj PDF kartoteki klientów abonamentowych"
            >
              Generuj kartotekę
            </button>

            <button
              className="btn-primary"
              onClick={generateLabelsPDF}
              title="Generuj PDF z etykietami (3×7 na A4)"
            >
              Generuj etykiety
            </button>
          </div>
        </div>

        {!hideModeSwitcher && (
          <div className="mt-3">
            <div className="w-full grid grid-cols-2 rounded-xl overflow-hidden border-2 border-blue-300 text-center select-none">
              <button
                type="button"
                className="btn-primary w-full py-3 rounded-none disabled:opacity-100 disabled:cursor-default"
                onClick={() => switchTab("abonament")}
                disabled={tab === "abonament"}
                aria-pressed={tab === "abonament"}
                title="Klienci z abonamentem"
              >
                Abonament
              </button>

              <button
                type="button"
                className="btn-primary w-full py-3 rounded-none disabled:opacity-100 disabled:cursor-default"
                onClick={() => switchTab("perpiece")}
                disabled={tab === "perpiece"}
                aria-pressed={tab === "perpiece"}
                title="Klienci rozliczani na sztuki"
              >
                Na sztuki
              </button>
            </div>
          </div>
        )}
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
              <label className="block text-sm mb-1">Email</label>
              <input
                type="email"
                className="input w-full"
                value={formClient.email}
                onChange={(e) =>
                  setFormClient({ ...formClient, email: e.target.value })
                }
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

            {/* ▼▼▼ ТУТ: обов'язкове поле "Logistyka" ▼▼▼ */}
            <div>
              <label className="block text-sm mb-1">Logistyka *</label>
              <select
                className="input w-full"
                value={formClient.logistics}
                onChange={(e) =>
                  setFormClient({ ...formClient, logistics: e.target.value })
                }
                required
              >
                {LOGI_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {/* ▲▲▲ КІНЕЦЬ блоку логістики ▲▲▲ */}

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
              <select
                className="input w-full"
                value={formClient.subscription}
                onChange={(e) =>
                  setFormClient({ ...formClient, subscription: e.target.value })
                }
              >
                <option value="">— brak (na sztuki) —</option>
                {SUBSCRIPTIONS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
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
        isNarrowTable ? (
          <div className="card-lg w-full">
            <div className="divide-y">
              {filtered.map((c) => (
                <div key={getId(c)} className="py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1 break-words">
                    {c.name || "—"}
                  </div>
                  <button
                    type="button"
                    className="btn-primary btn-sm shrink-0"
                    onClick={() => handleSelectClient(c)}
                  >
                    Szczegóły
                  </button>
                </div>
              ))}

              {!filtered.length && (
                <div className="py-6 text-center text-sm text-gray-600">
                  Brak klientów
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="card-lg w-full overflow-x-auto">
            <ClientList
              clients={filtered}
              onSelect={handleSelectClient}
              onEdit={startEdit}
              onDeleteRequest={askDelete}
              selectable
              checkedIds={checkedIds}
              onToggleCheck={onToggleCheck}
              onToggleCheckAll={onToggleCheckAll}
              showAbonFields={
                forcedMode === "abonament" || forcedMode === "all"
              }
              plainContacts
              showIdBeforeName={forcedMode === "perpiece"}
              idCellMaxChars={13}
              logisticsLabelMap={LOGI_LABEL}
              showLogistics
            />
          </div>
        )
      ) : (
        <div className="card-lg">
          <ClientCard
            client={selectedClient}
            onBack={handleBackFromCard}
            onSetNotice={() => handleSetNotice(selectedClient)}
            onCancelNotice={() => handleCancelNotice(selectedClient)}
            onUpdate={handleUpdateClient}
            protocols={clientProtocols.list}
            protocolsLoading={clientProtocols.loading}
            protocolsReadOnly
            protocolsTabLabel="Protokoły"
            onToggleArchive={toggleArchiveSelected}
            logisticsLabelMap={LOGI_LABEL}
          />
        </div>
      )}

      {/* Модалка архівації (замість видалення) */}
      <Modal
        open={confirmOpen}
        title="Przenieść klienta do archiwum?"
        onClose={() => {
          setConfirmOpen(false);
          setClientToDelete(null);
        }}
        onConfirm={confirmDelete}
        confirmText="Archiwizuj"
        cancelText="Anuluj"
      >
        {clientToDelete ? (
          <p>
            Czy na pewno chcesz przenieść klienta{" "}
            <span className="font-semibold">{clientToDelete.name || "?"}</span>{" "}
            do archiwum? Dane pozostaną dostępne w widoku archiwum.
          </p>
        ) : null}
      </Modal>

      {/* Модалка генерації з бази */}
      <Modal
        open={genModal.open}
        title="Generuj faktury z zaznaczonych"
        onClose={() => {
          setGenModal({
            open: false,
            issueDate: todayISO(),
            month:
              settings.currentIssueMonth ||
              new Date().toISOString().slice(0, 7),
          });
          setInvoiceNumbers({
            loading: false,
            month: "",
            lastNumber: null,
            nextNumber: null,
            manualStart: "",
          });
        }}
        onConfirm={confirmGen}
        confirmText="Generuj"
        cancelText="Anuluj"
      >
        <div className="space-y-2">
          <div className="text-sm">Wybrano klientów: {checkedIds.length}</div>
          <div className="text-xs text-gray-700">
            {invoiceNumbers.loading ? (
              <span>Sprawdzanie ostatniego numeru faktury…</span>
            ) : (
              <>
                {invoiceNumbers.lastNumber ? (
                  <div>
                    Ostatnia wystawiona faktura dla miesiąca{" "}
                    {invoiceNumbers.month}: {invoiceNumbers.lastNumber}. Nowe
                    faktury będą numerowane od:{" "}
                    {invoiceNumbers.nextNumber || "-"}.
                  </div>
                ) : (
                  <div>
                    Dla miesiąca {invoiceNumbers.month || genModal.month || "-"}{" "}
                    nie znaleziono faktur. Pierwszy numer będzie:{" "}
                    {invoiceNumbers.nextNumber ||
                      formatInvoiceNumberPreview(1, genModal.month)}
                    .
                  </div>
                )}
              </>
            )}
          </div>

          <label className="block text-sm mt-2">
            Ręcznie ustaw początkowy licznik
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              className="input w-24"
              value={invoiceNumbers.manualStart}
              onChange={(e) =>
                setInvoiceNumbers((s) => ({
                  ...s,
                  manualStart: e.target.value,
                }))
              }
            />
            <span className="text-xs text-gray-600">
              Podgląd numeru:{" "}
              {formatInvoiceNumberPreview(
                invoiceNumbers.manualStart || 1,
                genModal.month
              )}
            </span>
          </div>

          <label className="block text-sm mt-2">Data wystawienia</label>
          <input
            type="date"
            className="input w-full"
            value={genModal.issueDate}
            onChange={(e) =>
              setGenModal((s) => ({ ...s, issueDate: e.target.value }))
            }
          />

          <input
            type="month"
            className="input w-full"
            value={genModal.month}
            onChange={(e) => {
              const newMonth = e.target.value;
              setGenModal((s) => ({ ...s, month: newMonth }));

              if (!/^\d{4}-\d{2}$/.test(newMonth)) {
                setInvoiceNumbers((prev) => ({
                  ...prev,
                  month: newMonth,
                }));
                return;
              }

              setInvoiceNumbers((prev) => ({
                ...prev,
                loading: true,
                month: newMonth,
                lastNumber: null,
                nextNumber: null,
              }));

              (async () => {
                try {
                  const res = await apiFetch(
                    `/invoices/next-number-preview?month=${newMonth}`
                  );
                  if (res.ok) {
                    const data = await res.json();
                    setInvoiceNumbers((prev) => ({
                      ...prev,
                      loading: false,
                      month: data.month || newMonth,
                      lastNumber: data.lastNumber || null,
                      nextNumber: data.nextNumber || null,
                    }));
                  } else {
                    setInvoiceNumbers((prev) => ({
                      ...prev,
                      loading: false,
                    }));
                  }
                } catch {
                  setInvoiceNumbers((prev) => ({
                    ...prev,
                    loading: false,
                  }));
                }
              })();
            }}
          />
        </div>
      </Modal>

      {/* Інфо про прогрес генерації */}
      {genProgress.open && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-md">
            <div className="text-lg font-semibold mb-3">
              Generowanie faktur…
            </div>
            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-200"
                style={{ width: `${genProgress.pct}%` }}
              />
            </div>
            <div className="mt-2 text-sm text-gray-700">
              {genProgress.text || `${Math.round(genProgress.pct)}%`}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Nie zamykaj tej karty do zakończenia generowania.
            </div>
          </div>
        </div>
      )}

      {/* Інфо після додавання клієнта */}
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
