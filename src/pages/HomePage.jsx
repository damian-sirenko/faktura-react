// src/pages/HomePage.jsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../utils/api"; // перевірка сесії (401 → /login)
import ProtocolEntryModal from "../components/ProtocolEntryModal.jsx";

/* === Inline white vector icons (no deps) === */
const IconInvoice = ({ className = "" }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="15" y2="17" />
  </svg>
);

const IconUsers = ({ className = "" }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="3" />
    <circle cx="16.5" cy="10.5" r="3" />
    <path d="M2 20c0-3.2 3.2-5 6-5s6 1.8 6 5" />
    <path d="M10.5 20c0-2.6 2.7-4.2 6-4.2 3.3 0 5.5 1.6 5.5 4.2" />
  </svg>
);

const IconArchive = ({ className = "" }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="4" rx="1" />
    <rect x="3" y="7" width="18" height="14" rx="2" />
    <line x1="9" y1="12" x2="15" y2="12" />
  </svg>
);

const IconSignature = ({ className = "" }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 19l7-7-4-4-7 7-2 6z" />
    <circle cx="14.5" cy="9.5" r="1.25" />
    <path d="M3 22h18" />
  </svg>
);

/* Нові іконки під задачі */

const IconDocsStack = ({ className = "" }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="6" y="4" width="11" height="14" rx="1.5" />
    <path d="M9 8h5" />
    <path d="M9 11h5" />
    <path d="M9 14h3" />
    <path d="M9 2h8a2 2 0 0 1 2 2v11" />
  </svg>
);

const IconPackages = ({ className = "" }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="8" y="13" width="8" height="8" rx="1.5" />
  </svg>
);

const IconTable = ({ className = "" }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="9" y1="5" x2="9" y2="19" />
    <line x1="15" y1="5" x2="15" y2="19" />
  </svg>
);

export default function HomePage() {
  const [addOpen, setAddOpen] = useState(false);
  const [clients, setClients] = useState([]);
  const tileClass =
    "bg-blue-500 hover:bg-blue-600 text-white rounded-2xl shadow-soft flex items-center justify-center text-center transition home-tile";
  const iconClass =
    "text-white mx-auto mb-3 w-[clamp(42px,11vw,68px)] h-[clamp(42px,11vw,68px)]";
  const titleClass = "font-semibold break-words text-[16px]";

  // м'яка перевірка авторизації при вході на головну:
  // легкий запит до захищеного /settings (мінімальні дані).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await apiFetch("/settings", { method: "GET" });
      } catch (err) {
        const msg = String(err?.message || "");
        const is401 =
          err?.status === 401 || /401/.test(msg) || /unauthorized/i.test(msg);
        if (mounted && is401) {
          window.location.replace("/login");
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // підвантаження клієнтів для модального вікна протоколу
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch("/clients");
        if (!r.ok) return;
        const arr = await r.json().catch(() => []);
        if (alive && Array.isArray(arr)) {
          setClients(arr);
        }
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-[70vh] flex items-center pb-5">
      <div className="max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-6 py-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 md:gap-6 place-items-center">
          <Link
            to="/clients"
            className={tileClass}
          >
            <div>
              <IconUsers className={iconClass} />
              <div className={titleClass}>
                Baza klientów
              </div>
            </div>
          </Link>

          <Link
            to="/clients/prywatni/ewidencja"
            className={tileClass}
          >
            <div>
              <IconPackages className={iconClass} />
              <div className={titleClass}>
                "Na sztuki"
              </div>
            </div>
          </Link>

          <Link
            to="/saved"
            className={tileClass}
          >
            <div>
              <IconArchive className={iconClass} />
              <div className={titleClass}>
                Faktury
              </div>
            </div>
          </Link>

          <Link
            to="/documents/protocols"
            className={tileClass}
            title="Lista zapisanych protokołów"
          >
            <div>
              <IconDocsStack className={iconClass} />
              <div className={titleClass}>
                Protokoły
              </div>
            </div>
          </Link>

          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className={tileClass}
          >
            <div>
              <IconTable className={iconClass} />
              <div className={titleClass}>
                Dodaj wpis do protokołu
              </div>
            </div>
          </button>

          <Link
            to="/sign-queue?type=courier"
            className={tileClass}
            title="Protokoły oczekujące на podpis"
          >
            <div>
              <IconSignature className={iconClass} />
              <div className={titleClass}>
                Protokoły do podpisu
              </div>
            </div>
          </Link>
        </div>

        <ProtocolEntryModal
          isOpen={addOpen}
          onClose={() => setAddOpen(false)}
          clients={clients}
          preselect={null}
        />
      </div>
    </div>
  );
}
