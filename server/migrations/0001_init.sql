-- server/migrations/0001_init.sql
-- initial schema

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  type TEXT CHECK(type IN ('firma','op')) NOT NULL,
  nip TEXT DEFAULT '',
  pesel TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  agreementStart TEXT DEFAULT '',
  agreementEnd TEXT DEFAULT '',
  subscription TEXT DEFAULT '',
  subscriptionAmount REAL DEFAULT 0,
  notice INTEGER DEFAULT 0,          -- 0/1
  comment TEXT DEFAULT '',
  billingMode TEXT DEFAULT '',       -- 'abonament' / etc
  logistics TEXT DEFAULT '',         -- 'kurier' | 'punkt' | 'paczkomat' | ''
  courierPriceMode TEXT DEFAULT '',
  courierPriceGross REAL,
  shippingPriceMode TEXT DEFAULT '',
  shippingPriceGross REAL,
  archived INTEGER DEFAULT 0,        -- 0/1
  archivedAt TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  clientId TEXT,
  clientName TEXT NOT NULL,
  buyer_address TEXT DEFAULT '',
  buyer_nip TEXT DEFAULT '',
  buyer_pesel TEXT DEFAULT '',
  issueDate TEXT NOT NULL,
  dueDate TEXT NOT NULL,
  net TEXT DEFAULT '0,00',
  gross TEXT DEFAULT '0,00',
  status TEXT DEFAULT 'issued',
  filename TEXT DEFAULT '',
  folder TEXT DEFAULT '',
  items_json TEXT NOT NULL,
  FOREIGN KEY (clientId) REFERENCES clients(id) ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS invoice_counters (
  ym TEXT PRIMARY KEY,     -- '2025-08'
  next INTEGER NOT NULL    -- next sequence number to try
);

CREATE TABLE IF NOT EXISTS protocols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clientId TEXT NOT NULL,
  month TEXT NOT NULL,     -- '2025-09'
  summarized INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE(clientId, month),
  FOREIGN KEY (clientId) REFERENCES clients(id) ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS protocol_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  protocolId INTEGER NOT NULL,
  date TEXT NOT NULL,                -- '2025-09-01'
  packages INTEGER DEFAULT 0,
  delivery TEXT DEFAULT '',
  shipping INTEGER DEFAULT 0,        -- 0/1
  comment TEXT DEFAULT '',
  tools_json TEXT NOT NULL,          -- JSON array [{name,count},...]
  signatures_json TEXT DEFAULT '{}', -- JSON obj
  courierPending INTEGER DEFAULT 0,
  pointPending INTEGER DEFAULT 0,
  FOREIGN KEY (protocolId) REFERENCES protocols(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS psl_drafts (
  ym TEXT PRIMARY KEY,               -- '2025-10'
  rows_json TEXT NOT NULL,           -- JSON.stringify(rows)
  updatedAt TEXT NOT NULL
);
