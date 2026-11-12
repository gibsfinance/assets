---
title: Local storage
description: Where the studio keeps your lists, and how to avoid losing them.
sidebar:
  order: 8
---

The studio stores lists in IndexedDB, not in `localStorage`. This lets it hold large lists without hitting size limits. Each list is stored under the key `gib-list:{uuid}`.

Your lists persist across browser sessions. They are lost if you clear your browser data.

**Back up important lists.** Use [Publishing](/list-management/publishing/) to push them to GitHub.

Custom node addresses are different. They are stored in `localStorage`, under `gib-custom-rpcs`. See [Loading metadata from a chain](/list-management/rpc-metadata/).
