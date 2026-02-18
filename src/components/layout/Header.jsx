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
    `inline-flex items-center whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition border ${
      isActive
        ? "bg-white text-[var(--primary-700)] border-white"
        : "bg-transparent text-white border-white hover:bg-blue-500 hover:text-white"
    }`;

  const [docsOpen, setDocsOpen] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);
  const hideDocsTimer = useRef(null);
  const hideClientsTimer = useRef(null);

  const openDocs = () => {
    if (hideDocsTimer.current) clearTimeout(hideDocsTimer.current);
    setDocsOpen(true);
  };
  const closeDocsSoon = () => {
    if (hideDocsTimer.current) clearTimeout(hideDocsTimer.current);
    hideDocsTimer.current = setTimeout(() => setDocsOpen(false), 350);
  };
  const toggleDocs = () => {
    if (hideDocsTimer.current) clearTimeout(hideDocsTimer.current);
    setDocsOpen((v) => !v);
  };

  const openClients = () => {
    if (hideClientsTimer.current) clearTimeout(hideClientsTimer.current);
    setClientsOpen(true);
  };
  const closeClientsSoon = () => {
    if (hideClientsTimer.current) clearTimeout(hideClientsTimer.current);
    hideClientsTimer.current = setTimeout(() => setClientsOpen(false), 350);
  };
  const toggleClients = () => {
    if (hideClientsTimer.current) clearTimeout(hideClientsTimer.current);
    setClientsOpen((v) => !v);
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [docsOpenMobile, setDocsOpenMobile] = useState(false);
  const [clientsOpenMobile, setClientsOpenMobile] = useState(false);

  useEffect(() => {
    setDocsOpen(false);
    setClientsOpen(false);
    setMenuOpen(false);
    setDocsOpenMobile(false);
    setClientsOpenMobile(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setDocsOpen(false);
        setClientsOpen(false);
        setMenuOpen(false);
        setDocsOpenMobile(false);
        setClientsOpenMobile(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (hideDocsTimer.current) clearTimeout(hideDocsTimer.current);
      if (hideClientsTimer.current) clearTimeout(hideClientsTimer.current);
    };
  }, []);

  const docsMatchA = useMatch("/documents/*");
  const docsMatchB = useMatch("/saved");
  const docsActive = !!docsMatchA || !!docsMatchB;

  const clientsMatchA = useMatch("/clients");
  const clientsMatchB = useMatch("/clients/*");
  const clientsActive = !!clientsMatchA || !!clientsMatchB;
  

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
    <header className="bg-blue-600 shadow-md sticky top-0 z-50 w-full">
      <div
        className={`w-full px-3 sm:px-4 md:px-6 lg:px-8 relative transition-all ${
          scrolled ? "py-1" : "py-3"
        }`}
      >
        <div className="w-full grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <div className="flex items-center">
            <Link
              to="/"
              className="flex items-center gap-3 text-white transition-all"
            >
              <img
                src="/img/steryl-serwis-logo.png"
                alt="Steryl Serwis"
                className={`w-auto transition-all ${
                  scrolled ? "h-8 lg:h-9" : "h-10 lg:h-12"
                }`}
              />
              <span className="pl-3 border-l border-blue-200 text-[22px] tracking-wide text-blue-100 font-bold">
                Panel
              </span>
            </Link>
          </div>

          <div className="hidden lg:flex justify-center">
            <nav className="flex items-center gap-2 flex-wrap py-2">
              <NavLink to="/" className={linkClass} end>
                Start
              </NavLink>

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
                      ? "bg-white text-[var(--primary-700)] border-white"
                      : "bg-transparent text-white border-white hover:bg-blue-500 hover:text-white"
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
                          ? "bg-white text-[var(--primary-700)]"
                          : "text-[var(--primary-700)] bg-white hover:bg-blue-500 hover:text-white"
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
                          ? "bg-white text-[var(--primary-700)]"
                          : "text-[var(--primary-700)] bg-white hover:bg-blue-500 hover:text-white"
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
                          ? "bg-white text-[var(--primary-700)]"
                          : "text-[var(--primary-700)] bg-white hover:bg-blue-500 hover:text-white"
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
                          ? "bg-white text-[var(--primary-700)]"
                          : "text-[var(--primary-700)] bg-white hover:bg-blue-500 hover:text-white"
                      }`
                    }
                  >
                    Archiwum
                  </NavLink>
                </div>
              </div>

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
                      ? "bg-white text-[var(--primary-700)] border-white"
                      : "bg-transparent text-white border-white hover:bg-blue-500 hover:text-white"
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
                          ? "bg-white text-[var(--primary-700)]"
                          : "text-[var(--primary-700)] bg-white hover:bg-blue-500 hover:text-white"
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
                          ? "bg-white text-[var(--primary-700)]"
                          : "text-[var(--primary-700)] bg-white hover:bg-blue-500 hover:text-white"
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
                          ? "bg-white text-[var(--primary-700)]"
                          : "text-[var(--primary-700)] bg-white hover:bg-blue-500 hover:text-white"
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

              <NavLink to="/sign-queue?type=courier" className={linkClass}>
                Do podpisu
              </NavLink>

              <NavLink to="/admin-counter" className={linkClass}>
                Ustawienia
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center justify-end gap-2">
            <div className="hidden lg:block">{AuthButton}</div>

            <button
              className="lg:hidden inline-flex items-center justify-center h-10 w-10 rounded-lg bg-blue-500 text-white hover:bg-white hover:text-blue-700 border border-white transition"
              aria-label="Menu"
              aria-expanded={menuOpen ? "true" : "false"}
              onClick={() => setMenuOpen((v) => !v)}
              type="button"
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
        </div>
      </div>

      {menuOpen && (
        <div className="lg:hidden border-t border-white/30 bg-blue-600">
          <nav className="px-3 sm:px-4 md:px-6 py-3 flex flex-col gap-2">
            <NavLink to="/" className={linkClass} end>
              Start
            </NavLink>

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
 