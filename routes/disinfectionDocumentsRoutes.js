const express = require("express");
const router = express.Router();

const { query } = require("../server/db");
const generateDisinfectionPDF = require("../backend/process_reports/disinfection/generators/disinfection.pdfkit.cjs");

router.post("/disinfection/report/get-or-create", async (req, res) => {
  try {
    const { reportDate, washer } = req.body;

    if (!reportDate || !washer) {
      return res.status(400).json({ error: "reportDate and washer required" });
    }

    let rows = await query(
      `SELECT * FROM disinfect_reports WHERE report_date=? AND washer=?`,
      [reportDate, washer]
    );

    if (!rows.length) {
      await query(
        `
          INSERT INTO disinfect_reports
          (report_date, washer, disinfectant_name, concentration, immersion_time_minutes)
          VALUES (?, ?, '', '', 0)
          `,
        [reportDate, washer]
      );

      rows = await query(
        `SELECT * FROM disinfect_reports WHERE report_date=? AND washer=?`,
        [reportDate, washer]
      );
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// update параметрів рапорту
router.patch("/disinfection/report/update", async (req, res) => {
  try {
    const {
      reportId,
      disinfectant_name,
      concentration,
      immersion_time_minutes,
    } = req.body;

    if (!reportId) {
      return res.status(400).json({ error: "reportId required" });
    }

    const existing = await query(
      `SELECT status FROM disinfect_reports WHERE id=?`,
      [reportId]
    );

    if (!existing.length) {
      return res.status(404).json({ error: "Report not found" });
    }

    if (existing[0].status === "APPROVED") {
      return res.status(400).json({ error: "Cannot edit approved report" });
    }

    await query(
      `
      UPDATE disinfect_reports
      SET
        disinfectant_name = COALESCE(?, disinfectant_name),
        concentration = COALESCE(?, concentration),
        immersion_time_minutes = COALESCE(?, immersion_time_minutes)
      WHERE id=?
      `,
      [
        disinfectant_name ?? null,
        concentration ?? null,
        immersion_time_minutes ?? null,
        reportId,
      ]
    );

    res.json({ updated: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/disinfection/report/generate-pdf", async (req, res) => {
  try {
    const { reportId } = req.body;

    if (!reportId) {
      return res.status(400).json({ error: "reportId required" });
    }

    const result = await generateDisinfectionPDF(reportId);

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

router.post("/disinfection/reports/print-batch", async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: "ids required" });
    }

    const reports = await query(
      `
        SELECT *
        FROM disinfect_reports
        WHERE id IN (${ids.map(() => "?").join(",")})
        AND status='APPROVED'
        ORDER BY report_date, washer
        `,
      ids
    );

    if (!reports.length) {
      return res.status(404).json({ error: "No approved reports found" });
    }

    const generateBatchPDF = require("../backend/process_reports/disinfection/generators/disinfection.batch.pdfkit.cjs");

    const result = await generateBatchPDF(reports);

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
