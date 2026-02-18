// src/pages/LoginPage.jsx
import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { apiFetch } from "../utils/api"; // ВАЖЛИВО: прямий імпорт apiFetch
import { setAuthToken } from "../utils/api";


async function loginRequest(email, password) {
  // жодних window.*, тільки наш apiFetch
  return apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("sterylserwis@gmail.com");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeName, setWelcomeName] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);

    try {
      const r = await loginRequest(email.trim(), password);
      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        let message = j?.error || "Błąd logowania";

        if (r.status === 400 || r.status === 401) {
          message = "Nieprawidłowy login lub hasło.";
        } else {
          message =
            "Wystąpił problem techniczny po naszej stronie. Spróbuj ponownie za kilka minut.";
        }

        throw new Error(message);
      }

      if (j.token) {
        setAuthToken(j.token);
      }

      setWelcomeName(j.clientName || j.name || j.user?.name || email.trim());      
      setShowWelcome(true);

      const from = (loc.state && loc.state.from) || "/";
      setTimeout(() => {
        nav(from, { replace: true });
      }, 2000);
      
    } catch (e) {
      let message =
        e?.message ||
        "Wystąpił problem techniczny po naszej stronie. Spróbuj ponownie za kilka minut.";

      if (
        typeof message === "string" &&
        (message.includes("Failed to fetch") ||
          message.includes("NetworkError") ||
          message.includes("Network"))
      ) {
        message =
          "Wystąpił problem techniczny po naszej stronie. Spróbuj ponownie за кілька хвилин.";
      }

      setErr(message);
    } finally {
      setLoading(false);
    }
  };
  

  return (
    <div
      className="w-full flex items-center justify-center bg-slate-50 overflow-hidden"
      style={{
        minHeight: "calc(100vh - 160px)",
        maxHeight: "calc(100vh - 100px)",
        paddingTop: "0px",
        paddingBottom: "0px",
      }}
    >
      <div className="w-full max-w-lg px-4">
        {showWelcome && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="bg-white rounded-2xl shadow-xl px-10 py-8 text-center min-w-[320px]">
              <div className="text-lg font-semibold mb-2">Zalogowano pomyślnie</div>
              <div className="text-sm text-gray-600">Witaj, {welcomeName}</div>
            </div>
          </div>
        )}

        <div className="bg-white/80 backdrop-blur-sm shadow-lg rounded-2xl p-5 border border-gray-100 max-h-full overflow-auto">
          <h1 className="text-2xl font-semibold text-center mb-1">
            Witaj w panelu Steryl Serwis
          </h1>
          <p className="text-center text-gray-500 mb-6">
            Zaloguj się, aby zarządzać sterylizacją narzędzi
          </p>

          {err ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {err}
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <div>
              <label className="block text-sm mb-1">E-mail</label>
              <input
                type="email"
                className="input w-full"
                placeholder="E-mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div>
              <label className="block text-sm mb-1">Hasło</label>
              <input
                type={showPassword ? "text" : "password"}
                className="input w-full"
                placeholder="Twoje hasło"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <div className="flex items-center justify-between text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                />
                <span>Pokaż hasło</span>
              </label>

              <button
                type="button"
                onClick={() => setShowForgot((v) => !v)}
                className="text-blue-600 hover:underline"
              >
                Zapomniałeś hasła?
              </button>
            </div>

            {showForgot && (
              <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                Twoje dane logowania znajdują się w Załączniku nr 1 do umowy.
                Jeśli nie możesz ich znaleźć, skontaktuj się z nami:
                sterylserwis@gmail.com lub 739 015 287.
              </div>
            )}

            <button
              type="submit"
              className="btn-primary w-full h-11"
              disabled={loading}
            >
              {loading ? "Logowanie…" : "Zaloguj się"}
            </button>
          </form>

          <div className="mt-4 border-t pt-3 text-xs text-gray-500">
            <div className="flex items-center justify-between text-left gap-3">
              <a href="tel:739015287" className="text-blue-600 hover:underline">
                Tel.: 739 015 287
              </a>
              <a
                href="mailto:sterylserwis@gmail.com"
                className="text-blue-600 hover:underline ml-auto"
              >
                sterylserwis@gmail.com
              </a>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] text-gray-400">
              <a
                href="/regulamin.html"
                target="_blank"
                rel="noreferrer"
                className="hover:text-blue-600 hover:underline"
              >
                Regulamin
              </a>
              <span>•</span>
              <a
                href="/rodo.html"
                target="_blank"
                rel="noreferrer"
                className="hover:text-blue-600 hover:underline"
              >
                RODO
              </a>
              <span>•</span>
              <a
                href="/private_policy.html"
                target="_blank"
                rel="noreferrer"
                className="hover:text-blue-600 hover:underline"
              >
                Polityka prywatności
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
