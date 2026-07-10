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

The target is an explicit allow-list of the four reviewed faked Solana/Tron networks —
`eip155-900` and `eip155-501000101` (Solana, re-homed to `solana-501`), and `eip155-1000`
and `eip155-728126428` (Tron, re-homed to `tvm-195`). An earlier version used a broad
"any `eip155-*` network with no `0x`-hex token" predicate, but a staging preview showed it
also matched genuinely-unhandled chains that were never faked duplicates and have **no**
re-homed copy — BRC-20/Runes (`eip155-2203`), Algorand (`eip155-4160`), and Ontology
(`eip155-58`). Deleting those would lose data, so the scope is narrowed to the reviewed
duplicates only; those other chains need their own coin-type namespaces (future work).

Within the allow-list the `no-hex-token` guard is kept as a second layer: a row is deleted
only if its tokens contain **no** Ethereum-Virtual-Machine address (`0x` + 40 hex), so a
real Ethereum-Virtual-Machine chain that reused one of these numeric ids (some tooling
assigns Tron the `eip155-728126428` id) is still protected. The cleanup is idempotent:
once the allow-listed rows are gone the predicate matches nothing, so re-running is a no-op.

**Caveat — not-yet-re-homed tokens.** The preview's `token_count` minus
`reincarnated_token_count` is the count of tokens that exist **only** under the faked id
(not yet re-collected under the correct one). Deleting drops those rows until a future
collection re-homes them. Run only when that remainder is an acceptable loss.

### Promoting to an automatic migration

If you later prefer this to run automatically (matching the `0003`/`0004` cleanup
migrations), the two `DELETE` statements can be lifted verbatim into a numbered
`drizzle/000N_*.sql` migration — drop the temp table and `_data_migrations` marker and
keep the predicate. Do that only after the manual runs have confirmed the predicate
selects exactly the intended rows on real data.
