// functions/api/stats.js — All county stats
export async function onRequestGet(context) {
  const { env } = context;
  const { queryAll, queryOne } = await import('../../lib/helpers.js');

  const stats = await queryAll(env.DB, `
    SELECT c.code, c.name, c.slug, COUNT(n.id) as notary_count
    FROM counties c
    LEFT JOIN notaries n ON c.code = n.county_code
    GROUP BY c.code
    ORDER BY notary_count DESC
  `);

  const total = await queryOne(env.DB, 'SELECT COUNT(*) as c FROM notaries');
  const lastImport = await queryOne(env.DB, "SELECT value FROM meta WHERE key = 'last_import'");

  return Response.json({
    total_notaries: total.c,
    last_updated: lastImport?.value || null,
    counties: stats
  });
}
