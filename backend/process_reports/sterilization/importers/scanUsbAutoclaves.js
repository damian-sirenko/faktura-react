const { query } = require("../../../../server/db");
const detectUsbDrives = require("./detectUsbDrives");
const scanAutoclaveFolder = require("./scanAutoclaveFolder");

async function scanUsbAutoclaves() {
    const drives = await detectUsbDrives();
    console.log("USB drives detected:", drives);

  const results = [];

  for (const drive of drives) {
    if (!drive.serial) continue;

    const autoclave = await query(
      `SELECT * FROM autoclaves 
       WHERE usb_volume_serial=? 
       AND active=1 
       LIMIT 1`,
      [drive.serial]
    );

    if (!autoclave.length) continue;

    const folderResults = await scanAutoclaveFolder(drive.path);

    results.push({
      autoclave: autoclave[0].name,
      serial: drive.serial,
      path: drive.path,
      files: folderResults,
    });
  }

  return results;
}

module.exports = scanUsbAutoclaves;
