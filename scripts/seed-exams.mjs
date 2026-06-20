// seed-exams.mjs — Seeds exam_dates table from CPS HR schedule data
// Run: node scripts/seed-exams.mjs
// Production: CF Worker cron downloads + parses CPS HR PDF quarterly

import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = join(ROOT, 'data', 'notaries.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

// Clear existing exams
db.exec('DELETE FROM exam_dates');

// CPS HR registration portal (same for all exams)
const REG_URL = 'https://cmas.cpshr.us/CMAS/Login.aspx?ReturnUrl=%2fCMAS%2fCandidate%2fListProgramEvent.aspx%3fprogramid%3d165&programid=165';

// Venue data from CPS HR May-August 2026 schedule PDF
// Each venue: county_code, county name, venue name, address, city
const VENUES = {
  orange:       { county_code: 30, county: 'Orange',           venue: 'Orange Coast College',          address: '2701 Fairview Rd',           city: 'Costa Mesa' },
  sbd:          { county_code: 36, county: 'San Bernardino',   venue: 'Embassy Suites Ontario Airport', address: '3663 E. Guasti Road',        city: 'Ontario' },
  la_elcamino:  { county_code: 19, county: 'Los Angeles',      venue: 'El Camino College',             address: '16007 Crenshaw Blvd',         city: 'Torrance' },
  sd:           { county_code: 37, county: 'San Diego',        venue: 'Hampton Inn & Suites Poway',    address: '14068 Stowe Drive',           city: 'Poway' },
  la_canyons:   { county_code: 19, county: 'Los Angeles',      venue: 'College of the Canyons',        address: '26455 Rockwell Canyon Rd',    city: 'Valencia' },
  kern:         { county_code: 15, county: 'Kern',             venue: 'Hilton Garden Inn Bakersfield',  address: '3625 Marriott Drive',         city: 'Bakersfield' },
  fresno:       { county_code: 10, county: 'Fresno',           venue: 'DoubleTree by Hilton Fresno',    address: '2233 Cesar Chavez Blvd',      city: 'Fresno' },
  sacramento:   { county_code: 34, county: 'Sacramento',       venue: 'Sacramento City College',        address: '3835 Freeport Blvd',          city: 'Sacramento' },
  sonoma:       { county_code: 49, county: 'Sonoma',           venue: 'Best Western Plus Wine Country',  address: '870 Hopper Ave',              city: 'Santa Rosa' },
  san_mateo:    { county_code: 41, county: 'San Mateo',        venue: 'Hampton by Hilton Daly City',    address: '2700 Junipero Serra Blvd',    city: 'Daly City' },
  santa_clara:  { county_code: 43, county: 'Santa Clara',      venue: 'Hyatt House San Jose',           address: '75 Headquarters Drive',       city: 'San Jose' },
  humboldt:     { county_code: 12, county: 'Humboldt',         venue: 'College of the Redwoods',        address: '7351 Tompkins Hill Rd',       city: 'Eureka' },
  shasta:       { county_code: 45, county: 'Shasta',           venue: 'Shasta Junior College',          address: '11555 Old Oregon Trail',      city: 'Redding' },
  butte:        { county_code: 4,  county: 'Butte',            venue: 'Oxford Inn & Suites',            address: 'TBD',                          city: 'Butte County' },
};

// Times offered at most locations
const TIME_SLOTS = ['08:30 AM', '10:30 AM', '12:30 PM', '02:30 PM'];

// Exam dates extracted from CPS HR May-August 2026 PDF
// [venue_key, date, times]  — times overrides default TIME_SLOTS
const EXAM_DATES = [
  // === MAY 2026 ===
  ['orange',      '2026-05-09', ['08:30 AM', '10:30 AM', '12:30 PM']],
  ['sbd',         '2026-05-16', null],
  ['la_elcamino', '2026-05-16', null],
  ['sd',          '2026-05-16', null],
  ['la_canyons',  '2026-05-16', ['08:30 AM', '10:30 AM', '12:30 PM']],
  ['kern',        '2026-05-16', null],
  ['fresno',      '2026-05-16', null],
  ['sonoma',      '2026-05-16', ['08:30 AM', '10:30 AM', '12:30 PM']],
  ['san_mateo',   '2026-05-16', null],
  ['santa_clara', '2026-05-16', null],

  // === JUNE 2026 ===
  ['orange',      '2026-06-13', ['10:30 AM', '12:30 PM']],
  ['sbd',         '2026-06-20', null],
  ['la_elcamino', '2026-06-20', null],
  ['sd',          '2026-06-20', null],
  ['la_canyons',  '2026-06-20', ['08:30 AM', '10:30 AM', '12:30 PM']],
  ['kern',        '2026-06-20', null],
  ['fresno',      '2026-06-20', null],
  ['sonoma',      '2026-06-20', ['08:30 AM', '10:30 AM', '12:30 PM']],
  ['san_mateo',   '2026-06-20', null],
  ['santa_clara', '2026-06-20', null],

  // === JULY 2026 ===
  ['sacramento',  '2026-07-11', null],
  ['la_canyons',  '2026-07-11', ['08:30 AM', '10:30 AM', '12:30 PM']],
  ['sbd',         '2026-07-11', null],
  ['orange',      '2026-07-18', null],
  ['sbd',         '2026-07-18', null],
  ['humboldt',    '2026-07-25', null],
  ['sbd',         '2026-07-25', null],
  ['la_elcamino', '2026-07-25', null],
  ['sd',          '2026-07-25', null],
  ['la_canyons',  '2026-07-25', ['08:30 AM', '10:30 AM', '12:30 PM', '02:30 PM']],
  ['kern',        '2026-07-25', null],
  ['fresno',      '2026-07-25', null],
  ['sonoma',      '2026-07-25', ['08:30 AM', '10:30 AM', '12:30 PM']],
  ['san_mateo',   '2026-07-25', null],
  ['santa_clara', '2026-07-25', null],

  // === AUGUST 2026 ===
  ['orange',      '2026-08-01', ['10:30 AM', '12:30 PM']],
  ['la_canyons',  '2026-08-01', ['08:30 AM', '10:30 AM', '12:30 PM', '02:30 PM']],
  ['sbd',         '2026-08-08', null],
  ['la_canyons',  '2026-08-08', ['08:30 AM', '10:30 AM', '12:30 PM', '02:30 PM']],
  ['fresno',      '2026-08-08', null],
  ['orange',      '2026-08-15', null],
  ['sbd',         '2026-08-15', null],
  ['la_canyons',  '2026-08-15', ['08:30 AM', '10:30 AM', '12:30 PM', '02:30 PM']],
  ['shasta',      '2026-08-29', null],
  ['la_elcamino', '2026-08-29', null],
  ['sd',          '2026-08-29', null],
  ['kern',        '2026-08-29', null],
  ['fresno',      '2026-08-29', null],
  ['san_mateo',   '2026-08-29', null],
  ['santa_clara', '2026-08-29', null],
];

const stmt = db.prepare(
  `INSERT INTO exam_dates (date, city, county_code, venue, address, times, registration_url, status, walk_in)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 1)`
);

let count = 0;
for (const [venueKey, date, times] of EXAM_DATES) {
  const v = VENUES[venueKey];
  if (!v) { console.warn(`Unknown venue: ${venueKey}`); continue; }
  const timeStr = (times || TIME_SLOTS).join(', ');
  stmt.run(date, v.city, v.county_code, v.venue, v.address, timeStr, REG_URL);
  count++;
}

// Record metadata
const metaStmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
metaStmt.run('exam_last_updated', '2026-05-26');
metaStmt.run('exam_source', 'CPS HR May-August 2026 PDF');

// Print summary
const upcoming = db.prepare(`
  SELECT date, city, county_code, venue, times
  FROM exam_dates
  WHERE date >= date('now')
  ORDER BY date
  LIMIT 5
`).all();

console.log(`\n✅ Seeded ${count} exam sessions`);
console.log('\nUpcoming exams:');
for (const e of upcoming) {
  console.log(`  ${e.date} | ${e.city} | ${e.venue} | ${e.times}`);
}

db.close();
