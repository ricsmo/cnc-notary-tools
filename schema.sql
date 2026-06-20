-- CNC Notary Tools Schema
-- Compatible with both local SQLite (node:sqlite) and Cloudflare D1
-- Apply locally: wrangler d1 execute cnc-notary --local --file=schema.sql

-- County reference table (58 CA counties)
-- lat/lng are county centroid coordinates for distance sorting when no zip is provided
CREATE TABLE IF NOT EXISTS counties (
  code INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  lat REAL,
  lng REAL
);

-- Active notaries from CA SOS daily export
-- Privacy: street address, zip, and business name intentionally excluded
CREATE TABLE IF NOT EXISTS notaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT,
  county_code INTEGER NOT NULL,
  commission_nbr TEXT NOT NULL,
  expiration TEXT NOT NULL,
  FOREIGN KEY (county_code) REFERENCES counties(code)
);

CREATE INDEX IF NOT EXISTS idx_notaries_name ON notaries(name);
CREATE INDEX IF NOT EXISTS idx_notaries_commission ON notaries(commission_nbr);
CREATE INDEX IF NOT EXISTS idx_notaries_county ON notaries(county_code);
CREATE INDEX IF NOT EXISTS idx_notaries_city ON notaries(city);
CREATE INDEX IF NOT EXISTS idx_notaries_expiration ON notaries(expiration);

-- Exam schedule (from CPS HR)
CREATE TABLE IF NOT EXISTS exam_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  city TEXT,
  county_code INTEGER,
  venue TEXT,
  address TEXT,
  times TEXT,
  registration_url TEXT,
  status TEXT DEFAULT 'open',
  walk_in INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  lat REAL,
  lng REAL
);

-- Zip codes for geo search fallback
CREATE TABLE IF NOT EXISTS zip_codes (
  zip TEXT PRIMARY KEY,
  city TEXT,
  state TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL
);

-- Meta table for import tracking
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
