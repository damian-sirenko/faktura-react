const fs = require("fs");
const iconv = require("iconv-lite");

function parseDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;

  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;

  const [day, month, year] = parts;
  return `${year}-${month}-${day} ${timeStr}`;
}

function secondsBetween(start, end) {
  return Math.floor((new Date(end) - new Date(start)) / 1000);
}

function detectCycleType(text) {
  if (text.includes("B-D test")) return "TEST";
  const cleaned = text.replace(/\x00/g, "").trimEnd();
  const lastLine = cleaned
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.trim());
  if (lastLine !== "Koniec") return "REJECTED";
  return "NORMAL";
}

function extractValue(regex, text) {
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function extractTimeAfterLabel(label, text) {
  const regex = new RegExp(`${label}[\\s\\S]*?(\\d{2}:\\d{2}:\\d{2})`);
  const match = text.match(regex);
  return match ? match[1] : null;
}

function parseAutoclaveReport(filePath) {
  const buffer = fs.readFileSync(filePath);
  const text = iconv.decode(buffer, "utf16-le");

  const serial = extractValue(/Nr seryjny:(.+)/, text);
  const cycleNumber = extractValue(/Ilość:(\d+)/, text);
  const date = extractValue(/Data:(\d{2}-\d{2}-\d{4})/, text);
  let program = extractValue(/Program:(.+)/, text);

  if (program) {
    program = program.replace(/\x00/g, "").trim();

    const tempMatch = program.match(/\d+℃/);
    program = tempMatch ? tempMatch[0] : program;
  }

  const sterilStartTime = extractTimeAfterLabel("Start sterylizacji", text);
  const sterilEndTime = extractTimeAfterLabel("Koniec sterylizacji", text);

  const pressureMax = extractValue(/Maks ciśnienie:\s*(\d+)/, text);
  const pressureMin = extractValue(/Min\s+ciśnienie:\s*(\d+)/, text);
  const tempMax = extractValue(/Maks temp:\s*([\d.]+)/, text);
  const tempMin = extractValue(/Min temp:\s*([\d.]+)/, text);

  const cycleStartTime = extractValue(/Czas:(\d{2}:\d{2}:\d{2})/, text);

  const cycleStart =
    date && cycleStartTime ? parseDateTime(date, cycleStartTime) : null;

  const sterilStart = sterilStartTime
    ? parseDateTime(date, sterilStartTime)
    : null;
  const sterilEnd = sterilEndTime ? parseDateTime(date, sterilEndTime) : null;

  const durationSeconds =
    sterilStart && sterilEnd ? secondsBetween(sterilStart, sterilEnd) : null;

  const durationMinutes =
    durationSeconds !== null ? Math.round(durationSeconds / 60) : null;

  const cycleType = detectCycleType(text);

  return {
    serial_number: serial,
    cycle_number: cycleNumber,
    cycle_start_datetime: cycleStart,
    program,
    sterilization_start: sterilStart,
    sterilization_end: sterilEnd,
    sterilization_duration_seconds: durationSeconds,
    sterilization_duration_label:
      durationMinutes !== null ? `${durationMinutes} min` : null,
    pressure_min: pressureMin ? Number(pressureMin) : null,
    pressure_max: pressureMax ? Number(pressureMax) : null,
    temperature_min: tempMin ? Number(tempMin) : null,
    temperature_max: tempMax ? Number(tempMax) : null,
    cycle_type: cycleType,
    raw_text: text,
  };
}

module.exports = parseAutoclaveReport;
