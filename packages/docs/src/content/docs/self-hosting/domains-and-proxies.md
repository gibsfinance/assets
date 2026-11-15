---
title: Domains and reverse proxies
description: The host names and DNS records an instance needs, the settings that must match its public address, and working Caddy and nginx configurations.
sidebar:
  order: 4
---

A Gib server listens on one plain HTTP port. To serve it on a real domain name with encryption, you need DNS records and, in most setups, a reverse proxy. This page shows both. It uses `example.com` names. Replace them with your own.

## Host names an instance needs

| Name | Needed | What it serves |
|------|--------|----------------|
| `images.example.com` | Yes | The application: the API, the images and the interface. |
| `docs.example.com` | No | The documentation site. |

The same server process answers for both names. It chooses by the `Host` header of each request. A request whose host name is listed in `DOCS_HOSTNAMES` gets the documentation site and nothing else. The API and the interface do not answer on that name. Every other host name gets the application, and the documentation site is not reachable there. `DOCS_HOSTNAMES` is a comma-separated list, and it is empty by default, which turns the documentation site off. You must build the site first with `yarn workspace docs build`. The server reads it from `packages/docs/dist`.

Because the server reads the `Host` header, your proxy must pass the original header on. Both example configurations below do.

## DNS records

Create one record for each name at your DNS provider.

| Type | Name | Value |
|------|------|-------|
| `A` | `images` | The IPv4 address of your server. |
| `AAAA` | `images` | The IPv6 address of your server, if it has one. |
| `CNAME` | `docs` | `images.example.com`, or an `A` and `AAAA` record with the same addresses. |

Notes:

- A `CNAME` is allowed on a sub-domain such as `images`. It is not allowed on the bare domain `example.com`. Use `A` and `AAAA` records there.
- If a content delivery network or a proxy service sits in front of the server, set those records to the proxied mode that your provider offers. Then the provider answers the request and forwards it to your server. See [A content delivery network or a tunnel in front](#a-content-delivery-network-or-a-tunnel-in-front).
- A `www` name is optional. If you want one, point it at the same server and redirect it to the main name. The configurations below show how.
- Open ports 80 and 443 on the server. Port 80 is needed for certificate issue and for the redirect to HTTPS.

## Settings that must match the public address

Two settings hold the public address of your instance. Set both to the address people really use, with the `https://` prefix and no trailing slash.

| Setting | When it is read | What it controls |
|---------|-----------------|------------------|
| `ROOT_URI` | When the server starts. | The address inside every `/image/direct/<hash>` link that the server builds. These are the `logoURI` values in token lists. The default is `http://localhost:3456`. |
| `PUBLIC_BASE_URL` | When you build the interface. | The address the interface calls for the API. Empty means the same origin as the page. |

What breaks when they do not match:

- If `ROOT_URI` is wrong, the lists still load, but each `logoURI` points at the wrong host. A browser or a wallet that follows the link fails to load the logo. With the default, every link points at `localhost`.
- If `PUBLIC_BASE_URL` is wrong, the interface calls an address that does not answer or that blocks it. Leave it empty when the interface and the API share one host name, as in this page. The setting is baked into the build, so you must build the interface again after you change it.

Change `ROOT_URI` in the server environment and restart the server. See [Configuration](/self-hosting/configuration/) for every setting.

## What the server does behind a proxy

Read this before you write a proxy configuration. These facts come from the server code.

- **Port.** The server listens on `PORT`, which is `3000` by default.
- **Client address.** The server does not use the client address for anything. It does not set the Express `trust proxy` option, and its resize limits count per server process, not per client. So a proxy does not change how those limits work. It also means the `X-Forwarded-For` header is passed on but ignored.
- **Host.** The server reads the host name from the `Host` header. It does not read `X-Forwarded-Host`. The proxy must send the original `Host` header.
- **Request body.** The server accepts JSON bodies up to 1 megabyte. An image submission is limited to 512 kilobytes of image data inside that body. Set the proxy limit to 1 megabyte or more.
- **Compression.** The server compresses responses itself. Do not compress again in the proxy.
- **Cache headers.** The server sets `Cache-Control` itself. Hashed build files under `/assets/` and `/_astro/` are `public, max-age=31536000, immutable`. `index.html`, `sw.js` and the documentation HTML pages are `no-cache`. Images use `max-age` from `CACHE_SECONDS`, and `/image/direct/<hash>` is immutable. See [Caching](/api-reference/caching/). Do not override these headers in the proxy.
- **Slow requests.** A first request for a new image size resizes the image in the server. A fetch from a slow provider can also take time. Set the proxy read timeout to 60 seconds, not the short default of some proxies.
- **WebSocket.** The server does not use WebSocket, so the proxy needs no upgrade handling.
- **Health.** `GET /health` answers on every host name. It answers 200 with `{"status":"ok"}` when the server is ready, and 503 while it starts.

## Caddy

Caddy gets and renews certificates from Let's Encrypt by itself. It passes the original `Host` header and sets `X-Forwarded-For` and `X-Forwarded-Proto` by default. Put this in `/etc/caddy/Caddyfile`:

```caddyfile
# Optional: send www to the main name.
www.images.example.com {
	redir https://images.example.com{uri} permanent
}

# The application and, with DOCS_HOSTNAMES set, the documentation site.
images.example.com, docs.example.com {
	# Gib compresses its own responses, so no `encode` directive here.

	# Allow image submissions, which are JSON up to 1 MB.
	request_body {
		max_size 1MB
	}

	reverse_proxy 127.0.0.1:3000 {
		# Caddy sends the original Host header by default.
		# Wait for slow resizes and slow provider fetches.
		transport http {
			response_header_timeout 60s
		}
		health_uri /health
		health_interval 30s
	}
}
```

Caddy does not touch `Cache-Control` from the upstream, so the server headers reach the client unchanged. Check the file, then reload:

```bash
caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

If the proxy runs in a container on the same Docker network as the server, replace `127.0.0.1:3000` with the service name, for example `server:3000`.

## nginx

Install nginx and certbot, point DNS at the server, then get a certificate for each name:

```bash
sudo certbot certonly --nginx -d images.example.com -d docs.example.com -d www.images.example.com
```

Certbot renews the certificates by itself. Put this in `/etc/nginx/conf.d/gib.conf`:

```nginx
# Send plain HTTP to HTTPS.
server {
    listen 80;
    listen [::]:80;
    server_name images.example.com docs.example.com www.images.example.com;
    return 301 https://$host$request_uri;
}

# Optional: send www to the main name.
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name www.images.example.com;

    ssl_certificate     /etc/letsencrypt/live/images.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/images.example.com/privkey.pem;

    return 301 https://images.example.com$request_uri;
}

