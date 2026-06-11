/**
 * Executes migration 0005 (dedupe_tokens_normalize_case) against a database
 * seeded with the exact adversarial shapes its collision guards exist for.
 *
 * Why: the CI migration run only ever executes 0005 against an EMPTY database
 * (every dedupe statement is a no-op), and the staging database ran the
 * original unguarded version — so without this test, the guards' first
 * contact with real duplicate data would be the production deploy.
 *
 * The test recreates the pre-migration world (case-preserving token trigger,
 * no uniqueness constraint), seeds:
 *   - three case-variants of one address where the winner is decided by
 *     list_token reference count,
 *   - a loser sharing a list with the winner            (guard 2a),
 *   - two losers sharing a list the winner is absent from (guard 2b),
 *   - bridge_links where loser and winner both link the same bridge
 *     counterpart                                        (guard 3a),
 *   - a bridged-side loser reference                     (guard 3b),
 * then executes the real migration file statement-by-statement in one
 * transaction (matching how drizzle's migrator runs it — the temp table is
 * session-scoped) and asserts the collapsed end state. The migration's own
 * steps 5-6 restore the lowercasing trigger and the unique constraint.
 */
import { test } from 'node:test'
import assert from 'assert'
import * as fs from 'fs'
import * as viem from 'viem'
import { sql as dsql, eq, and, inArray } from 'drizzle-orm'
import * as db from '../src/db'
import * as s from '../src/db/schema'
import { getDrizzle } from '../src/db/drizzle'
import { isDbAvailable } from './db-available'

const MIGRATION_PATH = new URL('../drizzle/0005_dedupe_tokens_normalize_case.sql', import.meta.url).pathname

/** The pre-0005 trigger body: hashes provided_id case-SENSITIVELY. */
const OLD_TOKEN_TRIGGER = `
CREATE OR REPLACE FUNCTION gcid_token_token_id_networkid_providedid()
RETURNS TRIGGER AS $$
BEGIN
    NEW.token_id := keccak256(NEW.network_id::text || NEW.provided_id::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;`

/** Re-apply 0005's steps 5-6 so a mid-test failure cannot leave the old world behind. */
const NEW_TOKEN_TRIGGER = `
CREATE OR REPLACE FUNCTION gcid_token_token_id_networkid_providedid()
RETURNS TRIGGER AS $$
BEGIN
    NEW.token_id := keccak256(NEW.network_id::text || lower(NEW.provided_id::text));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;`

const RESTORE_CONSTRAINT = `
DO $do$ BEGIN
  ALTER TABLE token ADD CONSTRAINT token_network_provided_unique UNIQUE (network_id, provided_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $do$;`

