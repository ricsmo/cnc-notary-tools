// scripts/dump-for-d1.mjs — Dumps data from local SQLite as SQL INSERTs
// for import into Cloudflare D1 via wrangler.
// Usage: node scripts/dump-for-d1.mjs > dump.sql
//    or: npm run db:import

import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'notaries.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  // Escape single quotes
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function dumpTable(tableName, columns) {
  const colList = columns.join(', ');
  const rows = db.prepare(`SELECT ${colList} FROM ${tableName}`).all();
  
  // Batch in groups of 500 for multi-row INSERT
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = batch.map(r => 
      `(${columns.map(c => esc(r[c])).join(', ')})`
    ).join(',\n');
    process.stdout.write(`INSERT INTO ${tableName} (${colList}) VALUES\n${values};\n`);
  }
  console.error(`  ${tableName}: ${rows.length} rows`);
}

console.log('-- D1 data dump');

// Counties (58 rows)
dumpTable('counties', ['code', 'name', 'slug', 'lat', 'lng']);

// Notaries (136K rows)
dumpTable('notaries', ['id', 'name', 'city', 'county_code', 'commission_nbr', 'expiration']);

// Exam dates
dumpTable('exam_dates', ['id', 'date', 'city', 'county_code', 'venue', 'address', 'times', 'registration_url', 'status', 'walk_in', 'lat', 'lng']);

// Zip codes
dumpTable('zip_codes', ['zip', 'city', 'state', 'lat', 'lng']);

// Meta
dumpTable('meta', ['key', 'value']);

console.log('-- Done');
db.close();
