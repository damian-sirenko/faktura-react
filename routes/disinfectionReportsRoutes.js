const express = require("express");
const router = express.Router();
console.log("DISINFECTION REPORTS ROUTER LOADED");
const { query } = require("../server/db");

router.post("/cycle/create", async (req, res) => {
  try {
    const {
      reportDate,
      washer,
      disinfectantName,
      concentration,
      immersionTimeMinutes,
    } = req.body;

    if (!reportDate || !washer) {
      return res.status(400).json({ error: "reportDate and washer required" });
    }

    const nextRow = await query(
      `SELECT IFNULL(MAX(cycle_number),0)+1 AS nextNumber FROM disinfect_reports`
    );

    const nextNumber = nextRow[0].nextNumber;

    const insert = await query(
      `INSERT INTO disinfect_reports
         (cycle_number, report_date, washer, disinfectant_name, concentration, immersion_time_minutes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      [
        nextNumber,
        reportDate,
        washer,
        disinfectantName || "",
        concentration || "",
        parseInt(immersionTimeMinutes) || 0,
      ]
    );

    res.json({
      success: true,
      cycleNumber: nextNumber,
      id: insert.insertId,
    });
  } catch (err) {
    console.error("CYCLE CREATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/cycle/approve", async (req, res) => {
  try {
    const { cycleNumber } = req.body;

    if (!cycleNumber) {
      return res.status(400).json({ error: "cycleNumber required" });
    }

    const report = await query(
      `SELECT id, status FROM disinfect_reports WHERE cycle_number=?`,
      [cycleNumber]
    );

    if (!report.length) {
      return res.status(404).json({ error: "Report not found" });
    }

    if (report[0].status === "APPROVED") {
      return res.status(400).json({ error: "Report already approved" });
    }

    const clients = await query(
      `SELECT 1 FROM disinfect_report_clients WHERE report_id=? LIMIT 1`,
      [report[0].id]
    );

    if (!clients.length) {
      return res.status(400).json({
        error: "Report must contain at least one client",
      });
    }

    await query(`UPDATE disinfect_reports SET status='APPROVED' WHERE id=?`, [
      report[0].id,
    ]);

    res.json({ approved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/cycle/unapprove", async (req, res) => {
  try {
    const { cycleNumber } = req.body;

    if (!cycleNumber) {
      return res.status(400).json({ error: "cycleNumber required" });
    }

    const report = await query(
      `SELECT id FROM disinfect_reports WHERE cycle_number=?`,
      [cycleNumber]
    );

    if (!report.length) {
      return res.status(404).json({ error: "Report not found" });
    }

    await query(`UPDATE disinfect_reports SET status='DRAFT' WHERE id=?`, [
      report[0].id,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/cycle/add-client", async (req, res) => {
  try {
    const { cycleNumber, clientId, manualIdentifier, manualClientName } =
      req.body;

    if (!cycleNumber) {
      return res.status(400).json({ error: "cycleNumber required" });
    }

    if (!clientId && !manualIdentifier) {
      return res
        .status(400)
        .json({ error: "clientId or manualIdentifier required" });
    }

    const report = await query(
      `SELECT id, status, washer FROM disinfect_reports WHERE cycle_number=?`,
      [cycleNumber]
    );

    if (!report.length) {
      return res.status(404).json({ error: "Report not found" });
    }

    const reportId = report[0].id;

    if (report[0].status === "APPROVED") {
      await query(`UPDATE disinfect_reports SET status='DRAFT' WHERE id=?`, [
        reportId,
      ]);
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

    const duplicate = await query(
      `
          SELECT 1 FROM disinfect_report_clients
          WHERE report_id=?
          AND (
            (client_id IS NOT NULL AND client_id=?)
            OR
            (manual_identifier IS NOT NULL AND manual_identifier=?)
          )
          LIMIT 1
        `,
      [reportId, clientId || null, manualIdentifier || null]
    );

    if (duplicate.length) {
      return res
        .status(400)
        .json({ error: "Client already added to this report" });
    }

    await query(
      `
          INSERT INTO disinfect_report_clients
          (report_id, client_id, manual_identifier, manual_client_name, washer)
          VALUES (?, ?, ?, ?, ?)
        `,
      [
        reportId,
        clientExists ? clientId : null,
        clientExists ? null : manualIdentifier ?? null,
        clientExists ? null : manualClientName ?? null,
        report[0].washer ?? null,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/cycle/remove-client", async (req, res) => {
  try {
    const { cycleNumber, clientId, manualIdentifier } = req.body;

    if (!cycleNumber) {
      return res.status(400).json({ error: "cycleNumber required" });
    }

    const report = await query(
      `SELECT id, status, washer FROM disinfect_reports WHERE cycle_number=?`,
      [cycleNumber]
    );

    if (!report.length) {
      return res.status(404).json({ error: "Report not found" });
    }

    const reportId = report[0].id;

    if (report[0].status === "APPROVED") {
      await query(`UPDATE disinfect_reports SET status='DRAFT' WHERE id=?`, [
        reportId,
      ]);
    }

    await query(
      `
        DELETE FROM disinfect_report_clients
        WHERE report_id=?
        AND (
          client_id=? OR manual_identifier=?
        )
      `,
      [reportId, clientId || null, manualIdentifier || null]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
router.get("/list", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const date = req.query.date || null;
    const client = req.query.client || null;

    let where = [];
    let params = [];

    if (date) {
      where.push("dr.report_date=?");
      params.push(date);
    }

    if (client) {
      where.push(`
            EXISTS (
              SELECT 1
              FROM disinfect_report_clients drc2
              WHERE drc2.report_id = dr.id
              AND (
                drc2.client_id LIKE ?
                OR drc2.manual_identifier LIKE ?
              )
            )
          `);
      params.push(`%${client}%`, `%${client}%`);
    }
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

    const sql = `
    SELECT
  dr.id,
  dr.cycle_number,
  DATE_FORMAT(dr.report_date,'%Y-%m-%d') AS report_date,
  dr.washer,
  dr.disinfectant_name,
  dr.concentration,
  dr.immersion_time_minutes,
  dr.status,
  GROUP_CONCAT(
    COALESCE(c.id, drc.manual_identifier)
    ORDER BY drc.washer SEPARATOR ','
  ) AS clients_list
        FROM disinfect_reports dr
        LEFT JOIN disinfect_report_clients drc
          ON dr.id = drc.report_id
        LEFT JOIN clients c
          ON c.id = drc.client_id
        ${whereSql}
        GROUP BY dr.id
        ORDER BY dr.cycle_number DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

    const rows = await query(sql, params);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/cycle/:cycleNumber", async (req, res) => {
  try {
    const rows = await query(
      `SELECT 
          id,
          cycle_number,
          DATE_FORMAT(report_date,'%Y-%m-%d') AS report_date,
          washer,
          disinfectant_name,
          concentration,
          immersion_time_minutes,
          status,
          generated_report_path,
          created_at
        FROM disinfect_reports
        WHERE cycle_number=?`,
      [req.params.cycleNumber]
    );

    if (!rows.length) {
      return res.json(null);
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/cycle/:cycleNumber/clients", async (req, res) => {
  try {
    const report = await query(
      `SELECT id FROM disinfect_reports WHERE cycle_number=?`,
      [req.params.cycleNumber]
    );

    if (!report.length) {
      return res.status(404).json({ error: "Report not found" });
    }

    const rows = await query(
      `
        SELECT
          COALESCE(c.id, drc.manual_identifier) AS id,
          COALESCE(c.name, drc.manual_client_name) AS name,
          IF(c.id IS NULL, 1, 0) AS is_manual
        FROM disinfect_report_clients drc
        LEFT JOIN clients c ON c.id = drc.client_id
        WHERE drc.report_id=?
        ORDER BY name
        `,
      [report[0].id]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/reports/delete-batch", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: "No ids" });
    }

    const placeholders = ids.map(() => "?").join(",");

    await query(
      `DELETE FROM disinfect_report_clients WHERE report_id IN (${placeholders})`,
      ids
    );

    await query(
      `DELETE FROM disinfect_reports WHERE id IN (${placeholders})`,
      ids
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
