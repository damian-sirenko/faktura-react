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

  const [editTarget, setEditTarget] = useState(null); // { name, type }
  const [editName, setEditName] = useState("");

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

  const saveEdit = async () => {
    const name = editName.trim();
    if (!name || !editTarget) return;

    const exists =
      cosmetic.some(
        (n) =>
          n.toLowerCase() === name.toLowerCase() &&
          !(editTarget.type === "cosmetic" && n === editTarget.name)
      ) ||
      medical.some(
        (n) =>
          n.toLowerCase() === name.toLowerCase() &&
          !(editTarget.type === "medical" && n === editTarget.name)
      );

    if (exists) {
      alert("Takie narzędzie już istnieje.");
      return;
    }

    if (editTarget.type === "cosmetic") {
      const next = cosmetic
        .map((n) => (n === editTarget.name ? name : n))
        .sort((a, b) => a.localeCompare(b, "pl"));
      setCosmetic(next);
      await saveAll(next, medical);
    } else {
      const next = medical
        .map((n) => (n === editTarget.name ? name : n))
        .sort((a, b) => a.localeCompare(b, "pl"));
      setMedical(next);
      await saveAll(cosmetic, next);
    }

    setEditTarget(null);
    setEditName("");
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
    () => (cosmetic.length || 0) + (medical.length || 0),
    [cosmetic, medical]
  );

  const renderItem = (name, type) => {
    const isEditing = editTarget?.name === name && editTarget?.type === type;

    return (
      <div className="flex items-center gap-2 w-full">
        {isEditing ? (
          <>
            <input
              className="input flex-1"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") setEditTarget(null);
              }}
              autoFocus
            />
            <button className="btn-primary" onClick={saveEdit}>
              Zapisz
            </button>
            <button
              className="btn-secondary"
              onClick={() => setEditTarget(null)}
            >
              Anuluj
            </button>
          </>
        ) : (
          <>
            <div className="truncate flex-1">{name}</div>
            <button
              className="btn-secondary"
              onClick={() => {
                setEditTarget({ name, type });
                setEditName(name);
              }}
            >
              Edytuj
            </button>
            <button
              className="btn-danger"
              onClick={() => removeItem(name, type)}
            >
              Usuń
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-[70vh]">
      <div className="max-w-6xl mx-auto w-full px-3 py-6 md:px-6 space-y-4">
        <div className="card-lg border-2 border-blue-200 bg-blue-50/60">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">Lista narzędzi</h1>

            <div className="text-sm text-gray-700 flex items-center gap-2">
              <span>Razem: {totalCount}</span>
              {loading && <span className="text-gray-500">Ładowanie…</span>}
              {err && (
                <span className="text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                  {err}
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 grid md:grid-cols-[1fr_auto_auto] gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-600 mb-1">
                Nazwa narzędzia
              </label>
              <input
                className="input w-full"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
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
            <div className="px-4 py-2 bg-blue-50 border-b font-medium">
              Kosmetyczne ({cosmetic.length})
            </div>
            {cosmetic.length === 0 ? (
              <div className="p-4 text-gray-500">Brak pozycji.</div>
            ) : (
              <ul className="divide-y">
                {cosmetic.map((name) => (
                  <li key={`c-${name}`} className="px-3 py-2">
                    {renderItem(name, "cosmetic")}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2 bg-blue-50 border-b font-medium">
              Medyczne ({medical.length})
            </div>
            {medical.length === 0 ? (
              <div className="p-4 text-gray-500">Brak pozycji.</div>
            ) : (
              <ul className="divide-y">
                {medical.map((name) => (
                  <li key={`m-${name}`} className="px-3 py-2">
                    {renderItem(name, "medical")}
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
