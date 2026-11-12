---
title: What Gib.Show is
description: Gib.Show is a free public service that serves token images, network images and token lists, with no sign-in.
sidebar:
  order: 1
---

Gib.Show is a free, public service. It gives you the logo of a token or a blockchain network at a predictable address. It also gives you token lists in the standard Uniswap token list format.

You do not need an account, an API key or a sign-in. Every endpoint is public.

## How it works

Gib.Show collects token data and artwork from more than 30 providers. Examples are CoinGecko, Trust Wallet, SmolDapp and PulseX. It stores the images, sorts the providers by trust, and serves the best image it has for each token.

When more than one provider has an image for the same token, Gib.Show picks one for you. [Image priority](/api-reference/image-priority/) explains how.

Gib.Show is an index. It does not own the artwork it serves. Every image response tells you where the image came from and under which licence. Read [Image options](/api-reference/image-options/) for the response headers. The full terms are at [gib.show/terms](https://gib.show/terms).

## Where to send requests

| Name | Address |
|------|---------|
| Production | `https://gib.show` |
| Staging | `https://staging.gib.show` |

Use production in your applications. Staging is where changes are tried first, so it can change or break.

## What you can do

- Show a token logo in your application with one `img` tag. See [First requests](/getting-started/first-requests/).
- Show a network logo in a chain selector.
- Download a token list for a chain and use it in a wallet or an exchange interface.
- Search tokens by name, symbol or address across every chain.
- Build and publish your own token list in the [studio](/list-management/overview/).
- Run your own copy. See [Self-hosting](/self-hosting/overview/).

## Next steps

1. Try the [first requests](/getting-started/first-requests/).
2. Read the [API reference overview](/api-reference/overview/) for the rules that apply to every endpoint.
3. Open the [endpoint reference](/reference/) for every path and parameter.
