const express = require("express");
const router = express.Router();

const { query } = require("../server/db");
const detectUsbDrives = require("../backend/process_reports/sterilization/importers/detectUsbDrives");
const fs = require("fs");
const generateSterilizationPdf = require("../backend/process_reports/sterilization/generators/sterilization.pdfkit.cjs");
async function trySetReady(cycleId) {
  const cycle = await query(
    `SELECT program, temperature_min, pressure_min, sterilization_duration_seconds, status, cycle_type
     FROM sterilization_cycles
     WHERE id=?`,
    [cycleId]
  );

  if (!cycle.length) return;

  const c = cycle[0];

  if (["APPROVED", "DOCUMENTED", "REJECTED"].includes(c.status)) return;

  const clients = await query(
    `SELECT 1 FROM sterilization_cycle_clients WHERE cycle_id=? LIMIT 1`,
    [cycleId]
  );

  // якщо немає клієнтів → IMPORTED
  if (!clients.length) {
    await query(
      `UPDATE sterilization_cycles 
       SET status='IMPORTED'
       WHERE id=?`,
      [cycleId]
    );
    return;
  }

  let invalid = false;

  const programTemp = parseInt(String(c.program || "").match(/\d+/)?.[0]);

  if (!programTemp || ![121, 134].includes(programTemp)) {
    invalid = true;
  }

  if (c.temperature_min == null || c.temperature_min < programTemp) {
    invalid = true;
  }

  const minPressure = programTemp === 121 ? 100 : 200;

  if (c.pressure_min == null || c.pressure_min < minPressure) {
    invalid = true;
  }

  if (c.sterilization_duration_seconds == null) {
    invalid = true;
  }

  const minDuration = programTemp === 121 ? 20 * 60 : 3.5 * 60;

  if (c.sterilization_duration_seconds < minDuration) {
    invalid = true;
  }

  // якщо параметри НЕ валідні → IMPORTED
  if (invalid) {
    await query(
      `UPDATE sterilization_cycles 
       SET status='IMPORTED'
       WHERE id=?`,
      [cycleId]
    );
    return;
  }

  // якщо все добре → READY
  await query(
    `UPDATE sterilization_cycles 
     SET status='READY'
     WHERE id=?`,
    [cycleId]
  );
}

