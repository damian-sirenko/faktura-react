// server/db.js
// УВАГА: надалі потрібно винести створення таблиць protocols/protocol_entries
// в єдине місце (ensureSchema у server/repos/protocolsRepo.js).
// Зараз залишаю як є — ти просив зробити це пізніше.

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: "127.0.0.1",

  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: +(process.env.DB_POOL || 10),
  queueLimit: 0,
  multipleStatements: true,
  namedPlaceholders: true,
});

// зручний helper: повертає лише rows
const query = (sql, params = []) =>
  pool.execute(sql, params).then(([rows]) => rows);

async function initDB() {
  const sql = `
    CREATE TABLE IF NOT EXISTS protocols (
      id INT AUTO_INCREMENT PRIMARY KEY,
      clientId VARCHAR(191) NOT NULL,
      month CHAR(7) NOT NULL,
      summarized TINYINT(1) NOT NULL DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_client_month (clientId, month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS protocol_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      protocol_id INT NOT NULL,
      date DATE NOT NULL,
      packages INT NOT NULL DEFAULT 0,
      delivery VARCHAR(255),
      shipping TINYINT(1) NOT NULL DEFAULT 0,
      comment TEXT,
      tools_json JSON NULL,
      signatures_json JSON NULL,
      courierPending TINYINT(1) NOT NULL DEFAULT 0,
      pointPending   TINYINT(1) NOT NULL DEFAULT 0,
      courierPlannedDate DATE NULL,
      returnDate DATE NULL,
      returnPackages INT NULL,
      returnDelivery VARCHAR(255) NULL,
      returnShipping TINYINT(1) NULL,
      returnTools_json JSON NULL,
      transferClientSig TEXT NULL,
      transferStaffSig  TEXT NULL,
      returnClientSig   TEXT NULL,
      returnStaffSig    TEXT NULL,
      CONSTRAINT fk_entries_protocol FOREIGN KEY (protocol_id) REFERENCES protocols(id) ON DELETE CASCADE,
      KEY idx_protocol_date (protocol_id, date),
      KEY idx_protocol_id (protocol_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await pool.query(sql);
}

module.exports = { pool, query, initDB };
