// functions/_middleware.js
//
// Blocks direct-URL access to the embeddable tool pages.
// The tools are only meant to be used inside iframes on calnotaryclass.com.
//
// This closes the gap that frame-ancestors CSP cannot: a CSP frame-ancestors
// rule only governs who can *frame* a page; it does nothing when someone loads
// the Pages URL directly in a browser tab. This middleware runs before CF Pages
// serves the static HTML and rejects those top-level navigations.
//
// The browser-sent Sec-Fetch-Dest header is the discriminator:
//   - Direct visit (pasted URL / clicked link)  -> "document"
//   - Loaded inside our WP iframe               -> "iframe"
//   - Sub-resources the page itself fetches     -> "style" | "script" | ...
//   - Header absent (very old browser/WebView)  -> blocked (secure default)
//
// curl bypass is possible (header is client-controlled). That's an accepted
// trade for protecting paid marketing tools from casual hotlinking — it is not
// cryptographic protection. For something stronger you'd need signed tokens
// issued by WP and validated at the edge, which reintroduces the auth layer
// this project deliberately removed.
//
// Layering note — this middleware does NOT check the Referer/Origin, on purpose:
//   - WHO can frame the page is enforced by frame-ancestors CSP in _headers
//     (calnotaryclass.com only).
//   - WHETHER the page loads at all (iframe vs direct URL) is enforced HERE.
// Referer is unreliable under modern privacy settings (often stripped), so we
// don't depend on it. The two checks together mean: the only way to see a tool
// is to be framed by the allowed domain.

// HTML pages that are meant to be iframe-embedded (not the API or assets).
// Paths are matched as URL pathnames; trailing .html is optional.
const GATED_PATHS = new Set([
  '/exams',
  '/search',
  '/commission',
  '/county-widget',
]);

// Sub-resources must always pass through, otherwise the embedded page would
// load as HTML but render with no CSS/JS. Same for the API the pages call.
function isPassthrough(pathname) {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/assets/') ||
    pathname === '/robots.txt' ||
    pathname === '/favicon.ico'
  );
}

// Origins allowed to fetch /api/* cross-origin (browser JS embeds on the
// county pages). Mirrors the _headers CORS intent, which silently does not
// apply to Function responses.
const ALLOWED_ORIGINS = new Set([
  'https://calnotaryclass.com',
  'https://www.calnotaryclass.com',
]);

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  // Normalize: strip .html, trailing slashes, and a trailing /index so that
  // /exams, /exams/, /exams.html and /exams/index all collapse to /exams.
  // Otherwise /exams/index.html would slip past the gate (CF Pages serves it
  // as the directory's default page).
  const pathname =
    url.pathname
      .replace(/\.html$/, '')
      .replace(/\/index$/, '')
      .replace(/\/+$/, '') || '/';

  // Never gate the API or static assets — the embedded pages depend on them.
  if (isPassthrough(url.pathname)) {
    const res = await next();
    // CORS for the API: Pages' _headers file does not apply to Function
    // responses, so /api/* ships without Access-Control-Allow-Origin unless
    // added here. Without this, cross-origin fetches from county pages on
    // calnotaryclass.com fail ("Failed to fetch"), even though the header
    // rule in _headers suggests they should work.
    if (url.pathname.startsWith('/api/') && request.method === 'GET') {
      const origin = request.headers.get('origin');
      if (origin && ALLOWED_ORIGINS.has(origin)) {
        const cors = new Headers(res.headers);
        cors.set('Access-Control-Allow-Origin', origin);
        cors.set('Vary', 'Origin');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: cors });
      }
    }
    return res;
  }

  // Only gate the known embeddable tool pages; everything else passes through.
  if (!GATED_PATHS.has(pathname)) {
    return next();
  }

  const dest = request.headers.get('sec-fetch-dest');

  // Embedded in our iframe -> allow.
  if (dest === 'iframe') {
    return next();
  }

  // A sub-resource request (CSS/JS/font fetched BY the page) -> allow.
  // These land here only if not under /assets/*, e.g. an inline module import.
  if (
    dest === 'style' ||
    dest === 'script' ||
    dest === 'font' ||
    dest === 'image'
  ) {
    return next();
  }

  // Everything else is a direct top-level navigation (or a non-browser client
  // that didn't send the header). Block it.
  return blockResponse();
}

function blockResponse() {
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Not available</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         display:flex; align-items:center; justify-content:center; min-height:100vh;
         margin:0; background:#f7f8fa; color:#1a1a2e; line-height:1.6; }
  .card { background:#fff; border:1px solid #e0e4ec; border-radius:8px; padding:32px;
          max-width:420px; text-align:center; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { color:#667085; font-size:15px; margin:8px 0 0; }
  a { color:#067847; }
</style>
</head>
<body>
  <div class="card">
    <h1>This tool isn't available here.</h1>
    <p>It's part of CalNotaryClass and only loads inside the course pages.</p>
    <p>If you reached this page from a link inside your course, please open it in a current version of Chrome, Edge, Firefox, or Safari (16.4+).</p>
  </div>
</body>
</html>`;
  return new Response(body, {
    status: 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
