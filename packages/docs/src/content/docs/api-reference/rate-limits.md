---
title: Rate limits
description: Gib does not limit how often you fetch an image. It does limit how many new resized variants it makes.
sidebar:
  order: 13
---

The Gib engine has no request limit. Nothing in it counts or throttles requests as they arrive. An operator can still put a proxy or a content delivery network in front of an instance, and that layer can set its own limits.

## The variant limit

The image-resize pipeline has a rate limiter. It guards against a flood of resize **variants** filling the cache. It does not limit how many times you can fetch an image.

These limits are built into the engine. Each server process allows:

- 5 new variants per image per minute.
- 100 new variants per minute across all images.

When a budget is spent, Gib still sends you the resized image. It only does not store the new variant. The limits count per server process.

A daily job removes variants that were used fewer than three times in the last 24 hours.

## What we ask of you

This applies most to the public instance at `gib.show`, which the project pays to run. Be reasonable. A heavy user should cache with the long-lived, immutable `/image/direct/{imageHash}` route. Do not fetch the same token or chain image again on every request. See [Caching](/api-reference/caching/).

Request limits may be introduced later on the public instance. This page will say so plainly if they are.
