const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const SERVICES_PATH =
  "/Users/damiansirenko/Documents/WebDEV/Repositories/faktura-react/data/services.json";

router.get("/", (req, res) => {
  try {
    const raw = fs.readFileSync(SERVICES_PATH, "utf-8");
    const json = JSON.parse(raw);
    res.json(json);
  } catch (e) {
    res.status(500).json({ error: "Cannot read services.json" });
  }
});

module.exports = router;
