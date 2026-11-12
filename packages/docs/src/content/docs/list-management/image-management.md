---
title: Image management
description: Give each token in a list a custom image, by upload or by remote URL.
sidebar:
  order: 4
---

Each token can have a custom image:

- Click the token's image in the editor to open the image manager.
- Upload a local file. The studio accepts `svg`, `png`, `webp` and `jpg` files.
- Or set a remote URL.
- Preview the image at several sizes: 32, 64, 128 and 256 pixels.
- A format indicator shows whether the image is `svg`, `png` or `webp`.

The previews use the server's resize endpoint: `?w=N&h=N&as=webp`. See [Image options](/api-reference/image-options/).

To suggest an image for the public service instead of for your own list, use the [image submission endpoint](/api-reference/submissions/#submit-a-token-image).
