---
title: API reference overview
description: The rules that apply to every Gib.Show endpoint, and a map of the pages in this section.
sidebar:
  order: 1
---

Gib.Show is a token metadata and image service. This section describes its application programming interface (API). All endpoints are public. You need no authentication, except for a few moderation endpoints that are for the operator only.

**Base URL:** `https://gib.show` (production) or `https://staging.gib.show` (staging).

The [endpoint reference](/reference/) is built from the server's OpenAPI definition. It lists every path, parameter and response, and it always matches the running code. The pages in this section explain how the endpoints behave and why. Read them together.

## Chain identifiers

Every endpoint that takes a chain accepts two forms:

- The **prefixed identifier**, such as `eip155-369`.
- The **bare number**, such as `369`. Bare numbers work for Ethereum-style (`eip155`) chains.

Chains that are not Ethereum-style, such as Solana and Tron, need the prefixed form. Chain 0 uses the asset namespace (`asset-0`).

Algorand answers to its `ARC-25` chain numbers `4160` (the older number, for all Algorand chains) and `416001` (MainNet). You can write them bare or as `eip155-4160` and `eip155-416001`. All of them resolve to `algorand-283`. The `ARC-25` TestNet and BetaNet numbers (`416002`, `416003`) are not served.

Responses that name a chain give both forms. For example, `/networks` and `/stats` return `chainId` as a bare number and `chainIdentifier` as the prefixed form.

## Pages in this section

| Page | What it covers |
|------|----------------|
| [Images](/api-reference/images/) | Token images, network images, images by hash, fallback and batch lookup |
| [Image options](/api-reference/image-options/) | Resize, format, filters, licence filter, response headers |
| [Image priority](/api-reference/image-priority/) | How Gib.Show picks one image when many providers have one |
| [Token lists](/api-reference/token-lists/) | The list index, single lists, versions, ranked tokens per chain, merged lists |
| [Search](/api-reference/search/) | Find tokens by name, symbol or address |
| [Networks](/api-reference/networks/) | Supported networks and chains |
| [Statistics](/api-reference/statistics/) | Token counts per chain |
| [Sprite sheets](/api-reference/sprite-sheets/) | Many small images in one request |
| [Submissions](/api-reference/submissions/) | Send in a token list or an image |
| [Service endpoints](/api-reference/service-endpoints/) | Health, the OpenAPI definition, guides and terms |
| [Caching](/api-reference/caching/) | Cache lifetimes and how to cache well |
| [Rate limits](/api-reference/rate-limits/) | What is and is not limited |
| [Integration examples](/api-reference/integration-examples/) | React, HTML and recommended sizes |

## Errors

Errors are JSON objects with one `error` field that holds a message. The status codes are the usual ones: 400 for a bad request, 401 for a missing admin token, 404 when nothing matches, 406 for an unsupported format, and 503 while the server starts.
