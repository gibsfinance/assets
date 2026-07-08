# Operational SQL scripts

Manually-run, one-shot maintenance scripts. Unlike the migrations in `drizzle/`,
these are **not** applied automatically on deploy — an operator runs them by hand,
after reviewing the effect, when a specific cleanup is needed.

## Non-Ethereum-Virtual-Machine faked-network cleanup

Two scripts that remove the stale networks earlier collector runs filed under
fabricated Ethereum-Virtual-Machine chain ids (Solana under `eip155-900`, Tron under
`eip155-1000`, The-Open-Network under a `tvm`-typed `eip155-1`). Increment 2a/3 fixed
the collectors to write the correct coin-type ids (`solana-501`, `tvm-195`, `ton-607`),
leaving those old rows as stale duplicates.

Run in order, on staging first, then production:

1. **Preview (read-only).** Lists exactly what would be deleted and, per network, a
   `reincarnated_token_count` — how many of its tokens already exist under a correct
   (non-`eip155`) network. When that equals `token_count`, deleting the faked network
   loses no unique data.

   ```bash
   psql "$DATABASE_URL" -f scripts/preview-nonevm-faked-networks.sql
   ```

2. **Cleanup (irreversible delete).** Only run once the preview looks right and a full
   collection cycle has re-populated the correct-id rows.

   ```bash
   psql "$DATABASE_URL" -f scripts/cleanup-nonevm-faked-networks.sql
   ```

### Why these are safe

The target predicate is self-validating: it matches only an `eip155-*` network whose
tokens contain **no** Ethereum-Virtual-Machine address (`0x` + 40 hex). A genuine
Ethereum-Virtual-Machine chain always has such tokens, so it can never be selected —
including the real Ethereum mainnet that shares `chain_id = eip155-1` with the faked
The-Open-Network row (they are distinct `network_id`s; only the base58/base64url one
matches). The cleanup is idempotent: once the faked rows are gone the predicate matches
nothing, so re-running is a no-op.

### Promoting to an automatic migration

If you later prefer this to run automatically (matching the `0003`/`0004` cleanup
migrations), the two `DELETE` statements can be lifted verbatim into a numbered
`drizzle/000N_*.sql` migration — drop the temp table and `_data_migrations` marker and
keep the predicate. Do that only after the manual runs have confirmed the predicate
selects exactly the intended rows on real data.
