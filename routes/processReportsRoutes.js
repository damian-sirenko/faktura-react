const express = require("express");
const router = express.Router();
const path = require("path");
const scanAutoclaveFolder = require("../backend/process_reports/sterilization/importers/scanAutoclaveFolder");

const importAutoclaveReport = require("../backend/process_reports/sterilization/importers/importAutoclaveReport");
const fs = require("fs");

router.post("/sterilization/import", async (req, res) => {
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
router.post("/sterilization/scan-folder", async (req, res) => {
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

router.post("/import-from-agent", async (req, res) => {
  try {
    console.log("IMPORT FROM AGENT START");

    const { fileContent, fileName } = req.body;

    if (!fileContent || !fileName) {
      return res
        .status(400)
        .json({ error: "fileContent and fileName required" });
    }

    const tmpDir = path.join(process.cwd(), "tmp_agent_import");

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const filePath = path.join(tmpDir, fileName);

    fs.writeFileSync(filePath, Buffer.from(fileContent, "base64"));

    console.log("Saved temp file:", filePath);

    const result = await importAutoclaveReport(filePath);

    console.log("IMPORT RESULT:", result);

    res.json(result);
  } catch (err) {
    console.error("Agent import error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
