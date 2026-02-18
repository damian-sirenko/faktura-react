const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const parseAutoclaveReport = require("../parsers/parseAutoclaveReport");
const { query } = require("../../../../server/db");

function fileHash(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function importAutoclaveReport(filePath) {
  const hash = fileHash(filePath);

  const existing = await query(
    `SELECT id FROM sterilization_report_imports WHERE file_hash=?`,
    [hash]
  );

  if (existing.length) {
    const parsed = parseAutoclaveReport(filePath);

    const autoclave = await query(
      `SELECT id FROM autoclaves 
       WHERE serial_number LIKE CONCAT(?, '%') 
       AND active = 1 
       LIMIT 1`,
      [parsed.serial_number]
    );

    if (autoclave.length) {
      const cycle = await query(
        `SELECT id FROM sterilization_cycles
         WHERE autoclave_id=? AND cycle_number=?`,
        [autoclave[0].id, parsed.cycle_number]
      );

      if (cycle.length) {
        return { skipped: true };
      }
    }
  }

  const parsed = parseAutoclaveReport(filePath);

  const autoclave = await query(
    `SELECT * FROM autoclaves 
     WHERE serial_number LIKE CONCAT(?, '%') 
     AND active = 1 
     LIMIT 1`,
    [parsed.serial_number]
  );

  if (!autoclave.length) {
    throw new Error("Autoclave not registered");
  }

  const autoclaveId = autoclave[0].id;

  const storageDir = path.join(
    __dirname,
    "../../../../storage/autoclave_reports"
  );

  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  const fileName = path.basename(filePath);
  const storagePath = path.join(storageDir, fileName);

  fs.copyFileSync(filePath, storagePath);

  let durationSeconds = parsed.sterilization_duration_seconds;
  let cycleType = parsed.cycle_type || "NORMAL";

  if (!["NORMAL", "TEST", "REJECTED"].includes(cycleType)) {
    cycleType = "NORMAL";
  }

  const cycle = await query(
    `INSERT INTO sterilization_cycles
      (autoclave_id, cycle_number, cycle_start_datetime, program,
       sterilization_start, sterilization_end,
       sterilization_duration_seconds, pressure_min, pressure_max,
       temperature_min, temperature_max,
       cycle_type, report_file_path, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      autoclaveId,
      parsed.cycle_number,
      parsed.cycle_start_datetime,
      parsed.program,
      parsed.sterilization_start,
      parsed.sterilization_end,
      durationSeconds,
      parsed.pressure_min,
      parsed.pressure_max,
      parsed.temperature_min,
      parsed.temperature_max,
      cycleType,
      storagePath,
      "IMPORTED",
    ]
  );

  const insertedCycleId = cycle.insertId;

  const programTemp = parseInt(String(parsed.program || "").match(/\d+/)?.[0]);

  let validationFailed = false;

  if (!programTemp || ![121, 134].includes(programTemp)) {
    validationFailed = true;
  }

  if (parsed.temperature_min == null || parsed.temperature_min < programTemp) {
    validationFailed = true;
  }

  const minPressure = programTemp === 121 ? 100 : 200;

  if (parsed.pressure_min == null || parsed.pressure_min < minPressure) {
    validationFailed = true;
  }

  let minDuration;
  let maxDuration;

  if (programTemp === 121) {
    minDuration = 20 * 60;
    maxDuration = 23 * 60;
  } else {
    minDuration = 3.5 * 60;
    maxDuration = 5 * 60;
  }

  if (
    parsed.sterilization_duration_seconds == null ||
    parsed.sterilization_duration_seconds < minDuration ||
    parsed.sterilization_duration_seconds > maxDuration
  ) {
    validationFailed = true;
  }

  if (validationFailed) {
    await query(
      `UPDATE sterilization_cycles
       SET status='REJECTED', cycle_type='REJECTED'
       WHERE id=?`,
      [insertedCycleId]
    );
  }

  await query(
    `INSERT INTO sterilization_report_imports
    (autoclave_id, file_name, file_path, file_hash, status)
    VALUES (?,?,?,?,?)`,
    [autoclaveId, fileName, storagePath, hash, "PARSED"]
  );

  return { imported: true };
}

module.exports = importAutoclaveReport;
