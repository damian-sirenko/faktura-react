// server/repos/clientsRepo.js
const { query, pool } = require("../db.js");

// helpers
const toDateOrNull = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s === "0000-00-00") return null;
  // допускаємо вже Date або 'YYYY-MM-DD'
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const toNumOrNull = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const toBool01 = (v) => (v ? 1 : 0);
const toStr = (v) => (v == null ? "" : String(v));

/**
 * Активні клієнти (archived=0)
 * Сортування стабільне по даті договору (NULL наприкінці), далі по імені
 */
async function getAllActiveClients() {
  const rows = await query(
    `
    SELECT
      id,
      name,
      address,
      type,
      nip,
      pesel,
      email,
      phone,
      agreementStart,
      agreementEnd,
      subscription,
      subscriptionAmount,
      notice,
      comment,
      billingMode,
      logistics,
      courierPriceMode,
      courierPriceGross,
      shippingPriceMode,
      shippingPriceGross,
      archived,
      archivedAt
    FROM clients
    WHERE archived = 0
    ORDER BY (agreementStart IS NULL), agreementStart ASC, name ASC
    `
  );
  return rows;
}

/**
 * Усі клієнти (включно з архівними)
 */
async function getAllClients() {
  const rows = await query(
    `
    SELECT
      id,
      name,
      address,
      type,
      nip,
      pesel,
      email,
      phone,
      agreementStart,
      agreementEnd,
      subscription,
      subscriptionAmount,
      notice,
      comment,
      billingMode,
      logistics,
      courierPriceMode,
      courierPriceGross,
      shippingPriceMode,
      shippingPriceGross,
      archived,
      archivedAt
    FROM clients
    ORDER BY (agreementStart IS NULL), agreementStart ASC, name ASC
    `
  );
  return rows;
}

/**
 * Повна заміна вмісту таблиці clients.
 * Все в одній транзакції, щоб не втратити дані у випадку помилки.
 */
async function replaceAllClients(clientsArray) {
  const arr = Array.isArray(clientsArray) ? clientsArray : [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute("DELETE FROM clients");

    const sqlInsert = `
      INSERT INTO clients (
        id,
        name,
        address,
        type,
        nip,
        pesel,
        email,
        phone,
        agreementStart,
        agreementEnd,
        subscription,
        subscriptionAmount,
        notice,
        comment,
        billingMode,
        logistics,
        courierPriceMode,
        courierPriceGross,
        shippingPriceMode,
        shippingPriceGross,
        archived,
        archivedAt
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;

    for (const c of arr) {
      await conn.execute(sqlInsert, [
        toStr(c.id) || null, // якщо id текстове — збережеться як VARCHAR; якщо числове — MySQL сконвертує
        toStr(c.name),
        toStr(c.address),
        toStr(c.type || "op"),
        toStr(c.nip),
        toStr(c.pesel),
        toStr(c.email),
        toStr(c.phone),
        toDateOrNull(c.agreementStart),
        toDateOrNull(c.agreementEnd),
        toStr(c.subscription),
        toNumOrNull(c.subscriptionAmount) ?? 0,
        toBool01(c.notice),
        toStr(c.comment),
        toStr(c.billingMode),
        toStr(c.logistics),
        toStr(c.courierPriceMode),
        toNumOrNull(c.courierPriceGross),
        toStr(c.shippingPriceMode),
        toNumOrNull(c.shippingPriceGross),
        toBool01(c.archived),
        toDateOrNull(c.archivedAt),
      ]);
    }

    await conn.commit();
    return { inserted: arr.length };
  } catch (e) {
    try {
      await conn.rollback();
    } catch {}
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = {
  getAllActiveClients,
  getAllClients,
  replaceAllClients,
};
