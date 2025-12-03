import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { humanDateTime } from "../../utils/docStore.js";

// PL-місяці та формувач назви — як на DocumentsProtocols
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

function asMeta(p, clientsIndex = {}) {
  if (!p || !p.id || !p.month) return null;
  const entries = Array.isArray(p.entries) ? p.entries : [];
  if (!entries.length) return null;
  const maxDate =
    entries
      .map((e) => e?.date)
      .filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .slice(-1)[0] || `${p.month}-01`;
  const createdAt = new Date(`${maxDate}T00:00:00.000Z`).toISOString();
  const clientName =
    (clientsIndex[p.id]?.name || "").trim() ||
    String(p.clientName || p.id || "").trim();
  return {
    id: `${p.id}:${p.month}`,
    clientId: p.id,
    clientName,
    month: p.month,
    createdAt,
  };
}

/**
 * props:
 * - protocols: RAW протоколи (масив об'єктів з /protocols для КОНКРЕТНОГО клієнта)
 * - loading: boolean
 * - clientName?: string (опційно; якщо не передати — спробує з даних протоколу)
 * - clientsIndex?: { [clientId]: {name: string} } (опційно)
 */
export default function ClientProtocolsList({
  protocols = [],
  loading = false,
  clientName,
  clientsIndex = {},
}) {
  const navigate = useNavigate();

  const items = useMemo(() => {
    const metas = (protocols || [])
      .map((p) => asMeta(p, clientsIndex))
      .filter(Boolean)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return metas;
  }, [protocols, clientsIndex]);

  if (loading) {
    return <div className="p-3 text-gray-600">Ładowanie…</div>;
  }
  if (!items.length) {
    return (
      <div className="p-6 text-center text-gray-500">
        Brak zapisanych protokołów dla tego klienta.
      </div>
    );
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-3 py-2 text-sm text-gray-600 bg-blue-50 border-b">
        Zapisane: {items.length}
      </div>
      <table className="table w-full">
        <thead>
          <tr className="bg-gray-50">
            <th className="w-[6ch] text-center">#</th>
            <th>Nazwa protokołu</th>
            <th className="w-[16ch] text-center">Miesiąc</th>
            <th className="w-[10ch] text-center">Rok</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => {
            const { year, monthWord } = monthParts(it.month);
            const title = `Protokół_${monthWord}_${year}_${
              clientName || it.clientName || ""
            }`;
            return (
              <tr key={it.id} className="hover:bg-gray-50">
                <td className="text-center">{idx + 1}</td>
                <td className="truncate">
                  <button
                    type="button"
                    className="text-blue-700 hover:underline"
                    onClick={() =>
                      navigate(
                        `/documents/protocols/${encodeURIComponent(
                          it.clientId
                        )}/${it.month}`
                      )
                    }
                    title="Otwórz stronę protokołu"
                  >
                    {title}
                  </button>
                  <div className="text-[11px] text-gray-500">
                    Utworzono: {humanDateTime(it.createdAt)}
                  </div>
                </td>
                <td className="text-center capitalize">{monthWord}</td>
                <td className="text-center">{year}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
