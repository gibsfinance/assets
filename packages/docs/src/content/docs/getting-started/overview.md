---
title: What Gib is
description: Gib is an open-source engine that collects token and network artwork and token lists from many providers and serves them over HTTP. Run your own instance, or use the public one at gib.show.
sidebar:
  order: 1
---

Gib is an open-source engine for serving images. It gives you the logo of a token or a blockchain network at a predictable address. It also gives you token lists in the standard Uniswap token list format.

An instance needs no account, no API key and no sign-in from the people who call it. Every endpoint that this documentation describes is public.

## How it works

Gib collects token data and artwork from many providers. The engine ships with more than 30 collectors. Examples are CoinGecko, Trust Wallet, SmolDapp and PulseX. A self-hosted instance chooses which providers it collects from. The engine stores the images, sorts the providers by trust, and serves the best image it has for each token.

When more than one provider has an image for the same token, Gib picks one. [Image priority](/api-reference/image-priority/) explains how.

Gib is an index. It does not own the artwork it serves. Every image response tells you where the image came from and under which licence. Read [Image options](/api-reference/image-options/) for the response headers. The public instance publishes its terms at [gib.show/terms](https://gib.show/terms).

## Use the public instance or run your own

Anyone can run Gib. See [Self-hosting](/self-hosting/overview/) to start your own instance.

The project also runs a public instance at `https://gib.show`. You are free to use it. It is one option, not the only one. Every path in this documentation works the same on any instance, so you can swap the host later without changing anything else.

Examples in these pages use `https://gib.show` because a copy-and-paste example needs a real host.

## What you can do

- Show a token logo in your application with one `img` tag. See [First requests](/getting-started/first-requests/).
- Show a network logo in a chain selector.
- Download a token list for a chain and use it in a wallet or an exchange interface.
- Search tokens by name, symbol or address across every chain.
- Build and publish your own token list in the [studio](/list-management/overview/).
- Run your own instance. See [Self-hosting](/self-hosting/overview/).

## Next steps

1. Try the [first requests](/getting-started/first-requests/).
2. Read the [API reference overview](/api-reference/overview/) for the rules that apply to every endpoint.
3. Open the [endpoint reference](/reference/) for every path and parameter.
