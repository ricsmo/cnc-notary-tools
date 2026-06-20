// functions/api/fragment/exams.js — HTML fragment for WP embed
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const { queryAll, queryOne, html } = await import('../../../lib/helpers.js');

  const countySlug = url.searchParams.get('county');

  let county = null;
  let countyCode = null;
  if (countySlug) {
    county = await queryOne(env.DB, 'SELECT code, name, slug FROM counties WHERE slug = ?', [countySlug]);
    if (county) countyCode = county.code;
  }

  // Try county-specific exams first
  let exams = [];
  if (countyCode) {
    exams = await queryAll(env.DB, `
      SELECT e.date, e.city, e.venue, e.address, e.times, e.registration_url, e.walk_in
      FROM exam_dates e
      WHERE e.county_code = ? AND e.date >= date('now')
      ORDER BY e.date
    `, [countyCode]);
  }

  // If county has fewer than 3 sessions, supplement with statewide
  if (exams.length < 3) {
    const statewide = await queryAll(env.DB, `
      SELECT e.date, e.city, e.venue, e.address, e.times, e.registration_url, e.walk_in,
             c.name as county_name
      FROM exam_dates e
      LEFT JOIN counties c ON e.county_code = c.code
      WHERE e.date >= date('now')
      ORDER BY e.date
      LIMIT 8
    `);
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
    return html('<p style="font-size:14px;color:#667085;">No upcoming exam sessions scheduled. Check <a href="https://cmas.cpshr.us/CMAS/" style="color:#1a4ed8;">CPS HR</a> for future dates.</p>');
  }

  const headerText = county
    ? `Upcoming Notary Exams — ${county.name} County`
    : 'Upcoming California Notary Exams';

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

  return html(fragment);
}
