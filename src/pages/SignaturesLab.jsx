// src/pages/SignaturesLab.jsx
import React, { useEffect, useImperativeHandle, useRef, useState } from "react";

/* ===== API base (prod/dev) ===== */
const API = import.meta.env.VITE_API_URL || "";
const api = (p) => (API ? `${API}${p}` : p);

/* ===== Helpers ===== */
const todayISO = () => new Date().toISOString().slice(0, 10);
const ymNow = () => new Date().toISOString().slice(0, 7);
const safeFile = (s) => String(s || "").replace(/[^a-z0-9._-]+/gi, "-");

/* ===== Надійний SignaturePad (pointer + mouse + touch) ===== */
const SignaturePad = React.forwardRef(function SignaturePad(
  { width = 520, height = 180, onChange },
  ref
) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const emptyRef = useRef(true);

  // ініт канви з DPR
  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;

    // важливо: як розміри елемента, так і bitmap-пікселі
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.setAttribute("tabindex", "-1");

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // скид трансформацій + масштаб до DPR
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // стилі пера
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0f172a";

    // білий фон (інакше прозорий)
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    ctxRef.current = ctx;
    emptyRef.current = true;
    onChange && onChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    e.stopPropagation();
    drawing.current = true;
    last.current = getPos(e);

    // захоплюємо курсор, щоб не втрачати лінію при виході за межі
    if ("pointerId" in e && canvasRef.current?.setPointerCapture) {
      try {
        canvasRef.current.setPointerCapture(e.pointerId);
      } catch {}
    }

    // одразу ставимо крапку, щоб активувати кнопку
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(last.current.x + 0.01, last.current.y + 0.01);
    ctx.stroke();

    if (emptyRef.current) {
      emptyRef.current = false;
      onChange && onChange(false);
    }
  };

  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    e.stopPropagation();
    const p = getPos(e);
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (emptyRef.current) {
      emptyRef.current = false;
      onChange && onChange(false);
    }
  };

  const end = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    e.stopPropagation();
    drawing.current = false;
    if ("pointerId" in e && canvasRef.current?.releasePointerCapture) {
      try {
        canvasRef.current.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const clear = () => {
    const c = canvasRef.current;
    const ctx = ctxRef.current;
    if (!c || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    // знову білий фон (у device-пікселях)
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
    emptyRef.current = true;
    onChange && onChange(true);
  };

  const toDataURL = () => canvasRef.current.toDataURL("image/png");

  useImperativeHandle(ref, () => ({
    toDataURL,
    clear,
    isEmpty: () => emptyRef.current,
  }));

  const supportsPointer =
    typeof window !== "undefined" && "PointerEvent" in window;

  return (
    <div className="space-y-2 select-none">
      <div
        className="border rounded-xl bg-white"
        style={{ width, height, touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          // pointer (основний шлях)
          onPointerDown={supportsPointer ? start : undefined}
          onPointerMove={supportsPointer ? move : undefined}
          onPointerUp={supportsPointer ? end : undefined}
          onPointerLeave={supportsPointer ? end : undefined}
          onPointerCancel={supportsPointer ? end : undefined}
          // mouse fallback (лише якщо PointerEvent недоступний)
          onMouseDown={!supportsPointer ? start : undefined}
          onMouseMove={!supportsPointer ? move : undefined}
          onMouseUp={!supportsPointer ? end : undefined}
          onMouseLeave={!supportsPointer ? end : undefined}
          // touch fallback (лише якщо PointerEvent недоступний)
          onTouchStart={!supportsPointer ? start : undefined}
          onTouchMove={!supportsPointer ? move : undefined}
          onTouchEnd={!supportsPointer ? end : undefined}
          // дрібні UX/A11y
          onContextMenu={(e) => e.preventDefault()}
          draggable={false}
          aria-label="Pole podpisu — rysuj tutaj"
          // must be block-level to get full rect
          style={{
            display: "block",
            width,
            height,
            userSelect: "none",
            WebkitUserSelect: "none",
            touchAction: "none",
            cursor: "crosshair",
          }}
        />
      </div>
      <div className="text-xs text-gray-600">
        Podpis rysikiem/palcem/myszką.{" "}
        <button type="button" className="btn-secondary ml-2" onClick={clear}>
          Wyczyść
        </button>
      </div>
    </div>
  );
});

/* ===== Сторінка-лабораторія підписів ===== */
export default function SignaturesLab() {
  const [clientId, setClientId] = useState("test-client");
  const [month, setMonth] = useState(ymNow());
  const [date, setDate] = useState(todayISO());

  // по 2 пади на przekazanie + zwrot
  const tClientRef = useRef(null);
  const tStaffRef = useRef(null);
  const rClientRef = useRef(null);
  const rStaffRef = useRef(null);

  const [empty, setEmpty] = useState({
    tc: true,
    ts: true,
    rc: true,
    rs: true,
  });
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const hasAnySignature = !empty.tc || !empty.ts || !empty.rc || !empty.rs;

  const downloadPNG = (ref, filename) => {
    const url = ref.current?.toDataURL?.("image/png");
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const clearAllPads = () => {
    tClientRef.current?.clear?.();
    tStaffRef.current?.clear?.();
    rClientRef.current?.clear?.();
    rStaffRef.current?.clear?.();
    setEmpty({ tc: true, ts: true, rc: true, rs: true });
  };

  const saveAllToServer = async () => {
    if (!hasAnySignature) {
      alert("Brak podpisów do zapisania.");
      return;
    }
    setSaving(true);
    setStatusMsg("");
    try {
      // 1) створюємо ПУСТИЙ запис у протоколі (мінімально)
      const create = await fetch(
        api(`/protocols/${encodeURIComponent(clientId)}/${month}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            tools: [],
            packages: 0,
            comment: "[Auto] podpis z SignaturesLab",
            shipping: false,
            delivery: null,
          }),
        }
      );
      if (!create.ok) {
        const err = await create.json().catch(() => ({}));
        throw new Error(err?.error || "Błąd tworzenia wpisu.");
      }
      const proto = await create.json();
      const entries = Array.isArray(proto?.protocol?.entries)
        ? proto.protocol.entries
        : [];
      const index = Math.max(0, entries.length - 1);

      // 2) для кожної "nogi" відправляємо підписи, якщо є
      const transferBody = {};
      if (!empty.tc) transferBody.client = tClientRef.current.toDataURL();
      if (!empty.ts) transferBody.staff = tStaffRef.current.toDataURL();
      if (transferBody.client || transferBody.staff) {
        const r = await fetch(
          api(
            `/protocols/${encodeURIComponent(clientId)}/${month}/${index}/sign`
          ),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leg: "transfer", ...transferBody }),
          }
        );
        if (!r.ok) throw new Error("Błąd zapisu podpisu (przekazanie).");
      }

      const returnBody = {};
      if (!empty.rc) returnBody.client = rClientRef.current.toDataURL();
      if (!empty.rs) returnBody.staff = rStaffRef.current.toDataURL();
      if (returnBody.client || returnBody.staff) {
        const r = await fetch(
          api(
            `/protocols/${encodeURIComponent(clientId)}/${month}/${index}/sign`
          ),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leg: "return", ...returnBody }),
          }
        );
        if (!r.ok) throw new Error("Błąd zapisu podpisu (zwrot).");
      }

      // 3) почистити локальні полотна (щоб було видно, що збережено)
      clearAllPads();
      setStatusMsg("✅ Podpisy zapisane na serwerze (nowy wpis w protokole).");
      alert("✅ Podpisy zapisane na serwerze (nowy wpis w protokole).");
    } catch (e) {
      const msg = e.message || "Nie udało się zapisać podpisów.";
      setStatusMsg(`❌ ${msg}`);
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">✍️ Laboratorium podpisów</h1>

      {/* Ustawienia */}
      <div className="card-lg space-y-3">
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm mb-1">Client ID</label>
            <input
              className="input w-full"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="np. client-123"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Miesiąc (YYYY-MM)</label>
            <input
              type="month"
              className="input w-full"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Data operacji</label>
            <input
              type="date"
              className="input w-full"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
        <div className="text-xs text-gray-600">
          “Zapisz na serwerze” utworzy nowy wpis w protokole klienta i dołączy
          tu wykonane podpisy (ścieżki będą widoczne w /protocols).
        </div>
      </div>

      {/* DWA BLOKI — PRZEKAZANIE i ЗВРОТ (jeden pod drugim, prosto) */}
      <div className="card-lg space-y-6">
        <div>
          <div className="font-semibold mb-3">Przekazanie</div>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <div className="text-sm mb-1">Klient</div>
              <SignaturePad
                ref={tClientRef}
                onChange={(empty) => setEmpty((s) => ({ ...s, tc: empty }))}
              />
              <div className="mt-2 flex gap-2">
                <button
                  className="btn-secondary"
                  onClick={() =>
                    downloadPNG(
                      tClientRef,
                      safeFile(
                        `podpis_przekazanie_klient_${clientId}_${date}.png`
                      )
                    )
                  }
                >
                  Pobierz PNG
                </button>
              </div>
            </div>
            <div>
              <div className="text-sm mb-1">Serwis</div>
              <SignaturePad
                ref={tStaffRef}
                onChange={(empty) => setEmpty((s) => ({ ...s, ts: empty }))}
              />
              <div className="mt-2 flex gap-2">
                <button
                  className="btn-secondary"
                  onClick={() =>
                    downloadPNG(
                      tStaffRef,
                      safeFile(
                        `podpis_przekazanie_serwis_${clientId}_${date}.png`
                      )
                    )
                  }
                >
                  Pobierz PNG
                </button>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="font-semibold mb-3">Zwrot</div>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <div className="text-sm mb-1">Klient</div>
              <SignaturePad
                ref={rClientRef}
                onChange={(empty) => setEmpty((s) => ({ ...s, rc: empty }))}
              />
              <div className="mt-2 flex gap-2">
                <button
                  className="btn-secondary"
                  onClick={() =>
                    downloadPNG(
                      rClientRef,
                      safeFile(`podpis_zwrot_klient_${clientId}_${date}.png`)
                    )
                  }
                >
                  Pobierz PNG
                </button>
              </div>
            </div>
            <div>
              <div className="text-sm mb-1">Serwis</div>
              <SignaturePad
                ref={rStaffRef}
                onChange={(empty) => setEmpty((s) => ({ ...s, rs: empty }))}
              />
              <div className="mt-2 flex gap-2">
                <button
                  className="btn-secondary"
                  onClick={() =>
                    downloadPNG(
                      rStaffRef,
                      safeFile(`podpis_zwrot_serwis_${clientId}_${date}.png`)
                    )
                  }
                >
                  Pobierz PNG
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Wspólne akcje */}
        <div className="pt-2 flex flex-wrap items-center gap-2">
          <button
            className={`btn-primary ${
              !hasAnySignature || saving ? "opacity-50 cursor-not-allowed" : ""
            }`}
            disabled={!hasAnySignature || saving}
            onClick={saveAllToServer}
          >
            {saving ? "Zapisuję…" : "Zapisz na serwerze (nowy wpis)"}
          </button>
          <button
            className="btn-secondary"
            type="button"
            onClick={clearAllPads}
            disabled={saving}
            title="Wyczyść wszystkie podpisy na tej stronie"
          >
            Wyczyść wszystkie
          </button>
          <div className="text-xs text-gray-600" aria-live="polite">
            Zapis aktywuje istniejące API protokołów i zapisze obrazy w
            <code className="ml-1">/signatures/</code>.
          </div>
        </div>

        {statusMsg && (
          <div className="text-sm mt-1" aria-live="polite">
            {statusMsg}
          </div>
        )}
      </div>
    </div>
  );
}
