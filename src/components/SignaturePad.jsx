// src/components/SignaturePad.jsx
import React, {
  useLayoutEffect,
  useEffect,
  useRef,
  useImperativeHandle,
  useState, // ✅ додано
} from "react";
import { createPortal } from "react-dom"; // ✅ додано

// ✅ опційний проп refreshProtocolList (використовується в твоєму модальному блоці нижче)
const SignaturePad = React.forwardRef(function SignaturePad(
  {
    width = 520,
    height = 180,
    onChange,
    // нові опційні пропси (беквортс-компатибл)
    lineWidth = 2,
    penColor = "#0f172a",
    bgColor = "#fff",
    refreshProtocolList, // ✅ додано
  },
  ref
) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const isEmptyRef = useRef(true);
  const drawingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });
  const baseLineWidthRef = useRef(lineWidth);

  // ====== ЛОКАЛЬНИЙ STATE ДЛЯ ТВОГО МОДАЛУ (щоб не ламав збірку) ======
  const [signModal, setSignModal] = useState(null); // ✅ додано
  const padRef = useRef(null); // ✅ додано
  const [padEmpty, setPadEmpty] = useState(true); // ✅ додано

  // ✅ як і в інших файлах
  const API = import.meta.env.VITE_API_URL || "http://localhost:3000";

  // ————— ініт/ре-ініт полотна з урахуванням DPR —————
  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;

    // фізичні пікселі
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    // CSS розміри
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.touchAction = "none";
    canvas.style.userSelect = "none";
    canvas.style.webkitUserSelect = "none";
    canvas.setAttribute("tabindex", "-1");

    const ctx = canvas.getContext("2d");
    // скидаємо матрицю і масштабуємо під DPR, щоб малювати в CSS-координатах
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = baseLineWidthRef.current;
    ctx.strokeStyle = penColor;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    ctxRef.current = ctx;
    isEmptyRef.current = true; // стартово чисте (не викликаємо onChange)
  };

  useLayoutEffect(() => {
    setupCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, penColor, bgColor]);

  // Перемальовувати при зміні DPR/resize (масштаб сторінки, переміщення між моніторами тощо)
  useEffect(() => {
    const onResize = () => setupCanvas();
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ————— допоміжні —————
  const posFromClient = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };
  const getPoint = (ev) => {
    if (typeof ev.clientX === "number")
      return posFromClient(ev.clientX, ev.clientY);
    const t = ev.touches?.[0] || ev.changedTouches?.[0];
    return t ? posFromClient(t.clientX, t.clientY) : lastRef.current;
  };

  // ————— слухачі подій (пріоритет — Pointer Events, з фолбеком) —————
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    const startStroke = (p) => {
      drawingRef.current = true;
      lastRef.current = p;
      ctx.beginPath();
      // крапка на початку штриха
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.01, p.y + 0.01);
      ctx.stroke();
      if (isEmptyRef.current) {
        isEmptyRef.current = false;
        onChange && onChange(false);
      }
    };

    const moveStroke = (p, pressure = 0) => {
      // на пристроях з pressure (стилус) робимо легке варіювання товщини
      const pr = pressure > 0 ? pressure : 1; // миша дає 0 — тримаємо базову товщину
      ctx.lineWidth = baseLineWidthRef.current * (0.6 + 0.4 * pr);

      ctx.beginPath();
      ctx.moveTo(lastRef.current.x, lastRef.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastRef.current = p;
    };

    // Pointer Events
    const hasPointer = "PointerEvent" in window;

    let activePointerId = null;

    const onPointerDown = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      activePointerId = ev.pointerId;
      try {
        canvas.setPointerCapture?.(ev.pointerId);
      } catch {}
      startStroke(getPoint(ev));
    };

    const onPointerMove = (ev) => {
      // «рятувальник»: якщо втрачено down, але кнопка миші затиснута — стартуємо
      if (!drawingRef.current && ev.buttons & 1) {
        ev.preventDefault();
        ev.stopPropagation();
        activePointerId = ev.pointerId;
        try {
          canvas.setPointerCapture?.(ev.pointerId);
        } catch {}
        startStroke(getPoint(ev));
        return;
      }
      if (!drawingRef.current) return;
      if (activePointerId !== null && ev.pointerId !== activePointerId) return;

      ev.preventDefault();
      ev.stopPropagation();
      const p = getPoint(ev);
      moveStroke(p, typeof ev.pressure === "number" ? ev.pressure : 0);
    };

    const endPointer = (ev) => {
      if (!drawingRef.current) return;
      ev.preventDefault();
      ev.stopPropagation();
      drawingRef.current = false;
      if (activePointerId !== null && ev.pointerId === activePointerId) {
        try {
          canvas.releasePointerCapture?.(ev.pointerId);
        } catch {}
        activePointerId = null;
      }
      // повертаємо базову товщину
      ctx.lineWidth = baseLineWidthRef.current;
    };

    const onMouseDown = (ev) => {
      // фолбек, якщо PointerEvent недоступний
      ev.preventDefault();
      ev.stopPropagation();
      startStroke(getPoint(ev));
    };
    const onMouseMove = (ev) => {
      if (!drawingRef.current) return;
      ev.preventDefault();
      ev.stopPropagation();
      moveStroke(getPoint(ev), 0);
    };
    const onMouseUp = (ev) => {
      if (!drawingRef.current) return;
      ev.preventDefault();
      ev.stopPropagation();
      drawingRef.current = false;
      ctx.lineWidth = baseLineWidthRef.current;
    };

    const onTouchStart = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      startStroke(getPoint(ev));
    };
    const onTouchMove = (ev) => {
      if (!drawingRef.current) return;
      ev.preventDefault();
      ev.stopPropagation();
      moveStroke(getPoint(ev), 0);
    };
    const onTouchEnd = (ev) => {
      if (!drawingRef.current) return;
      ev.preventDefault();
      ev.stopPropagation();
      drawingRef.current = false;
      ctx.lineWidth = baseLineWidthRef.current;
    };

    if (hasPointer) {
      canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
      canvas.addEventListener("pointermove", onPointerMove, { passive: false });
      canvas.addEventListener("pointerup", endPointer, { passive: false });
      canvas.addEventListener("pointercancel", endPointer, { passive: false });
      canvas.addEventListener("pointerleave", endPointer, { passive: false });
    } else {
      // фолбек: старі браузери без PointerEvent
      canvas.addEventListener("mousedown", onMouseDown, { passive: false });
      window.addEventListener("mousemove", onMouseMove, { passive: false });
      window.addEventListener("mouseup", onMouseUp, { passive: false });

      canvas.addEventListener("touchstart", onTouchStart, { passive: false });
      canvas.addEventListener("touchmove", onTouchMove, { passive: false });
      canvas.addEventListener("touchend", onTouchEnd, { passive: false });
      canvas.addEventListener("touchcancel", onTouchEnd, { passive: false });
    }

    return () => {
      if (hasPointer) {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", endPointer);
        canvas.removeEventListener("pointercancel", endPointer);
        canvas.removeEventListener("pointerleave", endPointer);
      } else {
        canvas.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);

        canvas.removeEventListener("touchstart", onTouchStart);
        canvas.removeEventListener("touchmove", onTouchMove);
        canvas.removeEventListener("touchend", onTouchEnd);
        canvas.removeEventListener("touchcancel", onTouchEnd);
      }
    };
  }, [onChange]);

  // ————— API —————
  function clear() {
    const c = canvasRef.current;
    const ctx = ctxRef.current;
    if (!c || !ctx) return;

    // повністю чистимо буфер пікселів
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();

    // перефарбовуємо фон під DPR-масштабом
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    // повертаємо параметри пера
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = baseLineWidthRef.current;
    ctx.strokeStyle = penColor;

    isEmptyRef.current = true;
    onChange && onChange(true);
  }

  function toDataURL() {
    return canvasRef.current.toDataURL("image/png");
  }

  function toBlob() {
    const canvas = canvasRef.current;
    return new Promise((resolve) => {
      if (canvas.toBlob) {
        canvas.toBlob((b) => resolve(b), "image/png");
      } else {
        // фолбек через dataURL
        const dataUrl = canvas.toDataURL("image/png");
        const byteString = atob(dataUrl.split(",")[1]);
        const mimeString = dataUrl.split(",")[0].split(":")[1].split(";")[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++)
          ia[i] = byteString.charCodeAt(i);
        resolve(new Blob([ab], { type: mimeString }));
      }
    });
  }

  useImperativeHandle(ref, () => ({
    toDataURL,
    toBlob,
    clear,
    isEmpty: () => isEmptyRef.current,
  }));

  return (
    <div className="space-y-2 select-none">
      <div className="border rounded-xl bg-white" style={{ width, height }}>
        <canvas
          ref={canvasRef}
          onContextMenu={(e) => e.preventDefault()}
          draggable="false"
          style={{ width, height, display: "block", cursor: "crosshair" }}
        />
      </div>
      <div className="text-xs text-gray-600">
        Podpis rysikiem/palcem.
        <button type="button" className="btn-secondary ml-2" onClick={clear}>
          Wyczyść
        </button>
      </div>

      {/* ===== ТВОЄ ВБУДОВАНЕ МОДАЛЬНЕ ВІКНО — залишив як є, тепер воно компілюється ===== */}
      {signModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setSignModal(null)}
            style={{ background: "rgba(0,0,0,0.45)" }}
          >
            <div
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-lg font-semibold">
                  {signModal.leg === "transfer" ? "Przekazanie" : "Zwrot"} —{" "}
                  {signModal.role === "client" ? "Klient" : "Serwis"}
                </div>
                <div className="flex gap-2">
                  <select
                    className="input"
                    value={signModal.leg}
                    onChange={(e) =>
                      setSignModal({ ...signModal, leg: e.target.value })
                    }
                  >
                    <option value="transfer">Przekazanie</option>
                    <option value="return">Zwrot</option>
                  </select>
                  <select
                    className="input"
                    value={signModal.role}
                    onChange={(e) =>
                      setSignModal({ ...signModal, role: e.target.value })
                    }
                  >
                    <option value="client">Klient</option>
                    <option value="staff">Serwis</option>
                  </select>
                </div>
              </div>

              <div className="inline-block relative">
                {/* ⚠️ тут будується другий підпис-пад у модалі — залишив як у тебе */}
                <SignaturePad
                  ref={padRef}
                  onChange={setPadEmpty}
                  width={640}
                  height={220}
                  refreshProtocolList={refreshProtocolList}
                />
              </div>

              <div className="mt-4 flex items-center gap-2">
                <button
                  className={`btn-primary ${
                    padEmpty ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                  disabled={padEmpty}
                  onClick={async () => {
                    if (!padRef.current || padRef.current.isEmpty()) return;
                    const dataURL = padRef.current.toDataURL("image/png");
                    try {
                      const r = await fetch(
                        `${API}/protocols/${encodeURIComponent(
                          signModal.clientId
                        )}/${signModal.month}/${signModal.index}/sign`,
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            leg: signModal.leg,
                            ...(signModal.role === "client"
                              ? { client: dataURL }
                              : { staff: dataURL }),
                          }),
                        }
                      );
                      if (!r.ok) {
                        const err = await r.json().catch(() => ({}));
                        throw new Error(err?.error || "Błąd zapisu podpisu");
                      }
                      if (typeof refreshProtocolList === "function") {
                        await refreshProtocolList();
                      }
                      setSignModal(null);
                    } catch (e) {
                      alert(e.message || "Nie udało się zapisać podpisu.");
                    }
                  }}
                >
                  Zapisz podpis
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    padRef.current?.clear?.();
                    setPadEmpty(true);
                  }}
                >
                  Wyczyść
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setSignModal(null)}
                >
                  Zamknij
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
});

export default SignaturePad;
