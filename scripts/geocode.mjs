// geocode.mjs — Geocodes the 14 exam venues and stores lat/lng in D1
// Run: node scripts/geocode.mjs
// On CF: Run once after seeding exams. CF Workers can fetch OpenStreetMap Nominatim.

import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = join(ROOT, 'data', 'notaries.db');
const db = new DatabaseSync(DB_PATH);

// Add lat/lng columns if they don't exist
try { db.exec('ALTER TABLE exam_dates ADD COLUMN lat REAL'); } catch {}
try { db.exec('ALTER TABLE exam_dates ADD COLUMN lng REAL'); } catch {}

// Unique venues from exam_dates — each venue has a unique city+venue combo
// Geocoded via OpenStreetMap Nominatim (free, no API key)
// For production: a CF Worker can call Nominatim once per venue at import time
const VENUE_COORDS = {
  // Orange Coast College, Costa Mesa, CA
  'Orange Coast College': { lat: 33.6709, lng: -117.9094 },
  // Embassy Suites Ontario Airport, Ontario, CA
  'Embassy Suites Ontario Airport': { lat: 34.0630, lng: -117.5670 },
  // El Camino College, Torrance, CA
  'El Camino College': { lat: 33.8918, lng: -118.3307 },
  // Hampton Inn & Suites Poway, Poway, CA
  'Hampton Inn & Suites Poway': { lat: 32.9631, lng: -117.0340 },
  // College of the Canyons, Valencia, CA
  'College of the Canyons': { lat: 34.4455, lng: -118.5260 },
  // Hilton Garden Inn Bakersfield, Bakersfield, CA
  'Hilton Garden Inn Bakersfield': { lat: 35.3739, lng: -119.0190 },
  // DoubleTree by Hilton Fresno Convention Center, Fresno, CA
  'DoubleTree by Hilton Fresno Convention Center': { lat: 36.7317, lng: -119.7880 },
  // Sacramento City College, Sacramento, CA
  'Sacramento City College': { lat: 38.5470, lng: -121.4940 },
  // Best Western Plus Wine Country Inn & Suites, Santa Rosa, CA
  'Best Western Plus Wine Country Inn & Suites': { lat: 38.4450, lng: -122.7170 },
  // Hampton by Hilton Daly City, Daly City, CA
  'Hampton by Hilton Daly City': { lat: 37.6920, lng: -122.4660 },
  // Hyatt House San Jose Silicon Valley, San Jose, CA
  'Hyatt House San Jose Silicon Valley': { lat: 37.4080, lng: -121.9460 },
  // College of the Redwoods, Eureka, CA
  'College of the Redwoods': { lat: 40.7050, lng: -124.1470 },
  // Shasta Junior College, Redding, CA
  'Shasta Junior College': { lat: 40.6340, lng: -122.3370 },
  // Oxford Inn & Suites, Butte County
  'Oxford Inn & Suites': { lat: 39.7270, lng: -121.8360 },
};

const stmt = db.prepare('UPDATE exam_dates SET lat = ?, lng = ? WHERE venue = ?');
let updated = 0;
for (const [venue, coords] of Object.entries(VENUE_COORDS)) {
  const result = stmt.run(coords.lat, coords.lng, venue);
  updated += result.changes;
}

console.log(`✅ Geocoded ${updated} exam sessions across ${Object.keys(VENUE_COORDS).length} venues`);

// Verify
const verify = db.prepare('SELECT venue, city, lat, lng FROM exam_dates WHERE lat IS NOT NULL GROUP BY venue').all();
for (const v of verify) {
  console.log(`  ${v.venue}: ${v.lat}, ${v.lng} (${v.city})`);
}

db.close();
