async function detectUsbDrives() {
  if (process.env.ALLOW_USB_SCAN === "1") {
    try {
      const drivelist = require("drivelist");
      const drives = await drivelist.list();

      const usbDrives = [];

      for (const drive of drives) {
        if (!drive.isUSB) continue;

        for (const mount of drive.mountpoints) {
          usbDrives.push({
            path: mount.path,
            serial: drive.serialNumber || drive.device,
          });
        }
      }

      return usbDrives;
    } catch (err) {
      console.log("drivelist not available");
      return [];
    }
  }

  return [];
}

module.exports = detectUsbDrives;
