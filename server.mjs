// server.mjs — Local dev server for CNC Notary Tools
// Mirrors CF Worker API structure for easy migration.
// Run: node server.mjs

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

// Haversine distance: miles between two lat/lng points
function distance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DB_PATH = join(__dirname, 'data', 'notaries.db');
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = 3001;

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec('PRAGMA journal_mode = WAL');

// ─── Helpers ──────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, content, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html' });
  res.end(content);
}

function serveStatic(req, res) {
  let path = req.url.split('?')[0];
  if (path === '/') path = '/index.html';
  const filePath = join(PUBLIC_DIR, path);
  if (!existsSync(filePath)) return false;

  const ext = extname(filePath);
  const types = {
    '.html': 'text/html', '.js': 'application/javascript',
    '.css': 'text/css', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
  return true;
}

function queryDB(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function queryOne(sql, params = []) {
  return db.prepare(sql).get(...params);
}

// ─── TOOL 1: Notary Search (public-facing) ────────────────
// Find a notary by name. No commission data, no recommendations.
// GET /api/search?q=smith&county=37&limit=20

function apiSearch(req, res, url) {
  const q = (url.searchParams.get('q') || '').trim();
  const county = url.searchParams.get('county');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  if (!q || q.length < 2) return json(res, { results: [], count: 0 });

  let sql = `
    SELECT n.name, n.business_name, n.city, c.name as county_name, c.slug as county_slug
    FROM notaries n
    JOIN counties c ON n.county_code = c.code
    WHERE n.name LIKE ? COLLATE NOCASE
  `;
  const params = [`%${q}%`];

  if (county) {
    sql += ` AND n.county_code = ?`;
    params.push(parseInt(county));
  }

  sql += ` ORDER BY n.city, n.name LIMIT ?`;
  params.push(limit);

  const results = queryDB(sql, params);

  json(res, {
    results,
    count: results.length,
    query: q
  });
}

// ─── TOOL 2: Commission Checker (notary self-service) ─────
// Look up by commission number. Shows expiration + course recommendation.
// GET /api/commission?number=2538491

function apiCommission(req, res, url) {
  const number = (url.searchParams.get('number') || '').trim();
  if (!number) return json(res, { error: 'Commission number required' }, 400);

  const result = queryOne(`
    SELECT n.name, n.commission_nbr, n.expiration,
           n.county_code, c.name as county_name
    FROM notaries n
    JOIN counties c ON n.county_code = c.code
    WHERE n.commission_nbr = ?
  `, [number]);

  if (!result) return json(res, { found: false });

  const today = new Date();
  const exp = new Date(result.expiration + 'T00:00:00');
  const monthsLeft = Math.round((exp - today) / (1000 * 60 * 60 * 24 * 30));

  let recommendation = null;
  if (monthsLeft < -12) {
    recommendation = {
      type: 'expired_long',
      label: 'Commission Expired',
      urgency: 'critical',
      text: `This commission expired ${Math.abs(monthsLeft)} months ago. A full 6-hour course is required to get a new commission.`,
      cta: { text: 'Start the 6-Hour Course', url: 'https://calnotaryclass.com' }
    };
  } else if (monthsLeft < 0) {
    recommendation = {
      type: 'expired_recent',
      label: 'Commission Recently Expired',
      urgency: 'high',
      text: `This commission expired ${Math.abs(monthsLeft)} month(s) ago. You may still qualify for the 3-hour refresher if within the grace period.`,
      cta: { text: 'Check Renewal Eligibility', url: 'https://calnotaryclass.com' }
    };
  } else if (monthsLeft <= 12) {
    recommendation = {
      type: 'renew_now',
      label: 'Renew Now',
      urgency: 'high',
      text: `This commission expires in ${monthsLeft} month(s). Complete a 3-hour refresher course before expiration to avoid a lapse.`,
      cta: { text: 'Start 3-Hour Refresher', url: 'https://calnotaryclass.com' }
    };
  } else if (monthsLeft <= 24) {
    recommendation = {
      type: 'plan_ahead',
      label: 'Plan Ahead',
      urgency: 'low',
      text: `Commission is valid for ${monthsLeft} more months. No action needed yet — bookmark this page for renewal time.`,
      cta: null
    };
  } else {
    recommendation = {
      type: 'valid',
      label: 'Commission Active',
      urgency: 'none',
      text: `Commission is valid for ${monthsLeft} more months. No action needed.`,
      cta: null
    };
  }

  json(res, {
    found: true,
    name: result.name,
    commission_nbr: result.commission_nbr,
    county: result.county_name,
    expiration: result.expiration,
    expiration_formatted: exp.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    months_until_expiration: monthsLeft,
    status: monthsLeft < 0 ? 'expired' : 'active',
    recommendation
  });
}

// ─── TOOL 3: County Stats ─────────────────────────────────
// GET /api/stats              → all counties
// GET /api/stats/san-diego    → specific county

function apiStats(req, res, url, segments) {
  if (segments.length === 0) {
    const stats = queryDB(`
      SELECT c.code, c.name, c.slug, COUNT(n.id) as notary_count
      FROM counties c
      LEFT JOIN notaries n ON c.code = n.county_code
      GROUP BY c.code
      ORDER BY notary_count DESC
    `);
    const total = queryOne('SELECT COUNT(*) as c FROM notaries');
    const lastImport = queryOne("SELECT value FROM meta WHERE key = 'last_import'");
    json(res, {
      total_notaries: total.c,
      last_updated: lastImport?.value || null,
      counties: stats
    });
    return;
  }

  const slug = segments[0];
  const county = queryOne('SELECT code, name, slug FROM counties WHERE slug = ?', [slug]);
  if (!county) return json(res, { error: 'County not found' }, 404);

  const count = queryOne('SELECT COUNT(*) as c FROM notaries WHERE county_code = ?', [county.code]);
  const topCities = queryDB(`
    SELECT city, COUNT(*) as count
    FROM notaries
    WHERE county_code = ? AND city != ''
    GROUP BY city
    ORDER BY count DESC
    LIMIT 10
  `, [county.code]);

  // Fixed: ISO dates now work with SQLite date functions
  const expiringSoon = queryOne(`
    SELECT COUNT(*) as c FROM notaries
    WHERE county_code = ?
    AND date(expiration) <= date('now', '+12 months')
  `, [county.code]);

  json(res, {
    county: county.name,
    slug: county.slug,
    notary_count: count.c,
    top_cities: topCities,
    expiring_within_12_months: expiringSoon.c
  });
}

// ─── TOOL 4: Exam Schedule ────────────────────────────────
// GET /api/exams                → all upcoming
// GET /api/exams?county=37      → filter by county
// GET /api/exams?zip=92126      → nearest venues by zip (geocoded via Nominatim)
// GET /api/exams?lat=32.8&lng=-117.1  → nearest venues by coords

async function apiExams(req, res, url) {
  const county = url.searchParams.get('county');
  const zip = url.searchParams.get('zip');
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  // Geo search: resolve lat/lng from zip or use provided coords
  let userLat = null, userLng = null;
  if (lat && lng) {
    userLat = parseFloat(lat);
    userLng = parseFloat(lng);
  } else if (zip) {
    // Geocode zip via OpenStreetMap Nominatim (free, no API key)
    try {
      const nomResp = await fetch(
        `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&country=US&format=json`,
        { headers: { 'User-Agent': 'CNC-NotaryTools/1.0' } }
      );
      const nomData = await nomResp.json();
      if (nomData && nomData.length > 0) {
        userLat = parseFloat(nomData[0].lat);
        userLng = parseFloat(nomData[0].lon);
      }
    } catch (e) {
      // Nominatim failed — try local zip table as fallback
      const z = queryOne('SELECT lat, lng FROM zip_codes WHERE zip = ?', [zip]);
      if (z) { userLat = z.lat; userLng = z.lng; }
    }
  }

  // If we have coordinates, find nearest venues first
  if (userLat !== null && userLng !== null) {
    // Get all distinct venues with coords
    const venues = queryDB(`
      SELECT DISTINCT venue, address, city, county_code, lat, lng
      FROM exam_dates
      WHERE lat IS NOT NULL AND date >= date('now')
    `);

    // Calculate distance and sort
    const sorted = venues
      .map(v => ({ ...v, distance: distance(userLat, userLng, v.lat, v.lng) }))
      .sort((a, b) => a.distance - b.distance);

    // Get upcoming exams at these venues
    const nearestVenueNames = sorted.slice(0, 8).map(v => v.venue);
    const placeholders = nearestVenueNames.map(() => '?').join(',');
    const exams = queryDB(`
      SELECT e.date, e.city, e.county_code, e.venue, e.address,
             e.times, e.registration_url, e.status, e.walk_in, e.lat, e.lng,
             c.name as county_name, c.slug as county_slug
      FROM exam_dates e
      LEFT JOIN counties c ON e.county_code = c.code
      WHERE e.date >= date('now') AND e.venue IN (${placeholders})
      ORDER BY e.date
    `, nearestVenueNames);

    // Attach distance to each exam
    const distMap = {};
    sorted.forEach(v => distMap[v.venue] = v.distance);
    const examsWithDist = exams.map(e => ({ ...e, distance_miles: distMap[e.venue] || null }));
    examsWithDist.sort((a, b) => (a.distance_miles || 9999) - (b.distance_miles || 9999) || new Date(a.date) - new Date(b.date));

    json(res, {
      exams: examsWithDist,
      count: examsWithDist.length,
      user_location: { lat: userLat, lng: userLng, zip: zip || null },
      nearest_venues: sorted.slice(0, 8).map(v => ({ venue: v.venue, city: v.city, distance: v.distance })),
      last_updated: queryOne("SELECT value FROM meta WHERE key = 'exam_last_updated'")?.value || null,
      source: 'CPS HR Consulting'
    });
    return;
  }

  // Standard listing (no geo)
  let sql = `
    SELECT e.date, e.city, e.county_code, e.venue, e.address,
           e.times, e.registration_url, e.status, e.walk_in,
           c.name as county_name, c.slug as county_slug
    FROM exam_dates e
    LEFT JOIN counties c ON e.county_code = c.code
    WHERE e.date >= date('now')
  `;
  const params = [];

  if (county) {
    sql += ` AND e.county_code = ?`;
    params.push(parseInt(county));
  }

  sql += ` ORDER BY e.date, e.city LIMIT ?`;
  params.push(limit);

  const exams = queryDB(sql, params);
  const byDate = {};
  for (const e of exams) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }

  const lastUpdated = queryOne("SELECT value FROM meta WHERE key = 'exam_last_updated'");

  json(res, {
    exams,
    by_date: byDate,
    count: exams.length,
    last_updated: lastUpdated?.value || null,
    source: 'CPS HR Consulting'
  });
}

// ─── HTML Fragment: County stats (for WP embed) ───────────
// GET /api/fragment/county/san-diego

function apiCountyFragment(req, res, url, segments) {
  const slug = segments[0];
  const county = queryOne('SELECT code, name, slug FROM counties WHERE slug = ?', [slug]);
  if (!county) return html(res, '<p>County not found</p>', 404);

  const count = queryOne('SELECT COUNT(*) as c FROM notaries WHERE county_code = ?', [county.code]);
  const topCities = queryDB(`
    SELECT city, COUNT(*) as count
    FROM notaries
    WHERE county_code = ? AND city != ''
    GROUP BY city
    ORDER BY count DESC
    LIMIT 8
  `, [county.code]);

  const citiesHtml = topCities
    .map(c => `<tr><td>${c.city}</td><td style="text-align:right">${c.count.toLocaleString()}</td></tr>`)
    .join('');

  const fragment = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px 0;">
<h3 style="margin:0 0 8px;font-size:18px;color:#1a1a2e;">Active Notaries in ${county.name} County</h3>
<p style="font-size:28px;font-weight:700;color:#067847;margin:0 0 16px;">${count.c.toLocaleString()}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">
<thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e0e4ec;color:#667085;">City</th>
<th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e0e4ec;color:#667085;">Notaries</th></tr></thead>
<tbody>${citiesHtml}</tbody>
</table>
<p style="font-size:12px;color:#98a2b3;margin-top:12px;">Data sourced from California Secretary of State. For official verification, visit <a href="https://www.sos.ca.gov" style="color:#1a4ed8;">sos.ca.gov</a>.</p>
</div>`.trim();

  html(res, fragment);
}

// ─── HTML Fragment: Exam schedule (for WP embed) ──────────
// GET /api/fragment/exams                → next 6 sessions statewide
// GET /api/fragment/exams?county=san-diego → sessions in that county + nearest

function apiExamFragment(req, res, url) {
  const countySlug = url.searchParams.get('county');

  let county = null;
  let countyCode = null;
  if (countySlug) {
    county = queryOne('SELECT code, name, slug FROM counties WHERE slug = ?', [countySlug]);
    if (county) countyCode = county.code;
  }

  // Try county-specific exams first
  let exams = [];
  if (countyCode) {
    exams = queryDB(`
      SELECT e.date, e.city, e.venue, e.address, e.times, e.registration_url, e.walk_in
      FROM exam_dates e
      WHERE e.county_code = ? AND e.date >= date('now')
      ORDER BY e.date
    `, [countyCode]);
  }

  // If county has fewer than 3 sessions, supplement with statewide upcoming
  if (exams.length < 3) {
    const excludeVenue = exams.map(e => e.venue);
    const statewide = queryDB(`
      SELECT e.date, e.city, e.venue, e.address, e.times, e.registration_url, e.walk_in,
             c.name as county_name
      FROM exam_dates e
      LEFT JOIN counties c ON e.county_code = c.code
      WHERE e.date >= date('now')
      ORDER BY e.date
      LIMIT 8
    `);
    // Merge: county exams first, then fill with statewide (dedup by venue)
    const seen = new Set(exams.map(e => e.venue));
    for (const e of statewide) {
      if (!seen.has(e.venue)) {
        exams.push(e);
        seen.add(e.venue);
      }
      if (exams.length >= 6) break;
    }
  }

  if (!exams.length) {
    html(res, '<p style="font-size:14px;color:#667085;">No upcoming exam sessions scheduled. Check <a href="https://cmas.cpshr.us/CMAS/" style="color:#1a4ed8;">CPS HR</a> for future dates.</p>');
    return;
  }

  const headerText = county
    ? `Upcoming Notary Exams — ${county.name} County`
    : 'Upcoming California Notary Exams';

  // Build date groups
  const byDate = {};
  for (const e of exams) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }

  const rowsHtml = Object.entries(byDate).map(([date, sessions]) => {
    const d = new Date(date + 'T00:00:00');
    const dateStr = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
    const sessionsHtml = sessions.map(s => {
      const locLabel = (county && s.county_name && s.county_name !== county.name)
        ? `${s.venue} (${s.county_name} County)`
        : s.venue;
      return `<div style="padding:6px 0;border-bottom:1px solid #f0f0f0;">
        <div style="font-weight:600;font-size:14px;color:#1a1a2e;">${locLabel}</div>
        <div style="font-size:13px;color:#667085;">${s.city}${s.address ? ', ' + s.address : ''}</div>
        <div style="font-size:12px;color:#667085;margin-top:2px;">
          <strong>Times:</strong> ${s.times}
          ${s.walk_in ? ' · <span style="color:#cc5800;">Walk-in OK</span>' : ''}
          · <a href="${s.registration_url}" style="color:#1a4ed8;">Register</a>
        </div>
      </div>`;
    }).join('');
    return `<tr><td style="vertical-align:top;padding:8px 12px 8px 0;font-weight:600;color:#1a4ed8;white-space:nowrap;font-size:14px;">${dateStr}</td><td style="padding:8px 0;">${sessionsHtml}</td></tr>`;
  }).join('');

  const fragment = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px 0;">
<h3 style="margin:0 0 12px;font-size:18px;color:#1a1a2e;">${headerText}</h3>
<table style="width:100%;border-collapse:collapse;">
<tbody>${rowsHtml}
</tbody>
</table>
<p style="font-size:12px;color:#98a2b3;margin-top:12px;">Exam schedule provided by CPS HR Consulting. Registration required at <a href="https://cmas.cpshr.us/CMAS/" style="color:#1a4ed8;">cmas.cpshr.us</a>. Walk-in registration allowed space-available — arrive 45 minutes early.</p>
</div>`.trim();

  html(res, fragment);
}

// ─── Router ───────────────────────────────────────────────

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // API routes
  if (path === '/api/search') return apiSearch(req, res, url);
  if (path === '/api/commission') return apiCommission(req, res, url);

  if (path === '/api/stats') return apiStats(req, res, url, []);
  if (path.startsWith('/api/stats/')) return apiStats(req, res, url, path.replace('/api/stats/', '').split('/'));

  if (path === '/api/exams') return apiExams(req, res, url);

  if (path.startsWith('/api/fragment/county/')) return apiCountyFragment(req, res, url, [path.replace('/api/fragment/county/', '')]);
  if (path === '/api/fragment/exams') return apiExamFragment(req, res, url);

  // Static files
  if (serveStatic(req, res)) return;

  // 404
  json(res, { error: 'Not found', path }, 404);
});

server.listen(PORT, () => {
  console.log(`\n🔧 CNC Notary Tools — http://localhost:${PORT}\n`);
  console.log(`   Tools:`);
  console.log(`   ├── Notary Search:      /search.html`);
  console.log(`   ├── Commission Checker: /commission.html`);
  console.log(`   ├── County Stats:       /county-widget.html`);
  console.log(`   ├── Exam Schedule:      /exams.html`);
  console.log(`   └── Demo Hub:           /\n`);
  console.log(`   API:`);
  console.log(`   GET /api/search?q=<name>&county=<code>`);
  console.log(`   GET /api/commission?number=<commission#>`);
  console.log(`   GET /api/stats[/<county-slug>]`);
  console.log(`   GET /api/exams[?county=<code>]`);
  console.log(`   GET /api/fragment/county/<county-slug>`);
  console.log(`   GET /api/fragment/exams[?county=<slug>]\n`);
});
