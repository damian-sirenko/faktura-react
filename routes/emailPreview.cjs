const express = require("express");
const { query } = require("../server/db.js");

const router = express.Router();

router.post("/preview-data", async (req, res) => {
  try {
    const { month, clientIds } = req.body || {};

    if (!month || !Array.isArray(clientIds) || !clientIds.length) {
      return res.status(400).json({ error: "Brak danych wejściowych" });
    }

    const placeholders = clientIds.map(() => "?").join(",");

    const invoices = await query(
      `
      SELECT clientId, clientName, filename, folder, dueDate
      FROM invoices
      WHERE LEFT(issueDate, 7) = ?
      AND (
      clientId IN (${placeholders})
      OR clientName IS NOT NULL
      )
      ORDER BY issueDate DESC
        `,
      [month, ...clientIds]
    );

    const protocols = await query(
      `
      SELECT clientId
      FROM protocols
      WHERE month = ?
        AND clientId IN (${placeholders})
      `,
      [month, ...clientIds]
    );

    const clients = await query(
      `
      SELECT id, name, email
      FROM clients
      WHERE id IN (${placeholders})
      `,
      clientIds
    );

    const rows = clientIds.map((id) => {
      const client = clients.find((c) => String(c.id) === String(id));
      const inv =
        invoices.find((i) => String(i.clientId) === String(id)) ||
        invoices.find(
          (i) =>
            i.clientName && client && i.clientName.trim() === client.name.trim()
        );

      const prot = protocols.find((p) => String(p.clientId) === String(id));

      return {
        clientId: id,
        clientName: client?.name || "",
        clientEmail: client?.email || "",
        invoiceFile: inv?.filename || null,
        invoiceFolder: inv?.folder || null,
        dueDate: inv?.dueDate || null,
        protocolFile: prot ? `Protokół_${id}_${month}.pdf` : null,
      };
    });

    res.json(rows);
  } catch (e) {
    console.error("email preview-data error:", e);
    res.status(500).json({ error: "Błąd backendu" });
  }
});

module.exports = router;
