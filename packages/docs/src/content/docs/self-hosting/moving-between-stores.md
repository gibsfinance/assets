---
title: Moving between stores
description: Copy images from one store to another, fill the store from database rows, verify it, roll back, and clean up.
sidebar:
  order: 7
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

`export`, `verify`, `import` and `gc` work on whichever store `IMAGE_STORE` names.

A `fallback` store never lets `gc` delete from its read-only side.

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
