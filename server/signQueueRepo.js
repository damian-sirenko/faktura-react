// server/signQueueRepo.js
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "sign_queue.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE))
    fs.writeFileSync(FILE, JSON.stringify({ items: [] }, null, 2));
}
function load() {
  ensure();
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!j || !Array.isArray(j.items)) return { items: [] };
    return { items: j.items };
  } catch {
    return { items: [] };
  }
}
function save(state) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify({ items: state.items || [] }, null, 2));
}

function keyOf({ clientId, month, index }) {
  const idx = Number(index);
  return `${String(clientId)}::${String(month)}::${
    Number.isNaN(idx) ? String(index) : idx
  }`;
}

function list({ type, month }) {
  const { items } = load();
  return items.filter(
    (it) => (!type || it.type === type) && (!month || it.month === month)
  );
}

function upsert({ type, clientId, month, index, plannedDate = null }) {
  const st = load();
  const k = keyOf({ clientId, month, index });
  const i = st.items.findIndex((x) => x.k === k && x.type === type);
  const base = {
    k,
    type, // 'courier' | 'point'
    clientId,
    month, // 'YYYY-MM'
    index, // Number
    plannedDate, // 'YYYY-MM-DD' | null
    // нижче — поля, які фронт може показувати (можуть бути порожні — не критично)
    date: null,
    returnDate: null,
    tools: [],
    packages: 0,
    delivery: null,
    shipping: false,
    comment: "",
    signatures: {},
  };
  if (i >= 0) {
    st.items[i] = { ...st.items[i], plannedDate };
  } else {
    st.items.push(base);
  }
  save(st);
  return true;
}

function remove({ type, clientId, month, index }) {
  const st = load();
  const k = keyOf({ clientId, month, index });
  const before = st.items.length;
  const items = st.items.filter((x) => !(x.k === k && x.type === type));
  st.items = items;
  save(st);
  return before !== items.length;
}

module.exports = { list, upsert, remove };
