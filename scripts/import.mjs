// import.mjs — Loads CA SOS active notary data into local SQLite
// Local:  node scripts/import.mjs
// CF D1:  Replaced by a Worker cron trigger that downloads + imports daily

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readFileSync as read } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = join(ROOT, 'data', 'notaries.db');
const SOS_FILE = join(ROOT, 'data', 'active-notary.txt');

// County code → name + slug mapping
const COUNTIES = {
  1: ['Alameda', 'alameda'], 2: ['Alpine', 'alpine'], 3: ['Amador', 'amador'],
  4: ['Butte', 'butte'], 5: ['Calaveras', 'calaveras'], 6: ['Colusa', 'colusa'],
  7: ['Contra Costa', 'contra-costa'], 8: ['Del Norte', 'del-norte'],
  9: ['El Dorado', 'el-dorado'], 10: ['Fresno', 'fresno'], 11: ['Glenn', 'glenn'],
  12: ['Humboldt', 'humboldt'], 13: ['Imperial', 'imperial'], 14: ['Inyo', 'inyo'],
  15: ['Kern', 'kern'], 16: ['Kings', 'kings'], 17: ['Lake', 'lake'],
  18: ['Lassen', 'lassen'], 19: ['Los Angeles', 'los-angeles'],
  20: ['Madera', 'madera'], 21: ['Marin', 'marin'], 22: ['Mariposa', 'mariposa'],
  23: ['Mendocino', 'mendocino'], 24: ['Merced', 'merced'], 25: ['Modoc', 'modoc'],
  26: ['Mono', 'mono'], 27: ['Monterey', 'monterey'], 28: ['Napa', 'napa'],
  29: ['Nevada', 'nevada'], 30: ['Orange', 'orange'], 31: ['Placer', 'placer'],
  32: ['Plumas', 'plumas'], 33: ['Riverside', 'riverside'],
  34: ['Sacramento', 'sacramento'], 35: ['San Benito', 'san-benito'],
  36: ['San Bernardino', 'san-bernardino'], 37: ['San Diego', 'san-diego'],
  38: ['San Francisco', 'san-francisco'], 39: ['San Joaquin', 'san-joaquin'],
  40: ['San Luis Obispo', 'san-luis-obispo'], 41: ['San Mateo', 'san-mateo'],
  42: ['Santa Barbara', 'santa-barbara'], 43: ['Santa Clara', 'santa-clara'],
  44: ['Santa Cruz', 'santa-cruz'], 45: ['Shasta', 'shasta'],
  46: ['Sierra', 'sierra'], 47: ['Siskiyou', 'siskiyou'], 48: ['Solano', 'solano'],
  49: ['Sonoma', 'sonoma'], 50: ['Stanislaus', 'stanislaus'],
  51: ['Sutter', 'sutter'], 52: ['Tehama', 'tehama'], 53: ['Trinity', 'trinity'],
  54: ['Tulare', 'tulare'], 55: ['Tuolumne', 'tuolumne'], 56: ['Ventura', 'ventura'],
  57: ['Yolo', 'yolo'], 58: ['Yuba', 'yuba']
};

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

console.log('Creating schema...');
const schema = readFileSync(join(ROOT, 'schema.sql'), 'utf-8');
db.exec(schema);

// Clear existing data
db.exec('DELETE FROM notaries');
db.exec('DELETE FROM counties');
db.exec('DELETE FROM meta');

// Insert counties
const countyStmt = db.prepare('INSERT INTO counties (code, name, slug) VALUES (?, ?, ?)');
for (const [code, [name, slug]] of Object.entries(COUNTIES)) {
  countyStmt.run(Number(code), name, slug);
}
console.log(`Inserted ${Object.keys(COUNTIES).length} counties`);

// Read and import SOS data
console.log('Reading SOS data...');
const raw = readFileSync(SOS_FILE, 'utf-8');
const lines = raw.split('\n').filter(l => l.trim());

// Skip header
const dataLines = lines.slice(1);
console.log(`Importing ${dataLines.length} notaries...`);

const notaryStmt = db.prepare(
  `INSERT INTO notaries (name, city, county_code, commission_nbr, expiration)
   VALUES (?, ?, ?, ?, ?)`
);

// Batch insert with transaction
db.exec('BEGIN TRANSACTION');
let count = 0;
for (const line of dataLines) {
  const parts = line.split('\t');
  if (parts.length < 9) continue;
  const [name, , , city, , , countyCode, commissionNbr, rawExp] = parts;
  // Convert MM/DD/YYYY → ISO YYYY-MM-DD for SQLite date functions
  const rawExpiration = rawExp.trim();
  const expMatch = rawExpiration.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const expiration = expMatch ? `${expMatch[3]}-${expMatch[1]}-${expMatch[2]}` : rawExpiration;
  const cc = parseInt(countyCode);
  if (isNaN(cc) || cc < 1 || cc > 58) continue;
  notaryStmt.run(
    (name || '').trim(),
    (city || '').trim(),
    cc,
    (commissionNbr || '').trim(),
    expiration
  );
  count++;
}
db.exec('COMMIT');

// Record import metadata
const today = new Date().toISOString().split('T')[0];
const metaStmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
metaStmt.run('last_import', today);
metaStmt.run('total_records', String(count));

// Print summary stats
const total = db.prepare('SELECT COUNT(*) as c FROM notaries').get();
const byCounty = db.prepare(`
  SELECT co.name, COUNT(*) as count
  FROM notaries n JOIN counties co ON n.county_code = co.code
  GROUP BY co.name ORDER BY count DESC LIMIT 10
`).all();

console.log(`\n✅ Imported ${count} notary records`);
console.log(`Total in DB: ${total.c}`);
console.log('\nTop 10 counties:');
for (const row of byCounty) {
  console.log(`  ${row.name}: ${row.count.toLocaleString()}`);
}

db.close();
