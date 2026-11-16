---
title: Caching
description: How long each kind of response may be cached, and how to cache well.
sidebar:
  order: 12
---

## Lifetimes

| Response | `cache-control` |
|----------|-----------------|
| Images by chain and address | `public, max-age=` followed by the server's cache setting (86400 on the public instance `gib.show`), with a seven-day `stale-while-revalidate` and `stale-if-error` window |
| `/image/direct/{imageHash}` | `public, max-age=31536000, immutable` |
| `/list/tokens/{chainId}` | `public, max-age=21600, stale-while-revalidate=86400` (6 hours fresh, 24 hours stale) |
| Provider lists, `/networks`, `/stats`, sprite sheets | `public, max-age=` followed by the server's cache setting |

The Gib engine reads its cache setting from `CACHE_SECONDS`. It is one hour (3600) if the operator sets nothing. The public instance `gib.show` sets it to one day (86400). Image lifetimes use the same setting. An instance you host yourself uses whatever you set. See [Configuration](/self-hosting/configuration/).

A sprite sheet is cached like a list. The exception is a sheet drawn while the server was too busy to download every logo it needed: that sheet has empty cells that a later request would fill, so it carries `cache-control: no-store`.

Responses that an operator rebuilds with `refresh` carry `cache-control: no-store`, so no content delivery network keeps them.

## Content-addressed images

`/image/direct/{imageHash}` is content-addressed. The hash in the path names one download, so a raster image (PNG, JPEG, WebP and the like) never changes at that address. The route carries a one-year `immutable` lifetime for the original and for any resized or converted variant of a raster image.

A vector image (SVG) at that address uses the ordinary lifetime instead. The operator command `images resanitize` can rewrite the bytes of a vector image under the same address when the sanitizer is fixed, and a cache that held the old bytes for a year would keep serving what the fix removed.

If you show the same set of images again and again, take the hash from the `logoURI` of a token list and request `/image/direct/{imageHash}`. Do not fetch by chain and address each time.

## Server-side variant cache

Resized variants are cached in the database. The first request for a new size costs about 50 milliseconds of resize work. Later requests for that size are fast. See [Image options](/api-reference/image-options/) for the options and [Rate limits](/api-reference/rate-limits/) for the limit on new variants.

## Reuse a small set of sizes

Each different `w`, `h` and `as` combination is a new variant. Pick a small set of sizes and reuse them. The table in [Integration examples](/api-reference/integration-examples/#recommended-sizes) lists good choices.

## How gib.show uses a content delivery network

The public instance `gib.show` puts a content delivery network in front of the server. Cloudflare is that network. It keeps a copy of a response near the people who ask for it, and it keeps the copy for as long as its rules allow.

The server's own `Cache-Control` header decides every lifetime, with two exceptions. The page rule keeps the home page for 60 seconds at the edge, whatever the server says. The content rule keeps a 404 answer for one hour at the edge, whatever the server says. The browser always follows the server's header.

The rules below are generated from the committed rules file, `packages/docs/src/data/edge-cache-rules.json`. They match the live settings as of the last export.

<!-- edge-cache-rules:start -->

| Rule                                       | Enabled | Kept at the edge | Edge lifetime                                                                       | Browser lifetime                                                   |
| ------------------------------------------ | ------- | ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| content                                    | Yes     | Yes              | Follows the origin's Cache-Control header, except 404 answers are kept 3600 seconds | Not set by this rule, so the origin's Cache-Control header decides |
| page: cache index.html at the edge for 60s | Yes     | Yes              | 60 seconds, whatever the origin says                                                | Follows the origin's Cache-Control header                          |

**content**

```text
(http.request.uri.path wildcard r"/image/*") or (http.request.uri.path wildcard r"/list/*") or (http.request.uri.path wildcard r"/token/*") or (http.request.uri.path wildcard r"/sprite/*") or (http.request.uri.path wildcard r"/stats") or (http.request.uri.path wildcard r"/networks")
```

**page: cache index.html at the edge for 60s**

```text
(http.host in {"gib.show" "staging.gib.show"} and http.request.uri.path in {"/" "/index.html"})
```

<!-- edge-cache-rules:end -->

### The content rule

This rule covers the image, list, token, sprite sheet, stats and network answers.

Its edge lifetime follows the server's `Cache-Control`, except for a 404 answer. A 404 answer is kept for one hour.

The one-hour rule exists because of a polling client. One client asked for a few addresses that have no image, and it sent about 3,000 requests a day to the server. Without the rule, the network kept those 404 answers for about 3 minutes. The server had asked for a day.

### The page rule

This rule covers the home page and `index.html` on `gib.show` and `staging.gib.show`.

The edge keeps the page for 60 seconds, whatever the server says. A browser still follows the server's `no-cache` header, so it checks again on each visit.

The rule makes the page fast for first-time visitors. On a warm connection, the page arrives in about 30 to 50 milliseconds instead of about 120 milliseconds. A deploy reaches first-time visitors within a minute, with no purge.

### Copying a rule

Each rule's expression is written in Cloudflare's own selection language. The expressions name `gib.show` and `staging.gib.show`. Change those names to your own host names before you copy an expression.

If you run your own instance behind Cloudflare, see [A content delivery network or a tunnel in front](/self-hosting/domains-and-proxies/#a-content-delivery-network-or-a-tunnel-in-front) for the header and host name rules that apply to any product.

## Doing the same with another cache

Any cache in front of the server can follow the same two exceptions. Keep the server's `Cache-Control` for everything else, and do not override it in the proxy for the other routes.

These snippets show the intent for nginx. They are not validated. nginx was not installed on the machine where they were written, so `nginx -t` was not run. Test them on a copy of your server before you use them.

```nginx
# Cache store, in the http block.
proxy_cache_path /var/cache/nginx/gib keys_zone=gib:10m max_size=1g inactive=1d use_temp_path=off;

# The home page: keep it for 60 seconds whatever the server says, and let browsers follow the server.
location = / {
    proxy_pass http://127.0.0.1:3000;
    proxy_cache gib;
    proxy_ignore_headers Cache-Control;
    proxy_cache_valid 200 60s;
}

# The content routes: keep 404 answers for one hour. nginx cannot read the server's lifetime per
# status code, so this block sets the 200 lifetime itself. Match 1d to the server's CACHE_SECONDS.
location ~ ^/(image|list|token|sprite|stats|networks) {
    proxy_pass http://127.0.0.1:3000;
    proxy_cache gib;
    proxy_ignore_headers Cache-Control Expires;
    proxy_cache_valid 200 1d;
    proxy_cache_valid 404 1h;
}
```

Caddy has no cache in its standard build. The cache module for Caddy is third party, so take its syntax from its own documentation. Use the same two exceptions and leave every other route to the server's header.
