---
title: Database and primary keys
description: The Drizzle schema, how migrations work, and why every primary key is a Keccak-256 hash built in the database.
sidebar:
  order: 4
---

## Drizzle

The project moved from Knex to Drizzle in March 2026. Drizzle is the object-relational mapper.

- **Schema:** `packages/server/src/db/schema.ts`. It defines 19 tables, with custom `bytea` and `citext` types.- **Client:** `packages/server/src/db/drizzle.ts`. It uses `casing: 'snake_case'`.
- **Migrations:** `packages/server/drizzle/`. At the time of writing they run from `0000` to `0023`. They hold the baseline plus hand-written follow-ups, which generally use `IF NOT EXISTS` guards.

The old Knex files moved to `_backup/knex/`, which git ignores.

### Table relationships

```
provider → list (1:many)
provider → tag (1:many)
list → list_token (1:many)
list_token → token (many:1)
token → network (many:1)
list_token → image (many:1, nullable)
image → link (1:many, address cache)
image → image_variant (1:many, resize cache)
list_order → list_order_item (1:many)
bridge → bridge_link (1:many)
bridge_link → token ×2 (native and bridged)
list_token → header_link (1:1, optional banner)
list_submission (standalone)
```

### Migrations

Both the server and the collector apply migrations when they start. Drizzle skips applied migrations by their timestamp in `_journal.json`, not by file hash. Editing an old migration therefore does not disturb existing databases.

The snapshots in `drizzle/meta/` are aligned with the migrations. Migration `0015_realign_snapshot_with_applied_migrations` closed an earlier drift, where `drizzle/meta/` had stopped at `0010` while migrations ran to `0014`. `yarn db:migrate-generate` now reports "No schema changes, nothing to migrate" against a clean tree. Treat any other answer as a sign that `schema.ts` and the migrations have parted company. Read what it emits before you commit it.

When you must write a migration by hand, for example to add a guard that `drizzle-kit` will not emit (`0016` wraps a `CREATE EXTENSION` that a restricted database may refuse):

1. Still declare the change in `schema.ts`.
2. Run `generate`.
3. Keep the generated snapshot under the hand-written migration's number.
4. Delete the generated `.sql` file.

That keeps the schema and the migrations aligned.

Migration `0016` adds the `pg_trgm` indexes that the search needs. See [Search](/contributing/search/).

## Primary keys and the plain Postgres image

The database runs on the plain `postgres:16` image (`docker-compose.yml`, with `PGDATA=/var/lib/postgresql/data/pgdata16`). There is no custom database image.

Every primary key is the `keccak256` of its natural key, built by a `BEFORE INSERT` trigger (the `gcid_*` functions). The `keccak256(text)` function they call is written in pure `PL/pgSQL`. It is defined in `0021_keccak256_in_plpgsql`. It used to be written in `PL/Python` with `safe-pysha3`, which is why the database once needed its own image. Migration `0021` also drops the `plpython3u` extension.

### The hash is fixed

The output is Keccak-256, not NIST SHA-3, of the UTF-8 text. It is lowercase hexadecimal with no `0x`, and `NULL` is hashed as the empty string. Stored rows refer to each other by these ids, so **never change it**.

`packages/server/test/keccak256.test.ts` pins the function to values recorded from the old `PL/Python` function and to the `keccak256` of viem, which the application uses for the same ids.

### The cost

Each hash costs about 1 millisecond. `PL/Python` cost about 0.03. Each insert into a table with one of these triggers pays the cost once. Upserts that conflict pay it too. Do not add a second hash per row without a reason.

Migration `0000` no longer creates the extension or the function. A fresh database gets the function from `0021`, and no earlier migration inserts a row.
