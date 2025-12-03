import React from "react";

/* ===== Внутрішні утиліти (локальні до компонента) ===== */
const effectiveStatusOf = (inv) => {
  const stored = String(inv?.status || "issued");
  if (stored === "paid") return "paid";
  const due = String(inv?.dueDate || "").slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (due && due < today) return "overdue";
  return stored;
};

/* ====== Узгоджений IconButton (локально) ====== */
const IconButton = ({
  title,
  onClick,
  variant = "secondary",
  children,
  disabled,
}) => {
  const base =
    "inline-flex items-center justify-center w-8 h-8 rounded-lg p-1.5 transition focus:outline-none focus:ring disabled:opacity-50 disabled:cursor-not-allowed";
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
      disabled={disabled}
    >
      {children}
    </button>
  );
};

/* ====== Mono icons (локально) ====== */
const IconPencil = () => (
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
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);
const IconDownload = () => (
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
    <path d="M21 15v4a2 2 0 1 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
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

/* ====== Confirm modal (локально) ====== */
function ConfirmModal({ open, title, message, onCancel, onConfirm }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-5 w-full max-w-md">
        <div className="text-lg font-semibold mb-2">{title}</div>
        <div className="text-sm text-gray-700 mb-4">{message}</div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Anuluj
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm}>
            Potwierdź
          </button>
        </div>
      </div>
    </div>
  );
}

/* ====== Preview modal (локально) ====== */
function PreviewModal({ open, src, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-5xl h-[80vh] flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <div className="font-semibold">Podgląd PDF</div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Zamknij
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <iframe
            key={src}
            title="PDF preview"
            src={src}
            className="w-full h-full"
          />
        </div>
      </div>
    </div>
  );
}

/* =======================================================================
   ГОЛОВНИЙ КОМПОНЕНТ ТАБЛИЦІ З ФІЛЬТРАМИ/ДІЯМИ/МОДАЛКАМИ
   ======================================================================= */
