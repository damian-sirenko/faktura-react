const express = require("express");
const router = express.Router();
const { query } = require("../server/db");

// створення або оновлення запису
router.post("/disinfection/report/create", async (req, res) => {
  try {
    const { processDate, washer, responsiblePerson, confirmed } = req.body;

    if (!processDate || !washer) {
      return res.status(400).json({ error: "processDate and washer required" });
    }

    const existing = await query(
      `SELECT id, approved_at FROM disinfection_process_log
       WHERE process_date=? AND washer=?`,
      [processDate, washer]
    );

    if (existing.length && existing[0].approved_at) {
      return res.status(400).json({ error: "Log already approved" });
    }
    if (existing.length) {
      await query(
        `
        UPDATE disinfection_process_log
        SET responsible_person=?, confirmed=?
        WHERE DATE(process_date)=? AND washer=?
        `,
        [responsiblePerson || null, confirmed ? 1 : 0, processDate, washer]
      );

      return res.json({ updated: true });
    }

    await query(
      `
      INSERT INTO disinfection_process_log
      (process_date, washer, responsible_person, confirmed)
      VALUES (?, ?, ?, ?)
      `,
      [processDate, washer, responsiblePerson || null, confirmed ? 1 : 0]
    );

    res.json({ created: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// отримання логів за датою
router.get("/disinfection/report/:date", async (req, res) => {
  try {
    const rows = await query(
      `
  SELECT
  id,
  DATE_FORMAT(process_date,'%Y-%m-%d') AS process_date,
  washer,
  responsible_person,
  confirmed,
  approved_by,
  approved_at,
  created_at
      FROM disinfection_process_log
      WHERE DATE(process_date)=?
      `,
      [req.params.date]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/disinfection/report/approve", async (req, res) => {
  try {
    const { processDate, washer, approvedBy } = req.body;

    if (!processDate || !washer || !approvedBy) {
      return res.status(400).json({ error: "Missing data" });
    }

    await query(
      `
      UPDATE disinfection_process_log
      SET approved_by=?, approved_at=NOW()
      WHERE process_date=? AND washer=?
      `,
      [approvedBy, processDate, washer]
    );

    res.json({ approved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/disinfection/report/unapprove", async (req, res) => {
  try {
    const { processDate, washer } = req.body;

    if (!processDate || !washer) {
      return res.status(400).json({ error: "Missing data" });
    }

    await query(
      `
      UPDATE disinfection_process_log
      SET approved_by=NULL, approved_at=NULL
      WHERE process_date=? AND washer=?
      `,
      [processDate, washer]
    );

    res.json({ unapproved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/report/:id", async (req, res) => {
  try {
    const rows = await query(
      `SELECT 
        id,
        DATE_FORMAT(report_date,'%Y-%m-%d') AS report_date,
        washer,
        disinfectant_name,
        concentration,
        immersion_time_minutes,
        status,
        generated_report_path,
        created_at
      FROM disinfect_reports
      WHERE id=?`,
      [req.params.id]
    );

    if (!rows.length) {
      return res.json(null);
    }

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/report/:id/clients", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT c.id, c.name
      FROM disinfect_report_clients rc
      JOIN clients c ON c.id = rc.client_id
      WHERE rc.report_id = ?
      `,
      [req.params.id]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
