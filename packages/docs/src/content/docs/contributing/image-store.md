---
title: Image store internals
description: How the content-addressed image store, its adapters and its composites work, and the rules every adapter keeps.
sidebar:
  order: 5
---

Image bytes live in a content-addressed store in `packages/server/src/image-store/`. This page explains how the code works. To choose and configure a store, read [Image storage](/self-hosting/image-storage/).

## The interface

`getImageStore()` returns a `BlobStore` with `put`, `get`, `stat`, `delete` and `list`. `hashBytes()` gives the `sha256` of the stored bytes.

Which store you get comes from `IMAGE_STORE`, which `store-config.ts` parses. `initializeImageStore()` builds the store at start-up in both the server and the collector. A missing or invalid setting stops the process with one line that names the setting. It never prints a secret's value.

## Adapters

- **`local.ts`** keeps files at `<root>/sha256/<first two hex>/<64 hex>`, with no extension. A write goes to `<root>/tmp/`, is flushed, is renamed into place, and then its shard directory is flushed. Building the store sweeps temporary files older than an hour.
- **`s3.ts` and `sigv4.ts`** are one implementation of the S3 interface and a small Signature Version 4 signer. Provider presets are data in `S3_PRESETS`. The project chose this over the AWS software development kit, which adds about twenty megabytes for the same six requests.
- **`gcs.ts`** uses the native JSON API with service-account sign-in. It does not use S3 interoperability keys.
- **`azure.ts`** supports Shared Key or a shared access signature token.
- **`ipfs.ts` and `cid-index.ts`** pin through a Kubo remote procedure call node or Pinata, and read through gateways whose bytes are hashed. The `image_store_cid` table maps the `sha256` to the content identifier, and it answers `stat` and `list`.

The remote adapters share `object-blob-store.ts`:

- Keys are `[prefix]sha256/<2 hex>/<64 hex>`.
- A `put` of a blob that is already stored renews its age with a server-side copy (or a metadata change) and sends no bytes.
- `list` follows paging.

## Composites

`composite.ts` builds composites only from other stores, so they nest:

- **`tiered`** is a bounded local cache, by recency, in front of another store. It reads through and writes through.
- **`mirrored`** writes to all its stores and reads from the first that answers. Its `list` is the union.
- **`fallback`** reads a second store that it never writes to, lists or deletes from. `images gc` therefore cannot touch it.

## Rules every adapter keeps

`__testing__/blob-store-contract.ts` runs these rules against every adapter:

- A malformed digest throws `TypeError` before storage is touched.
- `get` and `stat` answer `null`, and `delete` answers `false`, for a missing blob.
- Only a real "not found" answer counts as missing. A 403 is an error.
- `stat` and `list` give a `modifiedAtMs` that a repeated `put` moves forward.

An S3 `HEAD` request gives whole seconds, and a listing gives milliseconds. The adapter truncates the listing so both agree.

## Tests

Unit tests inject `fetch`, the clock and the file system, so the coverage run needs no Docker.

The emulator suites (`*.emulator.test.ts`) run the same contract against real servers in Docker: MinIO (`cgr.dev/chainguard/minio`), Azurite, fake-gcs-server and Kubo. Run them with:

```bash
yarn workspace server run test:emulators
```

That sets `IMAGE_STORE_EMULATORS=1`. The suites are skipped otherwise.

There is one known emulator limit. fake-gcs-server does not move `updated` on a metadata `PATCH`. Its renewal test is skipped there and covered against the unit fake.

## Image bytes: the store and the database

The store holds image bytes. The server and the collector must share the same store, which for `local` means the same directory (`IMAGE_STORE_DIR`).

- `image_hash` is unchanged. It is the primary key and the public `/image/direct/<hash>` address. It is derived from the downloaded bytes, the source address and the extension. It is **not** a hash of the bytes served.
- `image.content_sha256` **is** the hash of the sanitised bytes, and the file's name. `image.byte_size` is their length. A link-only row has length 0, no digest and no file.
- **Write order.** `insertImage` writes the file **before** the row, because the row may sit in a long transaction. A rollback leaves an orphan file, which `images gc` removes. A row never points to a missing file. A `put` renews the age of a file it reuses.
- **Read path.** Queries select `CASE WHEN content_sha256 IS NULL THEN content END` (`db/image-columns.ts`). Routes call `withImageBytes` or `loadImageBytes` (`image-store/image-bytes.ts`). They take the bytes from the row when it has no digest, and from the file otherwise. A missing file is logged, and the request falls through to the ordinary redirect or 404 branches. Never select `image.content` directly. Keep `res.contentType(ext).send(buffer)`, so the ETag and 304 answers stay identical.
- `IMAGE_BYTES_IN_DATABASE` (default `true`) decides whether the database copy is still written. A trigger from migration 0022 clears a digest that stops matching its bytes. That covers the previous release writing `content` during a rolling deploy. See [Moving between stores](/self-hosting/moving-between-stores/#image-bytes-in-the-database).
- The operator command is `src/bin/images.ts`. See [Moving between stores](/self-hosting/moving-between-stores/) for `export`, `verify`, `import`, `gc` and `copy`. They all go through the `BlobStore` interface.
- The `content` column is dropped in a later migration, after production has run with the bytes switched off.
