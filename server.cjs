/*
  server.cjs
  Entry point of the backend.
  Creates Express app, mounts feature modules in safe order, initializes DB, starts HTTP server.
*/

require("dotenv").config();

const express = require("express");
const { initDB } = require("./server/db.js");

const app = express();

require("./server.middleware.cjs")(app);
require("./server.routes.invoices.cjs")(app);
require("./server.routes.protocols.cjs")(app);
require("./server.routes.core.cjs")(app);
require("./server/mail/server.routes.mail.cjs")(app);
app.use("/services", require("./routes/services"));


const PORT = process.env.PORT || 3000;

const path = require("path");

const DIST_DIR = path.join(__dirname, "..", "panel");

app.use(express.static(DIST_DIR));

app.use("/generated", express.static(path.join(__dirname, "generated")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

app.use((req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"));
});
initDB()
  .then(() => {
    app.listen(PORT, () =>
      console.log(`✅ Backend running on http://localhost:${PORT}`)
    );
  })
  .catch((e) => {
    console.error("initDB failed:", e);
    process.exit(1);
  });
