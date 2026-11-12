---
title: Rate limits
description: Gib.Show does not limit how often you fetch an image today. It does limit how many new resized variants it makes.
sidebar:
  order: 13
---

There is no enforced request limit today. Nothing in this service counts or throttles requests as they arrive.

## The variant limit

The image-resize pipeline has a rate limiter. It guards against a flood of resize **variants** filling the cache. It does not limit how many times you can fetch an image.

Each server process allows:

- 5 new variants per image per minute.
- 100 new variants per minute across all images.

When a budget is spent, Gib.Show still sends you the resized image. It only does not store the new variant. The limits count per server process.

A daily job removes variants that were used fewer than three times in the last 24 hours.

## What we ask of you

Be reasonable. A heavy user should cache with the long-lived, immutable `/image/direct/{imageHash}` route. Do not fetch the same token or chain image again on every request. See [Caching](/api-reference/caching/).

Request limits may be introduced later. This page will say so plainly if they are.
