-- база
CREATE DATABASE IF NOT EXISTS faktury
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE faktury;

-- settings
CREATE TABLE IF NOT EXISTS settings (
  id TINYINT PRIMARY KEY,
  perPiecePriceGross DECIMAL(10,2) NOT NULL DEFAULT 6.00,
  defaultVat INT NOT NULL DEFAULT 23,
  courierPriceGross DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  shippingPriceGross DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  currentIssueMonth CHAR(7) NOT NULL
) ENGINE=InnoDB;

INSERT INTO settings (id, perPiecePriceGross, defaultVat, courierPriceGross, shippingPriceGross, currentIssueMonth)
VALUES (1, 6.00, 23, 0.00, 0.00, DATE_FORMAT(CURDATE(), '%Y-%m'))
ON DUPLICATE KEY UPDATE id=id;

-- clients
CREATE TABLE IF NOT EXISTS clients (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address VARCHAR(255) NULL,
  nip VARCHAR(20) NULL,
  pesel VARCHAR(20) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(50) NULL,
  logistics VARCHAR(32) NULL,     -- "punkt" | "kurier" | ін.
  archived TINYINT(1) NOT NULL DEFAULT 0,
  subscription_name VARCHAR(100) NULL,
  subscription_quota INT NULL,
  signed_at DATE NULL,
  expires_at DATE NULL,

  -- додаткові поля для фронту
  billingMode ENUM('abonament','perpiece') DEFAULT 'abonament',
  agreementStart DATE NULL,
  agreementEnd DATE NULL,
  subscription VARCHAR(100) NULL,
  subscriptionAmount DECIMAL(10,2) NULL,
  notice TINYINT(1) NOT NULL DEFAULT 0,
  comment TEXT NULL,
  archivedAt DATE NULL,
  courierPriceMode ENUM('global','custom') DEFAULT 'global',
  courierPriceGross DECIMAL(10,2) NULL,
  shippingPriceMode ENUM('global','custom') DEFAULT 'global',
  shippingPriceGross DECIMAL(10,2) NULL
) ENGINE=InnoDB;

-- invoices
CREATE TABLE IF NOT EXISTS invoices (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  number VARCHAR(64) NOT NULL,
  clientName VARCHAR(255) NOT NULL,
  issueDate DATE NOT NULL,
  dueDate DATE NULL,
  net DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  gross DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  status ENUM('issued','paid','cancelled') NOT NULL DEFAULT 'issued',
  filename VARCHAR(255) NOT NULL,
  folder VARCHAR(255) NULL,
  items_json JSON NULL,
  buyer_address VARCHAR(255) NULL,
  buyer_nip VARCHAR(20) NULL,
  buyer_pesel VARCHAR(20) NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoices_number (number),
  UNIQUE KEY uq_invoices_filename (filename),
  KEY idx_invoices_client (clientName),
  KEY idx_invoices_issueDate (issueDate)
) ENGINE=InnoDB;

-- protocols (headers)
CREATE TABLE IF NOT EXISTS protocols (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  clientId VARCHAR(100) NOT NULL,
  month CHAR(7) NOT NULL,                -- "YYYY-MM"
  summarized TINYINT(1) NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  UNIQUE KEY uq_proto (clientId, month)
) ENGINE=InnoDB;

-- protocol_entries (rows)
CREATE TABLE IF NOT EXISTS protocol_entries (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  protocol_id BIGINT UNSIGNED NOT NULL,
  date DATE NULL,
  packages INT NULL,
  delivery ENUM('odbior','dowoz','odbior+dowoz') NULL,
  shipping TINYINT(1) NOT NULL DEFAULT 0,
  comment TEXT NULL,
  tools_json JSON NULL,
  signatures_json JSON NULL,
  courierPending TINYINT(1) NOT NULL DEFAULT 0,
  pointPending TINYINT(1) NOT NULL DEFAULT 0,
  courierPlannedDate DATE NULL,
  returnDate DATE NULL,
  returnPackages INT NULL,
  returnDelivery ENUM('odbior','dowoz','odbior+dowoz') NULL,
  returnShipping TINYINT(1) NOT NULL DEFAULT 0,
  returnTools_json JSON NULL,
  transferClientSig VARCHAR(255) NULL,
  transferStaffSig  VARCHAR(255) NULL,
  returnClientSig   VARCHAR(255) NULL,
  returnStaffSig    VARCHAR(255) NULL,
  CONSTRAINT fk_entry_protocol FOREIGN KEY (protocol_id) REFERENCES protocols(id) ON DELETE CASCADE,
  KEY idx_entry_protocol (protocol_id),
  KEY idx_entry_date (date)
) ENGINE=InnoDB;

-- counters (нумерація фактур)
CREATE TABLE IF NOT EXISTS counters (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  year INT NOT NULL,
  month INT NOT NULL,
  seed INT NOT NULL DEFAULT 1,
  current INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_counter (year, month)
) ENGINE=InnoDB;

-- PSL: чернетки та збережені місяці
CREATE TABLE IF NOT EXISTS psl_drafts (
  ym CHAR(7) PRIMARY KEY,
  rows_json JSON NOT NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS psl_saved (
  id VARCHAR(64) PRIMARY KEY,
  ym CHAR(7) NOT NULL,
  title VARCHAR(255) NOT NULL,
  rows_json JSON NOT NULL,
  totals_json JSON NOT NULL,
  pricePerPack DECIMAL(10,2) NOT NULL DEFAULT 6.00,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_psl_saved_ym (ym)
) ENGINE=InnoDB;
