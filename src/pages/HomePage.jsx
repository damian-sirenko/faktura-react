import React from "react";
import { Link } from "react-router-dom";

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
    strokeWidth="2.25"
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
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="4" rx="1" />
    <rect x="3" y="7" width="18" height="14" rx="2" />
    <line x1="9" y1="12" x2="15" y2="12" />
  </svg>
);

/* Новий значок “підпис/перо” */
const IconSignature = ({ className = "" }) => (
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
    <path d="M12 19l7-7-4-4-7 7-2 6z" />
    <circle cx="14.5" cy="9.5" r="1.25" />
    <path d="M3 22h18" />
  </svg>
);

export default function HomePage() {
  return (
    <div className="min-h-[70vh] flex items-center">
      <div className="max-w-6xl mx-auto w-full px-[20mm] py-6 md:px-6">
        {/* мобільно: 1 колонка; md: 2; xl: 4 — плитки завжди квадратні */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 place-items-center">
          <Link
            to="/generate"
            className="bg-blue-500 hover:bg-blue-600 text-white rounded-2xl shadow-soft w-full aspect-square md:w-56 md:h-56 flex items-center justify-center text-center transition"
          >
            <div>
              <IconInvoice className="w-20 h-20 text-white mx-auto mb-3" />
              <div className="text-lg font-semibold">Generuj faktury</div>
            </div>
          </Link>

          <Link
            to="/clients"
            className="bg-blue-500 hover:bg-blue-600 text-white rounded-2xl shadow-soft w-full aspect-square md:w-56 md:h-56 flex items-center justify-center text-center transition"
          >
            <div>
              <IconUsers className="w-20 h-20 text-white mx-auto mb-3" />
              <div className="text-lg font-semibold">Baza klientów</div>
            </div>
          </Link>

          <Link
            to="/saved"
            className="bg-blue-500 hover:bg-blue-600 text-white rounded-2xl shadow-soft w-full aspect-square md:w-56 md:h-56 flex items-center justify-center text-center transition"
          >
            <div>
              <IconArchive className="w-20 h-20 text-white mx-auto mb-3" />
              <div className="text-lg font-semibold">Zapisane faktury</div>
            </div>
          </Link>

          {/* 4-та плитка — той самий стиль/колір */}
          <Link
            to="/sign-queue?type=courier"
            className="bg-blue-500 hover:bg-blue-600 text-white rounded-2xl shadow-soft w-full aspect-square md:w-56 md:h-56 flex items-center justify-center text-center transition"
            title="Protokoły oczekujące na podpis"
          >
            <div>
              <IconSignature className="w-20 h-20 text-white mx-auto mb-3" />
              <div className="text-lg font-semibold">Protokoły do podpisu</div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
