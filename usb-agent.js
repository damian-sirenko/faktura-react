const fs = require("fs");
const path = require("path");
const axios = require("axios");
const drivelist = require("drivelist");
const express = require("express");

const API_URL =
  "https://panel.sterylserwis.pl/api/process-reports/import-from-agent";
const PORT = 4545;

let lastUsbState = false;
const uploadedFiles = new Set();

/* ================= USB DETECTION ================= */

async function detectUsb() {
  const drives = await drivelist.list();

  const usb = [];

  for (const drive of drives) {
    if (!drive.isUSB) continue;

    for (const mount of drive.mountpoints) {
      usb.push(mount.path);
    }
  }

  lastUsbState = usb.length > 0;

  return usb;
}

/* ================= FILE SCAN ================= */

async function scanFolder(folder) {
  if (!fs.existsSync(folder)) return;

  const files = fs.readdirSync(folder);

  for (const file of files) {
    if (uploadedFiles.has(file)) continue;
    if (!file.toLowerCase().endsWith(".txt")) continue;
    if (file.startsWith("._")) continue;

    const fullPath = path.join(folder, file);

    const content = fs.readFileSync(fullPath);

    try {
      await axios.post(API_URL, {
        fileName: file,
        fileContent: content.toString("base64"),
      });

      console.log("Uploaded:", file);
      uploadedFiles.add(file);
    } catch (err) {
      console.log("Upload failed:", file, err.message);
    }
  }
}

/* ================= MAIN LOOP ================= */

async function main() {
  try {
    const usbDrives = await detectUsb();

    for (const drive of usbDrives) {
      await scanFolder(drive);
    }
  } catch (err) {
    console.log("Agent error:", err.message);
  }
}
main();
setInterval(main, 30000);

/* ================= LOCAL STATUS SERVER ================= */

const app = express();
app.use(require("cors")());

console.log("USB AGENT STARTED");

app.get("/usb-status", async (req, res) => {
  try {
    await detectUsb();

    res.json({
      connected: lastUsbState,
    });
  } catch (err) {
    res.json({
      connected: false,
    });
  }
});

app.listen(PORT, () => {
  console.log("USB agent started");
  console.log("USB status server running on port", PORT);
});
