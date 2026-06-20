// functions/api/exams.js — Exam schedule with optional geo search
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const { queryAll, queryOne, distance } = await import('../../lib/helpers.js');

  const county = url.searchParams.get('county');
  const zip = url.searchParams.get('zip');
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  // Resolve lat/lng from zip or use provided coords
  let userLat = null, userLng = null;
  if (lat && lng) {
    userLat = parseFloat(lat);
    userLng = parseFloat(lng);
  } else if (zip) {
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
      // Fallback to local zip table
      const z = await queryOne(env.DB, 'SELECT lat, lng FROM zip_codes WHERE zip = ?', [zip]);
      if (z) { userLat = z.lat; userLng = z.lng; }
    }
  }

  // Geo search path
  if (userLat !== null && userLng !== null) {
    const venues = await queryAll(env.DB, `
      SELECT DISTINCT venue, address, city, county_code, lat, lng
      FROM exam_dates
      WHERE lat IS NOT NULL AND date >= date('now')
    `);

    const sorted = venues
      .map(v => ({ ...v, distance: distance(userLat, userLng, v.lat, v.lng) }))
      .sort((a, b) => a.distance - b.distance);

    const nearestVenueNames = sorted.slice(0, 8).map(v => v.venue);
    const placeholders = nearestVenueNames.map(() => '?').join(',');
    const exams = await queryAll(env.DB, `
      SELECT e.date, e.city, e.county_code, e.venue, e.address,
             e.times, e.registration_url, e.status, e.walk_in, e.lat, e.lng,
             c.name as county_name, c.slug as county_slug
      FROM exam_dates e
      LEFT JOIN counties c ON e.county_code = c.code
      WHERE e.date >= date('now') AND e.venue IN (${placeholders})
      ORDER BY e.date
    `, nearestVenueNames);

    const distMap = {};
    sorted.forEach(v => distMap[v.venue] = v.distance);
    const examsWithDist = exams.map(e => ({ ...e, distance_miles: distMap[e.venue] || null }));
    examsWithDist.sort((a, b) => (a.distance_miles || 9999) - (b.distance_miles || 9999) || new Date(a.date) - new Date(b.date));

    const lastUpdated = await queryOne(env.DB, "SELECT value FROM meta WHERE key = 'exam_last_updated'");

    return Response.json({
      exams: examsWithDist,
      count: examsWithDist.length,
      user_location: { lat: userLat, lng: userLng, zip: zip || null },
      nearest_venues: sorted.slice(0, 8).map(v => ({ venue: v.venue, city: v.city, distance: v.distance })),
      last_updated: lastUpdated?.value || null,
      source: 'CPS HR Consulting'
    });
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

  const exams = await queryAll(env.DB, sql, params);
  const byDate = {};
  for (const e of exams) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }

  const lastUpdated = await queryOne(env.DB, "SELECT value FROM meta WHERE key = 'exam_last_updated'");

  return Response.json({
    exams,
    by_date: byDate,
    count: exams.length,
    last_updated: lastUpdated?.value || null,
    source: 'CPS HR Consulting'
  });
}
