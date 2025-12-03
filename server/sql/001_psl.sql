-- Таблиці PSL
CREATE TABLE IF NOT EXISTS psl_drafts (
  ym CHAR(7) NOT NULL PRIMARY KEY,              -- YYYY-MM
  rows_json JSON NOT NULL,                      -- [{ id, clientId, clientName, qty, sterilCost, shipOrCourier, total }, ...]
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS psl_saved (
  id VARCHAR(64) NOT NULL PRIMARY KEY,          -- newId(ym)
  ym CHAR(7) NOT NULL,                          -- YYYY-MM
  title VARCHAR(255) NOT NULL,
  rows_json JSON NOT NULL,
  totals_json JSON NOT NULL,                    -- { qty, steril, ship, total }
  pricePerPack DECIMAL(10,2) NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL,
  KEY idx_psl_saved_ym (ym)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
