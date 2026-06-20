// seed-county-coords.mjs — Adds lat/lng centroids for all 58 CA counties
// Source: US Census county centroids
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'notaries.db');
const db = new DatabaseSync(DB_PATH);

// CA county centroids from Census data
const COORDS = {
  1: [37.65, -122.06],      // Alameda
  2: [38.60, -119.83],      // Alpine
  3: [38.45, -120.65],      // Amador
  4: [39.67, -121.60],      // Butte
  5: [38.20, -120.56],      // Calaveras
  6: [39.18, -121.98],      // Colusa
  7: [37.94, -121.94],      // Contra Costa
  8: [41.75, -123.98],      // Del Norte
  9: [38.76, -120.54],      // El Dorado
  10: [36.76, -119.65],     // Fresno
  11: [39.52, -122.40],     // Glenn
  12: [40.72, -123.85],     // Humboldt
  13: [33.03, -115.37],     // Imperial
  14: [36.42, -118.06],     // Inyo
  15: [35.34, -118.73],     // Kern
  16: [36.08, -119.82],     // Kings
  17: [39.09, -122.76],     // Lake
  18: [40.69, -120.73],     // Lassen
  19: [34.32, -118.23],     // Los Angeles
  20: [37.21, -119.79],     // Madera
  21: [38.07, -122.72],     // Marin
  22: [37.58, -119.91],     // Mariposa
  23: [39.31, -123.36],     // Mendocino
  24: [37.19, -120.72],     // Merced
  25: [41.64, -120.72],     // Modoc
  26: [37.90, -118.90],     // Mono
  27: [36.22, -121.31],     // Monterey
  28: [38.29, -122.36],     // Napa
  29: [39.31, -120.78],     // Nevada
  30: [33.67, -117.77],     // Orange
  31: [38.93, -120.65],     // Placer
  32: [40.00, -120.82],     // Plumas
  33: [33.74, -117.29],     // Riverside
  34: [38.45, -121.34],     // Sacramento
  35: [36.59, -121.08],     // San Benito
  36: [34.17, -116.19],     // San Bernardino
  37: [32.87, -116.77],     // San Diego
  38: [37.76, -122.43],     // San Francisco
  39: [37.76, -121.28],     // San Joaquin
  40: [35.39, -120.34],     // San Luis Obispo
  41: [37.44, -122.33],     // San Mateo
  42: [34.53, -119.70],     // Santa Barbara
  43: [37.23, -121.71],     // Santa Clara
  44: [37.04, -122.01],     // Santa Cruz
  45: [40.63, -122.04],     // Shasta
  46: [39.57, -120.53],     // Sierra
  47: [41.60, -122.84],     // Siskiyou
  48: [38.27, -121.94],     // Solano
  49: [38.53, -122.69],     // Sonoma
  50: [37.52, -120.86],     // Stanislaus
  51: [39.02, -121.53],     // Sutter
  52: [40.13, -122.01],     // Tehama
  53: [40.64, -123.15],     // Trinity
  54: [36.23, -118.68],     // Tulare
  55: [37.95, -120.02],     // Tuolumne
  56: [34.44, -119.09],     // Ventura
  57: [38.68, -121.83],     // Yolo
  58: [39.27, -121.27],     // Yuba
};

let updated = 0;
for (const [code, [lat, lng]] of Object.entries(COORDS)) {
  db.prepare('UPDATE counties SET lat = ?, lng = ? WHERE code = ?').run(lat, lng, Number(code));
  updated++;
}

console.log(`✅ Updated ${updated} county centroids`);

// Verify
const sample = db.prepare('SELECT name, lat, lng FROM counties WHERE code IN (40, 37, 19, 30)').all();
for (const row of sample) {
  console.log(`  ${row.name}: ${row.lat}, ${row.lng}`);
}

db.close();