router.post("/sterilization/cycle/add-client", async (req, res) => {
  try {
    const { cycleId, clientId, manualIdentifier, manualClientName } = req.body;

    if (!cycleId) {
      return res.status(400).json({ error: "cycleId required" });
    }

    if (!clientId && !manualIdentifier) {
      return res.status(400).json({
        error: "clientId or manualIdentifier required",
      });
    }
    const cycleRows = await query(
      `SELECT status, program FROM sterilization_cycles WHERE id=?`,
      [cycleId]
    );

    if (!cycleRows.length) {
      return res.status(404).json({ error: "Cycle not found" });
    }

    const programStr = String(cycleRows[0].program || "").toUpperCase();

    if (programStr.includes("B-D") || programStr.includes("BD")) {
      return res.status(400).json({
        error: "Nie można dodawać klientów do testu Bowie-Dick",
      });
    }

    if (cycleRows[0].status === "APPROVED") {
      return res.status(400).json({
        error: "Cannot modify approved cycle",
      });
    }

    if (cycleRows[0].status === "REJECTED") {
      return res.status(400).json({
        error: "Cycle already rejected",
      });
    }

    let clientExists = false;

    if (clientId) {
      const client = await query("SELECT id FROM clients WHERE id=?", [
        clientId,
      ]);

      if (!client.length) {
        return res.status(404).json({ error: "Client not found" });
      }

      clientExists = true;
    }

    // додаємо клієнта якщо його ще немає
    await query(
      `INSERT IGNORE INTO sterilization_cycle_clients
       (cycle_id, client_id, manual_identifier, manual_client_name)
       VALUES (?, ?, ?, ?)`,
      [
        cycleId,
        clientExists ? clientId : null,
        clientExists ? null : manualIdentifier,
        clientExists ? null : manualClientName || null,
      ]
    );

    await trySetReady(cycleId);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/sterilization/cycle/:id/clients", async (req, res) => {
  try {
    const cycleId = req.params.id;

    const clients = await query(
      `
     SELECT
     COALESCE(c.id, scc.manual_identifier) AS id,
     COALESCE(c.name, scc.manual_client_name) AS name,
     CASE
     WHEN c.id IS NULL THEN 1
     ELSE 0
     END AS is_manual
     FROM sterilization_cycle_clients scc
     LEFT JOIN clients c ON c.id = scc.client_id
     WHERE scc.cycle_id = ?
     ORDER BY name
      `,
      [cycleId]
    );

    res.json(clients);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/sterilization/cycle/approve", async (req, res) => {
  try {
    const { cycleId } = req.body;

    if (!cycleId) {
      return res.status(400).json({ error: "cycleId required" });
    }

    const cycleRows = await query(
      `SELECT id, cycle_number, cycle_start_datetime, cycle_type, status, program, pressure_min, pressure_max, sterilization_duration_seconds, temperature_min
       FROM sterilization_cycles
       WHERE id=?`,
      [cycleId]
    );

    if (!cycleRows.length) {
      return res.status(404).json({ error: "Cycle not found" });
    }
    const cycle = cycleRows[0];

    if (cycle.status === "APPROVED") {
      return res.status(400).json({ error: "Cycle already approved" });
    }
    if (cycle.status === "REJECTED") {
      return res.status(400).json({
        error: "Rejected cycle cannot be approved",
      });
    }

    if (cycle.status !== "READY") {
      return res.status(400).json({
        error: "Cycle must have READY status before approval",
      });
    }

    // --- PARAMETER VALIDATION ---

    const programStr = String(cycle.program || "").toUpperCase();

    if (programStr.includes("B-D") || programStr.includes("BD")) {
      return res.status(400).json({
        error: "B-D test cannot be approved as sterilization cycle",
      });
    }

    const programTemp = parseInt(programStr.match(/\d+/)?.[0]);

    if (!programTemp) {
      return res.status(400).json({
        error: "Cannot detect sterilization program temperature",
      });
    }

    if (![121, 134].includes(programTemp)) {
      return res.status(400).json({
        error: "Invalid sterilization program detected",
      });
    }
    if (cycle.temperature_min == null) {
      return res.status(400).json({
        error: "Temperature data missing",
      });
    }

    if (cycle.temperature_min < programTemp) {
      return res.status(400).json({
        error: `Temperature too low. Minimum for ${programTemp}° is ${programTemp}`,
      });
    }

    const minPressure = programTemp === 121 ? 100 : 200;

    let minDuration;
    let maxDuration;

    if (programTemp === 121) {
      minDuration = 20 * 60;
      maxDuration = 23 * 60;
    } else {
      minDuration = 3.5 * 60;
      maxDuration = 5 * 60;
    }

    if (cycle.sterilization_duration_seconds == null) {
      return res.status(400).json({
        error: "Sterilization duration missing",
      });
    }

    const duration = cycle.sterilization_duration_seconds;

    if (duration < minDuration || duration > maxDuration) {
      return res.status(400).json({
        error: `Sterilization time must be between ${minDuration / 60} and ${
          maxDuration / 60
        } minutes`,
      });
    }

    if (cycle.pressure_min == null) {
      return res.status(400).json({
        error: "Pressure data missing",
      });
    }

    if (cycle.pressure_min < minPressure) {
      return res.status(400).json({
        error: `Pressure too low. Minimum for ${programTemp}° is ${minPressure}`,
      });
    }

    if (String(cycle.cycle_type).toUpperCase() === "TEST") {
      return res.status(400).json({ error: "TEST cycles cannot be approved" });
    }

    const clients = await query(
      `SELECT 1
       FROM sterilization_cycle_clients
       WHERE cycle_id=?
       LIMIT 1`,
      [cycleId]
    );

    if (!clients.length) {
      return res
        .status(400)
        .json({ error: "Cycle must have at least one client" });
    }
    console.log("Cycle approved:", {
      cycleId,
      approvedAt: new Date().toISOString(),
    });
    await query(
      `UPDATE sterilization_cycles
       SET status='APPROVED'
       WHERE id=?`,
      [cycleId]
    );

    const clientsFull = await query(
      `
      SELECT
        COALESCE(c.id, scc.manual_identifier) AS identifier
      FROM sterilization_cycle_clients scc
      LEFT JOIN clients c ON c.id = scc.client_id
      WHERE scc.cycle_id=?
      `,
      [cycleId]
    );

    const pdfResult = await generateSterilizationPdf(cycleId);

    await query(
      `UPDATE sterilization_cycles
       SET generated_report_path=?
       WHERE id=?`,
      [pdfResult.path, cycleId]
    );
    await query(
      `INSERT INTO sterilization_cycle_logs (cycle_id, action, created_at)
       VALUES (?, 'APPROVED', NOW())`,
      [cycleId]
    );

    res.json({
      approved: true,
      url: pdfResult.url,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
router.post("/sterilization/cycle/reject", async (req, res) => {
  try {
    const { cycleId, reason } = req.body;

    if (!cycleId) {
      return res.status(400).json({ error: "cycleId required" });
    }

    const cycleRows = await query(
      `SELECT status FROM sterilization_cycles WHERE id=?`,
      [cycleId]
    );

    if (!cycleRows.length) {
      return res.status(404).json({ error: "Cycle not found" });
    }

    if (cycleRows[0].status === "APPROVED") {
      return res.status(400).json({
        error: "Cannot modify approved cycle",
      });
    }

    if (cycleRows[0].status === "REJECTED") {
      return res.status(400).json({
        error: "Cannot modify rejected cycle",
      });
    }

    if (cycleRows[0].status !== "READY") {
      return res.status(400).json({
        error: "Only READY cycles can be rejected",
      });
    }

    await query(
      `UPDATE sterilization_cycles
       SET status='REJECTED',
           cycle_type='REJECTED'
       WHERE id=?`,
      [cycleId]
    );

    await query(
      `INSERT INTO sterilization_cycle_logs (cycle_id, action, details, created_at)
       VALUES (?, 'REJECTED', ?, NOW())`,
      [cycleId, reason || null]
    );

    res.json({ rejected: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/sterilization/cycle/revert-to-ready", async (req, res) => {
  try {
    const { cycleId } = req.body;

    if (!cycleId) {
      return res.status(400).json({ error: "cycleId required" });
    }

    const rows = await query(
      `SELECT status FROM sterilization_cycles WHERE id=?`,
      [cycleId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Cycle not found" });
    }

    if (rows[0].status !== "APPROVED") {
      return res.status(400).json({
        error: "Only APPROVED cycle can be reverted to READY",
      });
    }

    await query(`UPDATE sterilization_cycles SET status='READY' WHERE id=?`, [
      cycleId,
    ]);

    await query(
      `INSERT INTO sterilization_cycle_logs (cycle_id, action, created_at)
       VALUES (?, 'REVERTED_TO_READY', NOW())`,
      [cycleId]
    );

    res.json({ reverted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/sterilization/cycle/:id/status", async (req, res) => {
  try {
    const cycleId = req.params.id;

    const rows = await query(
      `SELECT id, status, cycle_type
       FROM sterilization_cycles
       WHERE id=?`,
      [cycleId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Cycle not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/sterilization/cycle/:id/logs", async (req, res) => {
  try {
    const cycleId = req.params.id;

    const logs = await query(
      `SELECT id, action, details, created_at
       FROM sterilization_cycle_logs
       WHERE cycle_id=?
       ORDER BY created_at DESC`,
      [cycleId]
    );

    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/sterilization/cycle/remove-client", async (req, res) => {
  try {
    const { cycleId, clientId, manualIdentifier } = req.body;

    if (!cycleId) {
      return res.status(400).json({ error: "cycleId required" });
    }
    const cycleRows = await query(
      `SELECT status FROM sterilization_cycles WHERE id=?`,
      [cycleId]
    );

    if (!cycleRows.length) {
      return res.status(404).json({ error: "Cycle not found" });
    }

    if (cycleRows[0].status === "APPROVED") {
      return res.status(400).json({
        error: "Cannot modify approved cycle",
      });
    }

    if (!clientId && !manualIdentifier) {
      return res.status(400).json({
        error: "clientId or manualIdentifier required",
      });
    }

    if (clientId) {
      await query(
        `DELETE FROM sterilization_cycle_clients
         WHERE cycle_id=? AND client_id=?`,
        [cycleId, clientId]
      );
    }

    if (manualIdentifier) {
      await query(
        `DELETE FROM sterilization_cycle_clients
         WHERE cycle_id=? AND manual_identifier=?`,
        [cycleId, manualIdentifier]
      );
    }

    const clients = await query(
      `SELECT 1 FROM sterilization_cycle_clients WHERE cycle_id=? LIMIT 1`,
      [cycleId]
    );

    if (!clients.length) {
      await query(
        `UPDATE sterilization_cycles SET status='IMPORTED' WHERE id=? AND status='READY'`,
        [cycleId]
      );
    }

    res.json({ removed: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/sterilization/cycle/update-manual-client", async (req, res) => {
  try {
    const { cycleId, manualIdentifier, newIdentifier, newName } = req.body;

    if (!cycleId || !manualIdentifier) {
      return res.status(400).json({
        error: "cycleId and manualIdentifier required",
      });
    }

    await query(
      `UPDATE sterilization_cycle_clients
       SET
       manual_identifier = COALESCE(?, manual_identifier),
       manual_client_name = COALESCE(?, manual_client_name)
       WHERE cycle_id=? AND manual_identifier=?`,
      [newIdentifier || null, newName || null, cycleId, manualIdentifier]
    );

    res.json({ updated: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/sterilization/cycles/search", async (req, res) => {
  try {
    const {
      cycleNumber,
      status,
      dateFrom,
      dateTo,
      clientIdentifier,
      program,
      limit,
      offset,
    } = req.query;

    const sqlLimit = Number(limit) || 50;
    const sqlOffset = Number(offset) || 0;

    let sql = `
      SELECT
        sc.id,
        sc.cycle_number,
        sc.cycle_start_datetime,
        sc.program,
        sc.status,
        COUNT(scc.id) AS clients_count,
       GROUP_CONCAT(
DISTINCT CONCAT(
COALESCE(c.id, scc.manual_identifier),
'|',
COALESCE(c.name, scc.manual_client_name)
)
SEPARATOR ','
) AS clients_list
         FROM sterilization_cycles sc
         LEFT JOIN sterilization_cycle_clients scc ON sc.id = scc.cycle_id
         LEFT JOIN clients c ON c.id = scc.client_id
         WHERE 1=1
    `;

    const params = [];

    if (cycleNumber) {
      sql += ` AND sc.cycle_number LIKE ?`;
      params.push(`%${cycleNumber}%`);
    }

    if (status) {
      sql += ` AND sc.status = ?`;
      params.push(status);
    }

    if (dateFrom) {
      sql += ` AND sc.cycle_start_datetime >= ?`;
      params.push(dateFrom);
    }

    if (dateTo) {
      sql += ` AND sc.cycle_start_datetime <= ?`;
      params.push(dateTo);
    }

    if (clientIdentifier) {
      sql += `
        AND (
          c.id LIKE ?
          OR scc.manual_identifier LIKE ?
        )
      `;
      params.push(`%${clientIdentifier}%`, `%${clientIdentifier}%`);
    }

    if (program) {
      sql += ` AND sc.program LIKE ?`;
      params.push(`%${program}%`);
    }

    sql += `
      GROUP BY sc.id
      ORDER BY sc.cycle_start_datetime DESC
     LIMIT ${sqlLimit} OFFSET ${sqlOffset}
`;

    const rows = await query(sql, params);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/sterilization/cycle/:id/full", async (req, res) => {
  try {
    const cycleId = req.params.id;

    const cycle = await query(`SELECT * FROM sterilization_cycles WHERE id=?`, [
      cycleId,
    ]);

    if (!cycle.length) {
      return res.status(404).json({ error: "Cycle not found" });
    }

    const clients = await query(
      `
      SELECT
        COALESCE(c.id, scc.manual_identifier) AS id,
        COALESCE(c.name, scc.manual_client_name) AS name,
        IF(c.id IS NULL, 1, 0) AS is_manual
      FROM sterilization_cycle_clients scc
      LEFT JOIN clients c ON c.id = scc.client_id
      WHERE scc.cycle_id=?
      `,
      [cycleId]
    );

    const logs = await query(
      `
      SELECT id, action, details, created_at
      FROM sterilization_cycle_logs
      WHERE cycle_id=?
      ORDER BY created_at DESC
      `,
      [cycleId]
    );

    res.json({
      cycle: cycle[0],
      clients,
      logs,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/sterilization/client/:identifier/history", async (req, res) => {
  try {
    const identifier = req.params.identifier;

    const rows = await query(
      `
      SELECT
        sc.id,
        sc.cycle_number,
        sc.cycle_start_datetime,
        sc.program,
        sc.status
        FROM sterilization_cycles sc
        JOIN sterilization_cycle_clients scc ON sc.id = scc.cycle_id
        LEFT JOIN clients c ON c.id = scc.client_id
        WHERE
        c.id = ?
        OR scc.manual_identifier = ?
      ORDER BY sc.cycle_start_datetime DESC
      `,
      [identifier, identifier]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/sterilization/cycle/update", async (req, res) => {
  try {
    const {
      cycleId,
      program,
      temperature_min,
      temperature_max,
      pressure_min,
      pressure_max,
      sterilization_duration_seconds,
      sterilization_start,
      sterilization_end,
      cycle_type,
    } = req.body;

    if (!cycleId) {
      return res.status(400).json({ error: "cycleId required" });
    }

    await query(
      `
      UPDATE sterilization_cycles
      SET
        program = COALESCE(?, program),
        temperature_min = COALESCE(?, temperature_min),
        temperature_max = COALESCE(?, temperature_max),
        pressure_min = COALESCE(?, pressure_min),
        pressure_max = COALESCE(?, pressure_max),
        sterilization_duration_seconds = COALESCE(?, sterilization_duration_seconds),
        sterilization_start = COALESCE(?, sterilization_start),
        sterilization_end = COALESCE(?, sterilization_end),
        cycle_type = COALESCE(?, cycle_type)
      WHERE id = ?
      `,
      [
        program || null,
        temperature_min ?? null,
        temperature_max ?? null,
        pressure_min ?? null,
        pressure_max ?? null,
        sterilization_duration_seconds ?? null,
        sterilization_start ?? null,
        sterilization_end ?? null,
        cycle_type || null,
        cycleId,
      ]
    );

    await trySetReady(cycleId);

    await query(
      `INSERT INTO sterilization_cycle_logs (cycle_id, action, created_at)
       VALUES (?, 'UPDATED', NOW())`,
      [cycleId]
    );

    res.json({ updated: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/sterilization/cycle/delete", async (req, res) => {
  try {
    const { cycleId } = req.body;

    if (!cycleId) {
      return res.status(400).json({ error: "cycleId required" });
    }

    const exists = await query(
      `SELECT id FROM sterilization_cycles WHERE id=?`,
      [cycleId]
    );

    if (!exists.length) {
      return res.status(404).json({ error: "Cycle not found" });
    }

    await query(
      `INSERT INTO sterilization_cycle_logs (cycle_id, action, details)
       VALUES (?, 'DELETED', 'Deleted manually')`,
      [cycleId]
    );

    await query(`DELETE FROM sterilization_cycle_clients WHERE cycle_id=?`, [
      cycleId,
    ]);

    await query(`DELETE FROM sterilization_cycle_logs WHERE cycle_id=?`, [
      cycleId,
    ]);

    await query(`DELETE FROM sterilization_cycles WHERE id=?`, [cycleId]);

    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/sterilization/cycles/list", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10);
    const offset = parseInt(req.query.offset, 10);

    const safeLimit = Number.isFinite(limit) ? limit : 20;
    const safeOffset = Number.isFinite(offset) ? offset : 0;

    const rows = await query(
      `
      SELECT
        sc.id,
        sc.cycle_number,
        sc.cycle_start_datetime,
        sc.program,
        sc.status,
        COUNT(scc.id) AS clients_count,
        GROUP_CONCAT(
          DISTINCT CONCAT(
            COALESCE(c.id, scc.manual_identifier),
            '|',
            COALESCE(c.name, scc.manual_client_name)
          )
          SEPARATOR ','
        ) AS clients_list
      FROM sterilization_cycles sc
      LEFT JOIN sterilization_cycle_clients scc ON scc.cycle_id = sc.id
      LEFT JOIN clients c ON c.id = scc.client_id
      GROUP BY sc.id
      ORDER BY sc.cycle_start_datetime DESC
      LIMIT ${limit} OFFSET ${offset}
      `
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
router.delete("/sterilization/cycles/delete-many", async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: "ids array required" });
    }

    const imported = await query(
      `SELECT id FROM sterilization_cycles
       WHERE id IN (${ids.map(() => "?").join(",")})
       AND status='IMPORTED'`,
      ids
    );

    if (imported.length) {
      return res.status(400).json({
        error: "Cannot delete IMPORTED cycles",
      });
    }
    await query(
      `INSERT INTO sterilization_cycle_logs (cycle_id, action, details)
       SELECT id, 'DELETED', 'Deleted via bulk delete'
       FROM sterilization_cycles
       WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids
    );

    await query(
      `DELETE FROM sterilization_cycle_clients WHERE cycle_id IN (${ids
        .map(() => "?")
        .join(",")})`,
      ids
    );

    await query(
      `DELETE FROM sterilization_cycles WHERE id IN (${ids
        .map(() => "?")
        .join(",")})`,
      ids
    );

    res.json({ deleted: true, count: ids.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/sterilization/cycle/:id/report-raw", async (req, res) => {
  try {
    const cycle = await query(
      `SELECT report_file_path FROM sterilization_cycles WHERE id=?`,
      [req.params.id]
    );

    if (!cycle.length || !cycle[0].report_file_path) {
      return res.status(404).json({ error: "Report not found" });
    }
    const content = fs.readFileSync(cycle[0].report_file_path, "utf16le");

    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/sterilization/cycle/mark-documented", async (req, res) => {
  try {
    const { cycleId } = req.body;

    if (!cycleId) {
      return res.status(400).json({ error: "cycleId required" });
    }

    const cycle = await query(
      `SELECT status FROM sterilization_cycles WHERE id=?`,
      [cycleId]
    );

    if (!cycle.length) {
      return res.status(404).json({ error: "Cycle not found" });
    }

    if (cycle[0].status !== "APPROVED") {
      return res.status(400).json({
        error: "Only APPROVED cycles can be documented",
      });
    }

    await query(
      `UPDATE sterilization_cycles
       SET status='DOCUMENTED'
       WHERE id=?`,
      [cycleId]
    );

    await query(
      `INSERT INTO sterilization_cycle_logs (cycle_id, action, created_at)
       VALUES (?, 'DOCUMENTED', NOW())`,
      [cycleId]
    );

    res.json({ documented: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
