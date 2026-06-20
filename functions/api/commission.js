// functions/api/commission.js — Commission checker with exam timeline + dual recommendations
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const { queryOne, queryAll, distance } = await import('../../lib/helpers.js');

  const number = (url.searchParams.get('number') || '').trim();
  const zip = (url.searchParams.get('zip') || '').trim();
  if (!number) return Response.json({ error: 'Commission number required' }, { status: 400 });

  const result = await queryOne(env.DB, `
    SELECT n.name, n.commission_nbr, n.expiration, n.county_code, c.name as county_name, c.slug as county_slug
    FROM notaries n
    JOIN counties c ON n.county_code = c.code
    WHERE n.commission_nbr = ?
  `, [number]);

  if (!result) return Response.json({ found: false });

  const today = new Date();
  const exp = new Date(result.expiration + 'T00:00:00');
  const daysLeft = Math.round((exp - today) / (1000 * 60 * 60 * 24));
  const monthsLeft = Math.round(daysLeft / 30);

  // ─── Find upcoming exams (geo or county fallback) ──────
  // If already expired, no upper-bound filter — they need to take an exam whenever
  const examDeadline = monthsLeft <= 0 ? '9999-12-31' : result.expiration;
  let exams = [];
  let searchMethod = 'county';

  if (zip) {
    // Geocode zip and find nearest exam venues by distance
    searchMethod = 'geo';
    let userLat = null, userLng = null;

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
      // Fall back to local zip table
      const z = await queryOne(env.DB, 'SELECT lat, lng FROM zip_codes WHERE zip = ?', [zip]);
      if (z) { userLat = z.lat; userLng = z.lng; }
    }

    if (userLat !== null && userLng !== null) {
      // Get all unique venues with coordinates
      const venues = await queryAll(env.DB, `
        SELECT DISTINCT venue, address, city, county_code, lat, lng
        FROM exam_dates
        WHERE lat IS NOT NULL AND date >= date('now') AND date <= ?
      `, [examDeadline]);

      if (venues.length > 0) {
        const sorted = venues
          .map(v => ({ ...v, distance: distance(userLat, userLng, v.lat, v.lng) }))
          .sort((a, b) => a.distance - b.distance);

        // Take nearest 5 venues, get all their exam sessions
        const nearestVenueNames = sorted.slice(0, 5).map(v => v.venue);
        const placeholders = nearestVenueNames.map(() => '?').join(',');
        exams = await queryAll(env.DB, `
          SELECT e.date, e.city, e.venue, e.address, e.times, e.registration_url,
                 e.county_code, c.name as county_name
          FROM exam_dates e
          JOIN counties c ON e.county_code = c.code
          WHERE e.date >= date('now') AND e.date <= ? AND e.venue IN (${placeholders})
          ORDER BY e.date
        `, [examDeadline, ...nearestVenueNames]);

        // Attach distance to each exam
        const distMap = {};
        sorted.forEach(v => distMap[v.venue] = v.distance);
        exams.forEach(e => e.distance_miles = distMap[e.venue] || null);
        exams.sort((a, b) => (a.distance_miles || 9999) - (b.distance_miles || 9999) || new Date(a.date) - new Date(b.date));
        exams = exams.slice(0, 8);
      }
    }

    // If geocoding failed or no geo results, fall back to county
    if (exams.length === 0) {
      searchMethod = 'county_fallback';
    }
  }

  // County-based search (default or fallback)
  if (exams.length === 0) {
    // Exams in the notary's own county
    const localExams = await queryAll(env.DB, `
      SELECT e.date, e.city, e.venue, e.address, e.times, e.registration_url,
             e.county_code, c.name as county_name
      FROM exam_dates e
      JOIN counties c ON e.county_code = c.code
      WHERE e.county_code = ? AND e.date >= date('now') AND e.date <= ?
      ORDER BY e.date
      LIMIT 5
    `, [result.county_code, examDeadline]);

    if (localExams.length === 0) {
      // No local exams — find nearest by county centroid, then get their sessions
      searchMethod = 'statewide_fallback';

      const countyInfo = await queryOne(env.DB, 'SELECT lat, lng FROM counties WHERE code = ?', [result.county_code]);

      if (countyInfo && countyInfo.lat != null) {
        // Use county centroid to find nearest exam venues
        const venues = await queryAll(env.DB, `
          SELECT DISTINCT venue, address, city, county_code, lat, lng
          FROM exam_dates
          WHERE lat IS NOT NULL AND date >= date('now') AND date <= ?
        `, [examDeadline]);

        const sorted = venues
          .map(v => ({ ...v, distance: distance(countyInfo.lat, countyInfo.lng, v.lat, v.lng) }))
          .sort((a, b) => a.distance - b.distance);

        const nearestVenueNames = sorted.slice(0, 5).map(v => v.venue);
        const placeholders = nearestVenueNames.map(() => '?').join(',');
        exams = await queryAll(env.DB, `
          SELECT e.date, e.city, e.venue, e.address, e.times, e.registration_url,
                 e.county_code, c.name as county_name
          FROM exam_dates e
          JOIN counties c ON e.county_code = c.code
          WHERE e.date >= date('now') AND e.date <= ? AND e.venue IN (${placeholders})
          ORDER BY e.date
        `, [examDeadline, ...nearestVenueNames]);

        // Attach distance from county centroid
        const distMap = {};
        sorted.forEach(v => distMap[v.venue] = v.distance);
        exams.forEach(e => e.distance_miles = distMap[e.venue] || null);
        exams.sort((a, b) => (a.distance_miles || 9999) - (b.distance_miles || 9999) || new Date(a.date) - new Date(b.date));
        exams = exams.slice(0, 8);
      } else {
        // No coordinates — just get next 5 statewide
        exams = await queryAll(env.DB, `
          SELECT e.date, e.city, e.venue, e.address, e.times, e.registration_url,
                 e.county_code, c.name as county_name
          FROM exam_dates e
          JOIN counties c ON e.county_code = c.code
          WHERE e.date >= date('now') AND e.date <= ?
          ORDER BY e.date
          LIMIT 5
        `, [examDeadline]);
      }
    } else {
      searchMethod = 'county';
      exams = localExams;
    }
  }

  const nextExam = exams.length > 0 ? exams[0] : null;
  const hasNextExam = nextExam !== null;

  // ─── Timeline calculations ─────────────────────────────
  // Key insight: 3-hour refresher only works if they complete
  // course + pass exam + file application ALL before expiration.
  // If they fail the exam or run out of time, they need the 6-hour.

  const nextExamDate = nextExam ? new Date(nextExam.date + 'T00:00:00') : null;
  const daysUntilExam = nextExamDate ? Math.round((nextExamDate - today) / (1000 * 60 * 60 * 24)) : null;

  // Find the first exam with enough lead time to complete a course first
  const MIN_COURSE_DAYS = 7;      // Minimum to complete the course
  const MIN_FILING_DAYS = 14;     // Minimum buffer between exam and expiration for filing

  let viableExam = null;
  for (const exam of exams) {
    const examDate = new Date(exam.date + 'T00:00:00');
    const daysTo = Math.round((examDate - today) / (1000 * 60 * 60 * 24));
    const daysAfter = Math.round((exp - examDate) / (1000 * 60 * 60 * 24));
    if (daysTo >= MIN_COURSE_DAYS && daysAfter >= MIN_FILING_DAYS) {
      viableExam = exam;
      viableExam._days_until = daysTo;
      viableExam._days_after = daysAfter;
      break;
    }
  }

  const threeHourViable = viableExam !== null;
  const daysBetweenExamAndExpiry = viableExam ? viableExam._days_after : (nextExamDate ? Math.round((exp - nextExamDate) / (1000 * 60 * 60 * 24)) : null);

  // ─── Build recommendation ─────────────────────────────

  let recommendation = null;

  if (monthsLeft < -12) {
    // Expired more than a year ago — 6-hour required, no choice
    recommendation = {
      type: 'expired_long',
      label: 'Commission Expired',
      urgency: 'critical',
      course: '6-Hour Course (Required)',
      text: `This commission expired ${Math.abs(monthsLeft)} months ago. A new 6-hour course and state exam are required to obtain a fresh commission.`,
      cta: { text: 'Start the 6-Hour Course', url: 'https://calnotaryclass.com/checkout/?add-to-cart=1881' },
      paths: null
    };
  } else if (monthsLeft < 0) {
    // Recently expired — grace period
    recommendation = {
      type: 'expired_recent',
      label: 'Commission Recently Expired',
      urgency: 'critical',
      course: '3-Hour Refresher (if eligible)',
      text: `This commission expired ${Math.abs(monthsLeft)} month(s) ago. If within the one-year grace period, you may still qualify for the 3-hour refresher. Act quickly to complete the course and pass the exam.`,
      cta: { text: 'Start 3-Hour Refresher', url: 'https://calnotaryclass.com/checkout/?add-to-cart=3329' },
      paths: threeHourViable ? {
        recommended: {
          label: '3-Hour Refresher',
          course: '3-hour refresher course',
          exam: viableExam,
          text: `Complete the 3-hour refresher and pass the exam${viableExam ? ` at ${viableExam.city} on ${formatDate(viableExam.date)}` : ''}. You must do both before your grace period ends.`
        },
        alternative: {
          label: '6-Hour Course',
          course: '6-hour notary education course',
          text: `If your grace period has passed, the 6-hour course satisfies the requirement to renew your commission from scratch.`
        }
      } : null
    };
  } else if (monthsLeft <= 12) {
    // Active but needs renewal — dual path
    recommendation = {
      type: 'renew_now',
      label: 'Renew Now',
      urgency: monthsLeft <= 3 ? 'critical' : 'high',
      course: threeHourViable ? '3-Hour Refresher' : '6-Hour Course',
      text: `Commission expires in ${monthsLeft} month(s) on ${formatDate(result.expiration)}.`,
      cta: {
        text: threeHourViable ? 'Start 3-Hour Refresher' : 'Start 6-Hour Course',
        url: threeHourViable ? 'https://calnotaryclass.com/checkout/?add-to-cart=3329' : 'https://calnotaryclass.com/checkout/?add-to-cart=1881'
      },
      paths: {
        recommended: {
          label: threeHourViable ? '3-Hour Refresher' : '6-Hour Course',
          course: threeHourViable ? '3-hour refresher course' : '6-hour notary education course',
          exam: viableExam || nextExam,
          text: threeHourViable
            ? `Based on your time remaining, the 3-hour refresher is what you need. Complete the course, then pass the exam${viableExam ? ` at ${viableExam.city} on ${formatDate(viableExam.date)}` : ''} before your commission expires on ${formatDate(result.expiration)}.`
            : monthsLeft <= 0
              ? `Your commission has expired. Complete the 6-hour course and pass the exam whenever you're ready to renew.`
              : hasNextExam
                ? `There's an exam on ${formatDate(nextExam.date)} but not enough time to complete a course first. The 6-hour course gives you more time to prepare and pass the exam at your own pace.`
                : `No exams are currently scheduled before your commission expires. The 6-hour course lets you renew whenever you're ready, with no deadline pressure.`
        },
        alternative: threeHourViable ? {
          label: '6-Hour Course',
          course: '6-hour notary education course',
          text: `Want extra preparation before the exam? The 6-hour course covers everything in more depth. It's also a good choice if you'd rather not race the deadline — you can take the exam whenever you're ready.`
        } : null
      }
    };
  } else if (monthsLeft <= 24) {
    // Still time — no urgency
    recommendation = {
      type: 'plan_ahead',
      label: 'Plan Ahead',
      urgency: 'low',
      course: '3-hour refresher (when ready)',
      text: `Commission is valid for ${monthsLeft} more months. No action needed yet, but you'll need a 3-hour refresher course and exam before renewal.`,
      cta: null,
      paths: null
    };
  } else {
    recommendation = {
      type: 'valid',
      label: 'Commission Active',
      urgency: 'none',
      course: null,
      text: `Commission is valid for ${monthsLeft} more months. No action needed.`,
      cta: null,
      paths: null
    };
  }

  return Response.json({
    found: true,
    name: result.name,
    commission_nbr: result.commission_nbr,
    county: result.county_name,
    county_slug: result.county_slug,
    expiration: result.expiration,
    expiration_formatted: formatDate(result.expiration),
    months_until_expiration: monthsLeft,
    days_until_expiration: daysLeft,
    status: monthsLeft < 0 ? 'expired' : 'active',
    exam_search: {
      method: searchMethod,
      zip: zip || null,
      has_exams: hasNextExam,
      next_exam_date: nextExam?.date || null,
      next_exam_city: nextExam?.city || null,
      days_until_exam: daysUntilExam,
      days_between_exam_and_expiry: daysBetweenExamAndExpiry
    },
    upcoming_exams: exams,
    recommendation
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
