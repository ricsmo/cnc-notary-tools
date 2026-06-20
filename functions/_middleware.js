// functions/_middleware.js
// Overrides CF Pages default headers to allow embedding from calnotaryclass.com
export async function onRequest(context) {
  const response = await context.next();
  const url = new URL(context.request.url);

  // Clone so we can modify headers
  const newResponse = new Response(response.body, response);

  // For HTML pages: restrict iframe embedding to our WP domains only
  if (url.pathname.endsWith('.html') || url.pathname === '/' || !url.pathname.startsWith('/api/')) {
    newResponse.headers.set(
      'Content-Security-Policy',
      "frame-ancestors https://calnotaryclass.com https://www.calnotaryclass.com;"
    );
    newResponse.headers.delete('X-Frame-Options');
    newResponse.headers.set('X-Content-Type-Options', 'nosniff');
  }

  // For API endpoints: CORS for our domains
  if (url.pathname.startsWith('/api/')) {
    newResponse.headers.set('Access-Control-Allow-Origin', 'https://calnotaryclass.com');
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET');
  }

  return newResponse;
}