test(
  'migration 0005 collapses case-variant duplicates without primary-key collisions',
  { skip: !(await isDbAvailable()) && 'no database connection' },
  async (t) => {
    const drizzle = getDrizzle()

    // Case variants of one logical address — distinct strings, citext-equal.
    const BASE = 'a1077a294dde1b09bb078844df40758a5d0f9a27'
    const WINNER_CASING = `0x${BASE.toUpperCase()}`
    const LOSER_X_CASING = `0x${BASE}`
    const LOSER_Y_CASING = `0x${BASE.slice(0, 20).toUpperCase()}${BASE.slice(20)}`

    const insertRawToken = async (providedId: string, networkId: string) => {
      const [row] = await drizzle
        .insert(s.token)
        .values({
          tokenId: dsql`''` as unknown as string,
          type: 'erc20',
          providedId,
          name: `Dedupe ${providedId.slice(-4)}`,
          symbol: 'DDP',
          decimals: 18,
          networkId,
        })
        .returning()
      return row
    }

    const insertRawListToken = async (tokenId: string, listId: string, order: number) => {
      const [row] = await drizzle
        .insert(s.listToken)
        .values({
          listTokenId: dsql`''` as unknown as string,
          tokenId,
          listId,
          listTokenOrderId: order,
        })
        .returning()
      return row
    }

    const insertRawBridgeLink = async (nativeTokenId: string, bridgedTokenId: string, bridgeId: string) => {
      const [row] = await drizzle
        .insert(s.bridgeLink)
        .values({
          bridgeLinkId: dsql`''` as unknown as string,
          nativeTokenId,
          bridgedTokenId,
          bridgeId,
          transactionHash: viem.keccak256(viem.toBytes(`${nativeTokenId}-${bridgedTokenId}`)),
        })
        .returning()
      return row
    }

    const cleanupIds: { providerId?: string; networkIds: string[]; tokenIds: string[] } = {
      networkIds: [],
      tokenIds: [],
    }

    t.after(async () => {
      // Fixtures must go FIRST: while case-variant duplicates exist, re-adding
      // the unique constraint fails (unique_violation is not caught by the DO
      // block) and would abort this cleanup, leaving the database polluted for
      // every later ON CONFLICT in the suite.
      if (cleanupIds.tokenIds.length) {
        await drizzle.delete(s.bridgeLink).where(inArray(s.bridgeLink.nativeTokenId, cleanupIds.tokenIds))
        await drizzle.delete(s.bridgeLink).where(inArray(s.bridgeLink.bridgedTokenId, cleanupIds.tokenIds))
        await drizzle.delete(s.token).where(inArray(s.token.tokenId, cleanupIds.tokenIds))
      }
      if (cleanupIds.providerId) {
        await drizzle.delete(s.bridge).where(eq(s.bridge.providerId, cleanupIds.providerId))
        await drizzle.delete(s.provider).where(eq(s.provider.providerId, cleanupIds.providerId))
      }
      if (cleanupIds.networkIds.length) {
        await drizzle.delete(s.network).where(inArray(s.network.networkId, cleanupIds.networkIds))
      }
      // Whatever happened, leave the canonical trigger + constraint in place.
      await drizzle.execute(dsql.raw(NEW_TOKEN_TRIGGER))
      await drizzle.execute(dsql.raw(RESTORE_CONSTRAINT))
    })

    // --- Recreate the pre-migration world -----------------------------------
    await drizzle.execute(dsql.raw(OLD_TOKEN_TRIGGER))
    await drizzle.execute(dsql.raw('ALTER TABLE token DROP CONSTRAINT IF EXISTS token_network_provided_unique'))

    const [provider] = await db.insertProvider({ name: 'Dedupe Migration Test', key: 'dedupe-migration-test' })
    cleanupIds.providerId = provider.providerId
    const home = await db.insertNetworkFromChainId(98761, 'test')
    const foreign = await db.insertNetworkFromChainId(98762, 'test')
    cleanupIds.networkIds.push(home.networkId, foreign.networkId)

    const lists = await Promise.all(
      ['dedupe-l0', 'dedupe-l1', 'dedupe-l2', 'dedupe-l3'].map(async (key) => {
        const [list] = await db.insertList({ providerId: provider.providerId, key })
        return list
      }),
    )
    const [l0, l1, l2, l3] = lists

    // Three case variants → three distinct token rows under the old trigger.
    const winner = await insertRawToken(WINNER_CASING, home.networkId)
    const loserX = await insertRawToken(LOSER_X_CASING, home.networkId)
    const loserY = await insertRawToken(LOSER_Y_CASING, home.networkId)
    assert.notStrictEqual(winner.tokenId, loserX.tokenId, 'old trigger must hash case-sensitively')
    assert.notStrictEqual(winner.tokenId, loserY.tokenId, 'old trigger must hash case-sensitively')
    // Distinct counterpart tokens for the bridge links.
    const counterZ = await insertRawToken('0x000000000000000000000000000000000000beef', foreign.networkId)
    const counterZ2 = await insertRawToken('0x000000000000000000000000000000000000cafe', foreign.networkId)
    cleanupIds.tokenIds.push(winner.tokenId, loserX.tokenId, loserY.tokenId, counterZ.tokenId, counterZ2.tokenId)

    // Reference counts decide the winner: W=3, X=2, Y=1.
    await insertRawListToken(winner.tokenId, l0.listId, 0)
    await insertRawListToken(winner.tokenId, l1.listId, 0)
    await insertRawListToken(winner.tokenId, l2.listId, 0)
    // Guard 2a: X shares list l1 with the winner.
    await insertRawListToken(loserX.tokenId, l1.listId, 1)
    // Guard 2b: X and Y share list l3, where the winner is absent.
    await insertRawListToken(loserX.tokenId, l3.listId, 0)
    await insertRawListToken(loserY.tokenId, l3.listId, 1)

    const bridge = await db.insertBridge({
      type: 'omnibridge',
      providerId: provider.providerId,
      homeNetworkId: home.networkId,
      homeAddress: '0x1111111111111111111111111111111111111111',
      foreignNetworkId: foreign.networkId,
      foreignAddress: '0x2222222222222222222222222222222222222222',
    })
    // Guard 3a: winner AND loser X both link the same counterpart on this bridge.
    await insertRawBridgeLink(winner.tokenId, counterZ.tokenId, bridge.bridgeId)
    await insertRawBridgeLink(loserX.tokenId, counterZ.tokenId, bridge.bridgeId)
    // Clean reparent: only loser Y links counterZ2.
    await insertRawBridgeLink(loserY.tokenId, counterZ2.tokenId, bridge.bridgeId)
    // Guard 3b: loser referenced on the bridged side.
    await insertRawBridgeLink(counterZ.tokenId, loserY.tokenId, bridge.bridgeId)

    // --- Execute the real migration file ------------------------------------
    // One transaction = one session, matching drizzle's migrator (the temp
    // table _token_dedup is session-scoped).
    const statements = fs
      .readFileSync(MIGRATION_PATH, 'utf8')
      .split('--> statement-breakpoint')
      .map((stmt) => stmt.trim())
      .filter(Boolean)
    assert.ok(statements.length >= 8, 'migration file should contain all dedupe steps')
    await drizzle.transaction(async (tx) => {
      for (const statement of statements) {
        await tx.execute(dsql.raw(statement))
      }
    })

    // --- Assert the collapsed world ------------------------------------------
    // Exactly one token row survives for the citext-equal address, and it is
    // the most-referenced variant.
    const survivors = await drizzle
      .select()
      .from(s.token)
      .where(and(eq(s.token.networkId, home.networkId), eq(s.token.providedId, WINNER_CASING)))
    assert.strictEqual(survivors.length, 1, 'exactly one case-variant token row must survive')
    assert.strictEqual(survivors[0].tokenId, winner.tokenId, 'the most-referenced variant must win')

    // Every list ends with exactly one membership row pointing at the winner —
    // including l3, where two losers would have collided (guard 2b).
    for (const list of [l0, l1, l2, l3]) {
      const rows = await drizzle.select().from(s.listToken).where(eq(s.listToken.listId, list.listId))
      assert.strictEqual(rows.length, 1, `list ${list.key} must hold exactly one row after dedupe`)
      assert.strictEqual(rows[0].tokenId, winner.tokenId, `list ${list.key} row must point at the winner`)
    }

    // Bridge links: the (winner, Z) collision collapsed to one row (guard 3a),
    // Y's links reparented to the winner on both sides (guard 3b).
    const links = await drizzle.select().from(s.bridgeLink).where(eq(s.bridgeLink.bridgeId, bridge.bridgeId))
    const linkPairs = links.map((l) => `${l.nativeTokenId}|${l.bridgedTokenId}`).sort()
    assert.deepStrictEqual(
      linkPairs,
      [
        `${counterZ.tokenId}|${winner.tokenId}`,
        `${winner.tokenId}|${counterZ.tokenId}`,
        `${winner.tokenId}|${counterZ2.tokenId}`,
      ].sort(),
      'bridge links must collapse the collision and reparent both columns to the winner',
    )

    // The replaced trigger now lowercases: inserting yet another casing through
    // the normal upsert path resolves to the surviving winner row.
    const reinserted = await db.insertToken({
      providedId: `0x${BASE}`,
      symbol: 'DDP',
      name: 'Dedupe Reinsert',
      decimals: 18,
      networkId: home.networkId,
    })
    assert.strictEqual(reinserted.tokenId, winner.tokenId, 'post-migration trigger must dedupe future case variants')

    // The uniqueness constraint is back in place.
    const constraint = await drizzle.execute<{ conname: string }>(
      dsql`SELECT conname FROM pg_constraint WHERE conname = 'token_network_provided_unique'`,
    )
    assert.strictEqual(constraint.rows.length, 1, 'unique constraint must be restored by the migration')
  },
)
