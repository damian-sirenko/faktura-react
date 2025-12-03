// src/components/clients/ClientList.jsx
import React, { useState, useEffect } from "react";

// узгоджено з бекендом: стабільний slug без діакритиків
function stripDiacritics(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function normalizeKey(s) {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function slugFromName(name) {
  return normalizeKey(name).replace(/\s+/g, "-");
}
function idFromClient(c) {
  const direct = String(c.id || c.ID || "").trim();
  if (direct) return direct;
  const name = c.name || c.Klient || "";
  return slugFromName(name);
}

/* === ЄДИНИЙ СТИЛЬ ІКОНОК: кольорова іконка на світлому фоні === */
const IconEdit = ({ className = "" }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

/* 🆕 Іконка архіву замість смітника */
const IconArchive = ({ className = "" }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.0"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {/* кришка коробки */}
    <rect x="3" y="4" width="18" height="4" rx="1" />
    {/* корпус коробки */}
    <path d="M5 8h14v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8z" />
    {/* маленька ручка */}
    <path d="M10 12h4" />
  </svg>
);

export default function ClientList({
  clients,
  onSelect,
  onEdit,
  onDeleteRequest,
  // ▼ нове
  selectable = false,
  checkedIds = [],
  onToggleCheck,
  onToggleCheckAll,
  showAbonFields = true,

  /* 🆕 керування відображенням ID у вкладці "na sztuki" */
  showIdBeforeName = false,
  idCellMaxChars = 10,
}) {
  const [toastMsg, setToastMsg] = useState("");
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(""), 2000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  if (!Array.isArray(clients) || clients.length === 0) {
    return <div className="card">Brak klientów w bazie.</div>;
  }

  // використовуємо стабільні id; порожні не враховуємо
  const idsOnPage = clients.map(idFromClient).filter(Boolean);
  const allOnPageChecked =
    idsOnPage.length > 0 &&
    idsOnPage.every((id) => checkedIds.includes(id)) &&
    checkedIds.length > 0;

  return (
    <div className="overflow-x-hidden relative">
      <table className="table w-full">
        <thead>
          <tr>
            {selectable && (
              <th className="text-center whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={allOnPageChecked}
                  onChange={(e) =>
                    onToggleCheckAll &&
                    onToggleCheckAll(idsOnPage, e.target.checked)
                  }
                  aria-label="Zaznacz wszystkich na stronie"
                />
              </th>
            )}
            <th className="text-center whitespace-nowrap">#</th>

            {/* 🆕 Колонка ID — тільки коли потрібно показувати перед назвою */}
            {showIdBeforeName && (
              <th className="whitespace-normal text-left">ID</th>
            )}

            <th className="whitespace-normal">Nazwa</th>
            <th className="whitespace-nowrap">Email</th>
            <th className="whitespace-nowrap">Telefon</th>
            {showAbonFields && (
              <th className="whitespace-nowrap hidden md:table-cell">
                Abonament
              </th>
            )}
            {showAbonFields && (
              <th className="whitespace-nowrap text-right hidden md:table-cell">
                Kwota ab.
              </th>
            )}
            <th className="text-center whitespace-nowrap">Akcje</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c, i) => {
            const id = idFromClient(c);
            const name = c.name || c.Klient || "-";
            const email = c.email || c.Email || "-";
            const phone = c.phone ?? c.Telefon ?? "-";
            const phoneStr =
              phone == null || phone === "-" ? "-" : String(phone);
            const abonament =
              c.subscription ?? c.Abonament ?? c.abonament ?? "-";
            const abonamentAmountRaw =
              c.subscriptionAmount ??
              c["Kwota abonamentu"] ??
              c.abonamentAmount ??
              0;
            const abonamentAmount = Number(abonamentAmountRaw) || 0;
            const abonamentAmountStr = abonamentAmount
              ? `${abonamentAmount.toFixed(2)} zł`
              : "-";
            const rowClass = c.notice ? "bg-rose-50" : "";

            const rowChecked = selectable && id && checkedIds.includes(id);

            // для tel: створюємо безпечний номер (допускаємо + на початку)
            const telHref = (() => {
              if (!phoneStr || phoneStr === "-") return null;
              const cleaned = phoneStr.replace(/[^+\d]/g, "");
              return cleaned.length >= 6 ? `tel:${cleaned}` : null;
            })();

            return (
              <tr
                key={id || `${name}-${i}`}
                className={`hover:bg-gray-50 ${rowClass}`}
              >
                {selectable && (
                  <td className="text-center whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={!!rowChecked}
                      onChange={(e) =>
                        onToggleCheck && onToggleCheck(id, e.target.checked)
                      }
                      aria-label={`Zaznacz klienta ${name}`}
                    />
                  </td>
                )}

                <td className="text-center whitespace-nowrap">{i + 1}</td>

                {/* 🆕 Комірка з ID перед назвою */}
                {showIdBeforeName && (
                  <td
                    className="whitespace-normal break-words leading-tight text-xs font-medium text-gray-700"
                    style={{ maxWidth: `${idCellMaxChars}ch` }}
                    title={id || "-"}
                  >
                    {id || "—"}
                  </td>
                )}

                <td className="whitespace-normal">
                  <div className="flex items-start gap-2">
                    <span>{name}</span>
                    {c.notice && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 whitespace-nowrap mt-0.5">
                        wypowiedzenie
                      </span>
                    )}
                  </div>
                </td>

                {/* 🆕 Email — клікабельний, копіює у буфер */}
                <td
                  className="max-w-[240px] whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer text-blue-700 hover:underline"
                  title="Kliknij, aby skopiować e-mail"
                  onClick={() => {
                    if (email && email !== "-") {
                      navigator.clipboard.writeText(email);
                      setToastMsg("Skopiowano e-mail: " + email);
                    }
                  }}
                >
                  {email || "-"}
                </td>

                {/* Telefon — КЛІКАБЕЛЬНИЙ tel: */}
                <td
                  className="max-w-[160px] whitespace-nowrap overflow-hidden text-ellipsis"
                  title={phoneStr}
                >
                  {telHref ? (
                    <a href={telHref} className="btn-link">
                      {phoneStr}
                    </a>
                  ) : (
                    phoneStr
                  )}
                </td>

                {showAbonFields && (
                  <td
                    className="max-w-[220px] whitespace-nowrap overflow-hidden text-ellipsis hidden md:table-cell"
                    title={abonament || "-"}
                  >
                    {abonament || "-"}
                  </td>
                )}

                {showAbonFields && (
                  <td className="text-right whitespace-nowrap hidden md:table-cell">
                    {abonamentAmountStr}
                  </td>
                )}

                <td className="text-center whitespace-nowrap">
                  {/* Zielona “Szczegóły” */}
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    className="inline-flex items-center rounded-lg px-3 py-1 text-sm font-semibold bg-green-600 text-white hover:bg-green-700 focus:ring-2 focus:ring-green-400 mr-2"
                    title="Szczegóły klienta"
                  >
                    Szczegóły
                  </button>

                  <span className="hidden md:inline-flex items-center gap-2 align-middle">
                    <button
                      type="button"
                      onClick={() => onEdit && onEdit(c)}
                      title="Edytuj"
                      aria-label="Edytuj"
                      className="inline-flex items-center justify-center rounded-lg p-2 border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 focus:ring-2 focus:ring-blue-300 shadow-soft transition"
                    >
                      <IconEdit className="w-5 h-5" />
                    </button>

                    {/* Архівація */}
                    <button
                      type="button"
                      onClick={() => onDeleteRequest && onDeleteRequest(c)}
                      title="Archiwizuj"
                      aria-label="Archiwizuj"
                      className="inline-flex items-center justify-center rounded-lg p-2 border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 focus:ring-2 focus:ring-amber-300 shadow-soft transition"
                    >
                      <IconArchive className="w-5 h-5" />
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 🆕 Toast повідомлення */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm animate-fadeIn">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
