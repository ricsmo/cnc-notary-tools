// functions/api/stats/[slug].js — Single county stats
export async function onRequestGet(context) {
  const { env, params } = context;
  const { queryAll, queryOne } = await import('../../../lib/helpers.js');

  const slug = params.slug;
  const county = await queryOne(env.DB, 'SELECT code, name, slug FROM counties WHERE slug = ?', [slug]);
  if (!county) return Response.json({ error: 'County not found' }, { status: 404 });

  const count = await queryOne(env.DB, 'SELECT COUNT(*) as c FROM notaries WHERE county_code = ?', [county.code]);
  const topCities = await queryAll(env.DB, `
    SELECT city, COUNT(*) as count
    FROM notaries
    WHERE county_code = ? AND city != ''
    GROUP BY city
    ORDER BY count DESC
    LIMIT 10
  `, [county.code]);

  const expiringSoon = await queryOne(env.DB, `
    SELECT COUNT(*) as c FROM notaries
    WHERE county_code = ?
    AND date(expiration) <= date('now', '+12 months')
  `, [county.code]);

  return Response.json({
    county: county.name,
    slug: county.slug,
    notary_count: count.c,
    top_cities: topCities,
    expiring_within_12_months: expiringSoon.c
  });
}
