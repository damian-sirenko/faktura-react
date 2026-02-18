// src/pages/HomePage.jsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../utils/api"; // перевірка сесії (401 → /login)

/* === Inline white vector icons (no deps) === */
const IconInvoice = ({ className = "" }) => (
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
    strokeWidth="1.15"
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
    strokeWidth="1.15"
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
    strokeWidth="1.15"
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
    strokeWidth="1.15"
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
    strokeWidth="1.15"
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
    strokeWidth="1.15"
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
  const [clients, setClients] = useState([]);

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

  return (
    <div className="min-h-[70vh] flex items-center md:pt-6 lg:pt-10">
      <div className="w-full flex justify-center">
        <div className="inline-grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
          <Link
            to="/clients"
            className="bg-blue-500 hover:bg-blue-600 text-white rounded-2xl shadow-soft w-[142px] sm:w-[170px] md:w-[210px]
 aspect-square flex items-center justify-center text-center px-2 py-2 sm:px-4 sm:py-4 transition"
          >
            <div>
              <IconUsers className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 text-white mx-auto mb-2 sm:mb-3" />
              <div className="text-xs sm:text-sm md:text-lg lg:text-xl font-semibold break-words">
                Baza klientów
              </div>
            </div>
          </Link>

          <Link
            to="/clients/prywatni/ewidencja"
            className="bg-blue-500 hover:bg-blue-600 text-white rounded-2xl shadow-soft w-[142px] sm:w-[170px] md:w-[210px]
 aspect-square flex items-center justify-center text-center px-2 py-2 sm:px-4 sm:py-4 transition"
          >
            <div>
              <IconPackages className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 text-white mx-auto mb-2 sm:mb-3" />
              <div className="text-xs sm:text-sm md:text-lg lg:text-xl font-semibold break-words">
                "Na sztuki"
              </div>
            </div>
          </Link>

          <Link
            to="/saved"
            className="bg-blue-500 hover:bg-blue-600 text-white rounded-2xl shadow-soft w-[142px] sm:w-[170px] md:w-[210px]
 aspect-square flex items-center justify-center text-center px-2 py-2 sm:px-4 sm:py-4 transition"
          >
            <div>
              <IconArchive className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 text-white mx-auto mb-2 sm:mb-3" />
              <div className="text-xs sm:text-sm md:text-lg lg:text-xl font-semibold break-words">
                Faktury
              </div>
            </div>
          </Link>

          <Link
            to="/documents/protocols"
            className="bg-blue-500 hover:bg-blue-600 text-white rounded-2xl shadow-soft w-[142px] sm:w-[170px] md:w-[210px]
 aspect-square flex items-center justify-center text-center px-2 py-2 sm:px-4 sm:py-4 transition"
            title="Lista zapisanych protokołów"
          >
            <div>
              <IconDocsStack className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 text-white mx-auto mb-2 sm:mb-3" />
              <div className="text-xs sm:text-sm md:text-lg lg:text-xl font-semibold break-words">
                Protokoły
              </div>
            </div>
          </Link>

          <Link
            to="/protocol-entry"
            className="bg-blue-500 hover:bg-blue-600 text-white rounded-2xl shadow-soft w-[142px] sm:w-[170px] md:w-[210px]
 aspect-square flex items-center justify-center text-center px-2 py-2 sm:px-4 sm:py-4 transition"
          >
            <div>
              <IconTable className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 text-white mx-auto mb-2 sm:mb-3" />
              <div className="text-xs sm:text-sm md:text-lg lg:text-xl font-semibold break-words">
                Dodaj wpis do protokołu
              </div>
            </div>
          </Link>

          <Link
            to="/sign-queue?type=courier"
            className="bg-blue-500 hover:bg-blue-600 text-white rounded-2xl shadow-soft w-[142px] sm:w-[170px] md:w-[210px]
 aspect-square flex items-center justify-center text-center px-2 py-2 sm:px-4 sm:py-4 transition"
            title="Protokoły oczekujące на podpis"
          >
            <div>
              <IconSignature className="w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 text-white mx-auto mb-2 sm:mb-3" />
              <div className="text-xs sm:text-sm md:text-lg lg:text-xl font-semibold break-words">
                Protokoły do podpisu
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
