const express = require("express");
const router = express.Router();
const { query } = require("../server/db");

// додати клієнта в процес дезінфекції
router.post("/add-client", async (req, res) => {
  try {
    const {
      processDate,
      washer,
      clientId,
      manualIdentifier,
      manualClientName,
    } = req.body;

    if (!processDate || !washer) {
      if (!clientId && !manualIdentifier) {
        return res.status(400).json({
          error: "clientId or manualIdentifier required",
        });
      }
      return res.status(400).json({ error: "processDate and washer required" });
    }

    const [log] = await query(
      `SELECT id, approved_at FROM disinfection_process_log
         WHERE process_date=? AND washer=?`,
      [processDate, washer]
    );

    if (!log) {
      return res.status(404).json({ error: "Process log not found" });
    }

    if (log.approved_at !== null) {
      return res.status(400).json({ error: "Log already approved" });
    }

    await query(
      `
      INSERT IGNORE INTO disinfection_process_log_clients
      (process_log_id, client_id, manual_identifier, manual_client_name)
      VALUES (?, ?, ?, ?)
      `,
      [
        log.id,
        clientId || null,
        manualIdentifier || null,
        manualClientName || null,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// видалити клієнта
router.post("/remove-client", async (req, res) => {
  try {
    const { processDate, washer, clientId, manualIdentifier } = req.body;

    const [log] = await query(
      `SELECT id, approved_at FROM disinfection_process_log
                 WHERE process_date=? AND washer=?`,
      [processDate, washer]
    );

    if (!log) return res.json({ success: true });

    if (log.approved_at !== null) {
      return res.status(400).json({ error: "Log already approved" });
    }

    await query(
      `
 DELETE FROM disinfection_process_log_clients
WHERE process_log_id=?
AND (
  (client_id IS NOT NULL AND client_id=?)
  OR
  (manual_identifier IS NOT NULL AND manual_identifier=?)
)
      `,
      [log.id, clientId || null, manualIdentifier || null]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// отримати клієнтів для процесу
router.get("/:date/:washer/clients", async (req, res) => {
  try {
    const { date, washer } = req.params;

    const rows = await query(
      `
        SELECT
          COALESCE(c.id, d.manual_identifier) AS id,
          c.name,
          d.manual_client_name,
          CASE WHEN c.id IS NULL THEN 1 ELSE 0 END AS is_manual
        FROM disinfection_process_log dpl
        JOIN disinfection_process_log_clients d
          ON d.process_log_id = dpl.id
        LEFT JOIN clients c ON c.id = d.client_id
        WHERE DATE(dpl.process_date)=? AND dpl.washer=?
       ORDER BY COALESCE(c.name, d.manual_client_name, COALESCE(c.id, d.manual_identifier))
        `,
      [date, washer]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
