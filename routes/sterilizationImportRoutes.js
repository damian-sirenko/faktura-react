const express = require("express");
const router = express.Router();
const path = require("path");

const scanAutoclaveFolder = require("../backend/process_reports/sterilization/importers/scanAutoclaveFolder");
const importAutoclaveReport = require("../backend/process_reports/sterilization/importers/importAutoclaveReport");

router.post("/import", async (req, res) => {
  try {
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: "filePath required" });
    }

    const absolutePath = path.resolve(filePath);

    const result = await importAutoclaveReport(absolutePath);

    res.json(result);
  } catch (err) {
    console.error("Import sterilization report error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/scan-folder", async (req, res) => {
  try {
    const { folderPath } = req.body;

    if (!folderPath) {
      return res.status(400).json({ error: "folderPath required" });
    }

    const result = await scanAutoclaveFolder(folderPath);

    res.json(result);
  } catch (err) {
    console.error("Scan sterilization folder error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/scan-usb", async (_req, res) => {
  try {
    const folderPath = "/Volumes/NO NAME";
    const result = await scanAutoclaveFolder(folderPath);
    res.json(result);
  } catch (err) {
    console.error("Scan USB error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
