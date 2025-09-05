// src/App.jsx
import React, { useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";

import ClientsPage from "./pages/ClientsPage";
import GenerateInvoicesPage from "./pages/GenerateInvoicesPage";
import SavedInvoicesPage from "./pages/SavedInvoicesPage";
import CounterAdmin from "./pages/CounterAdmin";
import Header from "./components/layout/Header";
import Footer from "./components/layout/Footer";
import HomePage from "./pages/HomePage"; // ⬅️ додано
import StatsPage from "./pages/StatsPage.jsx";
import SignQueue from "./pages/SignQueue";
import SignaturesLab from "./pages/SignaturesLab";
import DocumentsProtocols from "./pages/DocumentsProtocols.jsx";
import ProtocolView from "./pages/ProtocolView.jsx";

/* ===== Helpers for UX ===== */
function ScrollToTop() {
  const loc = useLocation();
  useEffect(() => {
    // миттєво, без анімації (для форм/таблиць з великою висотою)
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
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
    ];

    const title = map.find(([re]) => re.test(pathname))?.[1] || "Panel faktur"; // fallback
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
      <a className="btn-primary inline-block mt-4" href="/">
        ← Wróć do startu
      </a>
    </div>
  );
}

export default function App() {
  // дозволяє деплой у podfolder (np. GitHub Pages) — безпечно, bo ma domyślnie "/"
  const basename =
    (typeof process !== "undefined" && process?.env?.PUBLIC_URL) || "/";

  return (
    <Router basename={basename}>
      <ScrollToTop />
      <RouteTitle />

      <div className="flex flex-col min-h-screen">
        <Header />

        <main className="flex-1 max-w-6xl mx-auto p-4">
          <Routes>
            <Route path="/" element={<HomePage />} /> {/* ⬅️ 3 сині картки */}
            <Route path="/generate" element={<GenerateInvoicesPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/saved" element={<SavedInvoicesPage />} />
            <Route path="/admin-counter" element={<CounterAdmin />} />
            <Route path="/sign-queue" element={<SignQueue />} />
            <Route path="/signatures-lab" element={<SignaturesLab />} />
            <Route
              path="/documents/protocols/:clientId/:month"
              element={<ProtocolView />}
            />
            {/* Dokumenty */}
            <Route
              path="/documents/invoices"
              element={<div className="p-4">Faktury (w przygotowaniu)</div>}
            />
            <Route
              path="/documents/protocols"
              element={<DocumentsProtocols />}
            />
            <Route
              path="/documents/tools"
              element={
                <div className="p-4">Lista narzędzi (w przygotowaniu)</div>
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
