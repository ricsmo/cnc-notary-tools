// functions/api/search.js — Notary commission verification by name
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const { queryAll } = await import('../../lib/helpers.js');

  const q = (url.searchParams.get('q') || '').trim();
  const county = url.searchParams.get('county');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  if (!q || q.length < 2) return Response.json({ results: [], count: 0 });

  // Split query into tokens so "smi john" matches "Smith, John"
  // Each token gets its own LIKE clause, ANDed together
  const tokens = q.split(/\s+/).filter(t => t.length >= 1);
  const whereClauses = tokens.map(() => `n.name LIKE ? COLLATE NOCASE`);
  const nameParams = tokens.map(t => `%${t}%`);

  let sql = `
    SELECT n.name, n.city, c.name as county_name, c.slug as county_slug,
           n.commission_nbr, n.expiration
    FROM notaries n
    JOIN counties c ON n.county_code = c.code
    WHERE ${whereClauses.join(' AND ')}
  `;
  const params = [...nameParams];

  if (county) {
    sql += ` AND n.county_code = ?`;
    params.push(parseInt(county));
  }

  sql += ` ORDER BY n.name LIMIT ?`;
  params.push(limit);

  const results = await queryAll(env.DB, sql, params);

  return Response.json({ results, count: results.length, query: q });
}
