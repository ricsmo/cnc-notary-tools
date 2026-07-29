// seed-exams.mjs — Seeds exam_dates table from CPS HR schedule data
// Run: node scripts/seed-exams.mjs
//
// SOURCE: CPS HR "July - October 2026" exam schedule PDF (updated 07/22/2026)
//   https://cpshr.us/services/california-notary-exam-2/test-schedule/
// CPS revises this PDF frequently ("SCHEDULE WILL BE UPDATED AS SESSIONS ARE
// ADDED"). Re-run this script and push the dump to remote D1 whenever CPS posts
// a new schedule — do NOT assume the list below is still current.

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
const REG_URL = 'https://notary.cpshr.us/';

// Venue data from CPS HR July-October 2026 schedule PDF
// Each venue: county_code, county name, venue name, address, city
const VENUES = {
  orange:       { county_code: 30, county: 'Orange',           venue: 'Orange Coast College',                              address: '2701 Fairview Rd',           city: 'Costa Mesa' },
  sbd:          { county_code: 36, county: 'San Bernardino',   venue: 'Embassy Suites by Hilton Ontario Airport',          address: '3663 E. Guasti Road',        city: 'Ontario' },
  la_elcamino:  { county_code: 19, county: 'Los Angeles',      venue: 'El Camino College',                                 address: '16007 Crenshaw Blvd',         city: 'Torrance' },
  sd:           { county_code: 37, county: 'San Diego',        venue: 'Hampton Inn & Suites - San Diego/Poway',            address: '14068 Stowe Drive',           city: 'Poway' },
  la_canyons:   { county_code: 19, county: 'Los Angeles',      venue: 'College of the Canyons',                            address: '26455 Rockwell Canyon Rd',    city: 'Valencia' },
  kern:         { county_code: 15, county: 'Kern',             venue: 'Hilton Garden Inn Bakersfield',                     address: '3625 Marriott Drive',         city: 'Bakersfield' },
  fresno:       { county_code: 10, county: 'Fresno',           venue: 'DoubleTree by Hilton Fresno Convention Center',     address: '2233 Cesar Chavez Blvd',      city: 'Fresno' },
  sacramento:   { county_code: 34, county: 'Sacramento',       venue: 'Sacramento City College',                           address: '3835 Freeport Blvd',          city: 'Sacramento' },
  sonoma:       { county_code: 49, county: 'Sonoma',           venue: 'Best Western Plus Wine Country Inn & Suites',       address: '870 Hopper Ave',              city: 'Santa Rosa' },
  san_mateo:    { county_code: 41, county: 'San Mateo',        venue: 'Hampton by Hilton Daly City',                       address: '2700 Junipero Serra Blvd',    city: 'Daly City' },
  santa_clara:  { county_code: 43, county: 'Santa Clara',      venue: 'Hyatt House San Jose Silicon Valley',               address: '75 Headquarters Drive',       city: 'San Jose' },
  humboldt:     { county_code: 12, county: 'Humboldt',         venue: 'College of the Redwoods',                           address: '7351 Tompkins Hill Rd',       city: 'Eureka' },
  shasta:       { county_code: 45, county: 'Shasta',           venue: 'Shasta Junior College',                             address: '11555 Old Oregon Trail',      city: 'Redding' },
  butte:        { county_code: 4,  county: 'Butte',            venue: 'Oxford Inn & Suites',                               address: '',                            city: 'Butte County' },
};

// Times offered at most locations
const TIME_SLOTS = ['08:30 AM', '10:30 AM', '12:30 PM', '02:30 PM'];
const THREE = ['08:30 AM', '10:30 AM', '12:30 PM'];

// Exam sessions from CPS HR "July - October 2026" PDF (updated 07/22/2026).
// Decoded from the PDF by registration-ID prefix (each venue has a stable
// 3-digit prefix, which disambiguates the interleaved multi-column layout).
//   071=El Camino, 091=Orange, 111=Ontario, 121=Sacramento, 151=Daly City,
//   181=San Jose, 200=Sonoma, 030=Fresno, 371=Canyons, 440=Kern, 451=Poway, 560=Shasta
// [venue_key, date, times]  — null = all four slots; otherwise an explicit array.
// Past July sessions were dropped; the live query filters to date('now') anyway.
// NOTE: Fresno, Humboldt, Sonoma, and Butte currently show "Next Exam Nov/Dec 2026"
// on the CPS PDF and are intentionally absent below.
const EXAM_DATES = [
  // === AUGUST 2026 ===
  ['shasta',      '2026-08-01', ['10:30 AM', '12:30 PM']],
  ['sbd',         '2026-08-01', null],
  ['sacramento',  '2026-08-08', null],
  ['la_elcamino', '2026-08-08', null],
  ['sd',          '2026-08-08', THREE],
  ['san_mateo',   '2026-08-15', THREE],
  ['la_canyons',  '2026-08-15', null],
  ['kern',        '2026-08-22', THREE],
  ['orange',      '2026-08-29', null],
  ['santa_clara', '2026-08-29', THREE],

  // === SEPTEMBER 2026 ===
  ['sacramento',  '2026-09-12', null],
  ['la_elcamino', '2026-09-12', null],
  ['sd',          '2026-09-12', THREE],
  ['san_mateo',   '2026-09-19', null],
  ['la_canyons',  '2026-09-19', null],
  ['orange',      '2026-09-26', null],
  ['santa_clara', '2026-09-26', THREE],
  ['sbd',         '2026-09-27', null],

  // === OCTOBER 2026 ===
  ['la_elcamino', '2026-10-10', null],
  ['sd',          '2026-10-10', THREE],
  ['sacramento',  '2026-10-17', null],
  ['la_canyons',  '2026-10-17', null],
  ['san_mateo',   '2026-10-17', null],
  ['sbd',         '2026-10-17', null],
  ['orange',      '2026-10-24', null],
  ['santa_clara', '2026-10-24', THREE],
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
metaStmt.run('exam_last_updated', '2026-07-29');
metaStmt.run('exam_source', 'CPS HR July-October 2026 PDF (updated 07/22/2026)');

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
