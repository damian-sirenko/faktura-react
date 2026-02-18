const fs = require("fs");
const path = require("path");

const importAutoclaveReport = require("./importAutoclaveReport");

async function scanAutoclaveFolder(folderPath) {
  const absoluteFolder = path.resolve(folderPath);

  if (!fs.existsSync(absoluteFolder)) {
    throw new Error("Folder does not exist");
  }

  const files = fs.readdirSync(absoluteFolder);

  const txtFiles = files.filter(
    (f) => f.toLowerCase().endsWith(".txt") && !f.startsWith("._")
  );

  const results = [];

  for (const file of txtFiles) {
    try {
      const fullPath = path.join(absoluteFolder, file);

      const result = await importAutoclaveReport(fullPath);

      results.push({
        file,
        ...result,
      });
    } catch (err) {
      results.push({
        file,
        error: err.message,
      });
    }
  }

  return results;
}

module.exports = scanAutoclaveFolder;
