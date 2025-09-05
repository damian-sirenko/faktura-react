import React, { useEffect, useRef, useState } from "react";
import { NavLink, Link, useLocation, useMatch } from "react-router-dom";

export default function Header() {
  const linkClass = ({ isActive }) =>
    `inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition border 
     ${
       isActive
         ? "bg-white text-blue-700 border-white"
         : "bg-blue-500 text-white border-white hover:bg-white hover:text-blue-700"
     }`;

  // Дропдаун для «Dokumenty» (десктоп)
  const [docsOpen, setDocsOpen] = useState(false);
  const hideTimer = useRef(null);

  const openDocs = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setDocsOpen(true);
  };
  const closeDocsSoon = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setDocsOpen(false), 350);
  };
  const toggleDocs = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setDocsOpen((v) => !v);
  };

  // ✅ Бургер для мобільного
  const [menuOpen, setMenuOpen] = useState(false);
  const [docsOpenMobile, setDocsOpenMobile] = useState(false);

  // Закривати меню при зміні маршруту та по ESC
  const location = useLocation();
  useEffect(() => {
    setDocsOpen(false);
    setMenuOpen(false);
    setDocsOpenMobile(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setDocsOpen(false);
        setMenuOpen(false);
        setDocsOpenMobile(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // підсвічувати кнопку «Dokumenty», якщо активні будь-які підсторінки
  // ❗ ВАЖЛИВО: викликати useMatch завжди, без короткого замикання
  const matchDocuments = useMatch("/documents/*");
  const matchSaved = useMatch("/saved");
  const docsActive = !!matchDocuments || !!matchSaved || false;

  return (
    <header className="bg-blue-600 shadow-md">
      <div className="container-app flex items-center justify-between gap-3">
        {/* Логотип */}
        <Link to="/" className="flex items-center gap-2 py-3 text-white">
          <span className="text-2xl" aria-hidden>
            🧾
          </span>
          <span className="text-xl font-bold">Faktura Serwis</span>
        </Link>

        {/* Меню — планшет/десктоп */}
        <nav className="hidden md:flex items-center gap-2 flex-wrap py-2">
          <NavLink to="/" className={linkClass} end>
            Start
          </NavLink>
          <NavLink to="/generate" className={linkClass}>
            Generuj faktury
          </NavLink>
          <NavLink to="/clients" className={linkClass}>
            Klienci
          </NavLink>

          {/* ▼ Dokumenty — ховер + клік + клавіатура (десктоп) */}
          <div
            className="relative"
            onMouseEnter={openDocs}
            onMouseLeave={closeDocsSoon}
            onFocus={openDocs}
            onBlur={closeDocsSoon}
          >
            <button
              type="button"
              aria-expanded={docsOpen ? "true" : "false"}
              aria-haspopup="menu"
              aria-controls="docs-menu"
              onClick={toggleDocs}
              className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition border ${
                docsActive
                  ? "bg-white text-blue-700 border-white"
                  : "bg-blue-500 text-white border-white hover:bg-white hover:text-blue-700"
              }`}
            >
              Dokumenty{" "}
              <span className="ml-1" aria-hidden>
                ▾
              </span>
            </button>

            <div
              id="docs-menu"
              role="menu"
              className={`absolute right-0 mt-1 w-56 rounded-lg border bg-white shadow z-50 ${
                docsOpen ? "block" : "hidden"
              }`}
              onMouseEnter={openDocs}
              onMouseLeave={closeDocsSoon}
            >
              <NavLink
                to="/saved"
                role="menuitem"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md transition ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-blue-700 bg-white hover:bg-blue-600 hover:text-white"
                  }`
                }
              >
                Faktury
              </NavLink>
              <NavLink
                to="/documents/protocols"
                role="menuitem"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md transition ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-blue-700 bg-white hover:bg-blue-600 hover:text-white"
                  }`
                }
              >
                Protokoły
              </NavLink>
              <NavLink
                to="/documents/tools"
                role="menuitem"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md transition ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-blue-700 bg-white hover:bg-blue-600 hover:text-white"
                  }`
                }
              >
                Narzędzia
              </NavLink>
            </div>
          </div>

          <NavLink to="/stats" className={linkClass}>
            Statystyki
          </NavLink>

          {/* ✅ Новий пункт */}
          <NavLink to="/sign-queue?type=courier" className={linkClass}>
            Do podpisu
          </NavLink>

          <NavLink to="/admin-counter" className={linkClass}>
            Ustawienia
          </NavLink>
        </nav>

        {/* Бургер — мобільні (< md) */}
        <button
          className="md:hidden inline-flex items-center justify-center h-10 w-10 rounded-lg bg-blue-500 text-white hover:bg-white hover:text-blue-700 border border-white transition"
          aria-label="Menu"
          aria-expanded={menuOpen ? "true" : "false"}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="sr-only">Otwórz menu</span>
          <div className="space-y-1.5">
            <span
              className={`block h-[2px] w-6 bg-current transition-transform ${
                menuOpen ? "translate-y-[7px] rotate-45" : ""
              }`}
            />
            <span
              className={`block h-[2px] w-6 bg-current transition-opacity ${
                menuOpen ? "opacity-0" : ""
              }`}
            />
            <span
              className={`block h-[2px] w-6 bg-current transition-transform ${
                menuOpen ? "-translate-y-[7px] -rotate-45" : ""
              }`}
            />
          </div>
        </button>
      </div>

      {/* Мобільне меню (slide-down), без зміни стилів кнопок */}
      {menuOpen && (
        <div className="md:hidden border-t border-white/30 bg-blue-600">
          <nav className="container-app py-3 flex flex-col gap-2">
            <NavLink to="/" className={linkClass} end>
              Start
            </NavLink>
            <NavLink to="/generate" className={linkClass}>
              Generuj faktury
            </NavLink>
            <NavLink to="/clients" className={linkClass}>
              Klienci
            </NavLink>

            {/* Dokumenty — простий акордеон на мобільному */}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setDocsOpenMobile((v) => !v)}
                className={`inline-flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition border ${
                  docsActive
                    ? "bg-white text-blue-700 border-white"
                    : "bg-blue-500 text-white border-white hover:bg-white hover:text-blue-700"
                }`}
                aria-expanded={docsOpenMobile ? "true" : "false"}
              >
                <span>Dokumenty</span>
                <span aria-hidden>{docsOpenMobile ? "▴" : "▾"}</span>
              </button>
              {docsOpenMobile && (
                <div className="pl-2 flex flex-col gap-2">
                  <NavLink to="/saved" className={linkClass}>
                    Faktury
                  </NavLink>
                  <NavLink to="/documents/protocols" className={linkClass}>
                    Protokoły
                  </NavLink>
                  <NavLink to="/documents/tools" className={linkClass}>
                    Narzędzia
                  </NavLink>
                </div>
              )}
            </div>

            <NavLink to="/stats" className={linkClass}>
              Statystyki
            </NavLink>
            <NavLink to="/sign-queue?type=courier" className={linkClass}>
              Do podpisu
            </NavLink>
            <NavLink to="/admin-counter" className={linkClass}>
              Ustawienia
            </NavLink>
          </nav>
        </div>
      )}
    </header>
  );
}
