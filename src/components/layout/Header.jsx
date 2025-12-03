import React, { useEffect, useRef, useState } from "react";
import {
  NavLink,
  Link,
  useLocation,
  useMatch,
  useNavigate,
} from "react-router-dom";
import { apiFetch, setAuthToken } from "../../utils/api";

export default function Header() {
  const nav = useNavigate();
  const location = useLocation();

  // ===== auth state =====
  const [isAuthed, setIsAuthed] = useState(false);
  const onLoginPage = location.pathname === "/login";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch("/auth/me");
        if (alive) setIsAuthed(r.ok);
      } catch {
        if (alive) setIsAuthed(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [location.pathname]);

  async function handleLogout() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {}
    setAuthToken("");
    setIsAuthed(false);
    nav("/login", { replace: true });
  }

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

  // Дропдаун для «Klienci» (десктоп)
  const [clientsOpen, setClientsOpen] = useState(false);
  const clientsHideTimer = useRef(null);

  const openClients = () => {
    if (clientsHideTimer.current) clearTimeout(clientsHideTimer.current);
    setClientsOpen(true);
  };
  const closeClientsSoon = () => {
    if (clientsHideTimer.current) clearTimeout(clientsHideTimer.current);
    clientsHideTimer.current = setTimeout(() => setClientsOpen(false), 350);
  };
  const toggleClients = () => {
    if (clientsHideTimer.current) clearTimeout(clientsHideTimer.current);
    setClientsOpen((v) => !v);
  };

  // ✅ Бургер для мобільного
  const [menuOpen, setMenuOpen] = useState(false);
  const [docsOpenMobile, setDocsOpenMobile] = useState(false);
  const [clientsOpenMobile, setClientsOpenMobile] = useState(false);

  // Закривати меню при зміні маршруту та по ESC
  useEffect(() => {
    setDocsOpen(false);
    setMenuOpen(false);
    setDocsOpenMobile(false);
    setClientsOpen(false);
    setClientsOpenMobile(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setDocsOpen(false);
        setMenuOpen(false);
        setDocsOpenMobile(false);
        setClientsOpen(false);
        setClientsOpenMobile(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (clientsHideTimer.current) clearTimeout(clientsHideTimer.current);
    };
  }, []);

  // підсвічування активних пунктів
  const matchDocuments = useMatch("/documents/*");
  const matchSaved = useMatch("/saved");
  const docsActive = !!matchDocuments || !!matchSaved || false;

  const matchClientsRoot = useMatch("/clients");
  const matchClientsAny = useMatch("/clients/*");
  const clientsActive = !!matchClientsAny || !!matchClientsRoot || false;

  // Кнопка логін/лог-аут (прихована на /login)
  const AuthButton = onLoginPage ? null : isAuthed ? (
    <button
      type="button"
      onClick={handleLogout}
      className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition border bg-white text-blue-700 border-white hover:bg-blue-50"
      title="Wyloguj"
    >
      Wyloguj
    </button>
  ) : (
    <NavLink
      to="/login"
      className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition border bg-blue-500 text-white border-white hover:bg-white hover:text-blue-700"
      title="Zaloguj się"
    >
      Zaloguj się
    </NavLink>
  );

  return (
    <header className="bg-blue-600 shadow-md sticky top-0 z-40 w-full">
      <div
        className={`w-full mx-auto px-3 sm:px-4 md:px-6 lg:px-8 relative flex items-center justify-between gap-3 transition-all ${
          scrolled ? "py-1" : "py-3"
        }`}
      >
        {/* Логотип (зліва) */}
        <Link
          to="/"
          className="flex items-center gap-3 text-white transition-all"
        >
          <img
            src="/img/steryl-serwis-logo.png"
            alt="Steryl Serwis"
            className={`w-auto transition-all ${
              scrolled ? "h-8 md:h-9" : "h-10 md:h-12"
            }`}
          />
          <span className="pl-3 border-l border-blue-200 text-[22px] tracking-wide text-blue-100 font-bold">
            Test
          </span>
        </Link>

        {/* Меню — планшет/десктоп (центр) */}
        <nav className="hidden md:flex items-center gap-2 flex-wrap py-2">
          <NavLink to="/" className={linkClass} end>
            Start
          </NavLink>

          {/* ▼ Klienci — ховер + клік (десктоп) */}
          <div
            className="relative"
            onMouseEnter={openClients}
            onMouseLeave={closeClientsSoon}
            onFocus={openClients}
            onBlur={closeClientsSoon}
          >
            <button
              type="button"
              aria-expanded={clientsOpen ? "true" : "false"}
              aria-haspopup="menu"
              aria-controls="clients-menu"
              onClick={toggleClients}
              className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition border ${
                clientsActive
                  ? "bg-white text-blue-700 border-white"
                  : "bg-blue-500 text-white border-white hover:bg-white hover:text-blue-700"
              }`}
            >
              Klienci{" "}
              <span className="ml-1" aria-hidden>
                ▾
              </span>
            </button>

            <div
              id="clients-menu"
              role="menu"
              className={`absolute left-0 mt-1 w-64 rounded-lg border bg-white shadow z-50 ${
                clientsOpen ? "block" : "hidden"
              }`}
              onMouseEnter={openClients}
              onMouseLeave={closeClientsSoon}
            >
              <NavLink
                to="/clients/abonamentowi"
                role="menuitem"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md transition ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-blue-700 bg-white hover:bg-blue-600 hover:text-white"
                  }`
                }
              >
                Abonamentowi
              </NavLink>

              <NavLink
                to="/clients/prywatni"
                role="menuitem"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md transition ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-blue-700 bg-white hover:bg-blue-600 hover:text-white"
                  }`
                }
              >
                Prywatni
              </NavLink>

              <NavLink
                to="/clients/prywatni/ewidencja"
                role="menuitem"
                className={({ isActive }) =>
                  `block pl-6 pr-3 py-2 rounded-md transition ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-blue-700 bg-white hover:bg-blue-600 hover:text-white"
                  }`
                }
                title="Ewidencja sterylizacji prywatnej"
              >
                Ewidencja sterylizacji prywatnej
              </NavLink>

              <NavLink
                to="/clients/archiwum"
                role="menuitem"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md transition ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-blue-700 bg-white hover:bg-blue-600 hover:text-white"
                  }`
                }
              >
                Archiwum
              </NavLink>
            </div>
          </div>

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

          <NavLink
            to="/sign-queue?type=courier"
            className={(props) => `hidden lg:inline-flex ${linkClass(props)}`}
          >
            Do podpisu
          </NavLink>

          <NavLink to="/admin-counter" className={linkClass}>
            Ustawienia
          </NavLink>
        </nav>

        {/* Кнопка логін/вилог — десктоп, справа в потоці */}
        <div className="hidden md:block ml-3">{AuthButton}</div>

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

      {/* Мобільне меню (slide-down) */}
      {menuOpen && (
        <div className="md:hidden border-t border-white/30 bg-blue-600">
          <nav className="container-app py-3 flex flex-col gap-2">
            <NavLink to="/" className={linkClass} end>
              Start
            </NavLink>

            {/* Klienci — мобільний акордеон */}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setClientsOpenMobile((v) => !v)}
                className={`inline-flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition border ${
                  clientsActive
                    ? "bg-white text-blue-700 border-white"
                    : "bg-blue-500 text-white border-white hover:bg-white hover:text-blue-700"
                }`}
                aria-expanded={clientsOpenMobile ? "true" : "false"}
              >
                <span>Klienci</span>
                <span aria-hidden>{clientsOpenMobile ? "▴" : "▾"}</span>
              </button>
              {clientsOpenMobile && (
                <div className="pl-2 flex flex-col gap-2">
                  <NavLink to="/clients/abonamentowi" className={linkClass}>
                    Abonamentowi
                  </NavLink>
                  <NavLink to="/clients/prywatni" className={linkClass}>
                    Prywatni
                  </NavLink>
                  <NavLink
                    to="/clients/prywatni/ewidencja"
                    className={linkClass}
                  >
                    — Ewidencja sterylizacji prywatnej
                  </NavLink>
                  <NavLink to="/clients/archiwum" className={linkClass}>
                    Archiwum
                  </NavLink>
                </div>
              )}
            </div>

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
            <NavLink
              to="/sign-queue?type=courier"
              className={(props) => `hidden ${linkClass(props)}`}
            >
              Do podpisu
            </NavLink>

            <NavLink to="/admin-counter" className={linkClass}>
              Ustawienia
            </NavLink>

            {/* ===== Mobile: Login/Logout (приховано на /login) ===== */}
            {!onLoginPage &&
              (isAuthed ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition border bg-white text-blue-700 border-white hover:bg-blue-50"
                  title="Wyloguj"
                >
                  Wyloguj
                </button>
              ) : (
                <NavLink
                  to="/login"
                  className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold transition border bg-blue-500 text-white border-white hover:bg-white hover:text-blue-700"
                  title="Zaloguj się"
                >
                  Zaloguj się
                </NavLink>
              ))}
          </nav>
        </div>
      )}
    </header>
  );
}
