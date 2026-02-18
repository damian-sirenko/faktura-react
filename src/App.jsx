// src/App.jsx
import React, { useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  Link,
} from "react-router-dom";

import { apiFetch, setAuthToken } from "./utils/api";

// Сторінки
import ClientsPage from "./pages/ClientsPage";
import SavedInvoicesPage from "./pages/SavedInvoicesPage";
import CounterAdmin from "./pages/CounterAdmin";
import Header from "./components/layout/Header";
import Footer from "./components/layout/Footer";
import HomePage from "./pages/HomePage";
import StatsPage from "./pages/StatsPage.jsx";
import SignQueue from "./pages/SignQueue";
import SignaturesLab from "./pages/SignaturesLab";
import DocumentsProtocols from "./pages/DocumentsProtocols.jsx";
import ProtocolView from "./pages/ProtocolView.jsx";
import DocumentsTools from "./pages/DocumentsTools.jsx";
import PrivateSterilizationLog from "./pages/PrivateSterilizationLog.jsx";
import ClientsAbonPage from "./pages/ClientsAbonPage";
import ClientsPrivatePage from "./pages/ClientsPrivatePage";
import ClientsArchivePage from "./pages/ClientsArchivePage";
import LoginPage from "./pages/LoginPage";

/* ===== Helpers for UX ===== */
function ScrollToTop() {
  const loc = useLocation();
  useEffect(() => {
    // "instant" не є стандартним значенням; ставимо "auto"
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [loc.pathname, loc.search]);
  return null;
}

function RouteTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    const map = [
      [/^\/$/, "Strona główna • Panel faktur"],
      [/^\/generate$/, "Generuj faktury • Panel faktur"],
      [/^\/clients$/, "Baza klientów • Panel faktur"],
      [/^\/stats$/, "Statystyki • Panel faktur"],
      [/^\/saved$/, "Zapisane faktury • Panel faktur"],
      [/^\/admin-counter$/, "Ustawienia i licznik • Panel faktur"],
      [/^\/sign-queue/, "Protokoły do podpisu • Panel faktur"],
      [/^\/signatures-lab$/, "Laboratorium podpisów • Panel faktur"],
      [
        /^\/documents\/protocols\/[^/]+\/\d{4}-\d{2}$/,
        "Protokół • Panel faktur",
      ],
      [/^\/documents\/protocols$/, "Dokumenty → Protokoły • Panel faktur"],
      [/^\/documents\/invoices$/, "Dokumenty → Faktury • Panel faktur"],
      [/^\/documents\/tools$/, "Dokumenty → Narzędzia • Panel faktur"],
      [/^\/login$/, "Logowanie • Panel faktur"],
    ];

    const title = map.find(([re]) => re.test(pathname))?.[1] || "Panel faktur";
    document.title = title;
  }, [pathname]);

  return null;
}

function NotFound() {
  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="text-2xl font-bold mb-2">404 — Nie znaleziono strony</div>
      <div className="text-gray-600">
        Sprawdź adres lub wróć na stronę główną.
      </div>
      <Link className="btn-primary inline-block mt-4" to="/">
        ← Wróć do startu
      </Link>
    </div>
  );
}

/* ===== Проста «брама»: все, крім /login, перевіряється через /auth/me ===== */
function AuthGate({ children }) {
  const [state, setState] = React.useState({ loading: true, ok: false });

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = localStorage.getItem("auth:token") || "";
        if (saved) setAuthToken(saved);

        const r = await apiFetch("/auth/me");
        if (alive) setState({ loading: false, ok: r.ok });
      } catch {
        if (alive) setState({ loading: false, ok: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state.loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        Ładowanie…
      </div>
    );
  }

  if (!state.ok) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const basename = "/";

  return (
    <Router basename={basename}>
      <ScrollToTop />
      <RouteTitle />

      <div className="flex flex-col min-h-dvh">
        <Header />

        <main className="flex-1 min-h-0 max-w-6xl mx-auto w-full px-3 sm:px-4 md:px-6 py-2 sm:py-4">
          <Routes>
            {/* Публічний логін */}
            <Route path="/login" element={<LoginPage />} />

            {/* Усі інші — за AuthGate */}
            <Route
              path="/"
              element={
                <AuthGate>
                  <HomePage />
                </AuthGate>
              }
            />

            {/* FIX: /generate не повинен рендерити порожній <AuthGate> */}
            <Route
              path="/generate"
              element={<Navigate to="/documents/invoices" replace />}
            />

            <Route
              path="/clients"
              element={<Navigate to="/clients/abonamentowi" replace />}
            />
            <Route
              path="/stats"
              element={
                <AuthGate>
                  <StatsPage />
                </AuthGate>
              }
            />
            <Route
              path="/saved"
              element={
                <AuthGate>
                  <SavedInvoicesPage />
                </AuthGate>
              }
            />
            <Route
              path="/admin-counter"
              element={
                <AuthGate>
                  <CounterAdmin />
                </AuthGate>
              }
            />
            <Route
              path="/sign-queue"
              element={
                <AuthGate>
                  <SignQueue />
                </AuthGate>
              }
            />
            <Route
              path="/signatures-lab"
              element={
                <AuthGate>
                  <SignaturesLab />
                </AuthGate>
              }
            />
            <Route
              path="/clients/prywatni/ewidencja"
              element={
                <AuthGate>
                  <PrivateSterilizationLog />
                </AuthGate>
              }
            />
            <Route
              path="/documents/protocols/:clientId/:month"
              element={
                <AuthGate>
                  <ProtocolView />
                </AuthGate>
              }
            />
            <Route
              path="/documents/invoices"
              element={
                <AuthGate>
                  <div className="p-4">Faktury (w przygotowaniu)</div>
                </AuthGate>
              }
            />
            <Route
              path="/documents/protocols"
              element={
                <AuthGate>
                  <DocumentsProtocols />
                </AuthGate>
              }
            />
            <Route
              path="/documents/tools"
              element={
                <AuthGate>
                  <DocumentsTools />
                </AuthGate>
              }
            />
            <Route
              path="/clients/abonamentowi"
              element={
                <AuthGate>
                  <ClientsAbonPage />
                </AuthGate>
              }
            />
            <Route
              path="/clients/prywatni"
              element={
                <AuthGate>
                  <ClientsPrivatePage />
                </AuthGate>
              }
            />
            <Route
              path="/clients/archiwum"
              element={
                <AuthGate>
                  <ClientsArchivePage />
                </AuthGate>
              }
            />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>

        <Footer />
      </div>
    </Router>
  );
}
