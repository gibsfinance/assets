---
title: Service endpoints
description: Health check, the OpenAPI definition, the machine-readable index, the terms page and these guides as text.
sidebar:
  order: 11
---

| Endpoint | What it returns |
|----------|-----------------|
| `GET /health` | `{"status":"ok"}` with status 200 once migrations and cache warm-up finish. `{"status":"starting"}` with status 503 while the server starts. |
| `GET /openapi.json` | The OpenAPI 3.1 definition of the public API. The [endpoint reference](/reference/) is built from it. |
| `GET /llms.txt` | A plain-text index of the public API and the guides, following the `llmstxt.org` convention. |
| `GET /terms` | The terms and attribution page that every image response links to. |
| `GET /skills/{filename}` | The hand-written guides as markdown: `api-reference.md`, `list-management.md` and `self-hosting.md`. An unknown name answers 404. |
| `GET /docs` | A redirect to the documentation page in the interface. |
| `GET /studio` | A redirect to the token list studio in the interface. |

The interface uses a hash router, so `/docs` and `/studio` are not pages themselves. They redirect to `/#/docs` and `/#/studio`. A URL fragment never reaches the server, so the redirect is what makes the plain paths work when you type or link them.

Every response carries an `x-response-time` header.
