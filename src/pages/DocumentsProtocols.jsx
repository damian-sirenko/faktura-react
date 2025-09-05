// src/pages/DocumentsProtocols.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  getProtocols,
  deleteProtocol,
  humanDateTime,
} from "../utils/docStore.js";

// ⬇️ ДОДАНО: базовий URL бекенду (працює з .env або fallback на localhost:3000)
const API = import.meta.env.VITE_API_URL || "http://localhost:3000";

// === Узгоджені кнопки та моно-іконки (як у фактурах) ===
const IconButton = ({
  title,
  onClick,
  variant = "secondary", // secondary | primary | danger
  children,
}) => {
  const base =
    "inline-flex items-center justify-center w-8 h-8 rounded-lg p-1.5 transition focus:outline-none focus:ring";
  const variants = {
    secondary:
      "bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-300",
    primary: "bg-blue-100 text-blue-700 hover:bg-blue-200 focus:ring-blue-300",
    danger: "bg-red-100 text-red-700 hover:bg-red-200 focus:ring-red-300",
  };
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`${base} ${variants[variant]}`}
    >
      {children}
    </button>
  );
};
const IconEye = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconTrash = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

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

export default function DocumentsProtocols() {
  const [items, setItems] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [q, setQ] = useState("");
  const [monthFilter, setMonthFilter] = useState("");

  // PREVIEW (серверний PDF у модалці)
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const previewObjectUrlRef = useRef(null);

  const navigate = useNavigate();

  // Завантаження списку протоколів (захист від збоїв)
  const load = () => {
    try {
      const list = getProtocols() || [];
      const safeList = Array.isArray(list) ? list : [];
      setItems(safeList);
      setSelectedIds((prev) => {
        const next = new Set();
        safeList.forEach((it) => prev.has(it.id) && next.add(it.id));
        return next;
      });
    } catch (e) {
      console.error("[DocumentsProtocols] load error:", e);
      setItems([]);
      setSelectedIds(new Set());
    }
  };

  useEffect(() => {
    load();
    const onStorage = (e) => {
      if (e.key && e.key.startsWith("doc:protocols")) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const filtered = useMemo(() => {
    const lower = q.trim().toLowerCase();
    return (items || [])
      .filter((it) => {
        const byMonth = monthFilter ? it.month === monthFilter : true;
        if (!byMonth) return false;
        if (!lower) return true;
        const { year, monthWord } = monthParts(it.month);
        const protoName = `Protokół_${monthWord}_${year}_${it.clientName || ""}`
          .toLowerCase()
          .replace(/\s+/g, " ");
        return (
          protoName.includes(lower) ||
          String(it.clientName || "")
            .toLowerCase()
            .includes(lower)
        );
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [items, q, monthFilter]);

  const allChecked =
    filtered.length > 0 && filtered.every((it) => selectedIds.has(it.id));

  const toggleAll = () =>
    setSelectedIds((s) => {
      if (allChecked) return new Set();
      const n = new Set();
      filtered.forEach((it) => n.add(it.id));
      return n;
    });

  const toggleOne = (id) =>
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // ==== Серверний PDF ====
  const buildServerPdfUrl = (meta) => {
    const clientId = meta.clientId || meta.id.split(":")[0];
    const month = meta.month || meta.id.split(":")[1];
    // ⬇️ БУЛО: return `/protocols/${encodeURIComponent(clientId)}/${month}/pdf`;
    return `${API}/protocols/${encodeURIComponent(clientId)}/${month}/pdf`;
  };

  const fetchPdfAsObjectUrl = async (url) => {
    const r = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/pdf" },
    });
    if (!r.ok) {
      // Пояснення причини для модалки
      let msg = "Nie udało się wygenerować PDF po stronie serwera.";
      try {
        const t = await r.text();
        if (t) msg += `\n\nSerwer: ${t}`;
      } catch {}
      throw new Error(msg);
    }
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  };

  const openPreviewFor = async (meta) => {
    try {
      setLoadingPreview(true);
      const url = buildServerPdfUrl(meta);
      const objUrl = await fetchPdfAsObjectUrl(url);

      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
      previewObjectUrlRef.current = objUrl;

      setPreviewUrl(objUrl);
      setPreviewOpen(true);
    } catch (e) {
      alert((e && e.message) || "Nie udało się otworzyć podglądu protokołu.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewUrl("");
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
  };

  const onPreviewSelected = async () => {
    if (selectedIds.size !== 1) {
      alert("Zaznacz dokładnie 1 protokół do podglądu.");
      return;
    }
    const id = Array.from(selectedIds)[0];
    const meta = items.find((x) => x.id === id);
    if (!meta) return;
    await openPreviewFor(meta);
  };

  const onPreviewRow = async (meta) => {
    await openPreviewFor(meta);
  };

  const onDownloadSelected = async () => {
    if (selectedIds.size === 0) {
      alert("Zaznacz co najmniej 1 protokół do pobrania.");
      return;
    }
    for (const id of Array.from(selectedIds)) {
      const meta = items.find((x) => x.id === id);
      if (!meta) continue;
      const url = buildServerPdfUrl(meta);

      try {
        const r = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/pdf" },
        });
        if (!r.ok) {
          let msg = `Nie udało się pobrać PDF dla: ${
            meta.clientName || meta.id
          }.`;
        }
        const blob = await r.blob();
        const a = document.createElement("a");
        const { year, monthWord } = monthParts(meta.month);
        const fileName = `Protokół_${monthWord}_${year}_${
          meta.clientName || "klient"
        }.pdf`;
        const objUrl = URL.createObjectURL(blob);
        a.href = objUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objUrl), 0);
      } catch (e) {
        console.error("Download error:", e);
        alert(`Nie udało się pobrać pliku для: ${meta.clientName || meta.id}.`);
      }
    }
  };

  const onDeleteSelected = async () => {
    if (selectedIds.size === 0) {
      alert("Zaznacz co najmniej 1 protokół do usunięcia.");
      return;
    }
    if (!confirm("Usunąć zaznaczone protokoły?")) return;
    Array.from(selectedIds).forEach((id) => deleteProtocol(id));
    setSelectedIds(new Set());
    load();
  };

  const navigateToView = (meta) => {
    const clientId = meta.clientId || meta.id.split(":")[0];
    const month = meta.month || meta.id.split(":")[1];
    navigate(`/documents/protocols/${encodeURIComponent(clientId)}/${month}`);
  };

  return (
    <div className="space-y-3">
      <div className="text-lg font-semibold">Dokumenty → Protokoły</div>

      {/* Фільтри */}
      <div className="card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs mb-1 text-gray-600">
              Nazwa protokołu / klient
            </label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="input w-72"
              placeholder="np. Protokół_styczeń_2025_Klient"
              aria-label="Filtruj po nazwie protokołu lub kliencie"
            />
          </div>

          <div>
            <label className="block text-xs mb-1 text-gray-600">Miesiąc</label>
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="input w-48"
              aria-label="Filtruj po miesiącu"
            />
          </div>

          <div className="flex-1" />

          <button className="btn-secondary" onClick={onPreviewSelected}>
            👁️ Podgląd zaznaczonych
          </button>
          <button className="btn-secondary" onClick={onDownloadSelected}>
            ⬇️ Pobierz zaznaczone
          </button>
          <IconButton
            title="Usuń zaznaczone"
            onClick={onDeleteSelected}
            variant="danger"
          >
            <IconTrash />
          </IconButton>
        </div>
      </div>

      {/* Список */}
      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          Brak zapisanych protokołów.
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="px-3 py-2 text-sm text-gray-600 bg-blue-50 border-b">
            Zapisane: {filtered.length}
          </div>

          <table className="table w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="w-[3.5rem] text-center">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Zaznacz wszystkie"
                  />
                </th>
                <th className="w-[6ch] text-center">#</th>
                <th>Nazwa protokołu</th>
                <th className="w-[16ch] text-center">Miesiąc</th>
                <th className="w-[10ch] text-center">Rok</th>
                <th className="w-[9ch] text-center">Podgląd</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it, idx) => {
                const { year, monthWord } = monthParts(it.month);
                const protoName = `Protokół_${monthWord}_${year}_${
                  it.clientName || ""
                }`;
                return (
                  <tr key={it.id} className="hover:bg-gray-50">
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(it.id)}
                        onChange={() => toggleOne(it.id)}
                        aria-label={`Zaznacz ${protoName}`}
                      />
                    </td>
                    <td className="text-center">{idx + 1}</td>
                    <td className="truncate">
                      <button
                        type="button"
                        className="text-blue-700 hover:underline"
                        onClick={() => navigateToView(it)}
                        title="Otwórz stronę protokołu"
                      >
                        {protoName}
                      </button>
                      <div className="text-[11px] text-gray-500">
                        Utworzono: {humanDateTime(it.createdAt)}
                      </div>
                    </td>
                    <td className="text-center capitalize">{monthWord}</td>
                    <td className="text-center">{year}</td>
                    <td className="text-center">
                      <IconButton
                        title={`Podgląd ${protoName}`}
                        onClick={() => onPreviewRow(it)}
                        variant="secondary"
                      >
                        <IconEye />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Модальне PREVIEW (серверний PDF) */}
      {previewOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-lg w-full max-w-5xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <div className="font-semibold">Podgląd protokołu (PDF)</div>
              <button
                type="button"
                className="btn-secondary"
                onClick={closePreview}
              >
                Zamknij
              </button>
            </div>
            <div className="h-[80vh]">
              {loadingPreview ? (
                <div className="h-full flex items-center justify-center text-gray-600">
                  Generowanie PDF…
                </div>
              ) : previewUrl ? (
                <iframe
                  title="Podgląd PDF"
                  src={previewUrl}
                  className="w-full h-full"
                />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  Brak danych do podglądu.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
