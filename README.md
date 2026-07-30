# CNC Notary Tools

CalNotaryClass notary tools, served as static HTML + a D1-backed API on
Cloudflare Pages. Designed to be **embedded via iframe** on calnotaryclass.com
WordPress pages — not accessed directly.

## Access control: how the tools are gated

There is no auth between Cloudflare and WordPress. Access is enforced by two
**layered** checks, each covering a different attack:

| Check | Where | What it blocks |
|---|---|---|
| `frame-ancestors` CSP | `public/_headers` | The wrong site embedding the tool (e.g. someone else's `<iframe src="...">`) |
| `Sec-Fetch-Dest` gate | `functions/_middleware.js` | **Direct-URL access** — pasting the Pages URL into a browser, clicking a link, sharing it |

The CSP alone does NOT stop someone from loading the tool by visiting its URL
directly (that's a known CSP limitation — `frame-ancestors` only governs framing).
The middleware closes that gap by rejecting any top-level navigation
(`Sec-Fetch-Dest: document`) to the gated pages and only serving them when
`Sec-Fetch-Dest: iframe` (loaded inside the WP embed).

### What's gated vs. passthrough

- **Gated (iframe-only):** `/exams`, `/search`, `/commission`, `/county-widget`
- **Passthrough (always served):** `/api/*` (the pages call these), `/assets/*` (CSS/JS), `robots.txt`, `favicon.ico`

### Browser requirement

`Sec-Fetch-Dest` is sent by Chrome, Edge, Firefox, Opera (and all Chromium forks)
since ~2020, and by **Safari 16.4+** (March 2023). Older Safari and some in-app
WebViews don't send it. The middleware **blocks on a missing header** (secure
default), so a user on an unsupported client sees a 403 page telling them to use
a current browser. On any affected device, opening Chrome/Edge/Firefox works.

### What this is NOT

Not cryptographic protection. The `Sec-Fetch-Dest` header is client-controlled,
so `curl --header "Sec-Fetch-Dest: iframe" <url>` fetches the HTML. That's an
accepted trade for protecting marketing/paid tools from casual hotlinking — a
serious competitor could scrape them. To make that impossible you'd need signed
tokens issued by WordPress and validated at the edge, which reintroduces the
auth layer this project deliberately removed (WP gating enrollment IS the auth).

## Local dev

```bash
npm install
npm run db:schema   # create local D1 tables
npm run db:import   # load data
npm run dev         # wrangler pages dev public  -> http://localhost:8788
```

Test the embed layout locally with `public/embed-test.html` (points at port 8788).

## Deploy

```bash
npm run deploy:pages   # wrangler pages deploy public
```

Cloudflare Pages is git-connected to this repo, so pushing to `main` triggers a
build+deploy as well.
