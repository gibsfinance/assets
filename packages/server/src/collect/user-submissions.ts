import { RemoteTokenListCollector } from './remote-tokenlist'
import type { BaseCollector } from './base-collector'
import { failureLog } from '@gibs/utils'
import { getDrizzle } from '../db/drizzle'
import { eq, sql as dsql } from 'drizzle-orm'
import * as s from '../db/schema'

/**
 * Loads all approved list submissions from the DB and creates
 * RemoteTokenListCollector instances for each.
 *
 * Called during collection startup to dynamically register
 * user-submitted lists alongside hardcoded collectors.
 *
 * Returns a map of providerKey -> collector, ready to merge
 * into the collectables map.
 */
export async function loadSubmissionCollectors(): Promise<Record<string, BaseCollector>> {
  const db = getDrizzle()
  const submissions = await db.select().from(s.listSubmission).where(eq(s.listSubmission.status, 'approved'))

  const collectors: Record<string, BaseCollector> = {}

  for (const sub of submissions) {
    collectors[sub.providerKey] = new RemoteTokenListCollector(sub.providerKey, {
      providerKey: sub.providerKey,
      listKey: sub.listKey,
      tokenList: sub.url,
    })
  }

  if (submissions.length > 0) {
    console.log(`Loaded ${submissions.length} user-submitted list collector(s)`)
  }

  return collectors
}

/**
 * After a submission's list is collected, update its metadata:
 * - Reset fail count on success
 * - Increment fail count on failure
 * - Update content hash and last fetched timestamp
 * - Mark stale after 5 consecutive failures
 */
export async function updateSubmissionStatus(
  providerKey: string,
  options: { success: boolean; contentHash?: string },
): Promise<void> {
  const db = getDrizzle()
  const [sub] = await db.select().from(s.listSubmission).where(eq(s.listSubmission.providerKey, providerKey)).limit(1)

  if (!sub || sub.status !== 'approved') return

  if (options.success) {
    await db
      .update(s.listSubmission)
      .set({
        failCount: 0,
        lastFetchedAt: new Date().toISOString(),
        ...(options.contentHash ? { lastContentHash: options.contentHash } : {}),
      })
      .where(eq(s.listSubmission.id, sub.id))
  } else {
    const newFailCount = sub.failCount + 1
    const updates: Record<string, unknown> = {
      failCount: newFailCount,
      lastFetchedAt: new Date().toISOString(),
    }
    if (newFailCount >= 5) {
      updates.status = 'stale'
      failureLog('Submission %s marked stale after %d failures', providerKey, newFailCount)
    }
    await db.update(s.listSubmission).set(updates).where(eq(s.listSubmission.id, sub.id))
  }
}

/**
 * Bump subscriber count when a list is accessed by a client.
 * Called from the list serving endpoints.
 */
export async function bumpSubscriberCount(providerKey: string): Promise<void> {
  const db = getDrizzle()
  await db
    .update(s.listSubmission)
    .set({
      subscriberCount: dsql`${s.listSubmission.subscriberCount} + 1`,
      lastAccessedAt: new Date().toISOString(),
    })
    .where(eq(s.listSubmission.providerKey, providerKey))
}
