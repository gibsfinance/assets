---
title: Moving between stores
description: Copy images from one store to another, fill the store from database rows, verify it, roll back, and clean up.
sidebar:
  order: 8
---

The `images` command moves and checks image bytes. It works through the same store interface as the server, so it acts on whichever store `IMAGE_STORE` names.

Run it from `packages/server`:

```bash
yarn workspace server run start:images <command>
```

That runs `node --import ./src/bin/register-hooks.ts ./src/bin/images.ts <command>`.

## Copy between any two stores

```sh
node --import ./src/bin/register-hooks.ts ./src/bin/images.ts copy \
  --from local --to '{"type":"s3","envPrefix":"IMAGE_STORE_NEW_S3_"}'
```

`images copy` works on any two stores. Each side (`<spec>`) is a kind name or the `IMAGE_STORE` JSON. The command:

- Skips blobs the destination already holds with the same length.
- Hashes every blob it reads. A blob that does not match is reported and never written.
- Exits with status 1 if any blob is corrupt, unreadable or refused.

Run it again to finish an interrupted copy. Use `--concurrency N` to set how many blobs it moves at once.

## The other commands

| Command | What it does |
|---------|--------------|
| `export` | Copies the bytes of existing image rows from the database into the store. It can be resumed. |
| `verify` | Checks the stored images against the database rows. Add `--rehash` to hash every blob again. It exits with status 1 on any problem. |
| `import` | Rollback. Copies bytes from the store back into the `content` column. |
| `gc` | Garbage collection. It is a dry run unless you pass `--no-dry-run`. It keeps files younger than `--grace-days` (default 7). It deletes only through the store's `delete` function. |
| `copy` | Moves every blob between two stores, as described above. |
| `resanitize` | Runs the current vector image sanitizer over every stored vector image. It is a dry run unless you pass `--no-dry-run`. It rewrites only the images whose cleaned bytes differ, and it exits with status 1 if a file is missing or the sanitizer refuses an image. See below. |

`export`, `verify`, `import` and `gc` work on whichever store `IMAGE_STORE` names.

A `fallback` store never lets `gc` delete from its read-only side.

## Cleaning stored vector images again

The sanitizer runs when an image is stored. An image stored before a security fix keeps the bytes the older sanitizer left. Run `images resanitize` after you upgrade to make every stored vector image pass the current sanitizer.

```sh
yarn workspace server run start:images resanitize                # dry run: reports counts only
yarn workspace server run start:images resanitize --no-dry-run --changed-list rewritten-hashes.txt   # rewrites
```

- A rewritten image gets a new file in the store, and its row gets the new digest and length. Its public address (`image_hash`) does not change.
- If the row still holds a copy in the database, that copy changes with the digest.
- The old file stays in the store. Run `images gc` later to remove it, after its grace period.
- It is safe to stop and to run again. A second run reports every image as unchanged.
- A row the sanitizer refuses (the file is not well formed) stays as it is and is listed in `rejectedExamples`. Check those rows by hand.
- It reads rows stored as `.svg` and rows stored as `.svg+xml`, an older spelling of the same format. The summary field `legacyExtensionRows` counts the second kind. Gib serves both as `image/svg+xml`. It does not rename the extension, because the extension is part of the key that makes `image_hash`.
- The summary lists the `image_hash` of every rewritten row in `rewrittenHashes`. With `--changed-list <path>`, the command also appends each hash to that file, one per line, as it rewrites the row, so the list is complete even if the run stops.
- When it rewrites a row, it deletes that image's stored resized variants in the same transaction, so no variant drawn from the old bytes is served again. They are made again on the next request. The summary field `variantsDeleted` counts them. A dry run reports how many would be deleted. A row that is unchanged keeps its variants.
- **Drop the old copies from your edge cache.** Gib serves a vector image at `/image/direct/<hash>` with the ordinary lifetime, not a year. The ordinary lifetime on `gib.show` is one day, plus a seven-day window that serves the old copy while the cache refreshes. A cache can therefore hold the old bytes for up to eight days. To close that window, ask your content delivery network to drop `/image/direct/<hash>` for each hash in the list. The resized forms of an address (`?w=`, `?h=` and `?as=`) are separate entries in the edge cache, and this list does not name them. They have the same ordinary one-day lifetime, so they expire on their own, and the server no longer builds them from the old bytes. On Cloudflare, give the full addresses to the cache purge by URL call, 30 at a time.
- Use `--batch-size` and `--sleep-ms` to leave the database room for other work.

## Image bytes in the database

Older versions kept image bytes in the `image.content` column. The store is now always written. The setting `IMAGE_BYTES_IN_DATABASE` (default `true`) decides whether the database copy is written as well.

Keep it `true` until `images export` has filled the store from the existing rows and `images verify` has passed. The previous release reads the column, and a rollback to it needs the bytes there. After both commands pass, set it to `false`. Rows written afterwards have no `content`, and every reader goes through the store.

A trigger in migration 0022 clears a digest that stops matching its bytes. That covers the previous release writing `content` during a rolling deploy.

The `content` column will be dropped in a later migration, after production has run with the bytes switched off.

## A typical move

1. Set up the new store and its settings under its own `envPrefix`.
2. Run `images copy --from <old> --to <new>`.
3. Run `images verify` against the new store.
4. Point `IMAGE_STORE` at the new store and restart the server and the collector together. Both must use the same store.
5. Keep the old store until you are sure the new one is complete.
