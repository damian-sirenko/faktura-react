module.exports = async function drawProtocol(doc, c, yOffset) {
  const startY = yOffset;

  doc.fontSize(12).text("RAPORT STERYLIZACJI", 40, startY);

  doc.fontSize(9);

  doc.text(`Nr cyklu: ${c.cycle_number}`, 40, startY + 25);
  doc.text(
    `Data: ${
      c.cycle_start_datetime
        ? new Date(c.cycle_start_datetime).toISOString().slice(0, 10)
        : "-"
    }`,
    40,
    startY + 40
  );

  doc.text(`Program: ${c.program || "-"}`, 40, startY + 55);

  doc.text(
    `Ciśnienie min/max: ${c.pressure_min || "-"} / ${c.pressure_max || "-"}`,
    40,
    startY + 70
  );

  doc.text(
    `Czas sterylizacji: ${c.sterilization_duration_seconds || "-"} sek`,
    40,
    startY + 85
  );
};
