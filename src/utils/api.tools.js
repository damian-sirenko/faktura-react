export async function getTools() {
  const r = await fetch("/tools", { credentials: "include" });
  if (!r.ok) throw new Error("Failed to load tools");
  return r.json();
}
export async function saveTools(payload) {
  const r = await fetch("/tools/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload || { cosmetic: [], medical: [] }),
  });
  if (!r.ok) throw new Error("Failed to save tools");
  return r.json();
}