# The application and, with DOCS_HOSTNAMES set, the documentation site.
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name images.example.com docs.example.com;

    ssl_certificate     /etc/letsencrypt/live/images.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/images.example.com/privkey.pem;

    # Image submissions are JSON up to 1 MB.
    client_max_body_size 1m;

    # Gib compresses its own responses. Leave nginx compression off.
    gzip off;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # The server chooses the application or the documentation site
        # from this header, so it must be the original host name.
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Wait for slow resizes and slow provider fetches.
        proxy_connect_timeout 5s;
        proxy_read_timeout    60s;
        proxy_send_timeout    60s;

        # Do not override the server's Cache-Control headers. nginx passes
        # them on by default. Do not add expires or add_header Cache-Control.
    }
}
```

Test the file, then reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

If the server runs in a container on the same Docker network, replace `127.0.0.1:3000` with the service name, for example `server:3000`.

## A content delivery network or a tunnel in front

You can put a content delivery network, such as the Cloudflare proxy, in front of the server. You can also use a tunnel product, such as Cloudflare Tunnel, which connects out from your server so that you open no inbound port. The rules are the same for all of them:

- The original host name must reach the server in the `Host` header. If the product rewrites the host to an internal name, the documentation site never answers and the application answers on every name. In a tunnel, set the host header or the origin server name to the public name.
- Let the product respect the origin cache headers. Do not set a rule that replaces the `Cache-Control` of the server. A rule that caches `/` and `/index.html` for a short time, such as 60 seconds, is fine and makes the page fast for first-time visitors.
- Tell Gib where to read the real address of the caller. Behind a proxy or a tunnel, every connection comes from the proxy, so Gib cannot tell callers apart and keeps only its whole-service limit on plated images. Set `CLIENT_ADDRESS_HEADER` to the header that your product fills with the caller's address (Cloudflare uses `cf-connecting-ip`), and each caller gets its own limit. Set it only when the server can be reached through the proxy alone: a caller that reaches the server directly could write that header itself and take a fresh limit with every request. Gib never trusts a header that you have not named.
- Caching 404 answers for a short time is optional. Providers that have no image for a token cause many repeated requests for the same missing image. A short cache, for example one hour, spares your server. The server sends its own lifetime with a 404. A product that follows the origin lifetimes may keep it for less than you want, so set a rule for it if you need a longer time.
- After a deploy, a cached copy made before it can answer a plain request. Add a random query parameter when you test.

If you terminate encryption at the content delivery network, you can keep the proxy to the server on plain HTTP. Then `X-Forwarded-Proto` tells you the original protocol.

## Check that it works

Run these from any machine. Replace the names with yours.

```bash
# The application answers, over HTTPS, with its own cache headers.
curl -I https://images.example.com/health
curl -s https://images.example.com/health
# {"status":"ok"}

# An image carries provenance headers and a lifetime.
curl -I "https://images.example.com/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?cachecheck=$RANDOM"
# Look for: cache-control, link, x-license

# The documentation host answers with the site, not the API.
curl -I https://docs.example.com/
# Expect: 200 and cache-control: no-cache
curl -I https://docs.example.com/list
# Expect: 404, because the API does not answer on the documentation host

# Plain HTTP redirects to HTTPS, and www redirects to the main name.
curl -I http://images.example.com/
curl -I https://www.images.example.com/
```

Then check these points:

1. The `link` and `x-license` headers are present on every image response. The server sets them always, so if they are missing, the answer did not come from your server. Suspect a cache in front first.
2. `cache-control` is the value from the server and not a value your proxy invented.
3. A token list has `logoURI` values that start with your public address. If they start with `http://localhost:3456`, set `ROOT_URI` and restart.
4. The interface loads at `https://images.example.com/` and calls the same host.
5. The `Host` check: `https://docs.example.com/` returns the documentation site, and `https://images.example.com/` returns the interface.
