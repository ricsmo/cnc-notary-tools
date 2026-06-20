// functions/api/fragment/county/[slug].js — HTML fragment for WP embed
export async function onRequestGet(context) {
  const { env, params } = context;
  const { queryAll, queryOne, html } = await import('../../../../lib/helpers.js');

  const slug = params.slug;
  const county = await queryOne(env.DB, 'SELECT code, name, slug FROM counties WHERE slug = ?', [slug]);
  if (!county) return new Response('<p>County not found</p>', { status: 404, headers: { 'Content-Type': 'text/html' } });

  const count = await queryOne(env.DB, 'SELECT COUNT(*) as c FROM notaries WHERE county_code = ?', [county.code]);
  const topCities = await queryAll(env.DB, `
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

  return html(fragment);
}
