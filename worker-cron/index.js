// worker-cron/index.js — Scheduled Worker that refreshes SOS notary data in D1
//
// Runs nightly at 2 AM Arizona time (9 AM UTC) on weekdays.
// Downloads the active notary ZIP from CA SOS, parses it, and upserts into D1.
//
// Data flow:
//   1. Fetch ZIP from https://notary.cdn.sos.ca.gov/export/active-notary.zip
//   2. Decompress using DecompressionStream (built into Workers runtime)
//   3. Parse tab-delimited records
//   4. Clear old data + batch insert new records into D1
//   5. Update meta table with import timestamp
//
// Deploy: npx wrangler deploy (from worker-cron/ directory)
// Test:   npx wrangler dev --test-scheduled (then hit /__scheduled)

const SOS_URL = 'https://notary.cdn.sos.ca.gov/export/active-notary.zip';

// County codes 1-58, all CA counties
const COUNTIES = {
  1: ['Alameda', 'alameda'], 2: ['Alpine', 'alpine'], 3: ['Amador', 'amador'],
  4: ['Butte', 'butte'], 5: ['Calaveras', 'calaveras'], 6: ['Colusa', 'colusa'],
  7: ['Contra Costa', 'contra-costa'], 8: ['Del Norte', 'del-norte'],
  9: ['El Dorado', 'el-dorado'], 10: ['Fresno', 'fresno'], 11: ['Glenn', 'glenn'],
  12: ['Humboldt', 'humboldt'], 13: ['Imperial', 'imperial'], 14: ['Inyo', 'inyo'],
  15: ['Kern', 'kern'], 16: ['Kings', 'kings'], 17: ['Lake', 'lake'],
  18: ['Lassen', 'lassen'], 19: ['Los Angeles', 'los-angeles'],
  20: ['Madera', 'madera'], 21: ['Marin', 'marin'], 22: ['Mariposa', 'mariposa'],
  23: ['Mendocino', 'mendocino'], 24: ['Merced', 'merced'], 25: ['Modoc', 'modoc'],
  26: ['Mono', 'mono'], 27: ['Monterey', 'monterey'], 28: ['Napa', 'napa'],
  29: ['Nevada', 'nevada'], 30: ['Orange', 'orange'], 31: ['Placer', 'placer'],
  32: ['Plumas', 'plumas'], 33: ['Riverside', 'riverside'],
  34: ['Sacramento', 'sacramento'], 35: ['San Benito', 'san-benito'],
  36: ['San Bernardino', 'san-bernardino'], 37: ['San Diego', 'san-diego'],
  38: ['San Francisco', 'san-francisco'], 39: ['San Joaquin', 'san-joaquin'],
  40: ['San Luis Obispo', 'san-luis-obispo'], 41: ['San Mateo', 'san-mateo'],
  42: ['Santa Barbara', 'santa-barbara'], 43: ['Santa Clara', 'santa-clara'],
  44: ['Santa Cruz', 'santa-cruz'], 45: ['Shasta', 'shasta'],
  46: ['Sierra', 'sierra'], 47: ['Siskiyou', 'siskiyou'], 48: ['Solano', 'solano'],
  49: ['Sonoma', 'sonoma'], 50: ['Stanislaus', 'stanislaus'],
  51: ['Sutter', 'sutter'], 52: ['Tehama', 'tehama'],
  53: ['Trinity', 'trinity'], 54: ['Tulare', 'tulare'],
  55: ['Tuolumne', 'tuolumne'], 56: ['Ventura', 'ventura'],
  57: ['Yolo', 'yolo'], 58: ['Yuba', 'yuba'],
};

export default {
  // ─── Cron trigger handler ────────────────────────────
  async scheduled(event, env, ctx) {
    console.log('⏰ Cron triggered:', new Date().toISOString());
    try {
      const result = await refreshNotaryData(env);
      console.log(`✅ ${result.imported} records imported in ${result.duration}s`);
    } catch (err) {
      console.error('❌ Import failed:', err.message);
      // Could add email/webhook notification here
    }
  },

  // ─── Manual trigger via HTTP (for testing) ───────────
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/refresh') {
      try {
        const result = await refreshNotaryData(env);
        return Response.json({ success: true, ...result });
      } catch (err) {
        return Response.json({ success: false, error: err.message }, { status: 500 });
      }
    }
    return new Response('CNC Notary Cron Worker. Hit /refresh to manually trigger.', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};

