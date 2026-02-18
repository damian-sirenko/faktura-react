const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");

const { query } = require("../server/db");
const generateSterilizationPdf = require("../backend/process_reports/sterilization/generators/sterilization.pdfkit.cjs");

router.post("/sterilization/cycle/generate-report", async (req, res) => {
  try {
    const { cycleId } = req.body;

    if (!cycleId) {
      return res.status(400).json({ error: "cycleId required" });
    }

    const cycleRows = await query(
      `
      SELECT sc.*, a.name AS autoclave_name, a.serial_number
      FROM sterilization_cycles sc
      JOIN autoclaves a ON a.id = sc.autoclave_id
      WHERE sc.id=?
      `,
      [cycleId]
    );

    if (!cycleRows.length) {
      return res.status(404).json({ error: "Cycle not found" });
    }

    const cycle = cycleRows[0];

    if (cycle.status !== "APPROVED") {
      return res
        .status(400)
        .json({ error: "Cycle must be APPROVED before generating report" });
    }
    const clients = await query(
      `
      SELECT
        COALESCE(c.id, scc.manual_identifier) AS identifier
      FROM sterilization_cycle_clients scc
      LEFT JOIN clients c ON c.id = scc.client_id
      WHERE scc.cycle_id=?
      `,
      [cycleId]
    );

    const result = await generateSterilizationPdf(cycleId);

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/sterilization/print-batch", async (req, res) => {
  try {
    const { cycleIds } = req.body;

    if (!Array.isArray(cycleIds) || cycleIds.length === 0) {
      return res.status(400).json({ error: "cycleIds required" });
    }

    const generateBatchSterilizationPdf = require("../backend/process_reports/sterilization/documents/generateBatchSterilizationPdf");

    const result = await generateBatchSterilizationPdf(cycleIds);

    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
