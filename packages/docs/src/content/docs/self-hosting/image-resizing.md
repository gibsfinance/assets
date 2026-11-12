---
title: Image resizing
description: How the server resizes images on the fly, how it caches the results, and which limits apply.
sidebar:
  order: 8
---

The server resizes images on the fly with query parameters:

```
GET /image/{chainId}/{address}?w=72&h=72&as=webp
```

- `sharp` does the resizing.
- Results are cached in the `image_variant` table, so they survive restarts.
- The limiter allows 5 new variants per image per minute, and 100 new variants per minute across all images, in each server process.
- A daily job removes variants that were used fewer than 3 times in the last 24 hours.
- A vector image (`svg`) with a `viewBox` passes through unchanged.

The options themselves are on [Image options](/api-reference/image-options/). To limit memory use on a small host, see the `SHARP_*` settings on [Configuration](/self-hosting/configuration/#runtime-limits).