// ─── Core: Download, parse, and import ────────────────────
async function refreshNotaryData(env) {
  const startTime = Date.now();

  // 1. Download ZIP
  console.log('Downloading SOS data...');
  const resp = await fetch(SOS_URL);
  if (!resp.ok) throw new Error(`SOS fetch failed: ${resp.status}`);
  const zipBlob = await resp.blob();
  console.log(`Downloaded: ${(zipBlob.size / 1024 / 1024).toFixed(1)} MB`);

  // 2. Decompress (Workers have DecompressionStream built in)
  // The ZIP format needs a proper unzip — but the SOS file is actually
  // a ZIP containing active-notary.txt. We use the fflate library or
  // a manual approach. Since Workers don't have zlib natively, we use
  // a workaround: the SOS file is actually stored as deflate.
  // 
  // Actually, Workers DO have DecompressionStream for 'gzip' and 'deflate'.
  // But ZIP format wraps deflate entries with headers. We need to extract
  // the inner stream. Let's use a minimal ZIP extraction approach.
  const text = await extractTextFromZip(zipBlob);
  console.log(`Parsed: ${text.split('\n').length} lines`);

  // 3. Parse records
  const records = parseRecords(text);
  console.log(`Parsed: ${records.length} valid notary records`);

  // 4. Clear and rebuild
  // D1 doesn't support transactions across batch() calls well,
  // so we DELETE, then batch INSERT
  console.log('Clearing old data...');
  await env.DB.prepare('DELETE FROM notaries').run();
  // Also ensure counties are populated (idempotent)
  await seedCounties(env);

  // 5. Batch insert (D1 batch limit is ~100 statements per call)
  // Privacy: street address, zip, and business name are NOT stored
  console.log('Inserting records...');
  let inserted = 0;
  const BATCH_SIZE = 90;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const stmts = batch.map(r =>
      env.DB.prepare(
        `INSERT INTO notaries (name, city, county_code, commission_nbr, expiration)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(r.name, r.city, r.county_code, r.commission_nbr, r.expiration)
    );
    await env.DB.batch(stmts);
    inserted += batch.length;

    // Log progress every 10K
    if (inserted % 10000 < BATCH_SIZE) {
      console.log(`  ${inserted}/${records.length}...`);
    }
  }

  // 6. Update meta
  const today = new Date().toISOString().split('T')[0];
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_import', ?)").bind(today).run();
  await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('total_records', ?)").bind(String(inserted)).run();

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Done: ${inserted} records in ${duration}s`);

  return { imported: inserted, duration: parseFloat(duration), date: today };
}

// ─── Extract text from ZIP blob ───────────────────────────
// Minimal ZIP extraction: parse the central directory to find the file entry,
// then decompress the raw deflate stream.
async function extractTextFromZip(zipBlob) {
  const zipBuffer = new Uint8Array(await zipBlob.arrayBuffer());

  // Find the local file header (PK\x03\x04)
  // ZIP local header: 4 bytes signature + 26 bytes header + variable name/extra
  const view = new DataView(zipBuffer.buffer);

  // Find first local file header
  let offset = 0;
  // PK\x03\x04 in little-endian = 0x04034b50
  const PK_SIG = 0x04034b50;
  if (view.getUint32(offset, true) !== PK_SIG) {
    throw new Error('Not a valid ZIP file');
  }

  // Parse local file header
  offset += 4;                                   // signature
  offset += 2;                                   // version needed
  offset += 2;                                   // flags
  const compressionMethod = view.getUint16(offset, true);
  offset += 2;                                   // compression method
  offset += 2;                                   // mod time
  offset += 2;                                   // mod date
  offset += 4;                                   // CRC-32
  const compressedSize = view.getUint32(offset, true);
  offset += 4;                                   // compressed size
  offset += 4;                                   // uncompressed size
  const fileNameLength = view.getUint16(offset, true);
  offset += 2;                                   // filename length
  const extraFieldLength = view.getUint16(offset, true);
  offset += 2;                                   // extra field length
  offset += fileNameLength;                       // skip filename
  offset += extraFieldLength;                     // skip extra field

  // Now offset points to the compressed data
  const compressedData = zipBuffer.subarray(offset, offset + compressedSize);

  if (compressionMethod === 0) {
    // Stored (no compression)
    return new TextDecoder().decode(compressedData);
  } else if (compressionMethod === 8) {
    // Deflate — ZIP uses raw deflate (RFC 1951)
    // DecompressionStream('deflate-raw') handles this directly
    const decompressed = new Response(compressedData)
      .body
      .pipeThrough(new DecompressionStream('deflate-raw'));
    const buf = await new Response(decompressed).arrayBuffer();
    return new TextDecoder().decode(buf);
  } else {
    throw new Error(`Unsupported compression method: ${compressionMethod}`);
  }
}

// ─── Parse tab-delimited records ──────────────────────────
function parseRecords(text) {
  const lines = text.split('\n');
  const records = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const parts = line.split('\t');
    if (parts.length < 9) continue;

    const [
      name, , street, city,
      , , countyCodeStr, commissionNbr, rawExp
    ] = parts;

    const countyCode = parseInt(countyCodeStr);
    if (isNaN(countyCode) || countyCode < 1 || countyCode > 58) continue;

    // Convert MM/DD/YYYY → YYYY-MM-DD
    const exp = rawExp.trim();
    const m = exp.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    const expiration = m ? `${m[3]}-${m[1]}-${m[2]}` : exp;

    records.push({
      name: (name || '').trim(),
      city: (city || '').trim(),
      county_code: countyCode,
      commission_nbr: (commissionNbr || '').trim(),
      expiration,
    });
  }

  return records;
}

// ─── Seed counties (idempotent) ───────────────────────────
async function seedCounties(env) {
  const stmts = Object.entries(COUNTIES).map(([code, [name, slug]]) =>
    env.DB.prepare('INSERT OR REPLACE INTO counties (code, name, slug) VALUES (?, ?, ?)')
      .bind(Number(code), name, slug)
  );
  await env.DB.batch(stmts);
}
