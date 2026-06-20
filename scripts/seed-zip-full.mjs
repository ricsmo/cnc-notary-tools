// seed-zip-full.mjs — Loads ALL California zip codes from census data
// Run: node scripts/seed-zip-full.mjs

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = join(ROOT, 'data', 'notaries.db');
const CSV_FILE = join(ROOT, 'data', 'all_zips.csv');

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS zip_codes (
    zip TEXT PRIMARY KEY,
    city TEXT,
    state TEXT,
    lat REAL NOT NULL,
    lng REAL NOT NULL
  )
`);

db.exec('DELETE FROM zip_codes');

const raw = readFileSync(CSV_FILE, 'utf-8');
const lines = raw.split('\n');
const header = lines[0].split(',');
console.log('CSV header:', header.join(' | '));

const stmt = db.prepare('INSERT OR REPLACE INTO zip_codes (zip, city, state, lat, lng) VALUES (?, ?, ?, ?, ?)');

db.exec('BEGIN TRANSACTION');
let count = 0;
let caCount = 0;
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const parts = line.split(',');
  if (parts.length < 7) continue;

  const zip = parts[0];
  const city = parts[1];
  const state = parts[2];
  const lat = parseFloat(parts[5]);
  const lng = parseFloat(parts[6]);

  if (!zip || isNaN(lat) || isNaN(lng)) continue;

  // Only import California
  if (state !== 'CA') continue;

  stmt.run(zip, city, 'CA', lat, lng);
  caCount++;
  count++;
}
db.exec('COMMIT');

console.log(`✅ Imported ${caCount} California zip codes (${count} total CA rows)`);
console.log('Sample lookups:');
const testZips = ['92882', '92126', '90001', '95670', '95814'];
for (const z of testZips) {
  const row = db.prepare('SELECT * FROM zip_codes WHERE zip = ?').get(z);
  console.log(`  ${z}: ${row ? row.city + ' @ ' + row.lat + ',' + row.lng : 'NOT FOUND'}`);
}

db.close();
