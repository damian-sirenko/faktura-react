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

/* === ЄДИНИЙ СТИЛЬ ІКОНОК === */
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
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8h14v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8z" />
    <path d="M10 12h4" />
  </svg>
);

export default function ClientList({
  clients,
  onSelect,
  onEdit,
  onDeleteRequest,
  selectable = false,
  checkedIds = [],
  onToggleCheck,
  onToggleCheckAll,
  showAbonFields = true,
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
  const sortedClients = [...clients]
    .map((c, idx) => ({
      ...c,
      __order: idx,
    }))
    .sort((a, b) => {
      const extractNum = (val) => {
        const m = String(val || "").match(/(\d+)/);
        return m ? parseInt(m[1], 10) : -Infinity;
      };

      const aNum = extractNum(a.id ?? a.ID);
      const bNum = extractNum(b.id ?? b.ID);

      if (aNum !== bNum) {
        return bNum - aNum; // DESC: 166, 165, 164…
      }

      // fallback: порядок з бекенду
      return b.__order - a.__order;
    });


  const idsOnPage = clients.map(idFromClient).filter(Boolean);
  const allOnPageChecked =
    idsOnPage.length > 0 &&
    idsOnPage.every((id) => checkedIds.includes(id)) &&
    checkedIds.length > 0;

  // тут ти вручну підганяєш ширину колонок у відсотках (міняй тільки числа)
  const COL_PCT = (() => {
    const base = {
      select: 4, // checkbox
      no: 6, // #
      id: 8, // ID
      name: 24, // Nazwa  ← ТУТ ТЕПЕР РУЧНЕ КЕРУВАННЯ
      email: 18, // Email
      phone: 10, // Telefon
      abon: 10, // Abonament
      actions: 20, // Akcje
    };

    return {
      select: `${base.select}%`,
      no: `${base.no}%`,
      id: `${base.id}%`,
      name: `${base.name}%`,
      email: `${base.email}%`,
      phone: `${base.phone}%`,
      abon: `${base.abon}%`,
      actions: `${base.actions}%`,
    };
  })();

  return (
    <div className="relative w-full max-w-full overflow-x-auto">
      <table className="table w-full table-fixed align-middle">
        <colgroup>
          {selectable && <col style={{ width: COL_PCT.select }} />}
          <col style={{ width: COL_PCT.no }} />
          <col style={{ width: COL_PCT.id }} />
          <col style={{ width: COL_PCT.name }} />
          <col style={{ width: COL_PCT.email }} />
          <col style={{ width: COL_PCT.phone }} />
          {showAbonFields && <col style={{ width: COL_PCT.abon }} />}
          <col style={{ width: COL_PCT.actions }} />
        </colgroup>

        <thead className="[&_th]:align-middle">
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
                />
              </th>
            )}
            <th className="text-center whitespace-nowrap">#</th>
            <th className="text-left whitespace-nowrap">ID</th>
            <th className="whitespace-normal break-words">Nazwa</th>
            <th className="whitespace-normal">Email</th>
            <th className="whitespace-normal">Telefon</th>
            {showAbonFields && <th className="whitespace-normal">Abonament</th>}
            <th className="text-center whitespace-nowrap">Akcje</th>
          </tr>
        </thead>

        <tbody className="[&_td]:align-middle">
          {sortedClients.map((c, i) => {
            const id = idFromClient(c);
            const name = c.name || "-";
            const email = c.email || "-";
            const phone = c.phone || "-";
            const abonament = c.subscription || "-";
            const rowClass = c.notice ? "bg-rose-50" : "";

            return (
              <tr key={id || i} className={`hover:bg-gray-50 ${rowClass}`}>
                {selectable && (
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={checkedIds.includes(id)}
                      onChange={(e) =>
                        onToggleCheck && onToggleCheck(id, e.target.checked)
                      }
                    />
                  </td>
                )}

                <td className="text-center">{i + 1}</td>
                <td className="whitespace-nowrap text-xs">{id}</td>
                <td className="break-words">{name}</td>
                <td
                  className="break-words cursor-pointer text-blue-600 hover:underline"
                  onClick={() => {
                    if (!email || email === "-") return;
                    navigator.clipboard.writeText(email);
                    setToastMsg("Email skopiowany");
                  }}
                  title="Kliknij, aby skopiować email"
                >
                  {email}
                </td>

                <td className="break-words">{phone}</td>

                {showAbonFields && <td>{abonament}</td>}

                <td className="text-center">
                  <div className="inline-flex items-center gap-2">
                    <button
                      onClick={() => onSelect(c)}
                      className="btn-primary btn-sm"
                    >
                      Szczegóły
                    </button>

                    <button
                      onClick={() => onEdit && onEdit(c)}
                      className="inline-flex items-center justify-center rounded-lg p-2 border border-blue-200 bg-blue-50 text-blue-700"
                    >
                      <IconEdit className="w-5 h-5" />
                    </button>

                    <button
                      onClick={() => onDeleteRequest && onDeleteRequest(c)}
                      className="inline-flex items-center justify-center rounded-lg p-2 border border-amber-200 bg-amber-50 text-amber-700"
                    >
                      <IconArchive className="w-5 h-5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {toastMsg && (
        <div className="fixed bottom-5 right-5 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