export default function InvoicesTable({
  // джерела даних
  invoices = [],
  pageSlice = [],
  filteredCount = 0,
  // вибір/сторінкування
  selected = [],
  setSelected = () => {},
  perPage = 50,
  setPerPage = () => {},
  pageSafe = 1,
  totalPages = 1,
  setPage = () => {},
  // фільтри
  searchClient = "",
  setSearchClient = () => {},
  searchNumber = "",
  setSearchNumber = () => {},
  dateFilter = "all",
  setDateFilter = () => {},
  customFrom = "",
  setCustomFrom = () => {},
  customTo = "",
  setCustomTo = () => {},
  statusFilter = "all",
  setStatusFilter = () => {},
  // дії над колекцією
  onBulkDelete = () => {},
  onBulkDownloadZip = () => {},
  onBulkExportEPPAndListPDF = () => {},
  // дії по рядку
  onUpdateStatus = () => {},
  onStartEdit = () => {},
  onOpenPreview = () => {},
  onDownloadOne = () => {},
  onAskDelete = () => {},
  // модалки
  confirmOpen = false,
  confirmTitle = "Potwierdź",
  confirmMessage = "",
  onCancelDelete = () => {},
  onConfirmDelete = () => {},
  previewOpen = false,
  previewSrc = "",
  onClosePreview = () => {},
}) {
  // локальний селект-all на сторінці
  const toggleSelectAllOnPage = () => {
    const pageFiles = pageSlice.map((i) => i.filename);
    const allSelected = pageFiles.every((f) => selected.includes(f));
    if (allSelected) {
      setSelected(selected.filter((f) => !pageFiles.includes(f)));
    } else {
      setSelected(Array.from(new Set([...selected, ...pageFiles])));
    }
  };

  return (
    <>
      {/* Фільтри + тулбар масових дій */}
      <div className="card-lg space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm mb-1">Klient</label>
            <input
              className="input"
              placeholder="Szukaj po kliencie"
              value={searchClient}
              onChange={(e) => {
                setSearchClient(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Numer</label>
            <input
              className="input"
              placeholder="Szukaj po numerze"
              value={searchNumber}
              onChange={(e) => {
                setSearchNumber(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Data</label>
            <select
              className="input"
              value={dateFilter}
              onChange={(e) => {
                setDateFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Wszystkie</option>
              <option value="today">Dzisiaj</option>
              <option value="week">Ten tydzień</option>
              <option value="month">Ten miesiąc</option>
              <option value="custom">Zakres</option>
            </select>
          </div>

          {dateFilter === "custom" && (
            <>
              <div>
                <label className="block text-sm mb-1">Od</label>
                <input
                  type="date"
                  className="input"
                  value={customFrom}
                  onChange={(e) => {
                    setCustomFrom(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Do</label>
                <input
                  type="date"
                  className="input"
                  value={customTo}
                  onChange={(e) => {
                    setCustomTo(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm mb-1">Status</label>
            <select
              className="input"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              title="Filtruj po statusie"
            >
              <option value="all">Wszystkie</option>
              <option value="issued">wystawiona</option>
              <option value="paid">opłacona</option>
              <option value="overdue">przeterminowana</option>
            </select>
          </div>

          <div className="flex-1" />

          <div className="flex gap-2">
            <IconButton
              title="Pobierz wybrane (ZIP)"
              onClick={onBulkDownloadZip}
              variant="secondary"
              disabled={!selected.length}
            >
              <IconDownload />
            </IconButton>

            <button
              className="btn-secondary"
              onClick={onBulkExportEPPAndListPDF}
              disabled={!selected.length}
              title="Eksport .epp + PDF lista"
              aria-label="Eksport EPP + PDF"
            >
              .epp + PDF
            </button>

            <IconButton
              title="Usuń zaznaczone"
              onClick={onBulkDelete}
              variant="danger"
              disabled={!selected.length}
            >
              <IconTrash />
            </IconButton>
          </div>
        </div>
      </div>

      {/* Таблиця + пагінація */}
      <div className="card-lg overflow-x-auto">
        <div className="mb-2 flex items-center gap-3">
          <label className="text-sm">Na stronę:</label>
          <select
            className="input w-24"
            value={perPage}
            onChange={(e) => {
              const v = Number(e.target.value) || 50;
              setPerPage(v);
              setPage(1);
            }}
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
          <div className="ml-auto text-sm text-gray-600">
            Wyniki: {filteredCount} • Strona {pageSafe}/{totalPages}
          </div>
        </div>

        <table className="table w-full">
          <thead>
            <tr>
              <th className="text-center" scope="col">
                <input
                  type="checkbox"
                  checked={
                    pageSlice.length > 0 &&
                    pageSlice.every((i) => selected.includes(i.filename))
                  }
                  onChange={toggleSelectAllOnPage}
                  aria-label="Zaznacz wszystkie na stronie"
                />
              </th>
              <th className="whitespace-nowrap" scope="col">
                #
              </th>
              <th className="whitespace-normal" scope="col">
                Klient
              </th>
              <th className="whitespace-nowrap text-right" scope="col">
                Brutto
              </th>
              <th className="whitespace-nowrap text-center" scope="col">
                Wystawiono
              </th>
              <th className="whitespace-nowrap text-center" scope="col">
                Termin
              </th>
              <th className="whitespace-nowrap text-center" scope="col">
                Status
              </th>
              <th className="whitespace-nowrap text-center" scope="col">
                Akcje
              </th>
            </tr>
          </thead>

          <tbody>
            {pageSlice.map((inv, idx) => {
              const indexInAll = invoices.indexOf(inv);
              const eff = effectiveStatusOf(inv);
              return (
                <tr key={`${inv.number}-${idx}`} className="hover:bg-gray-50">
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={selected.includes(inv.filename)}
                      onChange={() =>
                        setSelected((prev) =>
                          prev.includes(inv.filename)
                            ? prev.filter((f) => f !== inv.filename)
                            : [...prev, inv.filename]
                        )
                      }
                      aria-label={`Zaznacz ${inv.number}`}
                    />
                  </td>

                  <td className="whitespace-nowrap">{inv.number}</td>
                  <td className="whitespace-normal">{inv.client}</td>

                  <td className="text-right whitespace-nowrap">
                    {inv.gross} zł
                  </td>

                  <td className="text-center whitespace-nowrap">
                    {inv.issueDate}
                  </td>

                  <td className="text-center whitespace-nowrap">
                    {inv.dueDate}
                  </td>

                  <td className="text-center whitespace-nowrap">
                    <select
                      className={`input w-40 text-center font-medium rounded-md border ${
                        eff === "paid"
                          ? "bg-green-100 text-green-800 border-green-200"
                          : eff === "overdue"
                          ? "bg-rose-100 text-rose-800 border-rose-200"
                          : "bg-amber-100 text-amber-900 border-amber-200"
                      }`}
                      value={eff}
                      onChange={(e) => onUpdateStatus(inv, e.target.value)}
                      title={
                        eff !== (inv.status || "issued")
                          ? "Status nadpisany automatycznie (przeterminowana)"
                          : "Zmień status"
                      }
                    >
                      <option value="issued">wystawiona</option>
                      <option value="paid">opłacona</option>
                      <option value="overdue">przeterminowana</option>
                    </select>
                  </td>

                  <td className="text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <IconButton
                        title={`Edytuj ${inv.number}`}
                        onClick={() => onStartEdit(inv, indexInAll)}
                        variant="secondary"
                      >
                        <IconPencil />
                      </IconButton>

                      <IconButton
                        title={`Podgląd ${inv.number}`}
                        onClick={() => onOpenPreview(inv)}
                        variant="secondary"
                      >
                        <IconEye />
                      </IconButton>

                      <IconButton
                        title={`Pobierz ${inv.number}`}
                        onClick={() => onDownloadOne(inv)}
                        variant="secondary"
                      >
                        <IconDownload />
                      </IconButton>

                      <IconButton
                        title={`Usuń ${inv.number}`}
                        onClick={() => onAskDelete(inv)}
                        variant="danger"
                      >
                        <IconTrash />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              );
            })}

            {pageSlice.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-6 text-gray-500">
                  Brak wyników.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Пагінація */}
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setPage(Math.max(1, pageSafe - 1))}
            disabled={pageSafe <= 1}
          >
            ←
          </button>
          <div className="text-sm">
            Strona {pageSafe} z {totalPages}
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setPage(Math.min(totalPages, pageSafe + 1))}
            disabled={pageSafe >= totalPages}
          >
            →
          </button>
        </div>
      </div>

      {/* Модалки */}
      <ConfirmModal
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        onCancel={onCancelDelete}
        onConfirm={onConfirmDelete}
      />

      <PreviewModal
        open={previewOpen}
        src={previewSrc}
        onClose={onClosePreview}
      />
    </>
  );
}
