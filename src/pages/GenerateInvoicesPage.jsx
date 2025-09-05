// src/pages/GenerateInvoicesPage.jsx
import React, { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

export default function GenerateInvoicesPage() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");
  const [issueDate, setIssueDate] = useState(() => {
    // спробуємо відновити з пам’яті, інакше сьогодні
    const saved = localStorage.getItem("gen:issueDate");
    if (saved) return saved;
    const d = new Date();
    return d.toISOString().split("T")[0]; // YYYY-MM-DD
  });
  const [numberStart, setNumberStart] = useState(() => {
    const n = Number(localStorage.getItem("gen:numberStart") || "");
    return Number.isFinite(n) && n > 0 ? n : 1;
  });

  const [expectedCount, setExpectedCount] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState({ total: 0, done: 0, status: "" });
  const pollRef = useRef(null);

  // ▼ вибір формату виводу з пам’яттю
  const [format, setFormat] = useState(() => {
    const saved = localStorage.getItem("gen:format");
    return saved === "epp" ? "epp" : "pdf";
  });

  // локальна “відміна” лише зупиняє опитування
  const cancelRef = useRef(false);

  // оцінка кількості інвойсів із Excel
  const handleFileChange = async (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setStatus("");
    setExpectedCount(null);
    if (!f) return;

    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);
      const cnt = rows.filter((r) => r["Klient"] && r["Faktura"]).length;
      setExpectedCount(cnt);
    } catch {
      setExpectedCount(null);
    }
  };

  const clearFile = () => {
    setFile(null);
    setExpectedCount(null);
    setStatus("");
  };

  // пам’ять: формат / дата / старт
  useEffect(() => {
    localStorage.setItem("gen:format", format);
  }, [format]);
  useEffect(() => {
    if (issueDate) localStorage.setItem("gen:issueDate", issueDate);
  }, [issueDate]);
  useEffect(() => {
    localStorage.setItem("gen:numberStart", String(numberStart || 1));
  }, [numberStart]);

  // ініціалізація лічильника під обраний місяць
  const initCounter = async () => {
    const d = new Date(issueDate);
    if (Number.isNaN(d.getTime())) throw new Error("Nieprawidłowa data");
    const year = d.getFullYear();
    const month = d.getMonth() + 1; // 1..12

    const resp = await fetch("/upload/counters/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year,
        month,
        seed: Number(numberStart || 1),
      }),
    });

    // 200 — ок; 400 — коли seed ≤ уже використаного макс — покажемо текст помилки
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data?.error || "Nie udało się ustawić licznika");
    }
  };

  // старт джоби (PDF ZIP з прогресом)
  const startJob = async () => {
    const fd = new FormData();
    fd.append("excelFile", file);
    fd.append("issueDate", issueDate);

    const resp = await fetch("/upload/start", {
      method: "POST",
      body: fd,
    });

    if (!resp.ok) {
      // fallback на синхронний маршрут, якщо /start недоступний
      if (resp.status === 404) {
        await startSyncFallback();
        return null;
      }
      const data = await resp.json().catch(() => ({}));
      throw new Error(data?.error || "Błąd uruchamiania zadania");
    }

    const { jobId } = await resp.json();
    setJobId(jobId);
    return jobId;
  };

  // опитування прогресу
  const beginPolling = (id) => {
    cancelRef.current = false;
    pollRef.current && clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (cancelRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setIsGenerating(false);
        setStatus(
          "⏹️ Anulowano podgląd postępu (zadanie mogło pozostać w tle)."
        );
        return;
      }
      try {
        const r = await fetch(`/upload/progress/${id}`);
        if (!r.ok) throw new Error();
        const p = await r.json();
        setProgress({
          total: p.total || 0,
          done: p.done || 0,
          status: p.status || "",
        });

        if (p.finished) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (p.error) {
            setIsGenerating(false);
            setStatus(`❌ ${p.error}`);
            return;
          }
          // качаємо ZIP
          const zipResp = await fetch(`/upload/download/${id}`);
          if (!zipResp.ok) {
            setIsGenerating(false);
            setStatus("❌ Błąd pobierania archiwum");
            return;
          }
          const blob = await zipResp.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "faktury.zip";
          document.body.appendChild(a);
          a.click();
          a.remove();
          // важливо: прибираємо URL
          setTimeout(() => URL.revokeObjectURL(url), 0);

          setIsGenerating(false);
          setStatus(
            expectedCount != null
              ? `✅ Zakończono. Wygenerowano ${p.done}/${expectedCount}.`
              : `✅ Zakończono. Wygenerowano ${p.done}.`
          );
        }
      } catch {
        // по-тихому спробуємо ще
      }
    }, 1000);
  };

  // fallback: старий синхронний маршрут /upload/ (PDF ZIP)
  const startSyncFallback = async () => {
    const fd = new FormData();
    fd.append("excelFile", file);
    fd.append("issueDate", issueDate);

    const r = await fetch("/upload", { method: "POST", body: fd });
    if (!r.ok) throw new Error("Błąd generowania faktur.");

    const blob = await r.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "faktury.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);

    setIsGenerating(false);
    setStatus(
      expectedCount != null
        ? `✅ Wygenerowano faktury. Łącznie: ${expectedCount}.`
        : "✅ Wygenerowano faktury."
    );
  };

  // Експорт InsERT (.epp) з Excel — бекенд /upload/export-epp (FormData)
  const startExportEpp = async () => {
    const fd = new FormData();
    fd.append("excelFile", file);
    fd.append("issueDate", issueDate);

    const r = await fetch("/upload/export-epp", { method: "POST", body: fd });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data?.error || "Błąd generowania pliku EPP.");
    }

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // назва може приїхати з nagłówka; якщо ні — fallback:
    a.download = "export.epp";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);

    setIsGenerating(false);
    setStatus(
      expectedCount != null
        ? `✅ Wyeksportowano EPP. Pozycje: ${expectedCount}.`
        : "✅ Wyeksportowano EPP."
    );
  };

  const handleGenerate = async () => {
    if (!file) {
      setStatus("⚠️ Wybierz plik.");
      return;
    }
    if (!issueDate) {
      setStatus("⚠️ Wybierz datę wystawienia.");
      return;
    }

    // почистимо попередній прогрес/стан
    setProgress({ total: 0, done: 0, status: "" });
    setJobId(null);
    setIsGenerating(true);
    setStatus(
      expectedCount != null
        ? `⏳ Generowanie… (oczekiwane: ${expectedCount})`
        : "⏳ Generowanie…"
    );

    try {
      // 1) встановлюємо лічильник для місяця (seed)
      await initCounter().catch((e) => {
        setIsGenerating(false);
        setStatus(`❌ ${e.message}`);
        throw e;
      });

      // 2) гілка за форматом
      if (format === "epp") {
        await startExportEpp();
        return;
      }

      // 3) PDF ZIP з прогресом
      const id = await startJob();
      if (id) beginPolling(id);
      else setIsGenerating(false); // коли спрацював sync fallback
    } catch (e) {
      // очищення інтервалу при помилці
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }

      if (format === "pdf") {
        // якщо впали НЕ на seed — пробуємо синхронний фолбек PDF:
        try {
          await startSyncFallback();
        } catch (err) {
          setIsGenerating(false);
          setStatus("❌ Wystąpił błąd podczas generowania faktur.");
        }
      } else {
        // формат epp — просто покажемо помилку
        setIsGenerating(false);
        setStatus(e?.message || "❌ Wystąpił błąd podczas eksportu EPP.");
      }
    }
  };

  const handleCancel = () => {
    cancelRef.current = true; // зупиняємо лише опитування
  };

  // при розмонтуванні — прибираємо опитування
  useEffect(() => {
    return () => {
      pollRef.current && clearInterval(pollRef.current);
    };
  }, []);

  const canGenerate = !!file && !!issueDate && !isGenerating;

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">🧾 Generowanie faktur</h1>

      <div className="card-lg space-y-3">
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">Plik Excel</label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              disabled={isGenerating}
            />
            {file && (
              <div className="text-xs text-gray-700 mt-1 flex items-center gap-2">
                <span>Teraźniejszy plik:</span>
                <span
                  className="font-medium truncate max-w-[16rem]"
                  title={file.name}
                >
                  {file.name}
                </span>
                <button
                  type="button"
                  className="btn-secondary px-2 py-0.5"
                  onClick={clearFile}
                  disabled={isGenerating}
                  title="Wyczyść wybór pliku"
                >
                  Wyczyść
                </button>
              </div>
            )}
            {expectedCount != null && (
              <div className="text-xs text-gray-600 mt-1">
                Do wygenerowania: <b>{expectedCount}</b> faktur
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm mb-1">Data wystawienia</label>
            <input
              type="date"
              className="input w-full"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              disabled={isGenerating}
            />
            <div className="text-xs text-gray-600 mt-1">
              Numer będzie zawierał miesiąc z tej daty (MM/YYYY).
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">
              Start numeracji (miesiąc)
            </label>
            <input
              type="number"
              min="1"
              className="input w-full"
              value={numberStart}
              onChange={(e) => setNumberStart(Number(e.target.value) || 1)}
              disabled={isGenerating}
            />
            <div className="text-xs text-gray-600 mt-1">
              Używane tylko, jeśli licznik dla tego miesiąca jeszcze nie
              istnieje.
            </div>
          </div>

          {/* ВИБІР ФОРМАТУ */}
          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Format wyjściowy</label>
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="fmt"
                  value="pdf"
                  checked={format === "pdf"}
                  onChange={() => setFormat("pdf")}
                  disabled={isGenerating}
                />
                <span>ZIP z PDF</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="fmt"
                  value="epp"
                  checked={format === "epp"}
                  onChange={() => setFormat("epp")}
                  disabled={isGenerating}
                />
                <span>InsERT (.epp)</span>
              </label>
            </div>
          </div>
        </div>

        <div className="pt-2 flex gap-2 items-center">
          <button
            onClick={handleGenerate}
            className="btn-primary"
            disabled={!canGenerate}
            title={!file ? "Wybierz plik" : !issueDate ? "Wybierz datę" : ""}
          >
            {isGenerating ? "Generowanie…" : "Generuj"}
          </button>

          {isGenerating && format === "pdf" && (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleCancel}
              title="Zatrzymaj podgląd postępu"
            >
              Anuluj
            </button>
          )}
        </div>

        {/* Прогрес показуємо ТІЛЬКИ для PDF (для EPP — синхронно, миттєво файл) */}
        {isGenerating && format === "pdf" && (
          <div className="space-y-2">
            <div className="progress-wrap">
              <div
                className="progress-bar transition-all"
                style={{
                  width:
                    progress.total > 0
                      ? `${Math.min(
                          100,
                          Math.round((progress.done / progress.total) * 100)
                        )}%`
                      : "50%",
                }}
              />
            </div>
            <div className="text-sm text-gray-600">
              {progress.total
                ? `Postęp: ${progress.done}/${progress.total}`
                : status}
              {progress.status ? ` — ${progress.status}` : ""}
            </div>
          </div>
        )}

        {!isGenerating && status && (
          <p className="mt-2 text-sm" aria-live="polite">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
