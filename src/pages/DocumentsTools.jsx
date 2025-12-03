import React, { useEffect, useMemo, useState } from "react";

const API_BASE =
  typeof window !== "undefined" &&
  window.location.hostname === "panel.sterylserwis.pl"
    ? "/api"
    : "";

export default function DocumentsTools() {
  const [cosmetic, setCosmetic] = useState([]);
  const [medical, setMedical] = useState([]);

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("cosmetic");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setErr("");
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/tools`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setCosmetic(Array.isArray(data?.cosmetic) ? data.cosmetic : []);
      setMedical(Array.isArray(data?.medical) ? data.medical : []);
    } catch (e) {
      setErr(e?.message || "Nie udało się pobrać listy narzędzi.");
      setCosmetic([]);
      setMedical([]);
    } finally {
      setLoading(false);
    }
  };

  const saveAll = async (nextCos, nextMed) => {
    try {
      const r = await fetch(`${API_BASE}/tools`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          cosmetic: Array.isArray(nextCos) ? nextCos : [],
          medical: Array.isArray(nextMed) ? nextMed : [],
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      alert(e?.message || "Błąd zapisu narzędzi.");
      await load();
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAdd = async () => {
    const name = String(newName || "").trim();
    if (!name) return;
    const exists =
      cosmetic.some((n) => n.toLowerCase() === name.toLowerCase()) ||
      medical.some((n) => n.toLowerCase() === name.toLowerCase());
    if (exists) {
      alert("Takie narzędzie już istnieje.");
      return;
    }

    if (newType === "cosmetic") {
      const next = [...cosmetic, name].sort((a, b) => a.localeCompare(b, "pl"));
      setCosmetic(next);
      await saveAll(next, medical);
    } else {
      const next = [...medical, name].sort((a, b) => a.localeCompare(b, "pl"));
      setMedical(next);
      await saveAll(cosmetic, next);
    }
    setNewName("");
  };

  const removeItem = async (name, type) => {
    if (!window.confirm(`Usunąć: "${name}"?`)) return;
    if (type === "cosmetic") {
      const next = cosmetic.filter((n) => n !== name);
      setCosmetic(next);
      await saveAll(next, medical);
    } else {
      const next = medical.filter((n) => n !== name);
      setMedical(next);
      await saveAll(cosmetic, next);
    }
  };

  const totalCount = useMemo(
    () => (cosmetic?.length || 0) + (medical?.length || 0),
    [cosmetic, medical]
  );

  return (
    <div className="min-h-[70vh]">
      <div className="max-w-6xl mx-auto w-full px-[20mm] py-6 md:px-6 space-y-3">
        <div className="text-lg font-semibold">Dokumenty → Narzędzia</div>
        <div className="text-sm text-gray-600">
          Razem: <b>{totalCount}</b>{" "}
          {loading && <span className="ml-2 text-gray-500">Ładowanie…</span>}
          {err && (
            <span className="ml-2 text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
              {err}
            </span>
          )}
        </div>

        <div className="card p-4">
          <div className="grid md:grid-cols-[1fr_auto_auto] gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Nazwa narzędzia
              </label>
              <input
                className="input w-full"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="np. skalpel, pęseta…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAdd();
                  }
                }}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Typ</label>
              <select
                className="input"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
              >
                <option value="cosmetic">Kosmetyczne</option>
                <option value="medical">Medyczne</option>
              </select>
            </div>
            <div className="md:justify-self-end">
              <button
                type="button"
                className="btn-primary"
                onClick={onAdd}
                disabled={!newName.trim()}
              >
                + Dodaj
              </button>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2 bg-blue-50 border-b text-blue-900 font-medium">
              Kosmetyczne ({cosmetic.length})
            </div>
            {cosmetic.length === 0 ? (
              <div className="p-4 text-gray-500">Brak pozycji.</div>
            ) : (
              <ul className="divide-y">
                {cosmetic.map((name) => (
                  <li key={`c-${name}`} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate pr-4">{name}</div>
                      <button
                        type="button"
                        className="btn-danger whitespace-nowrap"
                        onClick={() => removeItem(name, "cosmetic")}
                        title="Usuń"
                      >
                        Usuń
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2 bg-blue-50 border-b text-blue-900 font-medium">
              Medyczne ({medical.length})
            </div>
            {medical.length === 0 ? (
              <div className="p-4 text-gray-500">Brak pozycji.</div>
            ) : (
              <ul className="divide-y">
                {medical.map((name) => (
                  <li key={`m-${name}`} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate pr-4">{name}</div>
                      <button
                        type="button"
                        className="btn-danger whitespace-nowrap"
                        onClick={() => removeItem(name, "medical")}
                        title="Usuń"
                      >
                        Usuń
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
